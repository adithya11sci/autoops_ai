/**
 * AutoOps AI — Workflow Orchestrator (LangGraph-Inspired StateGraph)
 *
 * Central orchestrator connecting all 6 agents in a stateful workflow with
 * conditional branching, retry logic, escalation, and real-time broadcasting.
 *
 * Flow: Monitoring → RCA → Planning → SLA → Decision → Execution → Feedback
 *       └───── retry (on failure, up to maxRetries) ─────┘
 */
import { IncidentState, createIncidentState, RawEvent } from "./state";
import { monitoringAgent } from "../agents/monitoring.agent";
import { rcaAgent } from "../agents/rca.agent";
import { planningAgent } from "../agents/planning.agent";
import { slaAgent } from "../agents/sla.agent";
import { executionAgent } from "../agents/execution.agent";
import { feedbackAgent } from "../agents/feedback.agent";
import { logAgentEvent } from "../services/database";
import { createChildLogger } from "../utils/logger";
import { DecisionEngine } from "../engines/decision.engine";
import { CommandValidatorService } from "../services/command-validator.service";
import { RiskService } from "../services/risk.service";
import { ApprovalService } from "../services/approval.service";
import { FixPlan } from "../services/enterprise-types";
import {
    broadcast,
    broadcastLog,
    recordPipelineStart,
    recordPipelineComplete,
    setPendingApproval,
    clearPendingApproval,
} from "../services/broadcast";

const log = createChildLogger("Orchestrator");

const commandValidator = new CommandValidatorService();
const riskService = new RiskService();
const approvalService = new ApprovalService();
const decisionEngine = new DecisionEngine(commandValidator, riskService, approvalService);

const activeIncidents = new Map<string, IncidentState>();

type IncidentListener = (state: IncidentState) => void;
const listeners: IncidentListener[] = [];

export function onIncidentUpdate(listener: IncidentListener) {
    listeners.push(listener);
}

function notifyListeners(state: IncidentState) {
    // Broadcast full state to all WS clients
    broadcast("incident_update", state);

    for (const listener of listeners) {
        try { listener(state); } catch { }
    }
}

/**
 * Pre-register an incident so it can be queried immediately (for async pipeline trigger).
 */
export function preRegisterIncident(state: IncidentState): void {
    activeIncidents.set(state.incidentId, state);
}

/**
 * Run the full incident pipeline from raw events.
 * Accepts an optional pre-created state (for async/non-blocking triggers).
 */
