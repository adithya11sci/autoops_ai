# 🛠️ AutoOps AI — Tech Stack Deep Dive

> **Comprehensive explanation of every technology choice — including no-Docker in-process alternatives**

---

## Stack Overview

| Category | Production Technology | No-Docker Alternative | Status |
|---|---|---|---|
| **Runtime** | Node.js v22 + TypeScript | Same | ✅ Running |
| **Web Framework** | Fastify v4 | Same | ✅ Running |
| **LLM** | Groq API (LLaMA 3.3 70B) | Same (SSL fixed) | ✅ Running |
| **Vector DB** | ChromaDB (Docker) | In-process TF-IDF store | ✅ Running |
| **Cache** | Redis (Docker) | In-process TTL Map | ✅ Running |
| **Event Streaming** | Apache Kafka (Docker) | In-process EventEmitter | ✅ Running |
| **Database** | PostgreSQL 15 (Docker) | In-memory store | ✅ Running |
| **Real-time** | WebSocket (@fastify/websocket) | Same | ✅ Running |
| **Metrics** | Prometheus endpoint | Same + file persistence | ✅ Running |

---

## 1. Node.js v22 + TypeScript

**Why TypeScript over Python:**

| Aspect | Python | TypeScript |
|---|---|---|
| Type safety | Runtime errors | Compile-time catches |
| Agent state | Dict chaos | Typed `IncidentState` interface |
| Async model | asyncio complexity | Native async/await |
| Full-stack | Separate frontend | One language end-to-end |

**Portable setup:** No system installation needed — runs from a zip-extracted Node.js binary at `C:\Users\<user>\node-portable\`.

---

## 2. Fastify v4

- **Speed:** 2–3× faster than Express (Radix-tree routing, schema-based serialization)
- **WebSocket:** `@fastify/websocket` — real-time incident stream to dashboard
- **Plugins:** `@fastify/cors`, `@fastify/static` (serves dashboard UI)
- **Rate limiting:** Built-in per-IP rate limiter on `/api/simulate` (10 req/min) and `/api/v1/approvals` (20 req/min)

---

## 3. Groq API (LLaMA 3.3 70B Versatile)

| Aspect | Details |
|---|---|
| Model | `llama-3.3-70b-versatile` |
| Fast model | `llama-3.1-8b-instant` |
| Latency | ~1–3s |
| Temperature | 0.1 (deterministic output) |
| Max tokens | 2048 |
| Output format | Forced JSON (`response_format: json_object`) |
| Circuit breaker | 3 consecutive failures → 5-min bypass → auto-closes |

**Planning priority chain:**
```
1. Template Service   (deterministic, pre-validated — fastest)
2. Memory Service     (past proven fixes via vector search)
3. Groq LLM           (only when 1 and 2 miss)
4. Fallback plan      (category-based hardcoded steps)
```

**Exception:** `service_down` incidents always skip steps 1 & 2 and go directly to Groq LLM to ensure a fresh, context-aware plan for service outages.

---

## 4. ChromaDB → In-Process TF-IDF Vector Store

**Production:** ChromaDB server (Docker, port 8000) with sentence-transformer embeddings.

**No-Docker (current):** `src/services/chroma.client.ts` — in-process TF-IDF cosine similarity.

### How TF-IDF Vector Search Works

```
1. Tokenize incident description → bag of words
2. Compute TF (term frequency) per document
3. Compute IDF (inverse document frequency) across all stored incidents
4. Build TF-IDF vector per document
5. On query: cosine similarity between query vector and all stored vectors
6. Return top-K results with distance score (lower = more similar)
```

**Similarity threshold:** `VECTOR_SIMILARITY_THRESHOLD=0.82` — only results above 82% similarity are used as memory hits.

**Data stored per incident:**
```json
{
  "id": "fix-abc123",
  "document": "pod_crash in payment-api. Root cause: memory_leak — OOMKilled. Fix: rolling_restart + update_resource_limits",
  "metadata": { "rootCauseCategory": "memory_leak", "service": "payment-api", "severity": "critical" },
  "tokens": ["pod", "crash", "payment", "api", "memory", "leak", "oom", ...]
}
```

---

## 5. Redis → In-Process TTL Cache

**Production:** Redis server (Docker, port 6379) with 30-minute TTL.

**No-Docker (current):** `InProcessCache` class in `src/services/memory.service.ts`.

```typescript
class InProcessCache {
    private store = new Map<string, { value: string; expiresAt: number }>();

