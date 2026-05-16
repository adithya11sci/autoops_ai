/**
 * AutoOps AI — WebSocket Broadcast Service
 * Central hub for real-time event broadcasting to all connected UI clients.
 * Imported by workflow, agents, and server — no circular deps (no imports from app modules).
 */
import { createChildLogger } from "../utils/logger";

const log = createChildLogger("Broadcast");

interface WsClient {
    readyState: number;
    send(data: string): void;
    on(event: string, listener: (...args: any[]) => void): void;
}

// In-memory metrics tracking (for Prometheus endpoint)
const metrics = {
    incidentsTotal: 0,
    incidentsResolved: 0,
    incidentsFailed: 0,
    incidentsEscalated: 0,
    incidentsActive: 0,
    totalMttrMs: 0,
    resolvedCount: 0,
};

// Connected WebSocket clients
const clients = new Set<WsClient>();

// ── Client Management ─────────────────────────────

export function addWsClient(socket: WsClient): void {
    clients.add(socket);
    log.info({ clientCount: clients.size }, "WS client connected");

    // Clean up on disconnect
    socket.on("close", () => {
        clients.delete(socket);
        log.info({ clientCount: clients.size }, "WS client disconnected");
    });
    socket.on("error", () => {
        clients.delete(socket);
    });

    // Send welcome + current metrics snapshot to new client
    try {
        socket.send(JSON.stringify({
            type: "connected",
            payload: { message: "Connected to AutoOps AI real-time feed", metrics: getMetricsJson() },
            ts: Date.now(),
        }));
    } catch { /* ignore */ }
}

export function getClientCount(): number {
    return clients.size;
}

// ── Broadcasting ──────────────────────────────────

export function broadcast(type: string, payload: unknown): void {
    if (clients.size === 0) return;

    const msg = JSON.stringify({ type, payload, ts: Date.now() });
    const dead: WsClient[] = [];

    for (const client of clients) {
        try {
            if (client.readyState === 1) {
                client.send(msg);
            } else {
                dead.push(client);
            }
        } catch {
            dead.push(client);
        }
    }

    for (const d of dead) clients.delete(d);
}

export function broadcastLog(
    agent: string,
    level: "info" | "warn" | "error",
    message: string,
    data?: Record<string, unknown>
): void {
    broadcast("log", { agent, level, message, data, ts: Date.now() });
}

// ── Metrics Tracking ──────────────────────────────

export function recordPipelineStart(): void {
    metrics.incidentsTotal++;
    metrics.incidentsActive = Math.max(0, metrics.incidentsActive + 1);
}

export function recordPipelineComplete(outcome: string, durationMs: number): void {
    metrics.incidentsActive = Math.max(0, metrics.incidentsActive - 1);
    if (outcome === "resolved") {
        metrics.incidentsResolved++;
        metrics.totalMttrMs += durationMs;
        metrics.resolvedCount++;
    } else if (outcome === "failed") {
        metrics.incidentsFailed++;
    } else if (outcome === "escalated") {
        metrics.incidentsEscalated++;
    }
    // Broadcast updated metrics to all clients
    broadcast("metrics_update", getMetricsJson());
}

export function getMetricsJson(): Record<string, number | string> {
    const avgMttrSec = metrics.resolvedCount > 0
        ? parseFloat((metrics.totalMttrMs / metrics.resolvedCount / 1000).toFixed(1))
        : 0;
    const autoRate = metrics.incidentsTotal > 0
        ? parseFloat((metrics.incidentsResolved / metrics.incidentsTotal).toFixed(3))
        : 0;

    return {
        incidentsTotal: metrics.incidentsTotal,
        incidentsResolved: metrics.incidentsResolved,
        incidentsFailed: metrics.incidentsFailed,
        incidentsEscalated: metrics.incidentsEscalated,
        incidentsActive: metrics.incidentsActive,
        autoResolutionRate: autoRate,
        avgMttrSeconds: avgMttrSec,
    };
}

export function getPrometheusMetrics(): string {
    const m = getMetricsJson();
    return [
        "# HELP autoops_incidents_total Total incidents processed",
        "# TYPE autoops_incidents_total counter",
        `autoops_incidents_total ${m.incidentsTotal}`,
        "",
        "# HELP autoops_incidents_resolved_total Auto-resolved incidents",
        "# TYPE autoops_incidents_resolved_total counter",
        `autoops_incidents_resolved_total ${m.incidentsResolved}`,
        "",
        "# HELP autoops_incidents_failed_total Failed incidents",
        "# TYPE autoops_incidents_failed_total counter",
        `autoops_incidents_failed_total ${m.incidentsFailed}`,
        "",
        "# HELP autoops_incidents_escalated_total Escalated incidents",
        "# TYPE autoops_incidents_escalated_total counter",
        `autoops_incidents_escalated_total ${m.incidentsEscalated}`,
        "",
        "# HELP autoops_incidents_active Currently active incidents",
        "# TYPE autoops_incidents_active gauge",
        `autoops_incidents_active ${m.incidentsActive}`,
        "",
        "# HELP autoops_auto_resolution_rate Auto-resolution success rate (0-1)",
        "# TYPE autoops_auto_resolution_rate gauge",
        `autoops_auto_resolution_rate ${m.autoResolutionRate}`,
        "",
        "# HELP autoops_avg_mttr_seconds Average mean time to resolution",
        "# TYPE autoops_avg_mttr_seconds gauge",
        `autoops_avg_mttr_seconds ${m.avgMttrSeconds}`,
    ].join("\n");
}