export async function runPipeline(rawEvents: RawEvent[], existingState?: IncidentState): Promise<IncidentState> {
    const state = existingState || createIncidentState(rawEvents);
    activeIncidents.set(state.incidentId, state);

    recordPipelineStart();

    broadcast("pipeline_start", {
        incidentId: state.incidentId,
        eventCount: rawEvents.length,
        timestamp: state.createdAt,
    });

    broadcastLog("orchestrator", "info",
        `Pipeline started for ${rawEvents.length} events`,
        { incidentId: state.incidentId }
    );

    log.info({ incidentId: state.incidentId, eventCount: rawEvents.length }, "🚀 PIPELINE STARTED");

    const startTime = Date.now();

    try {
        // ── STEP 1: Monitoring Agent ──────────────────────────────
        await runAgent("monitoring", monitoringAgent, state);
        notifyListeners(state);

        if (!state.issue) {
            broadcastLog("orchestrator", "info", "No anomaly detected — pipeline complete", { incidentId: state.incidentId });
            state.workflowStatus = "completed";
            state.outcome = "resolved";

            const totalMs = Date.now() - startTime;
            recordPipelineComplete("resolved", totalMs);
            broadcast("pipeline_complete", { incidentId: state.incidentId, outcome: "resolved", durationMs: totalMs });
            activeIncidents.set(state.incidentId, state);
            return state;
        }

        broadcastLog("orchestrator", "info",
            `Anomaly detected: ${state.issue.type} in ${state.issue.affectedService} (score: ${state.issue.anomalyScore.toFixed(3)})`,
            { severity: state.issue.severity, issueId: state.issue.issueId }
        );

        // ── STEP 2: RCA Agent ──────────────────────────────────────
        await runAgent("rca", rcaAgent, state);
        notifyListeners(state);

        if (state.rootCause) {
            broadcastLog("orchestrator", "info",
                `Root cause: ${state.rootCause.category} in ${state.rootCause.service} (confidence: ${(state.rootCause.confidence * 100).toFixed(0)}%)`,
                { remediationHint: state.rootCause.remediationHint }
            );
        }

        // ── STEPS 3-6: Planning → SLA → Decision → Execution (retry loop) ──
        let resolved = false;

        while (!resolved && state.retryCount <= state.maxRetries) {
            // STEP 3: Planning Agent
            await runAgent("planning", planningAgent, state);
            notifyListeners(state);

            if (state.plan) {
                broadcastLog("orchestrator", "info",
                    `Plan ready: "${state.plan.title}" (${state.plan.steps.length} steps, ${state.plan.riskLevel} risk, source: ${state.planSource || "llm"})`,
                    { planId: state.plan.planId }
                );
            }

            // STEP 4: SLA Agent
            await runAgent("sla", slaAgent, state);
            notifyListeners(state);

            if (state.priority) {
                broadcastLog("orchestrator", "info",
                    `Priority: ${state.priority} | SLA deadline: ${state.slaDeadline} | Fast-track: ${state.fastTrack}`,
                    { priority: state.priority }
                );
            }

            // STEP 4.5: Decision Engine
            const decisionStart = Date.now();
            broadcast("agent_start", { incidentId: state.incidentId, agent: "decision", timestamp: new Date().toISOString() });

            try {
                const decisionResult = await decisionEngine.decide(state);
                state.decisionResult = decisionResult;

                const decisionDuration = Date.now() - decisionStart;
                const decisionStatus = decisionResult.action === "block" || decisionResult.action === "escalate_human"
                    ? "error" : "success";

                broadcast("agent_complete", {
                    incidentId: state.incidentId,
                    agent: "decision",
                    duration: decisionDuration,
                    status: decisionStatus,
                    data: {
                        action: decisionResult.action,
                        reason: decisionResult.reason,
                        riskScore: state.riskAssessment?.score,
                        riskTier: state.riskAssessment?.tier,
                    },
                });

                broadcastLog(
                    "decision",
                    decisionStatus === "error" ? "warn" : "info",
                    `Decision: ${decisionResult.action.toUpperCase()} — ${decisionResult.reason}`,
                    { riskScore: state.riskAssessment?.score, tier: state.riskAssessment?.tier }
                );

                notifyListeners(state);

                if (decisionResult.action === "block" || decisionResult.action === "escalate_human") {
                    log.warn({ action: decisionResult.action, reason: decisionResult.reason }, `🚫 Decision: BLOCKED — requesting human approval`);

                    const fixPlan: FixPlan = {
                        title: state.plan?.title || "Unknown Fix",
                        fixSteps: (state.plan?.steps || []).map(s => ({
                            action: s.action,
                            command: (s.parameters?.command as string) || s.action,
                            description: s.description,
                            estimatedDurationSec: s.timeoutSeconds,
                        })),
                        confidence: 0.5,
                        blastRadius: state.riskAssessment?.score ?? 100,
                        hasRollbackPlan: (state.plan?.rollbackPlan?.length ?? 0) > 0,
                        riskLevel: state.plan?.riskLevel,
                        rollbackPlan: state.plan?.rollbackPlan,
                    };

                    const serviceName = state.issue?.affectedService || state.rootCause?.service || "unknown";
                    const namespace = state.rawEvents[0]?.source?.namespace || "production";

                    try {
                        const approvalId = await approvalService.createRequest(
                            fixPlan,
                            state.riskAssessment || { score: 100, tier: "block", reasons: [decisionResult.reason], requiresApproval: true, source: "llm" },
                            state.incidentId,
                            serviceName,
                            namespace,
                            state.fixId || null,
                        );

                        state.approvalId = approvalId;
                        state.workflowStatus = "awaiting_approval";
                        notifyListeners(state);

                        const approvalPayload = {
                            incidentId: state.incidentId,
                            approvalId,
                            reason: decisionResult.reason,
                            riskScore: state.riskAssessment?.score ?? 100,
                            riskTier: state.riskAssessment?.tier || "block",
                            serviceName,
                            planTitle: state.plan?.title || "Unknown Fix",
                        };
                        setPendingApproval(approvalPayload);
                        broadcast("approval_required", approvalPayload);

                        broadcastLog("decision", "warn",
                            `Human approval required — waiting for operator decision`,
                            { approvalId, riskScore: state.riskAssessment?.score }
                        );

                        log.warn({ approvalId }, "⏳ Awaiting human approval...");

                        const humanDecision = await approvalService.waitForDecision(approvalId);

                        clearPendingApproval();
                        broadcast("approval_decided", {
                            incidentId: state.incidentId,
                            approvalId,
                            decision: humanDecision,
                        });

                        if (humanDecision === "approved") {
                            broadcastLog("decision", "info", `Human APPROVED — proceeding to execution`, { approvalId });
                            log.info({ approvalId }, "✅ Human approved — proceeding to execution");
                            // fall through to execution
                        } else {
                            broadcastLog("decision", "warn", `Human ${humanDecision.toUpperCase()} — escalating incident`, { approvalId });
                            log.warn({ approvalId, humanDecision }, `❌ ${humanDecision.toUpperCase()} — escalating`);
                            state.workflowStatus = "escalated";
                            state.outcome = "escalated";
                            break;
                        }
                    } catch (approvalErr: any) {
                        log.error({ err: approvalErr.message }, "Approval flow failed — escalating for safety");
                        broadcastLog("decision", "error", `Approval flow failed — escalating: ${approvalErr.message}`);
                        state.workflowStatus = "escalated";
                        state.outcome = "escalated";
                        break;
                    }
                }

                log.info({ action: decisionResult.action }, `✅ Decision: ${decisionResult.action.toUpperCase()}`);
            } catch (err: unknown) {
                const error = err as Error;
                const decisionDuration = Date.now() - decisionStart;
                broadcast("agent_complete", {
                    incidentId: state.incidentId,
                    agent: "decision",
                    duration: decisionDuration,
                    status: "error",
                    data: { error: error.message },
                });
                broadcastLog("decision", "error", `Decision engine failed — blocking for safety: ${error.message}`);
                log.error({ err: error.message }, "Decision engine failed — blocking for safety");
                state.workflowStatus = "escalated";
                state.outcome = "escalated";
                break;
            }

            // STEP 5: Execution Agent
            await runAgent("execution", executionAgent, state);
            notifyListeners(state);

            if (state.executionStatus === "success") {
                resolved = true;
                broadcastLog("orchestrator", "info", `All execution steps completed successfully`);
                log.info("✅ Execution succeeded!");
            } else {
                state.retryCount++;
                if (state.retryCount <= state.maxRetries) {
                    broadcastLog("orchestrator", "warn",
                        `Execution failed — replanning (attempt ${state.retryCount}/${state.maxRetries})`,
                        { failedSteps: state.stepsFailed.map(s => s.action) }
                    );
                    log.warn({ retryCount: state.retryCount }, `⚠️ Replanning...`);
                    state.executionStatus = "pending";

                    try {
                        await logAgentEvent(state.incidentId, "orchestrator", "retry", {
                            retryCount: state.retryCount,
                            failedSteps: state.stepsFailed,
                        });
                    } catch { }
                } else {
                    broadcastLog("orchestrator", "error", `Max retries exceeded — escalating to human operator`);
                    log.error({ retryCount: state.retryCount }, "❌ Max retries exceeded — ESCALATING");
                    state.workflowStatus = "escalated";
                }
            }
        }

        // ── STEP 6: Feedback Agent ─────────────────────────────────
        await runAgent("feedback", feedbackAgent, state);
        notifyListeners(state);

        if (state.outcome) {
            broadcastLog("feedback", "info",
                `Incident ${state.outcome.toUpperCase()} — stored to ChromaDB for future RAG`,
                { lessons: state.lessonsLearned.length }
            );
        }

    } catch (err: any) {
        log.error({ err: err.message, incidentId: state.incidentId }, "Pipeline error");
        state.workflowStatus = "failed";
        state.errorLog.push({ agent: "orchestrator", error: err.message, timestamp: new Date().toISOString() });
        broadcast("pipeline_error", { incidentId: state.incidentId, error: err.message });
    }

    const totalMs = Date.now() - startTime;

    recordPipelineComplete(state.outcome || "failed", totalMs);

    broadcast("pipeline_complete", {
        incidentId: state.incidentId,
        outcome: state.outcome,
        durationMs: totalMs,
        stepsCompleted: state.stepsCompleted.length,
        stepsFailed: state.stepsFailed.length,
        retryCount: state.retryCount,
    });

    broadcastLog("orchestrator", state.outcome === "resolved" ? "info" : "warn",
        `Pipeline complete: ${(state.outcome || "unknown").toUpperCase()} in ${(totalMs / 1000).toFixed(1)}s`,
        { retries: state.retryCount }
    );

    log.info({
        incidentId: state.incidentId,
        outcome: state.outcome,
        duration: `${(totalMs / 1000).toFixed(1)}s`,
        retries: state.retryCount,
    }, `🏁 PIPELINE COMPLETE — ${(state.outcome || "UNKNOWN").toUpperCase()}`);

    activeIncidents.set(state.incidentId, state);
    return state;
}

