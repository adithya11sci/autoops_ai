/**
 * Database Service — In-memory store (no PostgreSQL / Docker required).
 * Exports the same API surface as the original PostgreSQL implementation.
 */
import { v4 as uuidv4 } from "uuid";
import { createChildLogger } from "../utils/logger";
import { IncidentState } from "../orchestrator/state";

const log = createChildLogger("Database");

// ── In-memory tables ──────────────────────────────────────────────
const incidentsStore = new Map<string, any>();
const incidentEventsStore: any[] = [];
const storedFixesStore = new Map<string, any>();
const approvalsStore = new Map<string, any>();

// ── Fake Pool used by services that call getPool().query() ────────

class InMemoryPool {
    async query(sql: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number }> {
        const s = sql.trim().replace(/\s+/g, " ");

        if (/stored_fixes/i.test(s)) return this.storedFixes(s, params);
        if (/approvals/i.test(s)) return this.approvals(s, params);

        // decision_audit and risk_assessments are audit-only — accept and discard
        if (/INSERT/i.test(s)) return { rows: [], rowCount: 1 };

        // DDL (CREATE TABLE / CREATE INDEX) — no-op
        return { rows: [], rowCount: 0 };
    }

    private storedFixes(s: string, params: any[]): { rows: any[]; rowCount: number } {
        if (/^INSERT/i.test(s)) {
            storedFixesStore.set(params[0], {
                id: params[0],
                incident_type: params[1],
                error_signature: params[2],
                fix_steps: params[3],
                rl_score: params[4] ?? 0.5,
                success_count: params[5] ?? 0,
                failure_count: params[6] ?? 0,
                last_used_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
            });
            return { rows: [], rowCount: 1 };
        }

        if (/WHERE id = ANY/i.test(s)) {
            const ids: string[] = params[0] || [];
            const rows = ids.map((id) => storedFixesStore.get(id)).filter(Boolean);
            return { rows, rowCount: rows.length };
        }

        if (/^SELECT.*FROM stored_fixes WHERE id/i.test(s)) {
            const fix = storedFixesStore.get(params[0]);
            return { rows: fix ? [fix] : [], rowCount: fix ? 1 : 0 };
        }

        if (/^UPDATE stored_fixes/i.test(s)) {
            const fix = storedFixesStore.get(params[3]);
            if (fix) {
                fix.rl_score = params[0];
                fix.success_count = (fix.success_count || 0) + (params[1] || 0);
                fix.failure_count = (fix.failure_count || 0) + (params[2] || 0);
                fix.last_used_at = new Date().toISOString();
            }
            return { rows: [], rowCount: fix ? 1 : 0 };
        }

        return { rows: [], rowCount: 0 };
    }

    private approvals(s: string, params: any[]): { rows: any[]; rowCount: number } {
        // INSERT
        if (/^INSERT INTO approvals/i.test(s)) {
            const id = uuidv4();
            approvalsStore.set(id, {
                id,
                incident_ids: params[0] || [],
                service_name: params[1],
                namespace: params[2],
                fix_id: params[3],
                risk_score: params[4],
                risk_tier: params[5],
                plan_summary: params[6],
                status: "PENDING",
                approver_id: null,
                approver_comment: null,
                created_at: new Date().toISOString(),
                decided_at: null,
            });
            return { rows: [{ id }], rowCount: 1 };
        }

        // Group-check: find pending approval for same service+namespace in window
        if (/WHERE service_name/i.test(s)) {
            const cutoff = new Date(Date.now() - parseInt(params[2] || "300000"));
            const rows = Array.from(approvalsStore.values())
                .filter(
                    (a) =>
                        a.service_name === params[0] &&
                        a.namespace === params[1] &&
                        a.status === "PENDING" &&
                        new Date(a.created_at) > cutoff
                )
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                .slice(0, 1);
            return { rows, rowCount: rows.length };
        }

        // UPDATE incident_ids (grouping)
        if (/SET incident_ids/i.test(s)) {
            const a = approvalsStore.get(params[1]);
            if (a) a.incident_ids = params[0];
            return { rows: [], rowCount: a ? 1 : 0 };
        }

        // SELECT status only
        if (/^SELECT status FROM approvals WHERE id/i.test(s)) {
            const a = approvalsStore.get(params[0]);
            return { rows: a ? [{ status: a.status }] : [], rowCount: a ? 1 : 0 };
        }

        // UPDATE with timeout literal
        if (/SET status = 'TIMEOUT'/i.test(s)) {
            const a = approvalsStore.get(params[0]);
            if (a) { a.status = "TIMEOUT"; a.decided_at = new Date().toISOString(); }
            return { rows: [], rowCount: a ? 1 : 0 };
        }

        // UPDATE status + approver (from router and approval service)
        if (/SET status.*approver_id/i.test(s)) {
            const a = approvalsStore.get(params[3]);
            if (a) {
                a.status = params[0];
                a.approver_id = params[1];
                a.approver_comment = params[2];
                a.decided_at = new Date().toISOString();
            }
            return { rows: [], rowCount: a ? 1 : 0 };
        }

        // SELECT * / single row by id
        if (/WHERE id = \$1/i.test(s)) {
            const a = approvalsStore.get(params[0]);
            return { rows: a ? [a] : [], rowCount: a ? 1 : 0 };
        }

        // List (optional status filter + LIMIT/OFFSET)
        if (/^SELECT.*FROM approvals/i.test(s)) {
            let rows = Array.from(approvalsStore.values());
            const hasStatusFilter = /WHERE status/i.test(s);
            let limit: number, offset: number;

            if (hasStatusFilter) {
                rows = rows.filter((a) => a.status === params[0]);
                limit = (params[1] as number) ?? 20;
                offset = (params[2] as number) ?? 0;
            } else {
                limit = (params[0] as number) ?? 20;
                offset = (params[1] as number) ?? 0;
            }

            rows = rows
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                .slice(offset, offset + limit);
            return { rows, rowCount: rows.length };
        }

        return { rows: [], rowCount: 0 };
    }

