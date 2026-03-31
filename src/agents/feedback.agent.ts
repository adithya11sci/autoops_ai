/**
 * Agent 6: Feedback / Learning Agent
 * Analyzes outcomes, stores results, and updates knowledge base.
 */
import { IncidentState } from "../orchestrator/state";
import { saveIncident, logAgentEvent } from "../services/database";
import { storeIncident } from "../services/chroma.client";
import { createChildLogger } from "../utils/logger";

const log = createChildLogger("FeedbackAgent");

export async function feedbackAgent(state: IncidentState): Promise<IncidentState> {
    log.info({ incidentId: state.incidentId }, "▶ Feedback Agent started");
    state.currentAgent = "feedback";
    state.workflowStatus = "learning";
    state.updatedAt = new Date().toISOString();

    // Step 1: Evaluate outcome
    let outcome: IncidentState["outcome"];
    if (state.executionStatus === "success") {
        outcome = "resolved";
    } else if (state.stepsCompleted.length > 0 && state.stepsFailed.length > 0) {
        outcome = "partial";
    } else if (state.retryCount >= state.maxRetries) {
        outcome = "escalated";
    } else {
        outcome = "failed";
    }
    state.outcome = outcome;

    // Step 2: Calculate resolution duration
    const createdTime = new Date(state.createdAt).getTime();
    const resolvedTime = Date.now();
    const durationSeconds = Math.round((resolvedTime - createdTime) / 1000);

    // Step 3: Extract lessons learned
    const lessons: string[] = [];

    lessons.push(
        `Incident ${state.incidentId}: ${outcome}. ` +
        `Root cause: ${state.rootCause?.category || "unknown"} in ${state.rootCause?.service || "unknown"}. ` +
        `Duration: ${durationSeconds}s.`
    );

    if (state.retryCount > 0) {
        lessons.push(
            `Required ${state.retryCount} replanning attempt(s) before ${outcome === "resolved" ? "success" : "escalation"}.`
        );
    }

    if (state.stepsCompleted.length > 0) {
        lessons.push(
            `Completed ${state.stepsCompleted.length} steps: ${state.stepsCompleted.map((s) => s.action).join(", ")}`
        );
    }

    if (state.stepsFailed.length > 0) {
        lessons.push(
            `Failed steps: ${state.stepsFailed.map((s) => `${s.action} (${s.error})`).join("; ")}`
        );
    }

    if (state.plan) {
        lessons.push(
            `Plan "${state.plan.title}" (${state.plan.steps.length} steps, risk: ${state.plan.riskLevel})`
        );
    }

    state.lessonsLearned = lessons;
    state.workflowStatus = outcome === "resolved" ? "completed" : outcome === "escalated" ? "escalated" : "failed";

    // Step 4: Persist to PostgreSQL
    try {
        await saveIncident(state);
        await logAgentEvent(state.incidentId, "feedback", "outcome", {
            outcome,
            durationSeconds,
            lessons,
        });
        log.info("Incident persisted to PostgreSQL");
    } catch (err: any) {
        log.warn({ err: err.message }, "Failed to persist to PostgreSQL (non-fatal)");
    }

    // Step 5: Store in ChromaDB for future RAG
    try {
        const description =
            `Incident: ${state.issue?.type || "unknown"} in ${state.rootCause?.service || "unknown"}. ` +
            `Root cause: ${state.rootCause?.category || "unknown"} — ${state.rootCause?.description || "N/A"}. ` +
            `Resolution: ${state.plan?.title || "N/A"}. ` +
            `Steps: ${state.stepsCompleted.map((s) => s.action).join(", ")}. ` +
            `Outcome: ${outcome}. Duration: ${durationSeconds}s.`;

        await storeIncident(state.incidentId, description, {
            outcome,
            rootCauseCategory: state.rootCause?.category || "unknown",
            service: state.rootCause?.service || "unknown",
            severity: state.issue?.severity || "unknown",
            priority: state.priority || "P3",
            durationSeconds,
            retryCount: state.retryCount,
            planTitle: state.plan?.title || "N/A",
        });
        log.info("Incident stored in ChromaDB for future RAG");
    } catch (err: any) {
        log.warn({ err: err.message }, "Failed to store in ChromaDB (non-fatal)");
    }

    // Step 6: Log summary
    log.info(
        {
            incidentId: state.incidentId,
            outcome,
            duration: `${durationSeconds}s`,
            retries: state.retryCount,
            stepsCompleted: state.stepsCompleted.length,
            stepsFailed: state.stepsFailed.length,
        },
        `📊 Feedback complete: ${outcome.toUpperCase()}`
    );

    return state;
}
