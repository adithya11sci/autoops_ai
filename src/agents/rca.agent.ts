/**
 * Agent 2: Root Cause Analysis Agent
 * Identifies failure root cause using dependency graph traversal,
 * temporal correlation, and rule-based pattern matching.
 */
import { IncidentState, RootCause } from "../orchestrator/state";
import { createChildLogger } from "../utils/logger";

const log = createChildLogger("RCAAgent");

// ── Service Dependency Graph ──────────────────────

interface ServiceNode {
    name: string;
    dependencies: string[];
    type: string; // "api" | "database" | "cache" | "queue" | "external"
}

const SERVICE_GRAPH: ServiceNode[] = [
    { name: "api-gateway", dependencies: ["auth-service", "user-service", "payment-service", "order-service"], type: "api" },
    { name: "auth-service", dependencies: ["user-db", "redis-cache"], type: "api" },
    { name: "user-service", dependencies: ["user-db", "redis-cache"], type: "api" },
    { name: "payment-service", dependencies: ["payment-db", "stripe-api", "redis-cache"], type: "api" },
    { name: "payment-api", dependencies: ["payment-db", "stripe-api", "redis-cache"], type: "api" },
    { name: "order-service", dependencies: ["order-db", "payment-service", "notification-service"], type: "api" },
    { name: "notification-service", dependencies: ["redis-cache", "email-api"], type: "api" },
    { name: "user-db", dependencies: [], type: "database" },
    { name: "payment-db", dependencies: [], type: "database" },
    { name: "order-db", dependencies: [], type: "database" },
    { name: "redis-cache", dependencies: [], type: "cache" },
    { name: "stripe-api", dependencies: [], type: "external" },
    { name: "email-api", dependencies: [], type: "external" },
];

// ── RCA Rules ─────────────────────────────────────

interface RCARule {
    name: string;
    eventTypes: string[];
    dataConditions: Record<string, any>;
    rootCause: {
        category: string;
        description: string;
        remediationHint: string;
        confidence: number;
    };
}

const RCA_RULES: RCARule[] = [
    {
        name: "OOMKilled Detection",
        eventTypes: ["pod_crash", "oom_killed"],
        dataConditions: { reason: "OOMKilled" },
        rootCause: {
            category: "memory_leak",
            description: "Container exceeded memory limit and was OOMKilled",
            remediationHint: "Increase memory limits or investigate memory leak in application",
            confidence: 0.95,
        },
    },
    {
        name: "CrashLoopBackOff",
        eventTypes: ["pod_crash"],
        dataConditions: { restartCountMin: 5 },
        rootCause: {
            category: "application_crash",
            description: "Application repeatedly crashing on startup (CrashLoopBackOff)",
            remediationHint: "Check application logs, rollback recent deployment",
            confidence: 0.90,
        },
    },
    {
        name: "High Error Rate Post-Deploy",
        eventTypes: ["error_spike"],
        dataConditions: {},
        rootCause: {
            category: "deployment_regression",
            description: "Error rate spike detected, likely caused by recent deployment",
            remediationHint: "Rollback to previous stable version",
            confidence: 0.85,
        },
    },
    {
        name: "CPU Saturation",
        eventTypes: ["cpu_spike"],
        dataConditions: { cpuUsageMin: 90 },
        rootCause: {
            category: "resource_exhaustion",
            description: "CPU usage exceeding safe threshold, service under heavy load",
            remediationHint: "Scale horizontally or optimize CPU-intensive operations",
            confidence: 0.82,
        },
    },
    {
        name: "Disk Full",
        eventTypes: ["disk_full"],
        dataConditions: { diskUsageMin: 95 },
        rootCause: {
            category: "storage_exhaustion",
            description: "Disk space nearly full, risk of service failure",
            remediationHint: "Clean up logs/temp files or expand storage volume",
            confidence: 0.90,
        },
    },
    {
        name: "DB Connection Pool Exhaustion",
        eventTypes: ["connection_pool_exhaustion"],
        dataConditions: { poolUsageMin: 90 },
        rootCause: {
            category: "connection_leak",
            description: "Database connection pool nearly exhausted",
            remediationHint: "Increase pool size or fix connection leak in application",
            confidence: 0.85,
        },
    },
    {
        name: "Service Down",
        eventTypes: ["service_down"],
        dataConditions: {},
        rootCause: {
            category: "service_failure",
            description: "Service is completely unresponsive",
            remediationHint: "Restart service and investigate underlying cause",
            confidence: 0.92,
        },
    },
];