    async get(key: string): Promise<string | null>  // Returns null if expired
    async set(key: string, value: string, ttlSec: number): Promise<void>
    snapshot(): Array<{ key: string; ttlSeconds: number; preview: string }>
}
```

**Cache key:** SHA-256 fingerprint of `service:incidentType:severity` (first 16 chars)

**Cache flow:**
```
New incident arrives
  → Compute fingerprint
  → Check Redis/InProcessCache (O(1) lookup)
  → HIT:  Return cached fix instantly (no LLM call needed)
  → MISS: Query vector store → fallback to LLM → store result in cache
```

---

## 6. Apache Kafka → In-Process EventEmitter

**Production:** Kafka broker (Docker, port 9092) with topic `autoops.raw-events`.

**No-Docker (current):** Node.js `EventEmitter` in `src/services/kafka.service.ts`.

```typescript
const bus = new EventEmitter();

// subscribeAndConsume registers handler on bus
bus.on("autoops.raw-events", async (events) => {
    await runPipeline(events);
});

// publishEvents emits to bus
bus.emit("autoops.raw-events", events);
```

**How it connects to POST /api/simulate:**
When `/api/simulate` is called, it:
1. Creates incident state
2. Publishes events to the EventEmitter bus (Kafka-style)
3. Runs pipeline directly (parallel path for immediate response)

---

## 7. PostgreSQL → In-Memory Store

**Production:** PostgreSQL 15 with ACID transactions.

**No-Docker (current):** `InMemoryPool` class in `src/services/database.ts` — implements the same `.query(sql, params)` interface so all calling code is identical.

**Tables simulated:**
- `incidents` — full incident state
- `incident_events` — per-agent event log
- `stored_fixes` — resolved fix plans with RL scores
- `approvals` — human approval requests/decisions
- `decision_audit` — every decision engine call logged
- `risk_assessments` — every risk score logged

---

## 8. Risk Scoring Engine

```
score = (blastRadius × 20)           // 0–100
      + (1 – confidence) × 30        // 0–30  lower confidence = higher risk
      + (critical ? +15 : 0)         // SLA severity penalty
      – (hasRollback ? 20 : 0)       // rollback plan discount
      – (template ? 25 : 0)          // pre-validated template discount
      – (trustworthy memory ? 15 : 0) // 3+ successful uses discount
      – (untrusted memory ? 5 : 0)   // memory hit but unproven
      clamped [0, 100]
```

**Tier routing:**

| Score | Tier | Action |
|---|---|---|
| 0–34 | AUTO | Execute immediately |
| 35–64 | NOTIFY | Execute + Slack alert |
| 65–84 | APPROVE | Wait for human approval |
| 85–100 | BLOCK | Never executes — escalate |

**Override rules** (applied after scoring):
1. `REQUIRE_REVIEW` command pattern → minimum tier bumped to `approve`
2. `HARD_BLOCKED` command pattern → always `block`, score = 100
3. Template source + approve/block → downgraded to `notify` (pre-validated = safe)
4. OOM kill (pod_crash + memory_leak) → score = 100, tier = `approve` (always needs human)

---

## 9. Metrics Persistence

Prometheus-format metrics are persisted to `metrics.json` on every pipeline event so restarts don't lose history.

```typescript
// On every pipeline start/complete:
fs.writeFileSync("metrics.json", JSON.stringify(metrics));

// On startup:
Object.assign(metrics, JSON.parse(fs.readFileSync("metrics.json")));
```

**Metrics tracked:**
- `incidentsTotal` — cumulative count
- `incidentsResolved` / `incidentsFailed` / `incidentsEscalated`
- `totalMttrMs` + `resolvedCount` → average MTTR
- `autoResolutionRate` — resolved / total

---

## Technology Decision Matrix

| Decision | Option A | Option B | Chosen | Reason |
|---|---|---|---|---|
| Language | Python | TypeScript | **TypeScript** | Type safety, single stack |
| Backend | Express | Fastify | **Fastify** | 2× faster, schema validation |
| LLM | OpenAI GPT-4 | Groq LLaMA | **Groq** | Lower latency, free tier |
| Vector DB | Pinecone | ChromaDB/TF-IDF | **TF-IDF (in-process)** | No Docker, no cost |
| Queue | RabbitMQ | Kafka/EventEmitter | **EventEmitter (in-process)** | No Docker needed |
| Database | MongoDB | PostgreSQL/InMemory | **InMemory (no-Docker)** | Zero infrastructure |
| Cache | Memcached | Redis/InProcessMap | **InProcessMap** | No Docker, TTL built-in |
