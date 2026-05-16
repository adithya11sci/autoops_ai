/**
 * AutoOps AI — Main Entry Point
 * Starts the API server, initializes all services, and wires the Kafka consumer.
 */
import { config } from "./config";
import { createChildLogger } from "./utils/logger";
import { startServer } from "./api/server";
import { initDatabase } from "./services/database";
import { subscribeAndConsume, disconnectKafka } from "./services/kafka.service";
import { runPipeline } from "./orchestrator/workflow";
import { broadcastLog } from "./services/broadcast";

const log = createChildLogger("Main");

async function main() {
    log.info("═══════════════════════════════════════════════════");
    log.info("  🤖 AutoOps AI — Autonomous Multi-Agent DevOps   ");
    log.info("     Intelligent Incident Detection & Resolution   ");
    log.info("═══════════════════════════════════════════════════");

    // 1. Initialize PostgreSQL
    try {
        await initDatabase();
        log.info("✅ PostgreSQL database initialized");
    } catch (err: any) {
        log.warn({ err: err.message }, "⚠️ PostgreSQL not available (will retry on use)");
    }

    // 2. ChromaDB connects on first use
    log.info("ℹ️ ChromaDB will connect on first incident");

    // 3. Start API + WebSocket server
    const app = await startServer();

    // 4. Wire Kafka consumer (non-blocking — system works without it via HTTP API)
    try {
        await subscribeAndConsume(
            config.kafka.topics.rawEvents,
            async (events) => {
                log.info({ count: events.length }, "Kafka: processing event batch from topic");
                broadcastLog("kafka", "info", `Received ${events.length} events from Kafka topic`, { count: events.length });
                await runPipeline(events);
            },
            30  // batch size
        );
        log.info("✅ Kafka consumer started — listening on", config.kafka.topics.rawEvents);
    } catch (err: any) {
        log.warn({ err: err.message }, "⚠️ Kafka not available — HTTP API mode only (use POST /api/simulate)");
    }

    log.info("");
    log.info("🔗 Endpoints:");
    log.info(`   GET  http://localhost:${config.server.port}/                   ← Dashboard UI`);
    log.info(`   GET  http://localhost:${config.server.port}/api/health`);
    log.info(`   POST http://localhost:${config.server.port}/api/simulate       ← Trigger incident`);
    log.info(`   GET  http://localhost:${config.server.port}/api/incidents`);
    log.info(`   GET  http://localhost:${config.server.port}/api/metrics`);
    log.info(`   GET  http://localhost:${config.server.port}/api/prometheus     ← Prometheus metrics`);
    log.info(`   WS   ws://localhost:${config.server.port}/ws                  ← Real-time feed`);
    log.info("");
    log.info("📝 Quick test:");
    log.info(`   curl -X POST http://localhost:${config.server.port}/api/simulate \\`);
    log.info(`     -H "Content-Type: application/json" \\`);
    log.info(`     -d '{"scenario":"oom_kill","eventCount":30}'`);
    log.info("═══════════════════════════════════════════════════");

    // Graceful shutdown
    const shutdown = async () => {
        log.info("Shutting down gracefully...");
        try { await disconnectKafka(); } catch { }
        await app.close();
        process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
