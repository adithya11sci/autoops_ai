# 🛠️ AutoOps AI — Tech Stack Deep Dive

> **Comprehensive explanation of every technology choice**

---

## Stack Overview

| Category | Technology | Why |
|---|---|---|
| Agent Framework | LangGraph-inspired StateGraph | Stateful multi-agent orchestration |
| Backend | Fastify (Node.js/TypeScript) | Async, fast, type-safe |
| AI/ML | Groq API (LLaMA 3 70B) | Fast LLM inference |
| Vector DB | ChromaDB | RAG retrieval, open-source |
| Database | PostgreSQL 15 | ACID compliance, JSONB |
| Streaming | Apache Kafka 3.6 | High throughput messaging |
| Containers | Docker 24 | Packaging & isolation |
| Orchestration | Kubernetes 1.28 | Auto-scaling |
| CI/CD | GitHub Actions | Native Git integration |
| Monitoring | Prometheus + Grafana | Observability |

---

## 1. LangGraph-Inspired StateGraph

- **StateGraph**: Stateful workflow with shared state between agents
- **Conditional edges**: Dynamic routing based on agent outputs
- **Checkpointing**: Resume workflows from any state
- **Retry logic**: Built-in replanning on failure

---

## 2. Fastify (TypeScript)

- **Async/await**: Handle 1000s of concurrent connections
- **Schema validation**: JSON Schema for all endpoints
- **WebSocket**: Real-time incident streaming
- **Performance**: Faster than Express

---

## 3. Groq API (LLaMA 3 70B)

| Aspect | Details |
|---|---|
| Model | LLaMA 3.3 70B Versatile |
| Latency | ~1-2s (Groq hardware) |
| Use case | Remediation plan generation |
| Temperature | 0.1 (deterministic) |
| Output | Structured JSON plans |

---

## 4. ChromaDB

- **Embedding storage**: Past incident vectors
- **Similarity search**: Find similar incidents for RAG
- **Self-hosted**: No vendor lock-in
- **Integration**: Native Python/JS clients

---

## 5. PostgreSQL 15

```sql
CREATE TABLE incidents (
    id UUID PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    severity VARCHAR(20),
    root_cause_category VARCHAR(100),
    resolution_steps JSONB,
    outcome VARCHAR(20),
    duration_seconds INTEGER
);

CREATE TABLE incident_events (
    id BIGSERIAL PRIMARY KEY,
    incident_id UUID REFERENCES incidents(id),
    agent VARCHAR(50),
    event_type VARCHAR(50),
    data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 6. Apache Kafka

| Feature | Benefit |
|---|---|
| Throughput | 1M+ messages/sec/broker |
| Durability | Replicated, persisted |
| Ordering | Per-partition guarantees |
| Consumer groups | Parallel processing |
| Replay | Re-process events for debug |

---

## 7. Docker + Kubernetes

- **Docker**: Multi-stage builds, minimal images
- **Kubernetes**: Deployments, HPA, Network Policies
- **Auto-scaling**: CPU & queue-depth based

---

## Technology Decision Matrix

| Decision | Option A | Option B | **Chosen** | Reason |
|---|---|---|---|---|
| Language | Python | TypeScript | **TypeScript** | Full-stack, type safety |
| Backend | Express | Fastify | **Fastify** | Performance, schema |
| LLM | OpenAI | Groq | **Groq** | Speed, cost |
| Vector DB | Pinecone | ChromaDB | **ChromaDB** | Self-hosted, free |
| Queue | RabbitMQ | Kafka | **Kafka** | Throughput, replay |
| Database | MongoDB | PostgreSQL | **PostgreSQL** | ACID, JSONB |
