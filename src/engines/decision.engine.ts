/**
 * AutoOps AI — Decision Engine
 * The middleware between planning and execution.
 * Every planned action passes through here.
 *
 * Execution order:
 *   1. Command Validator (HARD_BLOCKED check)
 *   2. Risk Assessment (score + tier)
 *   3. Tier-based routing (auto/notify/approve/block)
 *   4. Groq unavailability fallback
 *
 * Returns a typed DecisionResult.
 */
import { createChildLogger } from "../utils/logger";
import { getPool } from "../services/database";
import { CommandValidatorService } from "../services/command-validator.service";
import { RiskService } from "../services/risk.service";
import { ApprovalService } from "../services/approval.service";
import {
    DecisionResult,
    IncidentContext,
    FixPlan,
    MemoryResult,
    RiskAssessment,
} from "../services/enterprise-types";
import { IncidentState } from "../orchestrator/state";

const log = createChildLogger("DecisionEngine");

export class DecisionEngine {
    private commandValidator: CommandValidatorService;
    private riskService: RiskService;
    private approvalService: ApprovalService;

    constructor(
        commandValidator: CommandValidatorService,
        riskService: RiskService,
        approvalService: ApprovalService
    ) {
        this.commandValidator = commandValidator;
        this.riskService = riskService;
        this.approvalService = approvalService;
    }

