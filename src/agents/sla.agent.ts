/**
 * Agent 4: SLA Agent
 * Assigns priority based on severity, impact, and SLA deadlines.
 * Determines if fast-track execution is needed.
 */
import { IncidentState, Priority } from "../orchestrator/state";
import { createChildLogger } from "../utils/logger";

const log = createChildLogger("SLAAgent");

const SLA_TIERS: Record<string, { responseMin: number; resolutionMin: number }> = {
    platinum: { responseMin: 5, resolutionMin: 30 },
    gold: { responseMin: 15, resolutionMin: 60 },
    silver: { responseMin: 30, resolutionMin: 240 },
    bronze: { responseMin: 60, resolutionMin: 480 },
};

const SEVERITY_WEIGHTS: Record<string, number> = {
    critical: 1.0,
    high: 0.75,
    medium: 0.5,
    low: 0.25,
    info: 0.1,
};

export async function slaAgent(state: IncidentState): Promise<IncidentState> {
    log.info({ incidentId: state.incidentId }, "▶ SLA Agent started");
    state.currentAgent = "sla";
    state.workflowStatus = "prioritizing";
    state.updatedAt = new Date().toISOString();

    if (!state.issue || !state.plan) {
        log.warn("No issue or plan, assigning default P3");
        state.priority = "P3";
        return state;
    }

    const issue = state.issue;

    // Calculate composite priority score
    const severityScore = SEVERITY_WEIGHTS[issue.severity] || 0.5;
    const eventCount = state.rawEvents.length;
    const eventCountNorm = Math.min(eventCount / 50, 1.0);
    const anomalyScore = issue.anomalyScore;
    const hasRootCause = state.rootCause ? state.rootCause.confidence : 0.5;

    const priorityScore =
        0.35 * severityScore +
        0.25 * anomalyScore +
        0.25 * eventCountNorm +
        0.15 * hasRootCause;

    // Map score to priority level
    let priority: Priority;
    if (priorityScore >= 0.9) priority = "P0";
    else if (priorityScore >= 0.7) priority = "P1";
    else if (priorityScore >= 0.4) priority = "P2";
    else if (priorityScore >= 0.2) priority = "P3";
    else priority = "P4";

    // Determine SLA tier and deadline
    const slaTier = issue.severity === "critical"
        ? "platinum"
        : issue.severity === "high"
            ? "gold"
            : "silver";

    const slaConfig = SLA_TIERS[slaTier];
    const slaDeadline = new Date(
        Date.now() + slaConfig.resolutionMin * 60 * 1000
    ).toISOString();

    // Check if fast-track is needed
    const estimatedResolution = (state.plan.estimatedDurationMinutes || 10) * 60 * 1000;
    const timeToDeadline = slaConfig.resolutionMin * 60 * 1000;
    const buffer = 5 * 60 * 1000; // 5 minute buffer
    const fastTrack = timeToDeadline - estimatedResolution < buffer;

    state.priority = priority;
    state.slaDeadline = slaDeadline;
    state.fastTrack = fastTrack;

    log.info(
        {
            priorityScore: priorityScore.toFixed(3),
            priority,
            slaTier,
            slaDeadlineMin: slaConfig.resolutionMin,
            fastTrack,
        },
        `⏰ Priority assigned: ${priority}${fastTrack ? " [FAST-TRACK]" : ""}`
    );

    return state;
}
