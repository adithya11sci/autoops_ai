/**
 * AutoOps AI — Risk Assessment Service
 * Scores fix plans based on action properties only.
 * RL score is NOT part of this formula.
 *
 * Output determines whether a fix is auto-executed, notified,
 * requires approval, or is blocked entirely.
 */
import { createChildLogger } from "../utils/logger";
import { getPool } from "./database";
import {
    FixPlan,
    IncidentContext,
    MemoryResult,
    RiskAssessment,
    ValidationResult,
} from "./enterprise-types";

const log = createChildLogger("RiskService");

export class RiskService {
    /**
     * Assess risk of executing a fix plan.
     *
     * Formula:
     *   score = blastRadius * 20
     *   score += (1 - confidence) * 30
     *   score += slaCritical ? 15 : 0
     *   score -= hasRollbackPlan ? 20 : 0
     *   score -= template source ? 25 : 0
     *   score -= trustworthy memory ? 15 : 0
     *   score -= memory hit (not trustworthy) ? 5 : 0
     *   clamped [0, 100]
     */
    assessRisk(
        plan: FixPlan,
        context: IncidentContext,
        memoryResult: MemoryResult,
        fixSource: "template" | "memory" | "llm",
        validationResult?: ValidationResult
    ): RiskAssessment {
        const reasons: string[] = [];
        let score = 0;

        // Blast radius contribution
        const blastContribution = plan.blastRadius * 20;
        score += blastContribution;
        reasons.push(`Blast radius ${plan.blastRadius}/5: +${blastContribution}`);

        // Confidence contribution (lower confidence = higher risk)
        const confidenceContribution = Math.round((1 - plan.confidence) * 30);
        score += confidenceContribution;
        reasons.push(`Confidence ${(plan.confidence * 100).toFixed(0)}%: +${confidenceContribution}`);

        // SLA criticality
        const slaCritical = context.severity === "critical";
        if (slaCritical) {
            score += 15;
            reasons.push("SLA critical severity: +15");
        }

        // Rollback plan deduction
        if (plan.hasRollbackPlan) {
            score -= 20;
            reasons.push("Has rollback plan: -20");
        }

        // Template source deduction (pre-validated = much safer)
        if (fixSource === "template") {
            score -= 25;
            reasons.push("Template source (pre-validated): -25");
        }

        // Memory trustworthy deduction
        if (memoryResult.trustworthy) {
            score -= 15;
            reasons.push("Trustworthy memory (3+ successes): -15");
        } else if (memoryResult.source !== "none") {
            score -= 5;
            reasons.push("Memory hit (not yet trustworthy): -5");
        }

        // Clamp score to [0, 100]
        score = Math.max(0, Math.min(100, score));

        // Determine tier
        let tier: RiskAssessment["tier"];
        if (score < 35) {
            tier = "auto";
        } else if (score < 65) {
            tier = "notify";
        } else if (score < 85) {
            tier = "approve";
        } else {
            tier = "block";
        }

        // ── OVERRIDES ──

        // OVERRIDE: validator found REQUIRE_REVIEW → minimum tier is 'approve'
        if (validationResult?.tierUpgrade) {
            if (tier === "auto" || tier === "notify") {
                reasons.push(`Command validator upgrade: ${tier} → approve (REQUIRE_REVIEW pattern found)`);
                tier = "approve";
            }
        }

        // OVERRIDE: validator found HARD_BLOCKED → always 'block'
        if (validationResult && !validationResult.safe && validationResult.reason === "HARD_BLOCKED") {
            reasons.push("Command validator: HARD_BLOCKED pattern → block");
            tier = "block";
            score = 100;
        }

        // OVERRIDE: template source → maximum tier is 'notify'
        if (fixSource === "template" && (tier === "approve" || tier === "block")) {
            // Only downgrade if not HARD_BLOCKED
            if (!(validationResult && !validationResult.safe && validationResult.reason === "HARD_BLOCKED")) {
                reasons.push(`Template override: ${tier} → notify (templates are pre-validated)`);
                tier = "notify";
            }
        }

        const assessment: RiskAssessment = {
            score,
            tier,
            reasons,
            requiresApproval: tier === "approve",
            source: fixSource,
        };

        log.info(
            {
                score,
                tier,
                fixSource,
                incidentId: context.id,
                reasonCount: reasons.length,
            },
            `Risk assessed: score=${score}, tier=${tier}`
        );

        // Log to PostgreSQL (best-effort)
        this.persistAssessment(context.id, null, assessment).catch((err: Error) => {
            log.warn({ error: err.message }, "Failed to persist risk assessment");
        });

        return assessment;
    }

    /**
     * Persist risk assessment to database for audit.
     */
    private async persistAssessment(
        incidentId: string,
        fixId: string | null,
        assessment: RiskAssessment
    ): Promise<void> {
        try {
            const db = getPool();
            await db.query(
                `INSERT INTO risk_assessments (incident_id, fix_id, score, tier, reasons, fix_source)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    incidentId,
                    fixId,
                    assessment.score,
                    assessment.tier,
                    assessment.reasons,
                    assessment.source,
                ]
            );
        } catch (err: unknown) {
            const error = err as Error;
            log.warn({ error: error.message }, "Failed to log risk assessment to DB");
        }
    }
}
