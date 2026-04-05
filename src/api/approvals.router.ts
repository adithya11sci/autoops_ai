/**
 * AutoOps AI — Approvals API Router
 * Fastify routes for managing approval requests.
 *
 * POST   /api/v1/approvals              — list approvals
 * GET    /api/v1/approvals/:id          — get approval status
 * POST   /api/v1/approvals/:id/decision — submit approve/deny
 */
import { FastifyInstance } from "fastify";
import { getPool } from "../services/database";
import { createChildLogger } from "../utils/logger";

const log = createChildLogger("ApprovalsRouter");

// ── Auth middleware ──
const AUTOOPS_API_KEY = process.env.AUTOOPS_API_KEY || "";

interface RateLimitEntry {
    count: number;
    resetAt: number;
}
const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60000;

function checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = rateLimitMap.get(ip);

    if (!entry || now > entry.resetAt) {
        rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
        return true;
    }

    if (entry.count >= RATE_LIMIT) {
        return false;
    }

    entry.count++;
    return true;
}

// ── Zod-style validation (inline for no extra dependency) ──

interface DecisionBody {
    decision: "APPROVED" | "DENIED";
    approverId: string;
    comment?: string;
}

function validateDecisionBody(body: unknown): { valid: true; data: DecisionBody } | { valid: false; error: string } {
    if (!body || typeof body !== "object") {
        return { valid: false, error: "Request body is required" };
    }

    const obj = body as Record<string, unknown>;

    if (obj.decision !== "APPROVED" && obj.decision !== "DENIED") {
        return { valid: false, error: "decision must be 'APPROVED' or 'DENIED'" };
    }

    if (typeof obj.approverId !== "string" || obj.approverId.trim().length === 0) {
        return { valid: false, error: "approverId is required and must be a non-empty string" };
    }

    if (obj.comment !== undefined && typeof obj.comment !== "string") {
        return { valid: false, error: "comment must be a string if provided" };
    }

    return {
        valid: true,
        data: {
            decision: obj.decision as "APPROVED" | "DENIED",
            approverId: obj.approverId as string,
            comment: (obj.comment as string) || "",
        },
    };
}

interface ListBody {
    limit?: number;
    offset?: number;
    status?: string;
}

function validateListBody(body: unknown): ListBody {
    if (!body || typeof body !== "object") {
        return { limit: 20, offset: 0 };
    }
    const obj = body as Record<string, unknown>;
    return {
        limit: typeof obj.limit === "number" ? Math.min(obj.limit, 100) : 20,
        offset: typeof obj.offset === "number" ? obj.offset : 0,
        status: typeof obj.status === "string" ? obj.status : undefined,
    };
}

// ── Route registration ──

export async function registerApprovalRoutes(app: FastifyInstance): Promise<void> {
    // Auth + rate limit hook for all /api/v1/approvals routes
    app.addHook("onRequest", async (req, reply) => {
        if (!req.url.startsWith("/api/v1/approvals")) return;

        // Rate limit
        const clientIp = req.ip || "unknown";
        if (!checkRateLimit(clientIp)) {
            return reply.code(429).send({ error: "Rate limit exceeded. Max 20 req/min." });
        }

        // API key auth
        if (AUTOOPS_API_KEY) {
            const providedKey = req.headers["x-autoops-key"];
            if (providedKey !== AUTOOPS_API_KEY) {
                return reply.code(401).send({ error: "Invalid or missing API key (X-AutoOps-Key header)" });
            }
        }
    });

    // ── POST /api/v1/approvals — List approvals ──
    app.post("/api/v1/approvals", async (req) => {
        const params = validateListBody(req.body);
        const db = getPool();

        let query = `SELECT id, incident_ids, service_name, namespace, risk_score, risk_tier, 
                      plan_summary, status, approver_id, created_at, decided_at
                      FROM approvals`;
        const queryParams: (string | number)[] = [];
        let paramIndex = 1;

        if (params.status) {
            query += ` WHERE status = $${paramIndex}`;
            queryParams.push(params.status);
            paramIndex++;
        }

        query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        queryParams.push(params.limit || 20, params.offset || 0);

        const result = await db.query(query, queryParams);

        return {
            approvals: result.rows,
            total: result.rows.length,
            limit: params.limit,
            offset: params.offset,
        };
    });

    // ── GET /api/v1/approvals/:id — Get approval status ──
    app.get<{ Params: { id: string } }>("/api/v1/approvals/:id", async (req, reply) => {
        const { id } = req.params;
        const db = getPool();

        const result = await db.query(
            "SELECT * FROM approvals WHERE id = $1",
            [id]
        );

        if (result.rows.length === 0) {
            return reply.code(404).send({ error: "Approval not found" });
        }

        return result.rows[0];
    });

    // ── POST /api/v1/approvals/:id/decision — Submit decision ──
    app.post<{ Params: { id: string } }>("/api/v1/approvals/:id/decision", async (req, reply) => {
        const { id } = req.params;
        const validation = validateDecisionBody(req.body);

        if (!validation.valid) {
            return reply.code(400).send({ error: validation.error });
        }

        const { decision, approverId, comment } = validation.data;
        const db = getPool();

        // Verify approval exists and is PENDING
        const existing = await db.query(
            "SELECT status FROM approvals WHERE id = $1",
            [id]
        );

        if (existing.rows.length === 0) {
            return reply.code(404).send({ error: "Approval not found" });
        }

        if (existing.rows[0].status !== "PENDING") {
            return reply.code(409).send({
                error: `Approval already resolved with status: ${existing.rows[0].status}`,
            });
        }

        // Record decision
        await db.query(
            `UPDATE approvals 
             SET status = $1, approver_id = $2, approver_comment = $3, decided_at = NOW()
             WHERE id = $4`,
            [decision, approverId, comment, id]
        );

        log.info(
            { approvalId: id, decision, approverId },
            `Approval decision recorded: ${decision}`
        );

        return {
            approvalId: id,
            status: decision,
            approverId,
            decidedAt: new Date().toISOString(),
        };
    });

    log.info("Approval routes registered at /api/v1/approvals");
}
