/**
 * AutoOps AI — Shared State & Type Definitions
 * Central state flowing through the multi-agent workflow.
 */
import { v4 as uuidv4 } from "uuid";
import { MemoryResult, RiskAssessment, DecisionResult } from "../services/enterprise-types";

export interface RawEvent {
    eventId: string;
    timestamp: string;
    source: {
        type: string;
        service: string;
        host?: string;
        namespace?: string;
        pod?: string;
    };
    eventType: string;
    severity: "critical" | "high" | "medium" | "low" | "info";
    data: Record<string, any>;
    metadata?: Record<string, any>;
}

export interface DetectedIssue {
    issueId: string;
    type: string;
    severity: "critical" | "high" | "medium" | "low";
    description: string;
    anomalyScore: number;
    sourceEvents: string[];
    detectedAt: string;
    affectedService: string;
    modelScores: {
        statistical: number;
        patternBased: number;
        rulesBased: number;
    };
}

export interface RootCause {
    category: string;
    service: string;
    description: string;
    confidence: number;
    evidence: string[];
    dependencyPath: string[];
    remediationHint: string;
}

export interface PlanStep {
    stepId: number;
    action: string;
    description: string;
    parameters: Record<string, any>;
    timeoutSeconds: number;
    rollback?: string;
}

export interface RemediationPlan {
    planId: string;
    title: string;
    riskLevel: "low" | "medium" | "high" | "critical";
    estimatedDurationMinutes: number;
    steps: PlanStep[];
    rollbackPlan: string[];
    requiresApproval: boolean;
    ragContext: string[];
}

export interface StepResult {
    stepId: number;
    action: string;
    status: "success" | "failed" | "skipped";
    result?: any;
    error?: string;
    completedAt: string;
}

export type Priority = "P0" | "P1" | "P2" | "P3" | "P4";
export type WorkflowStatus = "created" | "monitoring" | "analyzing" | "planning" | "prioritizing" | "executing" | "learning" | "completed" | "failed" | "escalated";
export type ExecutionStatus = "pending" | "running" | "success" | "partial" | "failed";

export interface IncidentState {
    incidentId: string;
    createdAt: string;
    updatedAt: string;
    rawEvents: RawEvent[];
    issue: DetectedIssue | null;
    rootCause: RootCause | null;
    plan: RemediationPlan | null;
    priority: Priority | null;
    slaDeadline: string | null;
    fastTrack: boolean;
    executionStatus: ExecutionStatus;
    stepsCompleted: StepResult[];
    stepsFailed: StepResult[];
    outcome: "resolved" | "partial" | "failed" | "escalated" | null;
    lessonsLearned: string[];
    retryCount: number;
    maxRetries: number;
    currentAgent: string;
    workflowStatus: WorkflowStatus;
    errorLog: Array<{ agent: string; error: string; timestamp: string }>;
    // === ENTERPRISE FIELDS (optional, additive only) ===
    planSource?: "template" | "memory" | "llm" | "unavailable";
    memorySimilarity?: number;
    memoryResult?: MemoryResult;
    fixId?: string | null;
    riskAssessment?: RiskAssessment;
    approvalId?: string;
    groqFailed?: boolean;
    decisionResult?: DecisionResult;
}

export function createIncidentState(rawEvents: RawEvent[]): IncidentState {
    const now = new Date().toISOString();
    return {
        incidentId: `inc-${uuidv4().slice(0, 8)}`,
        createdAt: now,
        updatedAt: now,
        rawEvents,
        issue: null,
        rootCause: null,
        plan: null,
        priority: null,
        slaDeadline: null,
        fastTrack: false,
        executionStatus: "pending",
        stepsCompleted: [],
        stepsFailed: [],
        outcome: null,
        lessonsLearned: [],
        retryCount: 0,
        maxRetries: 3,
        currentAgent: "monitoring",
        workflowStatus: "created",
        errorLog: [],
    };
}
