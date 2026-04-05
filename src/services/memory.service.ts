/**
 * AutoOps AI — Memory Service
 * Handles vector DB retrieval and RL scoring for incident fixes.
 * Memory retrieval is the second most important thing in the system
 * after command validation.
 *
 * Flow: Fingerprint → Redis cache → ChromaDB → fallback none
 */
import crypto from "crypto";
import { createChildLogger } from "../utils/logger";
import { querySimilarIncidents, storeIncident } from "./chroma.client";
import { getPool } from "./database";
import {
    IncidentContext,
    FixPlan,
    StoredFix,
    MemoryResult,
    FixStep,
} from "./enterprise-types";

const log = createChildLogger("MemoryService");

const SIMILARITY_THRESHOLD = parseFloat(
    process.env.VECTOR_SIMILARITY_THRESHOLD || "0.82"
);
const TRUST_THRESHOLD = parseInt(
    process.env.TRUST_THRESHOLD_SUCCESS_COUNT || "3"
);
const TIEBREAKER_RANGE = 0.02;

import { Redis } from "ioredis";

// ── Redis Cache Service ──
// Connect to real Redis as required by true enterprise features
const redis = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    maxRetriesPerRequest: 3,
});

redis.on("error", (err) => {
    log.error({ err: err.message }, "Redis connection error in memory service");
});

const CACHE_TTL_SEC = 30 * 60; // 30 minutes in seconds

export class MemoryService {
    /**
     * Generate fingerprint for incident deduplication.
     */
    private fingerprint(incident: IncidentContext): string {
        const raw = `${incident.affectedService}:${incident.incidentType}:${incident.severity}`;
        return crypto.createHash("sha256").update(raw).digest("hex").substring(0, 16);
    }

    /**
     * Query memory for a matching past fix.
     */
    async queryMemory(incident: IncidentContext): Promise<MemoryResult> {
        const fp = this.fingerprint(incident);

        // Step 1: Check Redis cache
        const cacheKey = `fix:${fp}`;
        const cachedRaw = await redis.get(cacheKey).catch(() => null);
        
        if (cachedRaw) {
            try {
                const cachedFix = JSON.parse(cachedRaw) as StoredFix;
                // Validate incidentType match
                if (cachedFix.incidentType === incident.incidentType) {
                    log.info(
                        { fingerprint: fp, fixId: cachedFix.id },
                        "Redis cache hit — matching incidentType"
                    );
                    return {
                        fix: cachedFix,
                        similarity: 1.0,
                        source: "redis_cache",
                        trustworthy: cachedFix.successCount >= TRUST_THRESHOLD,
                    };
                }
                // Mismatching incidentType — ignore cache hit
                log.warn(
                    { fingerprint: fp, cachedType: cachedFix.incidentType, incidentType: incident.incidentType },
                    "Redis cache hit IGNORED — incidentType mismatch"
                );
            } catch (err) {
                log.warn("Corrupt JSON in Redis cache");
            }
        }

        // Step 2: Query ChromaDB via existing chroma.client.ts
        try {
            const queryText = `${incident.incidentType}: ${incident.errorSignature} in ${incident.affectedService}`;
            const results = await querySimilarIncidents(queryText, 5);

            // Filter: only accept matching incidentType + above threshold
            // ChromaDB returns distance (lower = more similar)
            // Convert distance to similarity: similarity = 1 - distance
            const validResults = results
                .map((r) => ({
                    ...r,
                    similarity: 1 - r.distance,
                }))
                .filter(
                    (r) =>
                        r.similarity >= SIMILARITY_THRESHOLD &&
                        r.metadata.rootCauseCategory === incident.incidentType
                )
                .sort((a, b) => b.similarity - a.similarity);

            if (validResults.length === 0) {
                log.info("No valid ChromaDB results above similarity threshold");
                return { fix: null, similarity: 0, source: "none", trustworthy: false };
            }

            // Check if tiebreaker needed (top two within TIEBREAKER_RANGE)
            let bestResult = validResults[0];
            if (
                validResults.length >= 2 &&
                bestResult.similarity - validResults[1].similarity < TIEBREAKER_RANGE
            ) {
                // Use RL score as tiebreaker — query from DB
                const topTwo = validResults.slice(0, 2);
                const dbFixes = await this.getStoredFixesByIds(topTwo.map((r) => r.id));
                if (dbFixes.length >= 2) {
                    dbFixes.sort((a, b) => b.rlScore - a.rlScore);
                    log.info(
                        {
                            winner: dbFixes[0].id,
                            winnerScore: dbFixes[0].rlScore,
                            loser: dbFixes[1].id,
                            loserScore: dbFixes[1].rlScore,
                        },
                        "RL score tiebreaker applied"
                    );
                    const winnerResult = validResults.find((r) => r.id === dbFixes[0].id);
                    if (winnerResult) bestResult = winnerResult;
                }
            }

            // Attempt to load full StoredFix from DB
            const storedFix = await this.getStoredFixById(bestResult.id);
            if (storedFix) {
                // Cache the result in Redis
                const cacheKey = `fix:${fp}`;
                redis.set(cacheKey, JSON.stringify(storedFix), "EX", CACHE_TTL_SEC).catch(() => {});

                return {
                    fix: storedFix,
                    similarity: bestResult.similarity,
                    source: "vector_db",
                    trustworthy: storedFix.successCount >= TRUST_THRESHOLD,
                };
            }

            log.info("ChromaDB result found but no matching stored_fix in database");
        } catch (err: unknown) {
            const error = err as Error;
            log.warn({ error: error.message }, "ChromaDB query failed in memory service");
        }

        // Step 3: No match found
        return { fix: null, similarity: 0, source: "none", trustworthy: false };
    }

