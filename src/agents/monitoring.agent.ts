/**
 * Agent 1: Monitoring Agent
 * Detects anomalies from incoming log events using statistical,
 * pattern-based, and rule-based analysis.
 */
import { v4 as uuidv4 } from "uuid";
import { IncidentState, RawEvent, DetectedIssue } from "../orchestrator/state";
import { createChildLogger } from "../utils/logger";
import { config } from "../config";

const log = createChildLogger("MonitoringAgent");

// ── Anomaly Detection Models ──────────────────────

/**
 * Statistical analysis — Z-score style deviation detection.
 * Checks for abnormal patterns in event frequencies and severities.
 */
function statisticalScore(events: RawEvent[]): number {
    const criticalCount = events.filter((e) => e.severity === "critical").length;
    const highCount = events.filter((e) => e.severity === "high").length;
    const errorEvents = events.filter((e) =>
        ["pod_crash", "service_down", "oom_killed", "error_spike", "disk_full"].includes(e.eventType)
    ).length;

    const totalEvents = events.length || 1;
    const severityRatio = (criticalCount * 2 + highCount) / totalEvents;
    const errorRatio = errorEvents / totalEvents;

    // Weighted combination
    return Math.min(1.0, severityRatio * 0.6 + errorRatio * 0.4);
}

/**
 * Pattern-based analysis — looks for known anomaly patterns.
 */
function patternScore(events: RawEvent[]): number {
    let score = 0;
    const patterns = [
        { type: "pod_crash", field: "reason", value: "OOMKilled", weight: 0.95 },
        { type: "pod_crash", field: "restartCount", minValue: 5, weight: 0.9 },
        { type: "error_spike", field: "errorRate", minValue: 0.1, weight: 0.85 },
        { type: "cpu_spike", field: "cpuUsage", minValue: 90, weight: 0.8 },
        { type: "disk_full", field: "diskUsage", minValue: 95, weight: 0.9 },
        { type: "connection_pool_exhaustion", field: "poolUsage", minValue: 90, weight: 0.85 },
        { type: "service_down", field: "status", value: "down", weight: 0.95 },
    ];

    for (const event of events) {
        for (const pattern of patterns) {
            if (event.eventType === pattern.type) {
                if (pattern.value && event.data[pattern.field!] === pattern.value) {
                    score = Math.max(score, pattern.weight);
                } else if (
                    pattern.minValue &&
                    typeof event.data[pattern.field!] === "number" &&
                    event.data[pattern.field!] >= pattern.minValue
                ) {
                    score = Math.max(score, pattern.weight);
                } else if (!pattern.value && !pattern.minValue) {
                    score = Math.max(score, pattern.weight * 0.7);
                }
            }
        }
    }

    return score;
}

/**
 * Rule-based analysis — checks against predefined incident rules.
 */
function rulesScore(events: RawEvent[]): number {
    let score = 0;

    // Rule: Multiple critical events from same service
    const serviceMap = new Map<string, number>();
    for (const e of events) {
        if (e.severity === "critical" || e.severity === "high") {
            const svc = e.source.service;
            serviceMap.set(svc, (serviceMap.get(svc) || 0) + 1);
        }
    }
    for (const count of serviceMap.values()) {
        if (count >= 3) score = Math.max(score, 0.9);
        else if (count >= 2) score = Math.max(score, 0.7);
    }

    // Rule: Rapid succession of error events
    const timestamps = events
        .filter((e) => e.severity === "critical")
        .map((e) => new Date(e.timestamp).getTime())
        .sort();
    if (timestamps.length >= 3) {
        const span = timestamps[timestamps.length - 1] - timestamps[0];
        if (span < 60000) score = Math.max(score, 0.85); // 3+ critical in 1 minute
    }

    return score;
}

// ── Main Agent ────────────────────────────────────

export async function monitoringAgent(state: IncidentState): Promise<IncidentState> {
    log.info(
        { incidentId: state.incidentId, eventCount: state.rawEvents.length },
        "▶ Monitoring Agent started"
    );
    state.currentAgent = "monitoring";
    state.workflowStatus = "monitoring";
    state.updatedAt = new Date().toISOString();

    const events = state.rawEvents;
    if (events.length === 0) {
        log.warn("No events to analyze");
        return state;
    }

    // Run all three detection models
    const statScore = statisticalScore(events);
    const patScore = patternScore(events);
    const ruleScore = rulesScore(events);

    // Ensemble score (weighted average)
    const anomalyScore =
        0.3 * statScore + 0.4 * patScore + 0.3 * ruleScore;

    log.info(
        { statScore: statScore.toFixed(3), patScore: patScore.toFixed(3), ruleScore: ruleScore.toFixed(3), ensemble: anomalyScore.toFixed(3) },
        "Anomaly scores computed"
    );

    if (anomalyScore >= config.agents.anomalyThreshold) {
        // Determine primary affected service
        const serviceCounts = new Map<string, number>();
        for (const e of events) {
            const svc = e.source.service;
            serviceCounts.set(svc, (serviceCounts.get(svc) || 0) + 1);
        }
        const affectedService = [...serviceCounts.entries()].sort(
            (a, b) => b[1] - a[1]
        )[0][0];

        // Determine severity
        const hasCritical = events.some((e) => e.severity === "critical");
        const hasHigh = events.some((e) => e.severity === "high");
        const severity = hasCritical
            ? "critical"
            : hasHigh
                ? "high"
                : anomalyScore > 0.85
                    ? "high"
                    : "medium";

        // Determine issue type
        const eventTypes = events.map((e) => e.eventType);
        const primaryType =
            eventTypes.find((t) => t === "pod_crash") ||
            eventTypes.find((t) => t === "oom_killed") ||
            eventTypes.find((t) => t === "error_spike") ||
            eventTypes.find((t) => t === "cpu_spike") ||
            eventTypes.find((t) => t === "disk_full") ||
            eventTypes.find((t) => t === "service_down") ||
            eventTypes[0];

        const issue: DetectedIssue = {
            issueId: `issue-${uuidv4().slice(0, 8)}`,
            type: primaryType,
            severity: severity as any,
            description: `Anomaly detected in ${affectedService}: ${primaryType} (score: ${anomalyScore.toFixed(3)})`,
            anomalyScore,
            sourceEvents: events.map((e) => e.eventId),
            detectedAt: new Date().toISOString(),
            affectedService,
            modelScores: {
                statistical: statScore,
                patternBased: patScore,
                rulesBased: ruleScore,
            },
        };

        state.issue = issue;
        log.info(
            { issueId: issue.issueId, type: issue.type, severity: issue.severity, score: anomalyScore.toFixed(3) },
            "🚨 ANOMALY DETECTED"
        );
    } else {
        log.info(
            { score: anomalyScore.toFixed(3), threshold: config.agents.anomalyThreshold },
            "No anomaly detected (below threshold)"
        );
    }

    return state;
}
