# 📡 AutoOps AI — API Reference

> **REST API endpoints for the AutoOps AI system**

---

## Base URL

```
http://localhost:3000/api
```

---

## Endpoints

### Health Check

```
GET /api/health
```

**Response:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 3600,
  "services": {
    "kafka": "connected",
    "postgres": "connected",
    "chromadb": "connected",
    "groq": "configured"
  }
}
```

---

### Trigger Incident Pipeline

```
POST /api/incidents/trigger
```

Manually trigger the incident pipeline with raw events.

**Request Body:**
```json
{
  "events": [
    {
      "eventId": "evt-001",
      "timestamp": "2026-03-31T22:30:00Z",
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
        "restartCount": 5,
        "memoryLimit": "512Mi",
        "memoryUsage": "510Mi"
      }
    }
  ]
}
```

**Response:**
```json
{
  "incidentId": "inc-abc123",
  "status": "processing",
  "message": "Incident pipeline triggered"
}
```

---

### Get Incident Status

```
GET /api/incidents/:incidentId
```

**Response:**
```json
{
  "incidentId": "inc-abc123",
  "workflowStatus": "completed",
  "currentAgent": "feedback",
  "issue": { "type": "pod_crash", "severity": "critical" },
  "rootCause": { "category": "memory_leak", "confidence": 0.92 },
  "plan": { "title": "Resolve Payment API OOM", "steps": 5 },
  "priority": "P1",
  "executionStatus": "success",
  "outcome": "resolved",
  "duration": 276
}
```

---

### List All Incidents

```
GET /api/incidents?limit=20&offset=0&status=completed
```

**Response:**
```json
{
  "incidents": [...],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

---

### Simulate Log Events

```
POST /api/simulate
```

Generate and inject simulated log events to test the pipeline.

**Request Body:**
```json
{
  "scenario": "oom_kill",
  "eventCount": 100,
  "targetService": "payment-api"
}
```

Available scenarios: `oom_kill`, `high_error_rate`, `cpu_spike`, `disk_full`, `connection_pool_exhaustion`

---

### Get System Metrics

```
GET /api/metrics
```

**Response:**
```json
{
  "totalIncidents": 42,
  "resolvedAutomatically": 38,
  "autoResolutionRate": 0.905,
  "averageMTTD": 0.5,
  "averageMTTR": 276,
  "slaCompliance": 0.995,
  "agentPerformance": {
    "monitoring": { "avgLatencyMs": 450, "processedCount": 10000 },
    "rca": { "avgLatencyMs": 1200, "accuracy": 0.92 },
    "planning": { "avgLatencyMs": 3500, "successRate": 0.88 },
    "execution": { "avgLatencyMs": 45000, "successRate": 0.95 }
  }
}
```

---

### WebSocket — Live Incident Stream

```
WS /api/incidents/live
```

Receive real-time updates as incidents progress through the pipeline.

**Message format:**
```json
{
  "type": "agent_update",
  "incidentId": "inc-abc123",
  "agent": "execution",
  "status": "running",
  "data": { "currentStep": 3, "totalSteps": 5 },
  "timestamp": "2026-03-31T22:35:00Z"
}
```