    async end(): Promise<void> {}
}

const pool = new InMemoryPool();

export function getPool(): any {
    return pool;
}

export async function initDatabase(): Promise<void> {
    log.info("In-memory database initialized (no PostgreSQL required)");
}

export async function saveIncident(state: IncidentState): Promise<void> {
    const duration = state.outcome
        ? Math.round((new Date().getTime() - new Date(state.createdAt).getTime()) / 1000)
        : null;

    incidentsStore.set(state.incidentId, {
        id: state.incidentId,
        created_at: state.createdAt,
        resolved_at: state.outcome ? new Date().toISOString() : null,
        severity: state.issue?.severity || null,
        root_cause_category: state.rootCause?.category || null,
        root_cause_service: state.rootCause?.service || null,
        root_cause_description: state.rootCause?.description || null,
        root_cause_confidence: state.rootCause?.confidence || null,
        plan_title: state.plan?.title || null,
        plan_steps: state.plan?.steps || [],
        priority: state.priority,
        execution_status: state.executionStatus,
        outcome: state.outcome,
        duration_seconds: duration,
        retry_count: state.retryCount,
        lessons_learned: state.lessonsLearned,
        full_state: state,
        updated_at: new Date().toISOString(),
    });

    log.info({ incidentId: state.incidentId }, "Incident saved to in-memory store");
}

export async function logAgentEvent(
    incidentId: string,
    agent: string,
    eventType: string,
    data: any
): Promise<void> {
    incidentEventsStore.push({
        id: incidentEventsStore.length + 1,
        incident_id: incidentId,
        agent,
        event_type: eventType,
        data,
        created_at: new Date().toISOString(),
    });
}

export async function getIncident(id: string): Promise<any | null> {
    return incidentsStore.get(id) || null;
}

export async function listIncidents(
    limit: number = 20,
    offset: number = 0
): Promise<{ incidents: any[]; total: number }> {
    const all = Array.from(incidentsStore.values()).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return {
        incidents: all.slice(offset, offset + limit).map((i) => ({
            id: i.id,
            incidentId: i.id,
            created_at: i.created_at,
            severity: i.severity,
            root_cause_category: i.root_cause_category,
            root_cause_service: i.root_cause_service,
            priority: i.priority,
            execution_status: i.execution_status,
            decision_action: i.full_state?.decisionResult?.action ?? i.execution_status ?? '—',
            outcome: i.outcome,
            duration_seconds: i.duration_seconds,
        })),
        total: all.length,
    };
}

export async function getMetrics(): Promise<any> {
    const all = Array.from(incidentsStore.values());
    const total = all.length;
    const resolved = all.filter((i) => i.outcome === "resolved").length;
    const failed = all.filter((i) => i.outcome === "failed").length;
    const escalated = all.filter((i) => i.outcome === "escalated").length;

    const resolvedWithDuration = all.filter((i) => i.outcome === "resolved" && i.duration_seconds);
    const avgMTTR =
        resolvedWithDuration.length > 0
            ? Math.round(
                  resolvedWithDuration.reduce((s, i) => s + (i.duration_seconds || 0), 0) /
                      resolvedWithDuration.length
              )
            : 0;

    const confItems = all.filter((i) => i.root_cause_confidence != null);
    const avgConf =
        confItems.length > 0
            ? parseFloat(
                  (confItems.reduce((s, i) => s + (i.root_cause_confidence || 0), 0) / confItems.length).toFixed(2)
              )
            : 0;

    return {
        totalIncidents: total,
        resolvedAutomatically: resolved,
        autoResolutionRate: total > 0 ? resolved / total : 0,
        averageMTTR: avgMTTR,
        failedCount: failed,
        escalatedCount: escalated,
        avgRcaConfidence: avgConf,
    };
}

export async function closePool(): Promise<void> {
    log.info("In-memory database closed");
}
