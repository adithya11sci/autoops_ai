# 🚀 AutoOps AI — Deployment Guide

> **No Docker required.** The system runs fully standalone using in-process replacements
> for Redis, ChromaDB, and Kafka.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | v22.x | Portable — no installation needed (see below) |
| Groq API Key | — | Free at [console.groq.com](https://console.groq.com) |
| Corporate CA cert | — | Auto-exported by start.ps1 for SSL proxy environments |

---

## Quick Start (No Docker, No Admin Rights)

### 1. Configure Environment

```powershell
# Copy example config
cp .env.example .env

# Edit .env — set your Groq API key
GROQ_API_KEY=gsk_your_key_here
```

### 2. Install Dependencies

```powershell
$node = "C:\Users\<you>\node-portable\node-v22.15.0-win-x64"
& "$node\node.exe" .\node_modules\npm\bin\npm-cli.js install
```

### 3. Start the System

```powershell
.\start.ps1
```

The script handles:
- Setting `NODE_EXTRA_CA_CERTS` → exports Windows trusted root CAs to `corporate-ca.pem` for SSL proxy environments
- Setting `PATH` to the portable Node.js binary
- Starting the server with `tsx` (TypeScript runner — no compile step needed)

### 4. Verify Running

```powershell
# Health check
curl http://localhost:3000/api/health

# Check all in-process services
curl http://localhost:3000/api/debug/stores
```

### 5. Trigger a Test Incident

```powershell
curl -X POST http://localhost:3000/api/simulate `
  -H "Content-Type: application/json" `
  -d '{"scenario":"oom_kill","eventCount":30}'
```

---

## What Runs Without Docker

| Service | Docker Version | No-Docker Version | Status |
|---|---|---|---|
| **ChromaDB** | External server port 8000 | In-process TF-IDF vector store | ✅ Full similarity search |
| **Redis** | External server port 6379 | In-process TTL Map (30-min cache) | ✅ Full caching |
| **Kafka** | External broker port 9092 | In-process EventEmitter bus | ✅ Same handler, same flow |
| **PostgreSQL** | External server port 5432 | In-memory store with same API | ✅ Full CRUD |
| **Groq LLM** | Cloud API | Cloud API (SSL fixed) | ✅ Real AI calls |

---

## SSL Corporate Proxy Fix

In enterprise/lab environments with SSL inspection proxies, Node.js rejects HTTPS calls with:
```
Error: unable to get local issuer certificate
```

`start.ps1` automatically fixes this by exporting Windows trusted root CAs:

```powershell
# Exports 52 corporate root CAs to a PEM file
# Sets NODE_EXTRA_CA_CERTS so Node.js trusts the proxy
$env:NODE_EXTRA_CA_CERTS = "$PSScriptRoot\corporate-ca.pem"
```

This is the **secure** approach — it adds your corporate CA to Node.js's trust store without disabling SSL verification.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GROQ_API_KEY` | ✅ | — | Groq LLM API key |
| `GROQ_MODEL_PLANNING` | — | `llama-3.3-70b-versatile` | Planning model |
| `GROQ_MODEL_FAST` | — | `llama-3.1-8b-instant` | Fast model |
| `PORT` | — | `3000` | API server port |
| `EXECUTION_MODE` | — | `simulate` | `simulate` / `shadow` / `live` |
| `ANOMALY_THRESHOLD` | — | `0.7` | Min score to trigger pipeline |
| `MAX_RETRIES` | — | `3` | Max replanning attempts |
| `VECTOR_SIMILARITY_THRESHOLD` | — | `0.82` | Min cosine similarity for memory hits |
| `TRUST_THRESHOLD_SUCCESS_COUNT` | — | `3` | Successes before memory is "trustworthy" |
| `APPROVAL_TIMEOUT_MS` | — | `600000` | Human approval timeout (10 min) |
| `AUTOOPS_API_KEY` | — | — | API key for approval endpoints |
| `REDIS_HOST` | — | `localhost` | Redis host (ignored in no-Docker mode) |
| `REDIS_PORT` | — | `6379` | Redis port (ignored in no-Docker mode) |
| `SLACK_WEBHOOK_URL` | — | — | Slack webhook for notifications |

---

## Execution Modes

```
EXECUTION_MODE=simulate   ← Default. All kubectl output is realistic simulation.
EXECUTION_MODE=shadow     ← Connects to real K8s, logs what it WOULD do (dry-run).
EXECUTION_MODE=live       ← Actually executes on a real Kubernetes cluster.
```

---

## Verification Endpoints

```bash
# System health
GET  http://localhost:3000/api/health

# Live incident data
GET  http://localhost:3000/api/incidents

# Performance metrics (JSON)
GET  http://localhost:3000/api/metrics

# Prometheus metrics (for Grafana scraping)
GET  http://localhost:3000/api/prometheus

# Debug: inspect vector store, cache, and event bus contents
GET  http://localhost:3000/api/debug/stores

# Real-time WebSocket feed
WS   ws://localhost:3000/ws
```

---

## With Docker (Full Stack)

When Docker is available:

```bash
# Start all external services
docker-compose up -d
# Starts: PostgreSQL 15, Kafka 3.6, ChromaDB, Redis

# Then run the app
npm run dev
```

The system auto-detects real services and uses them instead of in-process fallbacks.

---

## Kubernetes Deployment

```bash
kubectl apply -f infrastructure/kubernetes/namespace.yaml
kubectl apply -f infrastructure/kubernetes/

# Set secrets
kubectl create secret generic autoops-secrets \
  --from-literal=GROQ_API_KEY=gsk_... \
  --from-literal=AUTOOPS_API_KEY=your_key \
  -n autoops
```
