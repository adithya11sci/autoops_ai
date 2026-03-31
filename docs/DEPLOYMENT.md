# 🚀 AutoOps AI — Deployment Guide

---

## Prerequisites

- Node.js 18+ and npm
- Docker and Docker Compose
- Groq API key ([console.groq.com](https://console.groq.com))

---

## Local Development Setup

### 1. Clone & Configure

```bash
git clone https://github.com/adithya11sci/autoops_ai.git
cd autoops_ai
cp .env.example .env
# Edit .env → set GROQ_API_KEY
```

### 2. Start Infrastructure

```bash
docker-compose up -d
# Starts: PostgreSQL, Kafka, ChromaDB
```

### 3. Install & Run

```bash
npm install
npm run dev
```

### 4. Test the Pipeline

```bash
# Simulate incidents
npm run simulate

# Or use API
curl -X POST http://localhost:3000/api/simulate \
  -H "Content-Type: application/json" \
  -d '{"scenario": "oom_kill", "eventCount": 50}'
```

---

## Docker Deployment

```bash
# Build the application
docker build -t autoops-ai:latest .

# Run everything
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

## Kubernetes Deployment

```bash
# Apply manifests
kubectl apply -f infrastructure/kubernetes/namespace.yaml
kubectl apply -f infrastructure/kubernetes/
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GROQ_API_KEY` | ✅ | — | Groq API key for LLM |
| `POSTGRES_HOST` | — | localhost | PostgreSQL host |
| `POSTGRES_PORT` | — | 5432 | PostgreSQL port |
| `POSTGRES_DB` | — | autoops | Database name |
| `POSTGRES_USER` | — | autoops | Database user |
| `POSTGRES_PASSWORD` | — | autoops_secret | Database password |
| `KAFKA_BROKERS` | — | localhost:9092 | Kafka brokers |
| `CHROMA_HOST` | — | localhost | ChromaDB host |
| `CHROMA_PORT` | — | 8000 | ChromaDB port |
| `PORT` | — | 3000 | API server port |
| `EXECUTION_MODE` | — | simulate | simulate or live |
| `ANOMALY_THRESHOLD` | — | 0.7 | Anomaly detection threshold |
| `MAX_RETRIES` | — | 3 | Max retry attempts |

---

## Verification

```bash
# Check health
curl http://localhost:3000/api/health

# Check logs
docker-compose logs -f

# Check Kafka topics
docker exec autoops-kafka kafka-topics.sh --bootstrap-server localhost:9092 --list
```
