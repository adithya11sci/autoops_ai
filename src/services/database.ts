/**
 * Database Service — PostgreSQL for incident persistence and audit trail.
 */
import { Pool, PoolClient } from "pg";
import { config } from "../config";
import { createChildLogger } from "../utils/logger";
import { IncidentState } from "../orchestrator/state";

const log = createChildLogger("Database");

let pool: Pool | null = null;

export function getPool(): Pool {
    if (!pool) {
        pool = new Pool({
            host: config.postgres.host,
            port: config.postgres.port,
            database: config.postgres.database,
            user: config.postgres.user,
            password: config.postgres.password,
            max: 20,
            idleTimeoutMillis: 30000,
        });
        log.info("PostgreSQL pool created");
    }
    return pool;
}

/**
 * Initialize database schema.
 */
export async function initDatabase(): Promise<void> {
    const db = getPool();

    await db.query(`
    CREATE TABLE IF NOT EXISTS incidents (
      id VARCHAR(50) PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      severity VARCHAR(20),
      root_cause_category VARCHAR(100),
      root_cause_service VARCHAR(100),
      root_cause_description TEXT,
      root_cause_confidence REAL,
      plan_title TEXT,
      plan_steps JSONB,
      priority VARCHAR(10),
      execution_status VARCHAR(20),
      outcome VARCHAR(20),
      duration_seconds INTEGER,
      retry_count INTEGER DEFAULT 0,
      lessons_learned JSONB,
      full_state JSONB,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

    await db.query(`
    CREATE TABLE IF NOT EXISTS incident_events (
      id BIGSERIAL PRIMARY KEY,
      incident_id VARCHAR(50) REFERENCES incidents(id),
      agent VARCHAR(50) NOT NULL,
      event_type VARCHAR(50) NOT NULL,
      data JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

    await db.query(`
    CREATE INDEX IF NOT EXISTS idx_incidents_created ON incidents(created_at DESC);
  `);
    await db.query(`
    CREATE INDEX IF NOT EXISTS idx_incidents_outcome ON incidents(outcome);
  `);
    await db.query(`
    CREATE INDEX IF NOT EXISTS idx_events_incident ON incident_events(incident_id);
  `);

    log.info("Database schema initialized");
}

/**
 * Save an incident state to the database.
 */
export async function saveIncident(state: IncidentState): Promise<void> {
    const db = getPool();
    const duration = state.outcome
        ? Math.round(
            (new Date().getTime() - new Date(state.createdAt).getTime()) / 1000
        )
        : null;

    await db.query(
        `INSERT INTO incidents (
      id, created_at, severity, root_cause_category, root_cause_service,
      root_cause_description, root_cause_confidence, plan_title, plan_steps,
      priority, execution_status, outcome, duration_seconds, retry_count,
      lessons_learned, full_state, resolved_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
    ON CONFLICT (id) DO UPDATE SET
      severity = EXCLUDED.severity,
      root_cause_category = EXCLUDED.root_cause_category,
      root_cause_service = EXCLUDED.root_cause_service,
      root_cause_description = EXCLUDED.root_cause_description,
      root_cause_confidence = EXCLUDED.root_cause_confidence,
      plan_title = EXCLUDED.plan_title,
      plan_steps = EXCLUDED.plan_steps,
      priority = EXCLUDED.priority,
      execution_status = EXCLUDED.execution_status,
      outcome = EXCLUDED.outcome,
      duration_seconds = EXCLUDED.duration_seconds,
      retry_count = EXCLUDED.retry_count,
      lessons_learned = EXCLUDED.lessons_learned,
      full_state = EXCLUDED.full_state,
      resolved_at = EXCLUDED.resolved_at,
      updated_at = NOW()
    `,
        [
            state.incidentId,
            state.createdAt,
            state.issue?.severity || null,
            state.rootCause?.category || null,
            state.rootCause?.service || null,
            state.rootCause?.description || null,
            state.rootCause?.confidence || null,
            state.plan?.title || null,
            JSON.stringify(state.plan?.steps || []),
            state.priority,
            state.executionStatus,
            state.outcome,
            duration,
            state.retryCount,
            JSON.stringify(state.lessonsLearned),
            JSON.stringify(state),
            state.outcome ? new Date().toISOString() : null,
        ]
    );

    log.info({ incidentId: state.incidentId }, "Incident saved to database");
}

/**
 * Log an agent event for audit trail.
 */
export async function logAgentEvent(
    incidentId: string,
    agent: string,
    eventType: string,
    data: any
): Promise<void> {
    const db = getPool();
    await db.query(
        `INSERT INTO incident_events (incident_id, agent, event_type, data)
     VALUES ($1, $2, $3, $4)`,
        [incidentId, agent, eventType, JSON.stringify(data)]
    );
}

/**
 * Get incident by ID.
 */
export async function getIncident(id: string): Promise<any | null> {
    const db = getPool();
    const result = await db.query(
        `SELECT * FROM incidents WHERE id = $1`,
        [id]
    );
    return result.rows[0] || null;
}

/**
 * List recent incidents.
 */
export async function listIncidents(
    limit: number = 20,
    offset: number = 0
): Promise<{ incidents: any[]; total: number }> {
    const db = getPool();
    const countResult = await db.query(`SELECT COUNT(*) FROM incidents`);
    const total = parseInt(countResult.rows[0].count);

    const result = await db.query(
        `SELECT id, created_at, severity, root_cause_category, priority,
            execution_status, outcome, duration_seconds
     FROM incidents ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
    );

    return { incidents: result.rows, total };
}

/**
 * Get system metrics.
 */
export async function getMetrics(): Promise<any> {
    const db = getPool();
    const result = await db.query(`
    SELECT
      COUNT(*) as total_incidents,
      COUNT(*) FILTER (WHERE outcome = 'resolved') as resolved,
      COUNT(*) FILTER (WHERE outcome = 'failed') as failed_count,
      COUNT(*) FILTER (WHERE outcome = 'escalated') as escalated,
      ROUND(AVG(duration_seconds) FILTER (WHERE outcome = 'resolved')) as avg_mttr,
      ROUND(AVG(root_cause_confidence) FILTER (WHERE root_cause_confidence IS NOT NULL)::numeric, 2) as avg_rca_confidence
    FROM incidents
  `);
    const row = result.rows[0];
    const total = parseInt(row.total_incidents) || 0;
    const resolved = parseInt(row.resolved) || 0;

    return {
        totalIncidents: total,
        resolvedAutomatically: resolved,
        autoResolutionRate: total > 0 ? resolved / total : 0,
        averageMTTR: parseInt(row.avg_mttr) || 0,
        failedCount: parseInt(row.failed_count) || 0,
        escalatedCount: parseInt(row.escalated) || 0,
        avgRcaConfidence: parseFloat(row.avg_rca_confidence) || 0,
    };
}

export async function closePool(): Promise<void> {
    if (pool) await pool.end();
    log.info("PostgreSQL pool closed");
}
