# ⚡ AutoOps AI — Step-by-Step Execution Flow

> **Complete end-to-end flow from incident detection to resolution**

---

## End-to-End Timeline

```
┌─────────────┬─────────────┬──────────────┬─────────────┐
│    Phase    │    Agent    │   Duration   │   Status    │
├─────────────┼─────────────┼──────────────┼─────────────┤
│ Detection   │ Monitoring  │    0.5s      │ ✅ Detected │
│ Analysis    │ RCA         │    1.5s      │ ✅ Root cause│
│ Planning    │ Planning    │    4.0s      │ ✅ Plan ready│
│ Priority    │ SLA         │    0.1s      │ ✅ P1 assign │
│ Execution   │ Execution   │   ~4.5 min   │ ✅ All steps │
│ Learning    │ Feedback    │    2.0s      │ ✅ Stored    │
├─────────────┼─────────────┼──────────────┼─────────────┤
│ TOTAL       │ All 6       │   ~4.8 min   │ ✅ RESOLVED │
└─────────────┴─────────────┴──────────────┴─────────────┘
```

---

## Phase 1: Data Ingestion & Detection (~0.5s)

```
📡 DATA SOURCES emit events continuously
   → Kafka ingests to 'raw-events' topic (< 100ms)
   
🔍 MONITORING AGENT:
   Step 1: Parse & normalize events (50ms)
   Step 2: Extract features (100ms)
   Step 3: Run anomaly detection ensemble (200ms)
     • Statistical analysis: deviation = 4.2σ
     • Pattern-based: anomaly_score = 0.89
     • Rules-based: match against known signatures
   Step 4: Ensemble scoring (10ms)
     → weighted_score = 0.892
   Step 5: Threshold check: 0.892 > 0.7 ✅ ANOMALY DETECTED
   Step 6: Construct issue → update shared state
```

---

## Phase 2: Root Cause Analysis (~1.5s)

```
🔎 RCA AGENT:
   Step 1: Load service dependency graph
   Step 2: Trace upstream from anomaly source
     • payment-api → memory at 510Mi/512Mi ⚠️
   Step 3: Temporal correlation (last 30 min)
     • Deployment event 25 min ago: v2.4.0 → v2.4.1
   Step 4: Rule engine evaluation
     • "OOMKilled Detection" → MATCH (confidence: 0.95)
   Step 5: Aggregate results
     → Root cause: memory_leak in payment-api
     → Confidence: 0.92
```

---

## Phase 3: Plan Generation (~4s)

```
🧠 PLANNING AGENT:
   Step 1: RAG retrieval from ChromaDB
     • Query: "memory_leak payment-api OOMKilled"
     • Top-3 similar past resolutions found
   Step 2: Build LLM prompt with context
   Step 3: Groq LLM generates 5-step plan
   Step 4: Validate plan (safety, blast radius)
     → Plan: Scale up → Rolling restart → Update limits → Verify → Scale back
```

---

## Phase 4: SLA Prioritization (~0.1s)

```
⏰ SLA AGENT:
   • Severity (critical): 0.35 × 1.0 = 0.350
   • Affected services (3): 0.25 × 0.3 = 0.075
   • User impact (high): 0.25 × 0.8 = 0.200
   • Revenue impact (yes): 0.15 × 1.0 = 0.150
   → Total: 0.775 → P1 (High)
   → SLA deadline: 60 minutes
```

---

## Phase 5: Execution (~4.5 min)

```
⚙️ EXECUTION AGENT:
   Step 1: scale_deployment(replicas=6)     → 45s  ✅
   Step 2: rolling_restart(max_unavail=1)   → 120s ✅
   Step 3: update_resource_limits(768Mi)    → 30s  ✅
   Step 4: verify_health(/health → 200 OK)  → 45s  ✅
   Step 5: scale_deployment(replicas=3)     → 30s  ✅
   → ALL STEPS COMPLETED SUCCESSFULLY
```

---

## Phase 6: Feedback & Learning (~2s)

```
📊 FEEDBACK AGENT:
   Step 1: Evaluate → RESOLVED ✅
   Step 2: Extract lessons learned
   Step 3: Store incident in PostgreSQL
   Step 4: Update ChromaDB embeddings (for future RAG)
   Step 5: Record metrics (MTTD: 0.5s, MTTR: 276s)
   Step 6: Notify → Slack, Dashboard
```

---

## Failure Scenarios

### Scenario A: Execution Failure → Replan

```
Step 2 FAILS (timeout)
  → Execution Agent reports failure
  → LangGraph conditional: "retry" → Planning Agent
  → NEW plan generated with retry context
  → SLA re-evaluates priority
  → Execution runs NEW plan
  → If fail again (retry_count == 3) → ESCALATE
```

### Scenario B: Escalation

```
After 3 failed attempts:
  → PagerDuty: Page on-call (HIGH)
  → Slack: Detailed incident summary
  → Dashboard: "ESCALATED - Human Action Required"
```

### Scenario C: SLA Fast-Track

```
SLA Agent detects: Time to breach < Resolution time + buffer
  → FAST-TRACK: Skip queue, preempt lower priority
  → Immediate execution with dedicated resources
```
