/**
 * AutoOps AI — Log Simulator / Producer
 * Generates realistic log events and publishes to Kafka or directly to pipeline.
 */
import { v4 as uuidv4 } from "uuid";
import { RawEvent } from "../orchestrator/state";
import { createChildLogger } from "../utils/logger";

const log = createChildLogger("Simulator");

const SERVICES = [
    "payment-api", "auth-service", "user-service",
    "order-service", "notification-service", "api-gateway",
];

const NAMESPACES = ["production", "staging"];

type Scenario = "oom_kill" | "high_error_rate" | "cpu_spike" | "disk_full" | "connection_pool_exhaustion" | "service_down" | "random";

/**
 * Generate a batch of events for a given scenario.
 */
export function generateEvents(
    scenario: Scenario = "random",
    count: number = 20,
    targetService?: string
): RawEvent[] {
    const service = targetService || SERVICES[Math.floor(Math.random() * SERVICES.length)];
    const generators: Record<Scenario, () => RawEvent[]> = {
        oom_kill: () => generateOOMKillEvents(service, count),
        high_error_rate: () => generateErrorRateEvents(service, count),
        cpu_spike: () => generateCPUSpikeEvents(service, count),
        disk_full: () => generateDiskFullEvents(service, count),
        connection_pool_exhaustion: () => generateConnectionPoolEvents(service, count),
        service_down: () => generateServiceDownEvents(service, count),
        random: () => generateRandomEvents(count),
    };

    const events = generators[scenario]();
    log.info({ scenario, count: events.length, service }, "Events generated");
    return events;
}

function baseEvent(service: string, overrides: Partial<RawEvent> = {}): RawEvent {
    return {
        eventId: `evt-${uuidv4().slice(0, 8)}`,
        timestamp: new Date(Date.now() - Math.random() * 60000).toISOString(),
        source: {
            type: "kubernetes",
            service,
            namespace: "production",
            pod: `${service}-${Math.random().toString(36).slice(2, 8)}`,
        },
        eventType: "unknown",
        severity: "medium",
        data: {},
        ...overrides,
    };
}

function generateOOMKillEvents(service: string, count: number): RawEvent[] {
    const events: RawEvent[] = [];
    // Main OOMKill events
    for (let i = 0; i < Math.ceil(count * 0.4); i++) {
        events.push(baseEvent(service, {
            eventType: "pod_crash",
            severity: "critical",
            data: {
                reason: "OOMKilled",
                exitCode: 137,
                restartCount: 3 + Math.floor(Math.random() * 8),
                memoryLimit: "512Mi",
                memoryUsage: `${490 + Math.floor(Math.random() * 22)}Mi`,
            },
        }));
    }
    // Supporting metric events
    for (let i = 0; i < Math.ceil(count * 0.3); i++) {
        events.push(baseEvent(service, {
            eventType: "metric_alert",
            severity: "high",
            data: {
                metric: "container_memory_usage_bytes",
                value: 500 + Math.floor(Math.random() * 50),
                threshold: 480,
                unit: "Mi",
            },
        }));
    }
    // Noise events
    for (let i = 0; i < count - events.length; i++) {
        events.push(baseEvent(service, {
            eventType: "log_entry",
            severity: "info",
            data: { message: "Request processed", latency: Math.random() * 200 },
        }));
    }
    return events;
}

function generateErrorRateEvents(service: string, count: number): RawEvent[] {
    const events: RawEvent[] = [];
    for (let i = 0; i < Math.ceil(count * 0.5); i++) {
        events.push(baseEvent(service, {
            eventType: "error_spike",
            severity: "high",
            data: {
                errorRate: 0.15 + Math.random() * 0.3,
                statusCode: [500, 502, 503][Math.floor(Math.random() * 3)],
                endpoint: ["/api/payments", "/api/orders", "/api/users"][Math.floor(Math.random() * 3)],
                errorCount: 50 + Math.floor(Math.random() * 200),
            },
        }));
    }
    for (let i = events.length; i < count; i++) {
        events.push(baseEvent(service, {
            eventType: "log_entry",
            severity: "medium",
            data: { message: "HTTP 5xx error", statusCode: 500 },
        }));
    }
    return events;
}

function generateCPUSpikeEvents(service: string, count: number): RawEvent[] {
    const events: RawEvent[] = [];
    for (let i = 0; i < Math.ceil(count * 0.4); i++) {
        events.push(baseEvent(service, {
            eventType: "cpu_spike",
            severity: "high",
            data: {
                cpuUsage: 90 + Math.floor(Math.random() * 10),
                cpuLimit: "1000m",
                throttlingPercent: 20 + Math.floor(Math.random() * 40),
            },
        }));
    }
    for (let i = events.length; i < count; i++) {
        events.push(baseEvent(service, {
            eventType: "metric_alert",
            severity: "medium",
            data: { metric: "cpu_usage", value: 85 + Math.random() * 15 },
        }));
    }
    return events;
}

function generateDiskFullEvents(service: string, count: number): RawEvent[] {
    const events: RawEvent[] = [];
    for (let i = 0; i < Math.ceil(count * 0.3); i++) {
        events.push(baseEvent(service, {
            eventType: "disk_full",
            severity: "critical",
            data: { diskUsage: 95 + Math.floor(Math.random() * 5), volume: "/var/log", totalGB: 100, freeGB: 2 },
        }));
    }
    for (let i = events.length; i < count; i++) {
        events.push(baseEvent(service, {
            eventType: "log_entry",
            severity: "medium",
            data: { message: "Disk space warning" },
        }));
    }
    return events;
}

function generateConnectionPoolEvents(service: string, count: number): RawEvent[] {
    const events: RawEvent[] = [];
    for (let i = 0; i < Math.ceil(count * 0.4); i++) {
        events.push(baseEvent(service, {
            eventType: "connection_pool_exhaustion",
            severity: "high",
            data: { poolUsage: 90 + Math.floor(Math.random() * 10), maxConnections: 100, activeConnections: 95 },
        }));
    }
    for (let i = events.length; i < count; i++) {
        events.push(baseEvent(service, {
            eventType: "metric_alert",
            severity: "medium",
            data: { metric: "db_pool_active", value: 90 + Math.random() * 10 },
        }));
    }
    return events;
}

function generateServiceDownEvents(service: string, count: number): RawEvent[] {
    const events: RawEvent[] = [];
    for (let i = 0; i < Math.ceil(count * 0.3); i++) {
        events.push(baseEvent(service, {
            eventType: "service_down",
            severity: "critical",
            data: { status: "down", lastHealthCheck: new Date(Date.now() - 120000).toISOString(), consecutiveFailures: 10 },
        }));
    }
    for (let i = events.length; i < count; i++) {
        events.push(baseEvent(service, {
            eventType: "pod_crash",
            severity: "critical",
            data: { reason: "Error", exitCode: 1, restartCount: Math.floor(Math.random() * 10) },
        }));
    }
    return events;
}

function generateRandomEvents(count: number): RawEvent[] {
    const scenarios: Scenario[] = ["oom_kill", "high_error_rate", "cpu_spike", "disk_full", "connection_pool_exhaustion", "service_down"];
    const scenario = scenarios[Math.floor(Math.random() * scenarios.length)];
    const service = SERVICES[Math.floor(Math.random() * SERVICES.length)];
    return generateEvents(scenario, count, service);
}

/**
 * CLI entry — generate and print events or run standalone.
 */
if (require.main === module) {
    const events = generateEvents("oom_kill", 30, "payment-api");
    console.log(JSON.stringify(events, null, 2));
    console.log(`\n✅ Generated ${events.length} events`);
}
