# 🤖 AutoOps AI — Agent Specifications

> **Detailed specifications for all 6 core agents in the LangGraph multi-agent workflow**

---

## Agent Architecture Overview

Each agent follows a standardized pattern:

```
┌──────────────────────────────────────────────┐
│              AGENT TEMPLATE                   │
│  Input Parser → Processor → Output Formatter │
│       ↑            ↑              │          │
│  Shared State   Services     Shared State    │
│  (Read)        (APIs/ML)     (Write)         │
│  ┌──────────────────────────────────────┐    │
│  │ Telemetry: Logging, Metrics, Tracing │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

### Base Agent Interface

```python
from abc import ABC, abstractmethod

class BaseAgent(ABC):
    def __init__(self, config: AgentConfig):
        self.config = config
        self.logger = get_logger(self.__class__.__name__)
        self.metrics = MetricsCollector(self.__class__.__name__)
    
    @abstractmethod
    async def process(self, state: IncidentState) -> IncidentState:
        pass
    
    async def __call__(self, state: IncidentState) -> IncidentState:
        start_time = time.time()
        try:
            result = await self.process(state)
            self.metrics.record_success(time.time() - start_time)
            return result
        except Exception as e:
            self.metrics.record_failure(str(e))
            return self._handle_error(state, e)
```

---

## Agent 1: Monitoring Agent

| Property | Value |
|---|---|
| **Node** | `monitoring` |
| **Input** | Kafka: `raw-logs`, `raw-metrics`, `raw-alerts` |
| **Output** | `state.issue` + `state.anomaly_score` |
| **ML Models** | Isolation Forest, Z-Score, LSTM Autoencoder |
| **Scaling** | 2-8 instances |
| **Latency** | < 500ms |

### Detection Pipeline

```
Kafka Events → Event Parser → Feature Extraction
  → Isolation Forest (0.4w) ──┐
  → Z-Score Analysis (0.3w) ──┼─→ Ensemble Score → Threshold Gate → Issue
  → LSTM Autoencoder (0.3w) ──┘
```

### Key Implementation

```python
class MonitoringAgent(BaseAgent):
    async def process(self, state: IncidentState) -> IncidentState:
        raw_events = state["raw_events"]
        features = self.feature_extractor.extract(raw_events)
        
        anomaly_score = (
            0.4 * self.isolation_forest.score(features) +
            0.3 * self.zscore_detector.score(features) +
            0.3 * self.lstm_detector.predict(features)
        )
        
        if anomaly_score > self.config.anomaly_threshold:
            state["issue"] = self._construct_issue(raw_events, anomaly_score)
            state["anomaly_score"] = anomaly_score
        return state
```

---

## Agent 2: Root Cause Analysis Agent

| Property | Value |
|---|---|
| **Node** | `rca` |
| **Input** | `state.issue` |
| **Output** | `state.root_cause` + `state.confidence` |
| **Methods** | Dependency Graph, Temporal Correlation, Rule Engine |
| **Scaling** | 2-4 instances |
| **Latency** | < 2 seconds |

### Analysis Strategies

```
Detected Issue
     │
     ├──→ Dependency Graph Traversal (weight: 0.4)
     ├──→ Temporal Correlation (weight: 0.3)
     └──→ Rule-Based Pattern Matching (weight: 0.3)
     → Aggregate → Score → Select Best Root Cause
```

### RCA Rules

```yaml
rules:
  - name: "OOMKilled Detection"
    condition: { event_type: "pod_crash", data.reason: "OOMKilled" }
    root_cause: { category: "memory_leak", confidence: 0.95 }
  - name: "Error Rate After Deploy"
    condition: { metric: "http_error_rate", correlated: "deployment" }
    root_cause: { category: "deployment_regression", confidence: 0.88 }
  - name: "DB Connection Exhaustion"
    condition: { metric: "db_pool_active", value: "> 95%" }
    root_cause: { category: "resource_exhaustion", confidence: 0.85 }
