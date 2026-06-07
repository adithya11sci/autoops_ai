# 📡 AutoOps AI — API Reference

> **Base URL:** `http://localhost:3000`

---

## Endpoints Summary

| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/health` | System health check | None |
| GET | `/api/metrics` | JSON metrics snapshot | None |
| GET | `/api/prometheus` | Prometheus scrape endpoint | None |
| POST | `/api/simulate` | Trigger simulated incident | None (rate limited) |
| POST | `/api/incidents/trigger` | Trigger with raw events (sync) | None |
| GET | `/api/incidents` | List all incidents | None |
| GET | `/api/incidents/:id` | Get single incident | None |
| GET | `/api/scenarios` | List available scenarios | None |
| GET | `/api/debug/stores` | Inspect in-process store contents | None |
| POST | `/api/v1/approvals` | List approval requests | API Key |
| GET | `/api/v1/approvals/:id` | Get approval status | API Key |
| POST | `/api/v1/approvals/:id/decision` | Submit approve/deny | API Key |
| WS | `/ws` | Real-time incident stream | None |

---

## Health Check

```
GET /api/health
```

**Response:**
```json
{
  "status": "healthy",
  "version": "2.0.0",
  "uptime": 3600,
  "timestamp": "2026-06-07T16:00:00.000Z",
  "services": {
    "api": "running",
    "websocket": "2 clients",
    "executionMode": "simulate"
  }
}
```

---

## Trigger Incident (Async)

```
POST /api/simulate
Rate limit: 10 requests/min per IP
```

**Request Body:**
```json
{
  "scenario": "oom_kill",
  "eventCount": 30,
  "targetService": "payment-api"
}
```

**Available Scenarios:**

| Scenario | Description |
|---|---|
| `oom_kill` | Container memory limit exceeded (OOMKilled) |
| `high_error_rate` | HTTP 5xx error spike |
| `cpu_spike` | CPU usage exceeding limits |
| `disk_full` | Disk space nearly exhausted |
| `connection_pool_exhaustion` | Database connection pool saturated |
| `service_down` | Service completely unresponsive → always uses Groq LLM |
| `random` | Random scenario |

**Response (202 Accepted):**
```json
{
  "incidentId": "inc-abc123",
  "status": "started",
  "scenario": "oom_kill",
  "eventCount": 30,
  "message": "Pipeline started. Watch /ws for real-time updates."
}
```

---

## Trigger with Raw Events (Synchronous)

```
POST /api/incidents/trigger
```

Blocks until pipeline completes. Use for testing.

**Request Body:**
```json
{
  "events": [
    {
      "eventId": "evt-001",
      "timestamp": "2026-06-07T16:00:00Z",
      "source": {
        "type": "kubernetes",
        "service": "payment-api",
        "namespace": "production",
        "pod": "payment-api-7b9f4d-x2k9"
      },
      "eventType": "pod_crash",
      "severity": "critical",
      "data": {
        "reason": "OOMKilled",
        "exitCode": 137,
        "restartCount": 5
      }
    }
  ]
}
```

**Response:**
```json
{
  "incidentId": "inc-abc123",
  "status": "completed",
  "outcome": "resolved",
  "duration": "14.7s",
  "summary": {
    "issue": { "type": "pod_crash", "severity": "critical", "service": "payment-api" },
    "rootCause": { "category": "memory_leak", "confidence": 0.92 },
    "plan": { "title": "Payment API OOM Fix", "steps": 5, "riskLevel": "high", "source": "llm" },
    "priority": "P1",
    "executionStatus": "success",
    "stepsCompleted": 5,
    "stepsFailed": 0
  }
}
```

---

## Get Incident by ID

```
GET /api/incidents/:id
```

**Response:**
```json
{
  "incidentId": "inc-abc123",
  "workflowStatus": "completed",
  "currentAgent": "feedback",
  "planSource": "llm",
  "groqFailed": false,
  "issue": {
    "type": "pod_crash",
    "severity": "critical",
    "affectedService": "payment-api",
    "anomalyScore": 0.95
  },
  "rootCause": {
    "category": "memory_leak",
    "service": "payment-api",
    "confidence": 0.92,
    "description": "Container exceeded memory limit",
    "remediationHint": "Increase memory limits or fix leak"
  },
  "plan": {
    "planId": "plan-abc123",
    "title": "Payment API OOM Remediation",
    "riskLevel": "high",
    "steps": 5,
    "rollbackPlan": ["Revert all changes", "Escalate to on-call"]
  },
  "riskAssessment": {
    "score": 65,
    "tier": "approve",
    "reasons": ["Blast radius 3/5: +60", "Confidence 92%: +2", "SLA critical severity: +15", "Has rollback plan: -20"],
    "requiresApproval": true,
    "source": "llm"
  },
  "decisionResult": {
    "action": "escalate_human",
    "reason": "Risk score 65/100 requires human approval"
  },
  "priority": "P1",
  "executionStatus": "success",
  "outcome": "resolved",
  "stepsCompleted": 5,
  "retryCount": 0
}
```

---

## List Incidents

```
GET /api/incidents?limit=20&offset=0
```

**Response:**
```json
{
  "incidents": [
    {
      "id": "inc-abc123",
      "created_at": "2026-06-07T16:00:00Z",
      "severity": "critical",
      "root_cause_category": "memory_leak",
      "root_cause_service": "payment-api",
      "priority": "P1",
      "execution_status": "success",
      "decision_action": "escalate_human",
      "outcome": "resolved",
      "duration_seconds": 15
    }
  ],
  "total": 21
}
```

---

## System Metrics

```
GET /api/metrics
```

**Response:**
```json
{
  "incidentsTotal": 21,
  "incidentsResolved": 15,
  "incidentsFailed": 2,
  "incidentsEscalated": 0,
  "incidentsActive": 0,
  "autoResolutionRate": 0.714,
  "avgMttrSeconds": 6.5,
  "source": "database"
}
```

---

## Prometheus Metrics

```
GET /api/prometheus
Content-Type: text/plain; version=0.0.4
```

```
# HELP autoops_incidents_total Total incidents processed
autoops_incidents_total 21

