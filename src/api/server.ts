/**
 * AutoOps AI — Fastify API Server (Enterprise Edition)
 * REST + WebSocket endpoints for incident management and real-time monitoring.
 * Serves the enterprise dashboard UI via static file hosting.
 */
import path from "path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { config } from "../config";
import { createChildLogger } from "../utils/logger";
import {
    runPipeline,
    getIncidentState,
    getAllIncidentStates,
    preRegisterIncident,
} from "../orchestrator/workflow";
import { createIncidentState } from "../orchestrator/state";
import { generateEvents } from "../simulator/log-producer";
import { getIncident, listIncidents, getMetrics } from "../services/database";
import { RawEvent } from "../orchestrator/state";
import { registerApprovalRoutes } from "./approvals.router";
import {
    addWsClient,
    getClientCount,
    getPrometheusMetrics,
    getMetricsJson,
} from "../services/broadcast";
import { publishEvents, bus } from "../services/kafka.service";
import { getVectorStoreSnapshot } from "../services/chroma.client";
import { redis } from "../services/memory.service";

const log = createChildLogger("API");

// Simple per-IP rate limiter for /api/simulate (10 req/min)
const simulateRateMap = new Map<string, { count: number; resetAt: number }>();
const SIMULATE_RATE_LIMIT = 10;
const SIMULATE_RATE_WINDOW_MS = 60_000;

function checkSimulateRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = simulateRateMap.get(ip);
    if (!entry || now > entry.resetAt) {
        simulateRateMap.set(ip, { count: 1, resetAt: now + SIMULATE_RATE_WINDOW_MS });
        return true;
    }
    if (entry.count >= SIMULATE_RATE_LIMIT) return false;
    entry.count++;
    return true;
}