    /**
     * Store a new fix in vector DB + PostgreSQL + cache.
     */
    async storeFix(incident: IncidentContext, fix: FixPlan): Promise<string> {
        const fp = this.fingerprint(incident);
        const fixId = `fix-${crypto.randomUUID().substring(0, 8)}`;

        // Store in ChromaDB
        const description = `${incident.incidentType}: ${incident.errorSignature} in ${incident.affectedService}. Fix: ${fix.title}`;
        await storeIncident(fixId, description, {
            rootCauseCategory: incident.incidentType,
            service: incident.affectedService,
            severity: incident.severity,
            confidence: fix.confidence,
            blastRadius: fix.blastRadius,
        });

        // Persist to PostgreSQL stored_fixes table
        try {
            const db = getPool();
            await db.query(
                `INSERT INTO stored_fixes (id, incident_type, error_signature, fix_steps, rl_score, success_count, failure_count, last_used_at, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
                 ON CONFLICT (id) DO UPDATE SET last_used_at = NOW()`,
                [
                    fixId,
                    incident.incidentType,
                    incident.errorSignature,
                    JSON.stringify(fix.fixSteps),
                    0.5,
                    0,
                    0,
                ]
            );
        } catch (err: unknown) {
            const error = err as Error;
            log.warn({ error: error.message }, "Failed to persist fix to PostgreSQL");
        }

        // Write to Redis cache
        const storedFix: StoredFix = {
            id: fixId,
            incidentType: incident.incidentType,
            errorSignature: incident.errorSignature,
            fixSteps: fix.fixSteps,
            rlScore: 0.5,
            successCount: 0,
            failureCount: 0,
            lastUsedAt: new Date().toISOString() as any, // Cast for TS compatibility with cache format
            createdAt: new Date().toISOString() as any,
        };
        const cacheKey = `fix:${fp}`;
        redis.set(cacheKey, JSON.stringify(storedFix), "EX", CACHE_TTL_SEC).catch(() => {});

        log.info({ fixId, incidentType: incident.incidentType }, "Fix stored in memory");
        return fixId;
    }

    /**
     * Update RL score for a fix. BACKGROUND ONLY — fire-and-forget.
     * Caller must use .catch() to swallow errors.
     */
    async updateScore(
        fixId: string,
        outcome: { success: boolean; slaMet: boolean }
    ): Promise<void> {
        try {
            const db = getPool();

            // Calculate reward
            const reward = outcome.success ? (outcome.slaMet ? 1.0 : 0.6) : 0.1;

            // Get current score
            const result = await db.query(
                "SELECT rl_score, success_count, failure_count FROM stored_fixes WHERE id = $1",
                [fixId]
            );

            if (result.rows.length === 0) {
                log.warn({ fixId }, "Fix not found for score update");
                return;
            }

            const current = result.rows[0];
            const currentScore = parseFloat(current.rl_score) || 0.5;
            const newScore = 0.7 * currentScore + 0.3 * reward;

            // Increment counters
            const successInc = outcome.success ? 1 : 0;
            const failureInc = outcome.success ? 0 : 1;

            await db.query(
                `UPDATE stored_fixes 
                 SET rl_score = $1, 
                     success_count = success_count + $2, 
                     failure_count = failure_count + $3, 
                     last_used_at = NOW() 
                 WHERE id = $4`,
                [newScore, successInc, failureInc, fixId]
            );

            log.info(
                { fixId, oldScore: currentScore, newScore, reward },
                "RL score updated"
            );
        } catch (err: unknown) {
            const error = err as Error;
            log.warn({ fixId, error: error.message }, "Score update failed (non-critical)");
            // Swallowed — this is fire-and-forget
        }
    }

    /**
     * Get stored fix by ID from PostgreSQL.
     */
    private async getStoredFixById(id: string): Promise<StoredFix | null> {
        try {
            const db = getPool();
            const result = await db.query(
                "SELECT * FROM stored_fixes WHERE id = $1",
                [id]
            );
            if (result.rows.length === 0) return null;
            return this.rowToStoredFix(result.rows[0]);
        } catch {
            return null;
        }
    }

    /**
     * Get stored fixes by multiple IDs.
     */
    private async getStoredFixesByIds(ids: string[]): Promise<StoredFix[]> {
        try {
            const db = getPool();
            const result = await db.query(
                "SELECT * FROM stored_fixes WHERE id = ANY($1)",
                [ids]
            );
            return result.rows.map((row: Record<string, unknown>) => this.rowToStoredFix(row));
        } catch {
            return [];
        }
    }

    /**
     * Map a DB row to StoredFix interface.
     */
    private rowToStoredFix(row: Record<string, unknown>): StoredFix {
        return {
            id: row.id as string,
            incidentType: row.incident_type as string,
            errorSignature: row.error_signature as string,
            fixSteps: (typeof row.fix_steps === "string"
                ? JSON.parse(row.fix_steps)
                : row.fix_steps) as FixStep[],
            rlScore: parseFloat(String(row.rl_score)) || 0.5,
            successCount: parseInt(String(row.success_count)) || 0,
            failureCount: parseInt(String(row.failure_count)) || 0,
            lastUsedAt: new Date(row.last_used_at as string),
            createdAt: new Date(row.created_at as string),
        };
    }
}
