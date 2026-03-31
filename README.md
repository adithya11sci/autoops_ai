# 🤖 AutoOps AI — Autonomous Multi-Agent DevOps AI System

> **Intelligent Incident Detection & Resolution powered by LangGraph Multi-Agent Framework**

![System Architecture](docs/diagrams/system_architecture.png)

---

## 🚀 Overview

AutoOps AI is a production-grade, autonomous DevOps system that leverages a multi-agent AI architecture to automatically monitor infrastructure, detect anomalies, identify root causes, generate remediation plans, and execute self-healing actions — all without human intervention.

Built on the **LangGraph StateGraph** framework, each agent operates as an independent node in a stateful, orchestrated workflow, enabling intelligent decision-making at every stage of the incident lifecycle.

---

## 🏗️ Architecture

| Layer | Components |
|---|---|
| **Data Ingestion** | Kafka, Fluentd, Prometheus Exporters |
| **Agent Processing** | LangGraph StateGraph, 6 Specialized Agents |
| **AI/ML** | OpenAI GPT / LLaMA, Scikit-learn, PyTorch |
| **Storage** | PostgreSQL, Redis, FAISS/ChromaDB, S3 |
| **Execution** | Docker API, Kubernetes API, GitHub Actions |
| **Observability** | Prometheus, Grafana, Custom Dashboard |
| **Security** | JWT, RBAC, API Gateway |

---

## 📋 Table of Contents

- [System Design Document](docs/SYSTEM_DESIGN.md)
- [Architecture Diagrams](docs/ARCHITECTURE_DIAGRAMS.md)
- [Agent Specifications](docs/AGENT_SPECIFICATIONS.md)
- [Scalability Design](docs/SCALABILITY_DESIGN.md)
- [Execution Flow](docs/EXECUTION_FLOW.md)
- [Tech Stack Deep Dive](docs/TECH_STACK.md)
- [Presentation Content](docs/PRESENTATION.md)
- [API Reference](docs/API_REFERENCE.md)
- [Deployment Guide](docs/DEPLOYMENT.md)

---

## 🧠 Core Agents

| # | Agent | Role | Key Technology |
|---|---|---|---|
| 1 | **Monitoring Agent** | Anomaly detection from logs, metrics, alerts | Isolation Forest, Time-series ML |
| 2 | **Root Cause Analysis Agent** | Dependency graph reasoning & failure isolation | Rule engine, Graph traversal |
| 3 | **Planning Agent** | LLM-driven remediation plan generation | GPT/LLaMA + RAG |
| 4 | **SLA Agent** | Priority scoring & SLA breach prevention | Dynamic scheduling |
| 5 | **Execution Agent** | Automated fix execution | Docker/K8s API, Shell |
| 6 | **Feedback Agent** | Continuous learning & knowledge base updates | Vector DB, ML retraining |

---

## ⚡ Key Features

- 🔄 **Autonomous Decision Making** — Zero-touch incident resolution
- 🛡️ **Self-Healing Infrastructure** — Auto-restart, auto-scale, auto-rollback
- ⏱️ **Real-Time Detection** — Sub-second anomaly identification
- 🧠 **AI-Driven Remediation** — LLM-generated step-by-step fix plans
- 📈 **Continuous Learning** — Improves accuracy with every incident
- 🔧 **Scalable Architecture** — Handles 1000+ events/sec via Kafka
- 🔐 **Enterprise Security** — JWT, RBAC, encrypted communications

---

## 🛠️ Tech Stack

```
┌─────────────────────────────────────────────────────┐
│  Framework    │  LangGraph + LangChain              │
│  Backend      │  FastAPI (Python 3.11+)             │
│  AI/ML        │  OpenAI GPT-4 / LLaMA 3 / PyTorch  │
│  Vector DB    │  FAISS / ChromaDB                   │
│  Database     │  PostgreSQL 15 + Redis 7            │
│  Streaming    │  Apache Kafka 3.6                   │
│  Containers   │  Docker 24 + Kubernetes 1.28        │
│  CI/CD        │  GitHub Actions                     │
│  Monitoring   │  Prometheus + Grafana               │
│  Frontend     │  React 18 / Streamlit               │
│  Security     │  JWT + RBAC + OAuth 2.0             │
└─────────────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
autoops_ai/
├── docs/                          # Documentation & Diagrams
│   ├── SYSTEM_DESIGN.md
│   ├── ARCHITECTURE_DIAGRAMS.md
│   ├── AGENT_SPECIFICATIONS.md
│   ├── SCALABILITY_DESIGN.md
│   ├── EXECUTION_FLOW.md
│   ├── TECH_STACK.md
│   ├── PRESENTATION.md
│   ├── API_REFERENCE.md
│   ├── DEPLOYMENT.md
│   └── diagrams/
├── src/                           # Source Code
│   ├── agents/                    # Agent Implementations
│   │   ├── monitoring.agent.ts
│   │   ├── rca.agent.ts
│   │   ├── planning.agent.ts
│   │   ├── sla.agent.ts
│   │   ├── execution.agent.ts
│   │   └── feedback.agent.ts
│   ├── orchestrator/              # Workflow Orchestration
│   │   ├── state.ts
│   │   └── workflow.ts
│   ├── services/                  # Core Services
│   │   ├── groq.client.ts
│   │   ├── chroma.client.ts
│   │   ├── kafka.service.ts
│   │   └── database.ts
│   ├── api/                       # API Endpoints
│   │   ├── server.ts
│   │   └── routes.ts
│   ├── simulator/                 # Log Simulator
│   │   └── log-producer.ts
│   ├── config/
│   │   └── index.ts
│   ├── utils/
│   │   └── logger.ts
│   └── index.ts
├── infrastructure/                # Infrastructure as Code
│   ├── docker/
│   └── kubernetes/
├── docker-compose.yml
├── Dockerfile
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

---

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/adithya11sci/autoops_ai.git
cd autoops_ai

# Set up environment
cp .env.example .env
# Edit .env with your Groq API key

# Start infrastructure (Kafka, PostgreSQL, ChromaDB)
docker-compose up -d

# Install dependencies
npm install

# Run the system
npm run dev

# In another terminal, simulate log events
npm run simulate
```

---

## 📊 Performance Targets

| Metric | Target |
|---|---|
| Log ingestion rate | 1,000+ events/sec |
| Anomaly detection latency | < 500ms |
| End-to-end resolution time | < 5 minutes |
| System availability | 99.9% |
| False positive rate | < 5% |
| Auto-resolution success rate | > 85% |

---

## 📄 License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

<p align="center">
  <b>AutoOps AI</b> — Where AI meets DevOps for truly autonomous infrastructure management.
</p>
