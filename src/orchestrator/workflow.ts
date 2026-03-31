/**
 * AutoOps AI — Workflow Orchestrator (LangGraph-Inspired StateGraph)
 *
 * Central orchestrator that connects all 6 agents in a stateful workflow
 * with conditional branching, retry logic, and escalation.
 *
 * Flow: Monitoring → RCA → Planning → SLA → Execution → Feedback
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

const log = createChildLogger("Orchestrator");

// Store active incidents for API queries
const activeIncidents = new Map<string, IncidentState>();

// Event listeners for real-time updates
type IncidentListener = (state: IncidentState) => void;
const listeners: IncidentListener[] = [];

export function onIncidentUpdate(listener: IncidentListener) {
    listeners.push(listener);
}

function notifyListeners(state: IncidentState) {
    for (const listener of listeners) {
        try {
            listener(state);
        } catch { }
    }
}

/**
 * Run the full incident pipeline from raw events.
 */
export async function runPipeline(rawEvents: RawEvent[]): Promise<IncidentState> {
    const state = createIncidentState(rawEvents);
    activeIncidents.set(state.incidentId, state);

    log.info(
        { incidentId: state.incidentId, eventCount: rawEvents.length },
        "═══════════════════════════════════════════════════"
    );
    log.info(
        { incidentId: state.incidentId },
        "🚀 PIPELINE STARTED — Autonomous Incident Resolution"
    );
    log.info(
        {},
        "═══════════════════════════════════════════════════"
    );

    const startTime = Date.now();

    try {
        // ──────────────────────────────────────────────────
        // STEP 1: Monitoring Agent — Detect anomalies
        // ──────────────────────────────────────────────────
        await runAgent("monitoring", monitoringAgent, state);
        notifyListeners(state);

        if (!state.issue) {
            log.info({ incidentId: state.incidentId }, "No anomaly detected. Pipeline complete.");
            state.workflowStatus = "completed";
            state.outcome = "resolved";
            return state;
        }

        // ──────────────────────────────────────────────────
        // STEP 2: RCA Agent — Identify root cause
        // ──────────────────────────────────────────────────
        await runAgent("rca", rcaAgent, state);
        notifyListeners(state);

        // ──────────────────────────────────────────────────
        // STEPS 3-5: Planning → SLA → Execution (with retry loop)
        // ──────────────────────────────────────────────────
        let resolved = false;

        while (!resolved && state.retryCount <= state.maxRetries) {
            // STEP 3: Planning Agent — Generate remediation plan
            await runAgent("planning", planningAgent, state);
            notifyListeners(state);

            // STEP 4: SLA Agent — Assign priority
            await runAgent("sla", slaAgent, state);
            notifyListeners(state);

            // STEP 5: Execution Agent — Execute the plan
            await runAgent("execution", executionAgent, state);
            notifyListeners(state);

            // Check execution result
            if (state.executionStatus === "success") {
                resolved = true;
                log.info("✅ Execution succeeded!");
            } else {
                // Retry logic
                state.retryCount++;
                if (state.retryCount <= state.maxRetries) {
                    log.warn(
                        { retryCount: state.retryCount, maxRetries: state.maxRetries },
                        `⚠️ Execution failed. Replanning... (attempt ${state.retryCount}/${state.maxRetries})`
                    );
                    // Reset execution state for retry
                    state.executionStatus = "pending";

                    try {
                        await logAgentEvent(state.incidentId, "orchestrator", "retry", {
                            retryCount: state.retryCount,
                            failedSteps: state.stepsFailed,
                        });
                    } catch { }
                } else {
                    log.error(
                        { retryCount: state.retryCount },
                        "❌ Max retries exceeded — ESCALATING to human operator"
                    );
                    state.workflowStatus = "escalated";
                }
            }
        }

        // ──────────────────────────────────────────────────
        // STEP 6: Feedback Agent — Learn and store
        // ──────────────────────────────────────────────────
        await runAgent("feedback", feedbackAgent, state);
        notifyListeners(state);

    } catch (err: any) {
        log.error({ err: err.message, incidentId: state.incidentId }, "Pipeline error");
        state.workflowStatus = "failed";
        state.errorLog.push({
            agent: "orchestrator",
            error: err.message,
            timestamp: new Date().toISOString(),
        });
    }

    const totalMs = Date.now() - startTime;
    log.info(
        {},
        "═══════════════════════════════════════════════════"
    );
    log.info(
        {
            incidentId: state.incidentId,
            outcome: state.outcome,
            duration: `${(totalMs / 1000).toFixed(1)}s`,
            retries: state.retryCount,
            stepsCompleted: state.stepsCompleted.length,
            stepsFailed: state.stepsFailed.length,
        },
        `🏁 PIPELINE COMPLETE — ${state.outcome?.toUpperCase() || "UNKNOWN"} (${(totalMs / 1000).toFixed(1)}s)`
    );
    log.info(
        {},
        "═══════════════════════════════════════════════════"
    );

    activeIncidents.set(state.incidentId, state);
    return state;
}

/**
 * Run a single agent with error handling and logging.
 */
async function runAgent(
    name: string,
    agentFn: (state: IncidentState) => Promise<IncidentState>,
    state: IncidentState
): Promise<void> {
    const start = Date.now();
    try {
        await agentFn(state);
        const duration = Date.now() - start;

        try {
            await logAgentEvent(state.incidentId, name, "completed", {
                durationMs: duration,
                status: "success",
            });
        } catch { }

    } catch (err: any) {
        const duration = Date.now() - start;
        log.error({ agent: name, err: err.message, durationMs: duration }, `Agent ${name} failed`);
        state.errorLog.push({
            agent: name,
            error: err.message,
            timestamp: new Date().toISOString(),
        });

        try {
            await logAgentEvent(state.incidentId, name, "failed", {
                durationMs: duration,
                error: err.message,
            });
        } catch { }
    }
}

/**
 * Get an active or completed incident state.
 */
export function getIncidentState(incidentId: string): IncidentState | undefined {
    return activeIncidents.get(incidentId);
}

/**
 * Get all incident states.
 */
export function getAllIncidentStates(): IncidentState[] {
    return Array.from(activeIncidents.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}