// ── Analysis Functions ────────────────────────────

function matchRules(issue: NonNullable<IncidentState["issue"]>, events: IncidentState["rawEvents"]): RCARule | null {
    for (const rule of RCA_RULES) {
        // Check event type match
        if (!rule.eventTypes.includes(issue.type)) continue;

        // Check data conditions
        let conditionsMet = true;
        for (const event of events) {
            for (const [key, value] of Object.entries(rule.dataConditions)) {
                if (key.endsWith("Min")) {
                    const field = key.replace("Min", "");
                    if (typeof event.data[field] !== "number" || event.data[field] < value) {
                        conditionsMet = false;
                    }
                } else if (event.data[key] !== undefined && event.data[key] !== value) {
                    conditionsMet = false;
                }
            }
        }

        if (conditionsMet) return rule;
    }
    return null;
}

function traceDependencyPath(serviceName: string): string[] {
    const path: string[] = [serviceName];
    const node = SERVICE_GRAPH.find((n) => n.name === serviceName);
    if (node) {
        for (const dep of node.dependencies) {
            path.push(dep);
        }
    }
    // Also find services that depend on this one (upstream impact)
    const dependents = SERVICE_GRAPH.filter((n) => n.dependencies.includes(serviceName));
    for (const dep of dependents) {
        path.unshift(dep.name);
    }
    return [...new Set(path)];
}

function buildEvidence(issue: NonNullable<IncidentState["issue"]>, events: IncidentState["rawEvents"]): string[] {
    const evidence: string[] = [];
    evidence.push(`Anomaly detected: ${issue.type} with score ${issue.anomalyScore.toFixed(3)}`);
    evidence.push(`Affected service: ${issue.affectedService}`);
    evidence.push(`Severity: ${issue.severity}`);
    evidence.push(`Total anomalous events: ${events.length}`);

    // Extract specific data points
    for (const event of events.slice(0, 5)) {
        const dataStr = Object.entries(event.data)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ");
        evidence.push(`Event ${event.eventType}: ${dataStr}`);
    }

    return evidence;
}

// ── Main Agent ────────────────────────────────────

export async function rcaAgent(state: IncidentState): Promise<IncidentState> {
    log.info({ incidentId: state.incidentId }, "▶ RCA Agent started");
    state.currentAgent = "rca";
    state.workflowStatus = "analyzing";
    state.updatedAt = new Date().toISOString();

    if (!state.issue) {
        log.warn("No issue detected, skipping RCA");
        return state;
    }

    const issue = state.issue;
    const events = state.rawEvents;

    // Strategy 1: Rule-based pattern matching
    const matchedRule = matchRules(issue, events);

    // Strategy 2: Dependency graph traversal
    const dependencyPath = traceDependencyPath(issue.affectedService);

    // Strategy 3: Build evidence
    const evidence = buildEvidence(issue, events);

    // Construct root cause
    let rootCause: RootCause;

    if (matchedRule) {
        rootCause = {
            category: matchedRule.rootCause.category,
            service: issue.affectedService,
            description: matchedRule.rootCause.description,
            confidence: matchedRule.rootCause.confidence,
            evidence,
            dependencyPath,
            remediationHint: matchedRule.rootCause.remediationHint,
        };
        log.info(
            { rule: matchedRule.name, confidence: matchedRule.rootCause.confidence },
            "Root cause identified via rule match"
        );
    } else {
        // Fallback: generic root cause based on event type
        rootCause = {
            category: "unknown",
            service: issue.affectedService,
            description: `Issue of type '${issue.type}' detected in ${issue.affectedService}. No specific rule matched.`,
            confidence: 0.5,
            evidence,
            dependencyPath,
            remediationHint: "Investigate service logs and metrics manually, then apply standard remediation",
        };
        log.warn("No rule matched, using fallback root cause");
    }

    state.rootCause = rootCause;

    log.info(
        {
            category: rootCause.category,
            service: rootCause.service,
            confidence: rootCause.confidence.toFixed(2),
            dependencyPathLength: dependencyPath.length,
        },
        "🔎 Root cause identified"
    );

    return state;
}
