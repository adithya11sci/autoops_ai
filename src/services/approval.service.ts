/**
 * AutoOps AI — Approval Service
 * Human approval gate for risky fix plans.
 * Handles incident grouping to prevent alert fatigue.
 */
import { createChildLogger } from "../utils/logger";
import { getPool } from "./database";
import {
    FixPlan,
    RiskAssessment,
    ApprovalStatus,
} from "./enterprise-types";

const log = createChildLogger("ApprovalService");

const APPROVAL_TIMEOUT_MS = parseInt(
    process.env.APPROVAL_TIMEOUT_MS || "600000"
); // 10 minutes
const APPROVAL_GROUP_WINDOW_MS = parseInt(
    process.env.APPROVAL_GROUP_WINDOW_MS || "300000"
); // 5 minutes
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || "";
const APP_URL = process.env.APP_URL || "http://localhost:3000";

export class ApprovalService {
    /**
     * Create an approval request.
     * Groups incidents for the same service+namespace within 5 minutes.
     */
    async createRequest(
        plan: FixPlan,
        riskAssessment: RiskAssessment,
        incidentId: string,
        serviceName: string,
        namespace: string,
        fixId: string | null
    ): Promise<string> {
        const db = getPool();

        // Check for existing PENDING approval for same service+namespace
        const existing = await db.query(
            `SELECT id, incident_ids FROM approvals 
             WHERE service_name = $1 AND namespace = $2 AND status = 'PENDING'
             AND created_at > NOW() - ($3 || ' milliseconds')::INTERVAL
             ORDER BY created_at DESC LIMIT 1`,
            [serviceName, namespace, APPROVAL_GROUP_WINDOW_MS.toString()]
        );

        let approvalId: string;

        if (existing.rows.length > 0) {
            // Group with existing approval
            approvalId = existing.rows[0].id;
            const currentIds: string[] = existing.rows[0].incident_ids || [];

            if (!currentIds.includes(incidentId)) {
                currentIds.push(incidentId);
                await db.query(
                    "UPDATE approvals SET incident_ids = $1 WHERE id = $2",
                    [currentIds, approvalId]
                );
            }

            log.info(
                { approvalId, incidentId, totalGrouped: currentIds.length },
                "Incident grouped with existing approval request"
            );
        } else {
            // Create new approval
            const result = await db.query(
                `INSERT INTO approvals 
                 (incident_ids, service_name, namespace, fix_id, risk_score, risk_tier, plan_summary, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')
                 RETURNING id`,
                [
                    [incidentId],
                    serviceName,
                    namespace,
                    fixId,
                    riskAssessment.score,
                    riskAssessment.tier,
                    JSON.stringify({
                        title: plan.title,
                        steps: plan.fixSteps.slice(0, 3).map((s) => ({
                            action: s.action,
                            command: s.command?.substring(0, 100),
                        })),
                        totalSteps: plan.fixSteps.length,
                        confidence: plan.confidence,
                        blastRadius: plan.blastRadius,
                    }),
                ]
            );
            approvalId = result.rows[0].id;
            log.info({ approvalId, incidentId }, "New approval request created");
        }

        // Send Slack notification
        await this.sendSlackNotification(approvalId, plan, riskAssessment, serviceName, namespace, incidentId);

        return approvalId;
    }

    /**
     * Wait for a human decision on an approval request.
     * Polls PostgreSQL every 5 seconds, times out after APPROVAL_TIMEOUT_MS.
     */
    async waitForDecision(approvalId: string): Promise<"approved" | "denied" | "timeout"> {
        const startTime = Date.now();
        const pollIntervalMs = 5000;

        while (Date.now() - startTime < APPROVAL_TIMEOUT_MS) {
            const db = getPool();
            const result = await db.query(
                "SELECT status FROM approvals WHERE id = $1",
                [approvalId]
            );

            if (result.rows.length === 0) {
                log.error({ approvalId }, "Approval record not found");
                return "timeout";
            }

            const status: ApprovalStatus = result.rows[0].status;

            if (status === "APPROVED") return "approved";
            if (status === "DENIED") return "denied";

            // Still PENDING — wait and poll again
            await this.sleep(pollIntervalMs);
        }

        // Timeout reached — update approval status
        try {
            const db = getPool();
            await db.query(
                "UPDATE approvals SET status = 'TIMEOUT', decided_at = NOW() WHERE id = $1",
                [approvalId]
            );
        } catch (err: unknown) {
            const error = err as Error;
            log.warn({ approvalId, error: error.message }, "Failed to update timeout status");
        }

        log.warn({ approvalId, timeoutMs: APPROVAL_TIMEOUT_MS }, "Approval request timed out");
        return "timeout";
    }

    /**
     * Record a human decision on an approval request.
     */
    async recordDecision(
        approvalId: string,
        decision: "APPROVED" | "DENIED",
        approverId: string,
        comment: string
    ): Promise<void> {
        const db = getPool();
        await db.query(
            `UPDATE approvals 
             SET status = $1, approver_id = $2, approver_comment = $3, decided_at = NOW()
             WHERE id = $4`,
            [decision, approverId, comment, approvalId]
        );

        log.info(
            { approvalId, decision, approverId },
            `Approval decision recorded: ${decision}`
        );

        // Post outcome back to Slack
        if (SLACK_WEBHOOK_URL) {
            try {
                await fetch(SLACK_WEBHOOK_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        text: `✅ Approval ${approvalId}: ${decision} by ${approverId}. ${comment ? `Comment: ${comment}` : ""}`,
                    }),
                });
            } catch (err: unknown) {
                const error = err as Error;
                log.warn({ error: error.message }, "Failed to post decision to Slack");
            }
        }
    }

    /**
     * Send Slack notification for new approval request.
     */
    private async sendSlackNotification(
        approvalId: string,
        plan: FixPlan,
        riskAssessment: RiskAssessment,
        serviceName: string,
        namespace: string,
        incidentId: string
    ): Promise<void> {
        if (!SLACK_WEBHOOK_URL) {
            log.info("SLACK_WEBHOOK_URL not set — skipping Slack notification");
            return;
        }

        const stepsPreview = plan.fixSteps
            .slice(0, 3)
            .map((s, i) => `${i + 1}. ${s.action}: ${s.command?.substring(0, 80) || "N/A"}`)
            .join("\n");

        const message = {
            text: [
                `🚨 *AutoOps AI — Approval Required*`,
                `*Service:* ${serviceName} | *Namespace:* ${namespace}`,
                `*Incident:* ${incidentId}`,
                `*Risk Score:* ${riskAssessment.score}/100 | *Tier:* ${riskAssessment.tier}`,
                `*Reasons:* ${riskAssessment.reasons.join("; ")}`,
                `*Planned Fix (first 3 steps):*`,
                stepsPreview,
                `*Approve:* ${APP_URL}/api/v1/approvals/${approvalId}`,
                `⏰ Auto-timeout in ${APPROVAL_TIMEOUT_MS / 60000} minutes`,
            ].join("\n"),
        };

        try {
            await fetch(SLACK_WEBHOOK_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(message),
            });
            log.info({ approvalId }, "Slack notification sent");
        } catch (err: unknown) {
            const error = err as Error;
            log.warn({ error: error.message }, "Failed to send Slack notification");
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
