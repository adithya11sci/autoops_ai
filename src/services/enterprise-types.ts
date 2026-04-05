/**
 * AutoOps AI — Enterprise Type Definitions
 * Shared interfaces used across all enterprise services.
 * These types are additive — they complement existing state.ts types.
 */

// ── Fix Step (used by templates, memory, validator, risk) ──

export interface FixStep {
    action: string;
    command: string;
    description?: string;
    estimatedDurationSec?: number;
    rollbackCommand?: string;
}

// ── Incident Context (lightweight view for services) ──

export interface IncidentContext {
    id: string;
    incidentType: string;
    errorSignature: string;
    severity: "critical" | "high" | "medium" | "low";
    affectedService: string;
    namespace?: string;
    podName?: string;
    deploymentName?: string;
    metric?: string;
    metricValue?: number;
    resourceType?: string;
}

// ── Fix Plan (output of planning) ──

export interface FixPlan {
    title: string;
    fixSteps: FixStep[];
    confidence: number;
    blastRadius: number;
    hasRollbackPlan: boolean;
    riskLevel?: "low" | "medium" | "high" | "critical";
    estimatedDurationMinutes?: number;
    rollbackPlan?: string[];
    ragContext?: string[];
}

// ── Stored Fix (persisted in DB + vector store) ──

export interface StoredFix {
    id: string;
    incidentType: string;
    errorSignature: string;
    fixSteps: FixStep[];
    rlScore: number;
    successCount: number;
    failureCount: number;
    lastUsedAt: Date;
    createdAt: Date;
}

// ── Memory Result ──

export interface MemoryResult {
    fix: StoredFix | null;
    similarity: number;
    source: "redis_cache" | "vector_db" | "none";
    trustworthy: boolean;
}

// ── Template Fix ──

export interface TemplateFix {
    templateId: string;
    name: string;
    fixSteps: FixStep[];
    confidence: number;
    blastRadius: number;
    hasRollbackPlan: boolean;
}

// ── Validation Result ──

export interface BlockedStep {
    stepIndex: number;
    command: string;
    pattern: string;
    type: "HARD_BLOCKED" | "REQUIRE_REVIEW";
}

export interface ValidationResult {
    safe: boolean;
    blockedSteps: BlockedStep[];
    reason?: string;
    tierUpgrade?: boolean;
}

// ── Risk Assessment ──

export interface RiskAssessment {
    score: number;
    tier: "auto" | "notify" | "approve" | "block";
    reasons: string[];
    requiresApproval: boolean;
    source: "template" | "memory" | "llm";
}

// ── Decision Result ──

export type DecisionResult =
    | { action: "execute"; reason: string; auditNote: string }
    | { action: "execute_notify"; reason: string; slackMessage: string }
    | { action: "await_approval"; reason: string; approvalId: string }
    | { action: "block"; reason: string; commandIssue?: string }
    | { action: "escalate_human"; reason: string };

// ── Approval Types ──

export type ApprovalStatus = "PENDING" | "APPROVED" | "DENIED" | "TIMEOUT" | "ESCALATED";

export interface ApprovalRecord {
    id: string;
    incidentIds: string[];
    serviceName: string;
    namespace: string;
    fixId: string | null;
    riskScore: number;
    riskTier: string;
    planSummary: Record<string, unknown>;
    status: ApprovalStatus;
    approverId: string | null;
    approverComment: string | null;
    createdAt: Date;
    decidedAt: Date | null;
}

// ── Groq Error Types ──

export class GroqParseError extends Error {
    public readonly rawResponse: string;
    constructor(message: string, rawResponse: string) {
        super(message);
        this.name = "GroqParseError";
        this.rawResponse = rawResponse;
    }
}

export class GroqUnavailableError extends Error {
    public readonly originalError: Error;
    constructor(message: string, originalError: Error) {
        super(message);
        this.name = "GroqUnavailableError";
        this.originalError = originalError;
    }
}

export class GroqClientError extends Error {
    public readonly statusCode: number;
    constructor(message: string, statusCode: number) {
        super(message);
        this.name = "GroqClientError";
        this.statusCode = statusCode;
    }
}
