/**
 * AutoOps AI — Command Validator Service
 * CRITICAL SAFETY FILE: Validates all fix commands before execution.
 * A hallucinated LLM command on production infrastructure is catastrophic.
 *
 * This validator runs BEFORE execution.agent.ts processes any fix step.
 * No fix step reaches the execution agent without passing this check.
 */
import { createChildLogger } from "../utils/logger";
import { FixStep, BlockedStep, ValidationResult } from "./enterprise-types";

const log = createChildLogger("CommandValidator");

// ── HARD-BLOCKED patterns (block immediately, no override possible) ──

const HARD_BLOCKED: RegExp[] = [
    /kubectl\s+delete\s+namespace/i,
    /kubectl\s+delete\s+.*--all/i,
    /kubectl\s+.*--force\s+.*--grace-period=0/i,
    /DROP\s+(TABLE|DATABASE|SCHEMA)/i,
    /TRUNCATE\s+TABLE/i,
    /DELETE\s+FROM\s+\w+\s*;?\s*$/i,   // DELETE without WHERE clause
    /rm\s+-rf\s+\//i,
    /rm\s+-rf\s+~/i,
    /chmod\s+777\s+\//i,
    /kubectl\s+exec.*--stdin.*bash/i,   // shell access into pods
    /curl\s+.*\|\s*bash/i,             // pipe to bash
    /wget\s+.*\|\s*sh/i,
];

// ── REQUIRE-APPROVAL patterns (upgrade tier even if risk said 'auto') ──

const REQUIRE_REVIEW: RegExp[] = [
    /kubectl\s+delete\s+(deployment|statefulset|daemonset)/i,
    /kubectl\s+scale\s+.*--replicas=0/i,    // scaling to zero
    /kubectl\s+drain/i,
    /ALTER\s+TABLE/i,
    /kubectl\s+cordon/i,
];

export class CommandValidatorService {
    /**
     * Validate all fix steps before execution.
     * Returns a ValidationResult indicating whether the plan is safe to execute.
     */
    validate(steps: FixStep[]): ValidationResult {
        const blockedSteps: BlockedStep[] = [];
        let tierUpgrade = false;

        // Guard: empty steps array
        if (!steps || steps.length === 0) {
            log.warn("Empty fixSteps array — rejecting plan");
            return {
                safe: false,
                blockedSteps: [],
                reason: "Fix plan contains no steps",
            };
        }

        // Guard: too many steps (hallucination signal)
        if (steps.length > 10) {
            log.warn(
                { stepCount: steps.length },
                "Fix plan has >10 steps — possible LLM hallucination"
            );
            return {
                safe: false,
                blockedSteps: [],
                reason: `Fix plan has ${steps.length} steps (max 10). This may indicate LLM hallucination.`,
            };
        }

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const command = step.command || "";

            // Guard: empty command
            if (!command.trim()) {
                blockedSteps.push({
                    stepIndex: i,
                    command: "(empty)",
                    pattern: "EMPTY_COMMAND",
                    type: "HARD_BLOCKED",
                });
                continue;
            }

            // Guard: unusually long operation
            if (step.estimatedDurationSec !== undefined && step.estimatedDurationSec > 300) {
                log.warn(
                    { stepIndex: i, duration: step.estimatedDurationSec },
                    "Step has estimatedDurationSec > 300 — flagging"
                );
            }

            // Check HARD_BLOCKED patterns
            for (const pattern of HARD_BLOCKED) {
                if (pattern.test(command)) {
                    blockedSteps.push({
                        stepIndex: i,
                        command: this.sanitizeCommand(command),
                        pattern: pattern.source,
                        type: "HARD_BLOCKED",
                    });
                    log.error(
                        { stepIndex: i, pattern: pattern.source },
                        "HARD_BLOCKED command detected"
                    );
                    break; // One hard-block per step is enough
                }
            }

            // Check REQUIRE_REVIEW patterns (only if not already hard-blocked)
            const isHardBlocked = blockedSteps.some(
                (b) => b.stepIndex === i && b.type === "HARD_BLOCKED"
            );
            if (!isHardBlocked) {
                for (const pattern of REQUIRE_REVIEW) {
                    if (pattern.test(command)) {
                        blockedSteps.push({
                            stepIndex: i,
                            command: this.sanitizeCommand(command),
                            pattern: pattern.source,
                            type: "REQUIRE_REVIEW",
                        });
                        tierUpgrade = true;
                        log.warn(
                            { stepIndex: i, pattern: pattern.source },
                            "REQUIRE_REVIEW command detected — tier upgrade required"
                        );
                        break;
                    }
                }
            }
        }

        // If ANY step is HARD_BLOCKED, the entire plan is unsafe
        const hasHardBlocked = blockedSteps.some((b) => b.type === "HARD_BLOCKED");
        if (hasHardBlocked) {
            return {
                safe: false,
                blockedSteps,
                reason: "HARD_BLOCKED",
            };
        }

        return {
            safe: true,
            blockedSteps,
            tierUpgrade,
        };
    }

    /**
     * Sanitize command for logging — never log secrets/env values.
     */
    private sanitizeCommand(command: string): string {
        // Redact potential secrets in env vars or tokens
        return command
            .replace(/(?:--token|--password|--secret|API_KEY)[\s=]+\S+/gi, "$& [REDACTED]")
            .substring(0, 200);
    }
}