```

---

## Agent 3: Planning Agent (LLM-Based)

| Property | Value |
|---|---|
| **Node** | `planning` |
| **Input** | `state.root_cause` + RAG context |
| **Output** | `state.plan` + `state.plan_steps` |
| **LLM** | GPT-4 / LLaMA 3 70B |
| **RAG** | FAISS / ChromaDB vector store |
| **Scaling** | 2-4 instances |
| **Latency** | < 5 seconds |

### RAG Pipeline

```
Root Cause → Embed → Vector Search (top-5 similar incidents)
  → Build Prompt (incident + past resolutions + available actions)
  → LLM Generation (temp=0.1)
  → Plan Validation (safety constraints, blast radius)
  → Structured Plan Output
```

---

## Agent 4: SLA Agent

| Property | Value |
|---|---|
| **Node** | `sla` |
| **Input** | `state.plan` + SLA policies |
| **Output** | `state.priority` + `state.sla_deadline` + `state.fast_track` |
| **Scaling** | 1-2 instances |
| **Latency** | < 200ms |

### Priority Levels

| Level | Score Range | Fast Track | Queue Position |
|---|---|---|---|
| P0 | ≥ 0.9 | Yes | Immediate |
| P1 | 0.7 - 0.9 | Possible | High |
| P2 | 0.4 - 0.7 | No | Normal |
| P3 | 0.2 - 0.4 | No | Low |
| P4 | < 0.2 | No | Deferred |

---

## Agent 5: Execution Agent

| Property | Value |
|---|---|
| **Node** | `execution` |
| **Input** | `state.plan_steps` |
| **Output** | `state.execution_status` + `state.steps_completed/failed` |
| **APIs** | Docker, Kubernetes, GitHub Actions |
| **Scaling** | 2-4 instances |
| **Latency** | < 30s per action |

### Available Actions

| Action | API | Description |
|---|---|---|
| `restart_service` | K8s | Restart pods in deployment |
| `scale_deployment` | K8s | Scale replica count |
| `rolling_restart` | K8s | Zero-downtime restart |
| `rollback_deployment` | K8s | Rollback to revision |
| `update_resource_limits` | K8s | Change CPU/Memory limits |
| `trigger_pipeline` | GitHub | Trigger CI/CD workflow |
| `verify_health` | HTTP | Check health endpoint |

---

## Agent 6: Feedback / Learning Agent

| Property | Value |
|---|---|
| **Node** | `feedback` |
| **Input** | Complete `IncidentState` |
| **Output** | `state.outcome` + `state.lessons_learned` |
| **Storage** | PostgreSQL + ChromaDB |
| **Scaling** | 1-2 instances |
| **Latency** | < 3 seconds |

### Learning Pipeline

```
1. Evaluate Outcome → resolved / partial / failed
2. Extract Lessons → duration, retry count, failure points
3. Store in PostgreSQL → incident history, audit trail
4. Update ChromaDB → embed incident for future RAG retrieval
5. Record Metrics → MTTD, MTTR, success rate
```

---

## Agent Interaction Matrix

| From \ To | Monitor | RCA | Planning | SLA | Execute | Feedback |
|---|---|---|---|---|---|---|
| **Monitor** | — | issue, anomaly_score | — | — | — | — |
| **RCA** | — | — | root_cause, confidence | — | — | — |
| **Planning** | — | — | — | plan, steps | — | — |
| **SLA** | — | — | — | — | priority, deadline | — |
| **Execute** | — | — | retry (on fail) | — | — | exec_status |
| **Feedback** | model updates | — | — | — | — | — |

---

## Master Configuration

```yaml
global:
  log_level: "INFO"
  kafka_brokers: ["kafka-0:9092", "kafka-1:9092", "kafka-2:9092"]
  redis_url: "redis://redis:6379/0"
  postgres_url: "postgresql://autoops:secret@postgres:5432/autoops"

agents:
  monitoring:  { instances: "2-8",  memory: "512Mi", threshold: 0.7 }
  rca:         { instances: "2-4",  memory: "256Mi", min_confidence: 0.6 }
  planning:    { instances: "2-4",  memory: "1Gi",   llm: "gpt-4" }
  sla:         { instances: "1-2",  memory: "256Mi" }
  execution:   { instances: "2-4",  memory: "512Mi", timeout: 120 }
  feedback:    { instances: "1-2",  memory: "512Mi" }
```
