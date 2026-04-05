-- ============================================================================
-- AutoOps AI — Enterprise Upgrade Migration
-- Migration: 003_enterprise_upgrade.sql
-- Description: Adds tables for stored fixes, approvals, risk assessments,
--              and decision audit trail.
-- ============================================================================

-- ── Stored Fixes (vector DB backing store) ──
CREATE TABLE IF NOT EXISTS stored_fixes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_type   VARCHAR(255) NOT NULL,
    error_signature VARCHAR(64) NOT NULL,
    fix_steps       JSONB NOT NULL,
    rl_score        DECIMAL(4,3) DEFAULT 0.500,
    success_count   INT DEFAULT 0,
    failure_count   INT DEFAULT 0,
    last_used_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Approvals (human approval gate) ──
CREATE TABLE IF NOT EXISTS approvals (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_ids     TEXT[] NOT NULL,
    service_name     VARCHAR(255),
    namespace        VARCHAR(255),
    fix_id           UUID REFERENCES stored_fixes(id),
    risk_score       INT NOT NULL,
    risk_tier        VARCHAR(20) NOT NULL,
    plan_summary     JSONB NOT NULL,
    status           VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    approver_id      VARCHAR(255),
    approver_comment TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    decided_at       TIMESTAMPTZ
);

-- ── Risk Assessments (audit trail) ──
CREATE TABLE IF NOT EXISTS risk_assessments (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id   VARCHAR(255) NOT NULL,
    fix_id        UUID,
    score         INT NOT NULL,
    tier          VARCHAR(20) NOT NULL,
    reasons       TEXT[] NOT NULL,
    fix_source    VARCHAR(20) NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Decision Audit (full audit trail for every decision) ──
CREATE TABLE IF NOT EXISTS decision_audit (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id   VARCHAR(255) NOT NULL,
    fix_id        UUID,
    fix_source    VARCHAR(20),
    risk_score    INT,
    risk_tier     VARCHAR(20),
    action_taken  VARCHAR(30) NOT NULL,
    rule_matched  VARCHAR(100),
    approver_id   VARCHAR(255),
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_stored_fixes_type_sig
    ON stored_fixes(incident_type, error_signature);

CREATE INDEX IF NOT EXISTS idx_approvals_status
    ON approvals(status);

CREATE INDEX IF NOT EXISTS idx_approvals_service_ns
    ON approvals(service_name, namespace, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decision_audit_incident
    ON decision_audit(incident_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_risk_assessments_incident
    ON risk_assessments(incident_id, created_at DESC);

-- ── Weekly RL score decay job (run via pg_cron or external cron) ──
-- UPDATE stored_fixes SET rl_score = rl_score * 0.95
--   WHERE last_used_at < NOW() - INTERVAL '7 days';