# HELP autoops_incidents_resolved_total Auto-resolved incidents
autoops_incidents_resolved_total 15

# HELP autoops_auto_resolution_rate Auto-resolution success rate (0-1)
autoops_auto_resolution_rate 0.714

# HELP autoops_avg_mttr_seconds Average mean time to resolution
autoops_avg_mttr_seconds 6.5
```

---

## Debug — Inspect In-Process Stores

```
GET /api/debug/stores
```

Shows live contents of all three in-process services. Use to verify that incidents are being stored and cached.

**Response:**
```json
{
  "vectorStore": {
    "description": "ChromaDB replacement — TF-IDF cosine similarity",
    "totalDocs": 3,
    "docs": [
      {
        "id": "fix-abc123",
        "document": "pod_crash in payment-api. Root cause: memory_leak. Fix: rolling_restart",
        "metadata": {
          "rootCauseCategory": "memory_leak",
          "service": "payment-api",
          "severity": "critical",
          "outcome": "resolved"
        },
        "tokenCount": 31
      }
    ]
  },
  "redisCache": {
    "description": "Redis replacement — in-process TTL Map",
    "totalKeys": 2,
    "entries": [
      {
        "key": "fix:a3f9b2c1d4e5f6a7",
        "ttlSeconds": 1742,
        "preview": "{\"id\":\"fix-abc123\",\"incidentType\":\"pod_crash\"...}"
      }
    ]
  },
  "kafkaBus": {
    "description": "Kafka replacement — in-process EventEmitter",
    "topics": [
      { "topic": "autoops.raw-events", "listenerCount": 1 }
    ]
  }
}
```

---

## Approvals API

All approval endpoints require the `X-AutoOps-Key` header if `AUTOOPS_API_KEY` is set in `.env`.

**Rate limit:** 20 requests/min per IP.

### List Approvals

```
POST /api/v1/approvals
X-AutoOps-Key: your_key
```

**Request Body:**
```json
{ "limit": 20, "offset": 0, "status": "PENDING" }
```

### Get Approval

```
GET /api/v1/approvals/:id
X-AutoOps-Key: your_key
```

**Response:**
```json
{
  "id": "approval-uuid",
  "incident_ids": ["inc-abc123"],
  "service_name": "payment-api",
  "namespace": "production",
  "risk_score": 85,
  "risk_tier": "block",
  "plan_summary": "5 steps: scale_deployment, rolling_restart...",
  "status": "PENDING",
  "created_at": "2026-06-07T16:00:00Z"
}
```

### Submit Decision

```
POST /api/v1/approvals/:id/decision
X-AutoOps-Key: your_key
```

**Request Body:**
```json
{
  "decision": "APPROVED",
  "approverId": "john.doe@company.com",
  "comment": "Reviewed and approved for off-peak execution"
}
```

**Response:**
```json
{
  "approvalId": "approval-uuid",
  "status": "APPROVED",
  "approverId": "john.doe@company.com",
  "decidedAt": "2026-06-07T16:05:00Z"
}
```

---

## WebSocket — Real-Time Stream

```
WS ws://localhost:3000/ws
```

### Connection Message

```json
{
  "type": "connected",
  "payload": {
    "message": "Connected to AutoOps AI real-time feed",
    "metrics": { "incidentsTotal": 21, "autoResolutionRate": 0.714 }
  },
  "ts": 1749312000000
}
```

### Event Types

| Type | When fired | Payload |
|---|---|---|
| `pipeline_start` | Incident begins | `{ incidentId, scenario, eventCount }` |
| `agent_start` | Agent begins | `{ incidentId, agent }` |
| `agent_complete` | Agent finishes | `{ incidentId, agent, durationMs }` |
| `execution_step` | Each step runs | `{ incidentId, stepId, action, status, output }` |
| `approval_required` | Human needed | `{ incidentId, riskScore, tier, planSummary }` |
| `pipeline_complete` | Incident done | `{ incidentId, outcome, durationMs }` |
| `metrics_update` | After each pipeline | current metrics snapshot |
| `log` | Agent log line | `{ agent, level, message }` |

### Example Step Event

```json
{
  "type": "execution_step",
  "payload": {
    "incidentId": "inc-abc123",
    "stepId": 3,
    "stepNum": 3,
    "totalSteps": 5,
    "action": "rolling_restart",
    "status": "success",
    "output": "deployment.apps/payment-api restarted (rolling)\n✓ 0 downtime. 3/3 pods healthy",
    "durationMs": 3000
  },
  "ts": 1749312045000
}
```