export async function createServer() {
    const app = Fastify({ logger: false });

    // ── Plugins ─────────────────────────────────────────
    await app.register(cors, { origin: true });
    await app.register(fastifyWebsocket);

    // Serve the enterprise dashboard UI
    try {
        await app.register(fastifyStatic, {
            root: path.join(process.cwd(), "public"),
            prefix: "/",
            decorateReply: true,
        });
    } catch (err: any) {
        log.warn({ err: err.message }, "Static file serving not available");
    }

    await registerApprovalRoutes(app);

    // ── WebSocket: Real-time Event Stream ────────────────
    app.get("/ws", { websocket: true }, (connection: any) => {
        const ws = connection.socket || connection;
        addWsClient(ws);
        log.info({ clients: getClientCount() }, "WS client connected");
    });

    // ── Health Check ─────────────────────────────────────
    app.get("/api/health", async () => ({
        status: "healthy",
        version: "2.0.0",
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
        services: {
            api: "running",
            websocket: `${getClientCount()} clients`,
            executionMode: config.agents.executionMode,
        },
    }));

    // ── Prometheus Metrics ───────────────────────────────
    app.get("/api/prometheus", async (req, reply) => {
        reply.type("text/plain; version=0.0.4; charset=utf-8");
        return getPrometheusMetrics();
    });

    // ── In-memory Metrics (JSON) ─────────────────────────
    app.get("/api/metrics", async () => {
        // Try DB first for historical data, fall back to in-memory
        try {
            const dbMetrics = await getMetrics();
            return { ...dbMetrics, ...getMetricsJson(), source: "database" };
        } catch {
            return { ...getMetricsJson(), source: "memory" };
        }
    });

    // ── Trigger Incident (async — returns immediately, pipeline runs in background) ──
    app.post<{ Body: { scenario?: string; eventCount?: number; targetService?: string } }>(
        "/api/simulate",
        async (req, reply) => {
            if (!checkSimulateRateLimit(req.ip || "unknown")) {
                return reply.code(429).send({ error: "Rate limit exceeded. Max 10 simulations/min per IP." });
            }

            const { scenario = "oom_kill", eventCount = 30, targetService } = req.body || {};

            log.info({ scenario, eventCount, targetService }, "Simulation triggered");

            const events = generateEvents(scenario as any, eventCount, targetService);
            const state = createIncidentState(events);

            // Pre-register so the incident is queryable immediately
            preRegisterIncident(state);

            // Publish through in-process event bus (mirrors Kafka flow) + run pipeline
            setImmediate(() => {
                publishEvents(config.kafka.topics.rawEvents, events).catch(() => {});
                runPipeline(events, state).catch((err) =>
                    log.error({ err: err.message }, "Background pipeline error")
                );
            });

            return reply.code(202).send({
                incidentId: state.incidentId,
                status: "started",
                scenario,
                eventCount: events.length,
                message: "Pipeline started. Watch /ws for real-time updates.",
            });
        }
    );

    // ── Trigger Pipeline with raw events (synchronous) ────
    app.post<{ Body: { events: RawEvent[] } }>(
        "/api/incidents/trigger",
        async (req, reply) => {
            const { events } = req.body;

            if (!events || !Array.isArray(events) || events.length === 0) {
                return reply.code(400).send({ error: "events array is required" });
            }

            log.info({ eventCount: events.length }, "Pipeline triggered via API (sync)");
            const state = await runPipeline(events);

            return {
                incidentId: state.incidentId,
                status: state.workflowStatus,
                outcome: state.outcome,
                duration: `${((Date.now() - new Date(state.createdAt).getTime()) / 1000).toFixed(1)}s`,
                summary: {
                    issue: state.issue ? {
                        type: state.issue.type,
                        severity: state.issue.severity,
                        service: state.issue.affectedService,
                        anomalyScore: state.issue.anomalyScore,
                    } : null,
                    rootCause: state.rootCause ? {
                        category: state.rootCause.category,
                        service: state.rootCause.service,
                        confidence: state.rootCause.confidence,
                    } : null,
                    plan: state.plan ? {
                        title: state.plan.title,
                        steps: state.plan.steps.length,
                        riskLevel: state.plan.riskLevel,
                        source: state.planSource,
                    } : null,
                    priority: state.priority,
                    executionStatus: state.executionStatus,
                    stepsCompleted: state.stepsCompleted.length,
                    stepsFailed: state.stepsFailed.length,
                    retryCount: state.retryCount,
                },
            };
        }
    );

    // ── Get Incident by ID ────────────────────────────────
    app.get<{ Params: { id: string } }>("/api/incidents/:id", async (req, reply) => {
        const { id } = req.params;

        const memState = getIncidentState(id);
        if (memState) return memState;

        try {
            const dbIncident = await getIncident(id);
            if (dbIncident) return dbIncident;
        } catch { }

        return reply.code(404).send({ error: "Incident not found" });
    });

    // ── List Incidents ────────────────────────────────────
    app.get<{ Querystring: { limit?: string; offset?: string } }>(
        "/api/incidents",
        async (req) => {
            const limit = parseInt(req.query.limit || "20");
            const offset = parseInt(req.query.offset || "0");

            try {
                return await listIncidents(limit, offset);
            } catch {
                const all = getAllIncidentStates();
                return {
                    incidents: all.slice(offset, offset + limit),
                    total: all.length,
                    limit,
                    offset,
                };
            }
        }
    );

    // ── List Available Scenarios ──────────────────────────
    app.get("/api/scenarios", async () => ({
        scenarios: [
            { id: "oom_kill", name: "OOM Kill", description: "Container memory limit exceeded (OOMKilled)", icon: "💥" },
            { id: "high_error_rate", name: "High Error Rate", description: "HTTP 5xx error spike", icon: "📈" },
            { id: "cpu_spike", name: "CPU Spike", description: "CPU usage exceeding limits", icon: "🔥" },
            { id: "disk_full", name: "Disk Full", description: "Disk space nearly exhausted", icon: "💾" },
            { id: "connection_pool_exhaustion", name: "DB Pool Exhaustion", description: "Database connection pool saturated", icon: "🔌" },
            { id: "service_down", name: "Service Down", description: "Service completely unresponsive", icon: "⛔" },
            { id: "random", name: "Random", description: "Random incident scenario", icon: "🎲" },
        ],
    }));

    // ── Debug: Inspect in-process store contents ─────────
    app.get("/api/debug/stores", async () => {
        const vectors = getVectorStoreSnapshot();
        const cache   = redis.snapshot();
        const busListeners = bus.eventNames().map((e) => ({
            topic: e,
            listenerCount: bus.listenerCount(e as string),
        }));

        return {
            vectorStore: {
                description: "ChromaDB replacement — TF-IDF cosine similarity",
                totalDocs: vectors.length,
                docs: vectors,
            },
            redisCache: {
                description: "Redis replacement — in-process TTL Map",
                totalKeys: cache.length,
                entries: cache,
            },
            kafkaBus: {
                description: "Kafka replacement — in-process EventEmitter",
                topics: busListeners,
            },
        };
    });

    // ── Root: Serve Dashboard ─────────────────────────────
    // Only register if static plugin is registered; otherwise fallback
    app.setNotFoundHandler(async (req, reply) => {
        // For API 404s, return JSON
        if (req.url.startsWith("/api/")) {
            return reply.code(404).send({ error: "Not found" });
        }
        // For UI routes, try sending index.html
        try {
            return reply.sendFile("index.html");
        } catch {
            return reply.code(404).send("Not found");
        }
    });

    return app;
}

export async function startServer() {
    const app = await createServer();

    await app.listen({
        port: config.server.port,
        host: config.server.host,
    });

    log.info(
        { port: config.server.port },
        `🌐 AutoOps AI API running at http://${config.server.host}:${config.server.port}`
    );

    return app;
}
