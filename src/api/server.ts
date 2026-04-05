/**
 * AutoOps AI — Fastify API Server
 * REST endpoints for triggering and monitoring the incident pipeline.
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "../config";
import { createChildLogger } from "../utils/logger";
import { runPipeline, getIncidentState, getAllIncidentStates, onIncidentUpdate } from "../orchestrator/workflow";
import { generateEvents } from "../simulator/log-producer";
import { getIncident, listIncidents, getMetrics } from "../services/database";
import { RawEvent } from "../orchestrator/state";
// === ENTERPRISE ADDITION ===
import { registerApprovalRoutes } from "./approvals.router";

const log = createChildLogger("API");

export async function createServer() {
    const app = Fastify({
        logger: false, // We use our own pino logger
    });

    await app.register(cors, { origin: true });

    // === ENTERPRISE ADDITION: Register approval routes ===
    await registerApprovalRoutes(app);

    // ── Health Check ────────────────────────────────────
    app.get("/api/health", async () => {
        return {
            status: "healthy",
            version: "1.0.0",
            uptime: Math.round(process.uptime()),
            timestamp: new Date().toISOString(),
            services: {
                api: "running",
                executionMode: config.agents.executionMode,
            },
        };
    });

    // ── Trigger Incident Pipeline ───────────────────────
    app.post<{ Body: { events: RawEvent[] } }>("/api/incidents/trigger", async (req, reply) => {
        const { events } = req.body;

        if (!events || !Array.isArray(events) || events.length === 0) {
            return reply.code(400).send({ error: "events array is required" });
        }

        log.info({ eventCount: events.length }, "Pipeline triggered via API");

        // Run pipeline asynchronously
        const statePromise = runPipeline(events);

        // Return immediately with incident ID
        const incidentId = `inc-${Date.now().toString(36)}`;

        // Wait briefly for monitoring agent to create the ID
        const state = await statePromise;

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
                } : null,
                priority: state.priority,
                executionStatus: state.executionStatus,
                stepsCompleted: state.stepsCompleted.length,
                stepsFailed: state.stepsFailed.length,
                retryCount: state.retryCount,
                lessonsLearned: state.lessonsLearned,
            },
        };
    });

    // ── Simulate Incidents ──────────────────────────────
    app.post<{
        Body: {
            scenario?: string;
            eventCount?: number;
            targetService?: string;
        };
    }>("/api/simulate", async (req) => {
        const {
            scenario = "oom_kill",
            eventCount = 30,
            targetService,
        } = req.body || {};

        log.info({ scenario, eventCount, targetService }, "Simulation triggered");

        const events = generateEvents(
            scenario as any,
            eventCount,
            targetService
        );

        const state = await runPipeline(events);

        return {
            incidentId: state.incidentId,
            scenario,
            eventCount: events.length,
            outcome: state.outcome,
            workflowStatus: state.workflowStatus,
            duration: `${((Date.now() - new Date(state.createdAt).getTime()) / 1000).toFixed(1)}s`,
            summary: {
                issue: state.issue?.type || null,
                rootCause: state.rootCause?.category || null,
                plan: state.plan?.title || null,
                priority: state.priority,
                executionStatus: state.executionStatus,
                stepsCompleted: state.stepsCompleted.length,
                stepsFailed: state.stepsFailed.length,
            },
        };
    });

    // ── Get Incident by ID ──────────────────────────────
    app.get<{ Params: { id: string } }>("/api/incidents/:id", async (req, reply) => {
        const { id } = req.params;

        // Check in-memory first
        const memState = getIncidentState(id);
        if (memState) return memState;

        // Then check database
        try {
            const dbIncident = await getIncident(id);
            if (dbIncident) return dbIncident;
        } catch { }

        return reply.code(404).send({ error: "Incident not found" });
    });

    // ── List Incidents ──────────────────────────────────
    app.get<{
        Querystring: { limit?: string; offset?: string };
    }>("/api/incidents", async (req) => {
        const limit = parseInt(req.query.limit || "20");
        const offset = parseInt(req.query.offset || "0");

        // Try database first
        try {
            return await listIncidents(limit, offset);
        } catch {
            // Fallback to in-memory
            const all = getAllIncidentStates();
            return {
                incidents: all.slice(offset, offset + limit),
                total: all.length,
                limit,
                offset,
            };
        }
    });

    // ── Get Metrics ─────────────────────────────────────
    app.get("/api/metrics", async () => {
        try {
            return await getMetrics();
        } catch {
            return {
                totalIncidents: getAllIncidentStates().length,
                resolvedAutomatically: getAllIncidentStates().filter((i) => i.outcome === "resolved").length,
                autoResolutionRate: 0,
                averageMTTR: 0,
            };
        }
    });

    // ── List Available Scenarios ────────────────────────
    app.get("/api/scenarios", async () => {
        return {
            scenarios: [
                { id: "oom_kill", name: "OOM Kill", description: "Container memory limit exceeded (OOMKilled)" },
                { id: "high_error_rate", name: "High Error Rate", description: "HTTP 5xx error spike" },
                { id: "cpu_spike", name: "CPU Spike", description: "CPU usage exceeding limits" },
                { id: "disk_full", name: "Disk Full", description: "Disk space nearly exhausted" },
                { id: "connection_pool_exhaustion", name: "Connection Pool Exhaustion", description: "Database connection pool saturated" },
                { id: "service_down", name: "Service Down", description: "Service completely unresponsive" },
                { id: "random", name: "Random", description: "Random incident scenario" },
            ],
        };
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
        { port: config.server.port, host: config.server.host },
        `🌐 AutoOps AI API running at http://${config.server.host}:${config.server.port}`
    );

    return app;
}