/**
 * Run a single agent with error handling, logging, and broadcast.
 */
async function runAgent(
    name: string,
    agentFn: (state: IncidentState) => Promise<IncidentState>,
    state: IncidentState
): Promise<void> {
    const start = Date.now();

    broadcast("agent_start", {
        incidentId: state.incidentId,
        agent: name,
        timestamp: new Date().toISOString(),
    });

    try {
        await agentFn(state);
        const duration = Date.now() - start;

        broadcast("agent_complete", {
            incidentId: state.incidentId,
            agent: name,
            duration,
            status: "success",
            data: extractAgentOutput(name, state),
        });

        try {
            await logAgentEvent(state.incidentId, name, "completed", { durationMs: duration, status: "success" });
        } catch { }

    } catch (err: any) {
        const duration = Date.now() - start;
        log.error({ agent: name, err: err.message, durationMs: duration }, `Agent ${name} failed`);

        broadcast("agent_complete", {
            incidentId: state.incidentId,
            agent: name,
            duration,
            status: "error",
            data: { error: err.message },
        });

        state.errorLog.push({ agent: name, error: err.message, timestamp: new Date().toISOString() });

        try {
            await logAgentEvent(state.incidentId, name, "failed", { durationMs: duration, error: err.message });
        } catch { }
    }
}

