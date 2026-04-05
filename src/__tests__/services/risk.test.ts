/**
 * AutoOps AI — Risk Service Tests
 */
import { describe, it, expect } from "vitest";
import { RiskService } from "../../services/risk.service";
import { FixPlan, IncidentContext, MemoryResult, ValidationResult } from "../../services/enterprise-types";

const riskService = new RiskService();

function makePlan(overrides: Partial<FixPlan> = {}): FixPlan {
    return {
        title: "Test Plan",
        fixSteps: [{ action: "restart", command: "kubectl rollout restart deployment/x" }],
        confidence: 0.8,
        blastRadius: 2,
        hasRollbackPlan: true,
        ...overrides,
    };
}

function makeContext(overrides: Partial<IncidentContext> = {}): IncidentContext {
    return {
        id: "inc-test",
        incidentType: "pod_crash",
        errorSignature: "CrashLoopBackOff",
        severity: "medium",
        affectedService: "api-service",
        ...overrides,
    };
}

function makeMemory(overrides: Partial<MemoryResult> = {}): MemoryResult {
    return {
        fix: null,
        similarity: 0,
        source: "none",
        trustworthy: false,
        ...overrides,
    };
}

describe("RiskService", () => {
    it("template source subtracts 25 — resulting in low tier", () => {
        const result = riskService.assessRisk(
            makePlan({ blastRadius: 2, confidence: 0.9, hasRollbackPlan: true }),
            makeContext(),
            makeMemory(),
            "template"
        );
        // blastRadius 2 * 20 = 40
        // (1 - 0.9) * 30 = 3
        // hasRollback: -20
        // template: -25
        // = 40 + 3 - 20 - 25 = -2 → clamped to 0
        expect(result.score).toBeLessThan(35);
        // Template override: max tier is 'notify'
        expect(["auto", "notify"]).toContain(result.tier);
    });

    it("trustworthy memory hit subtracts 15", () => {
        const result = riskService.assessRisk(
            makePlan({ blastRadius: 2, confidence: 0.7, hasRollbackPlan: true }),
            makeContext(),
            makeMemory({ trustworthy: true, source: "vector_db" }),
            "memory"
        );
        const reasons = result.reasons.join(" ");
        expect(reasons).toContain("-15");
    });

    it("hasRollbackPlan subtracts 20", () => {
        const withRollback = riskService.assessRisk(
            makePlan({ hasRollbackPlan: true, blastRadius: 3 }),
            makeContext(),
            makeMemory(),
            "llm"
        );
        const withoutRollback = riskService.assessRisk(
            makePlan({ hasRollbackPlan: false, blastRadius: 3 }),
            makeContext(),
            makeMemory(),
            "llm"
        );
        expect(withRollback.score).toBeLessThan(withoutRollback.score);
    });

    it("HARD_BLOCKED override forces 'block' regardless of score", () => {
        const validationResult: ValidationResult = {
            safe: false,
            blockedSteps: [{ stepIndex: 0, command: "rm -rf /", pattern: "rm", type: "HARD_BLOCKED" }],
            reason: "HARD_BLOCKED",
        };
        const result = riskService.assessRisk(
            makePlan({ blastRadius: 1, confidence: 0.99, hasRollbackPlan: true }),
            makeContext(),
            makeMemory(),
            "template",
            validationResult
        );
        expect(result.tier).toBe("block");
        expect(result.score).toBe(100);
    });

    it("REQUIRE_REVIEW upgrades tier to approve", () => {
        const validationResult: ValidationResult = {
            safe: true,
            blockedSteps: [],
            tierUpgrade: true,
        };
        const result = riskService.assessRisk(
            makePlan({ blastRadius: 1, confidence: 0.95, hasRollbackPlan: true }),
            makeContext(),
            makeMemory(),
            "llm",
            validationResult
        );
        // The tier should be at minimum 'approve' due to upgrade
        expect(["approve", "block"]).toContain(result.tier);
    });

    it("score is always clamped 0–100", () => {
        // Very low risk — should clamp to 0
        const low = riskService.assessRisk(
            makePlan({ blastRadius: 1, confidence: 0.99, hasRollbackPlan: true }),
            makeContext(),
            makeMemory({ trustworthy: true, source: "redis_cache" }),
            "template"
        );
        expect(low.score).toBeGreaterThanOrEqual(0);

        // Very high risk — should clamp to 100
        const high = riskService.assessRisk(
            makePlan({ blastRadius: 5, confidence: 0.1, hasRollbackPlan: false }),
            makeContext({ severity: "critical" }),
            makeMemory(),
            "llm"
        );
        expect(high.score).toBeLessThanOrEqual(100);
    });

    it("reasons array is non-empty and human-readable", () => {
        const result = riskService.assessRisk(
            makePlan(),
            makeContext(),
            makeMemory(),
            "llm"
        );
        expect(result.reasons.length).toBeGreaterThan(0);
        expect(result.reasons.every((r) => typeof r === "string")).toBe(true);
    });

    it("template override: maximum tier is notify", () => {
        // Even with high blast radius, template should cap at notify
        const result = riskService.assessRisk(
            makePlan({ blastRadius: 4, confidence: 0.5, hasRollbackPlan: false }),
            makeContext({ severity: "critical" }),
            makeMemory(),
            "template"
        );
        expect(["auto", "notify"]).toContain(result.tier);
    });
});