    /**
     * Make a decision on whether to execute, notify, await approval, or block.
     */
    async decide(state: IncidentState): Promise<DecisionResult> {
        const incidentId = state.incidentId;

        // ── Step 0: Check if Groq failed and no fix available ──
        if (state.groqFailed && !state.plan) {
            const result: DecisionResult = {
                action: "escalate_human",
                reason: "LLM unavailable and no cached fix found",
            };
            await this.logDecision(incidentId, null, null, null, null, "escalate_human", "groq_unavailable_no_fix");
            return result;
        }

        if (!state.plan || !state.plan.steps || state.plan.steps.length === 0) {
            const result: DecisionResult = {
                action: "escalate_human",
                reason: "No remediation plan available",
            };
            await this.logDecision(incidentId, null, null, null, null, "escalate_human", "no_plan");
            return result;
        }

        // Build FixStep array from plan steps (map PlanStep → FixStep shape)
        const fixSteps = state.plan.steps.map((s) => ({
            action: s.action,
            command: s.description || s.action, // existing PlanStep uses description
            estimatedDurationSec: s.timeoutSeconds,
            rollbackCommand: s.rollback,
        }));

        // ── Step 1: Command Validation ──
        const validation = this.commandValidator.validate(fixSteps);

        if (!validation.safe && validation.reason === "HARD_BLOCKED") {
            log.error(
                { incidentId, blockedSteps: validation.blockedSteps },
                "HARD_BLOCKED command detected — blocking execution"
            );

            const result: DecisionResult = {
                action: "block",
                reason: `HARD_BLOCKED: ${validation.blockedSteps.map((b) => b.pattern).join(", ")}`,
                commandIssue: validation.reason,
            };
            await this.logDecision(incidentId, state.fixId ?? null, state.planSource ?? null, null, null, "block", "hard_blocked");
            return result;
        }

        if (!validation.safe) {
            const result: DecisionResult = {
                action: "block",
                reason: validation.reason || "Validation failed",
                commandIssue: validation.reason,
            };
            await this.logDecision(incidentId, state.fixId ?? null, state.planSource ?? null, null, null, "block", "validation_failed");
            return result;
        }

        // ── Step 2: Risk Assessment ──
        const fixSource = (state.planSource === "template" || state.planSource === "memory" || state.planSource === "llm")
            ? state.planSource
            : "llm";

        const incidentContext: IncidentContext = {
            id: incidentId,
            incidentType: state.issue?.type || "unknown",
            errorSignature: state.rootCause?.category || "unknown",
            severity: (state.issue?.severity || "medium") as IncidentContext["severity"],
            affectedService: state.issue?.affectedService || "unknown",
        };

        const memoryResult: MemoryResult = state.memoryResult || {
            fix: null,
            similarity: 0,
            source: "none",
            trustworthy: false,
        };

        const fixPlan: FixPlan = {
            title: state.plan.title,
            fixSteps,
            confidence: state.plan.riskLevel === "low" ? 0.9 : state.plan.riskLevel === "medium" ? 0.7 : 0.5,
            blastRadius: state.plan.riskLevel === "critical" ? 5 : state.plan.riskLevel === "high" ? 3 : 2,
            hasRollbackPlan: state.plan.rollbackPlan.length > 0,
        };

        const riskAssessment = this.riskService.assessRisk(
            fixPlan,
            incidentContext,
            memoryResult,
            fixSource,
            validation
        );

        // Attach to state for downstream use
        state.riskAssessment = riskAssessment;

        // ── Step 3: Tier-based routing ──
        switch (riskAssessment.tier) {
            case "block": {
                const result: DecisionResult = {
                    action: "block",
                    reason: riskAssessment.reasons.join(", "),
                };
                await this.logDecision(incidentId, state.fixId ?? null, fixSource, riskAssessment.score, riskAssessment.tier, "block", "risk_block");
                return result;
            }

            case "approve": {
                try {
                    const approvalId = await this.approvalService.createRequest(
                        fixPlan,
                        riskAssessment,
                        incidentId,
                        incidentContext.affectedService,
                        incidentContext.namespace || "default",
                        state.fixId ?? null
                    );
                    state.approvalId = approvalId;

                    const decision = await this.approvalService.waitForDecision(approvalId);

                    if (decision === "approved") {
                        const result: DecisionResult = {
                            action: "execute",
                            reason: "Human approved",
                            auditNote: `Approved via approval ${approvalId}`,
                        };
                        await this.logDecision(incidentId, state.fixId ?? null, fixSource, riskAssessment.score, riskAssessment.tier, "execute", "human_approved");
                        return result;
                    }

                    if (decision === "denied") {
                        const result: DecisionResult = {
                            action: "block",
                            reason: "Human denied the fix plan",
                        };
                        await this.logDecision(incidentId, state.fixId ?? null, fixSource, riskAssessment.score, riskAssessment.tier, "block", "human_denied");
                        return result;
                    }

                    // Timeout
                    if (riskAssessment.score >= 75) {
                        const result: DecisionResult = {
                            action: "block",
                            reason: "Approval timeout, high risk — blocking execution",
                        };
                        await this.logDecision(incidentId, state.fixId ?? null, fixSource, riskAssessment.score, riskAssessment.tier, "block", "timeout_high_risk");
                        return result;
                    } else {
                        const result: DecisionResult = {
                            action: "execute_notify",
                            reason: "Approval timeout, medium risk — proceeding with notification",
                            slackMessage: `⚠️ Approval timeout for incident ${incidentId}. Risk score ${riskAssessment.score} < 75. Proceeding with execution.`,
                        };
                        await this.logDecision(incidentId, state.fixId ?? null, fixSource, riskAssessment.score, riskAssessment.tier, "execute_notify", "timeout_medium_risk");
                        return result;
                    }
                } catch (err: unknown) {
                    const error = err as Error;
                    log.error({ error: error.message, incidentId }, "Approval flow failed");
                    // On approval service failure, block for safety
                    const result: DecisionResult = {
                        action: "block",
                        reason: `Approval service error: ${error.message}`,
                    };
                    return result;
                }
            }

            case "notify": {
                const result: DecisionResult = {
                    action: "execute_notify",
                    reason: "Medium risk — executing with notification",
                    slackMessage: `ℹ️ AutoOps executing fix for incident ${incidentId}. Risk: ${riskAssessment.score}/100 (${riskAssessment.tier}). Source: ${fixSource}.`,
                };
                await this.logDecision(incidentId, state.fixId ?? null, fixSource, riskAssessment.score, riskAssessment.tier, "execute_notify", "notify_tier");
                return result;
            }

            case "auto":
            default: {
                const result: DecisionResult = {
                    action: "execute",
                    reason: "Low risk — auto-approved",
                    auditNote: `Auto-approved: score=${riskAssessment.score}, source=${fixSource}, reasons=[${riskAssessment.reasons.join("; ")}]`,
                };
                await this.logDecision(incidentId, state.fixId ?? null, fixSource, riskAssessment.score, riskAssessment.tier, "execute", "auto_approve");
                return result;
            }
        }
    }

    /**
     * Log every decision for audit trail.
     */
    private async logDecision(
        incidentId: string,
        fixId: string | null,
        fixSource: string | null,
        riskScore: number | null,
        riskTier: string | null,
        actionTaken: string,
        ruleMatched: string
    ): Promise<void> {
        try {
            const db = getPool();
            await db.query(
                `INSERT INTO decision_audit 
                 (incident_id, fix_id, fix_source, risk_score, risk_tier, action_taken, rule_matched)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [incidentId, fixId, fixSource, riskScore, riskTier, actionTaken, ruleMatched]
            );
        } catch (err: unknown) {
            const error = err as Error;
            log.warn({ error: error.message }, "Failed to log decision audit");
        }
    }
}
