/**
 * AutoOps AI — Main Entry Point
 * Starts the API server and initializes all services.
 */
import { config } from "./config";
import { createChildLogger } from "./utils/logger";
import { startServer } from "./api/server";
import { initDatabase } from "./services/database";

const log = createChildLogger("Main");

async function main() {
    log.info("═══════════════════════════════════════════════════");
    log.info("  🤖 AutoOps AI — Autonomous Multi-Agent DevOps   ");
    log.info("     Intelligent Incident Detection & Resolution   ");
    log.info("═══════════════════════════════════════════════════");

    // Initialize database
    try {
        await initDatabase();
        log.info("✅ PostgreSQL database initialized");
    } catch (err: any) {
        log.warn({ err: err.message }, "⚠️ PostgreSQL not available (will retry on use)");
    }

    // Initialize ChromaDB (tested on first use)
    log.info("ℹ️ ChromaDB will connect on first incident");

    // Start API server
    const app = await startServer();

    log.info("");
    log.info("🔗 API Endpoints:");
    log.info(`   GET  http://localhost:${config.server.port}/api/health`);
    log.info(`   POST http://localhost:${config.server.port}/api/simulate`);
    log.info(`   POST http://localhost:${config.server.port}/api/incidents/trigger`);
    log.info(`   GET  http://localhost:${config.server.port}/api/incidents`);
    log.info(`   GET  http://localhost:${config.server.port}/api/incidents/:id`);
    log.info(`   GET  http://localhost:${config.server.port}/api/metrics`);
    log.info(`   GET  http://localhost:${config.server.port}/api/scenarios`);
    log.info("");
    log.info("📝 Quick test:");
    log.info(`   curl -X POST http://localhost:${config.server.port}/api/simulate -H "Content-Type: application/json" -d '{"scenario":"oom_kill","eventCount":30}'`);
    log.info("");
    log.info("═══════════════════════════════════════════════════");

    // Graceful shutdown
    const shutdown = async () => {
        log.info("Shutting down...");
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