/**
 * Extract key output data from state for each agent (shown in UI).
 */
function extractAgentOutput(agentName: string, state: IncidentState): Record<string, unknown> | null {
    switch (agentName) {
        case "monitoring":
            return state.issue
                ? { type: state.issue.type, score: state.issue.anomalyScore, severity: state.issue.severity, service: state.issue.affectedService }
                : { noAnomaly: true };
        case "rca":
            return state.rootCause
                ? { category: state.rootCause.category, confidence: state.rootCause.confidence, service: state.rootCause.service }
                : null;
        case "planning":
            return state.plan
                ? { title: state.plan.title, steps: state.plan.steps.length, risk: state.plan.riskLevel, source: state.planSource }
                : null;
        case "sla":
            return state.priority ? { priority: state.priority, fastTrack: state.fastTrack } : null;
        case "execution":
            return {
                stepsCompleted: state.stepsCompleted.length,
                stepsFailed: state.stepsFailed.length,
                status: state.executionStatus,
            };
        case "feedback":
            return { outcome: state.outcome, lessons: state.lessonsLearned.length };
        default:
            return null;
    }
}

export function getIncidentState(incidentId: string): IncidentState | undefined {
    return activeIncidents.get(incidentId);
}

export function getAllIncidentStates(): IncidentState[] {
    return Array.from(activeIncidents.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}
