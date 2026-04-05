# 🚀 AutoOps AI

> **An Autonomous, Multi-Agent DevOps System for Intelligent Incident Detection, Root Cause Analysis, and Self-Healing Automation**

---

## 1. Project Overview

### What the Project Does
AutoOps AI is an enterprise-grade, autonomous DevOps and Site Reliability Engineering (SRE) system. It acts as an intelligent, tirelessly working DevOps engineer that continuously ingests infrastructure telemetry (logs, metrics, alerts), detects anomalies in real-time, identifies the root cause of issues, dynamically formulates a remediation plan, and securely executes the fix—all with zero or minimal human intervention. 

By taking an agentic approach inspired by LangGraph’s stateful graphs, it orchestrates a fleet of specialized AI agents that pass the context of an incident from detection all the way to resolution and continuous learning.

### Real-World Problem it Solves
Modern cloud infrastructure is highly distributed and complex. When an incident occurs (e.g., a memory leak, a runaway pod, or a sudden spike in latency), SRE teams face a deluge of cascading alerts. They waste critical minutes digging through logs, tracing dependencies, formulating a fix, and executing runbooks manually. This manual toil leads to prolonged downtime (high MTTR), massive stress on on-call engineers, and breaches in Service Level Agreements (SLAs). AutoOps AI solves this by automating the entire lifecycle of an incident securely and deterministically.

---

## 2. Problem Statement

### Defining the Problem
Infrastructure scales horizontally and dynamically, but operations teams do not. When hundreds of microservices interact, a single failure cascades into a storm of noisy alerts. Human engineers are the bottleneck: no matter how skilled, parsing gigabytes of logs to find out *why* a service failed takes time. 

### Limitations of Existing Solutions
Current tools (like PagerDuty, Datadog alerts, or static Ansible runbooks) only go halfway:
1. **Rule-based & Static:** Traditional runbooks fail when an incident deviates slightly from the expected parameters. 
2. **Alert Fatigue:** Monitoring tools tell you something broke, but they don't tell you *exactly* how to fix it, leading to alert fatigue.
3. **Lack of Contextual Awareness:** While LLMs are great at text generation, throwing raw logs at ChatGPT doesn't work for infrastructure. You need deterministic, gated execution with a deep understanding of the system's architecture.

---

## 3. Why This Approach

### Architecture Choices
Instead of a single "omnipotent" AI prompt that tries to do everything, AutoOps AI uses a **LangGraph-inspired StateGraph framework** with specialized, compartmentalized AI agents (Monitor, RCA, Planner, SLA, Executor, Feedback).

### Why Not Other Approaches?
- **Why not pure script automation?** Scripts are brittle. If the environment changes, the script breaks. AutoOps AI dynamically adapts.
- **Why not a single massive LLM call?** Giving a single AI full rein over production is dangerous and non-deterministic. A multi-agent approach isolates responsibilities: the Planner can only plan, the Executor can only execute (and only within approved templates), and a human-in-the-loop gate can intercept critical actions. This guarantees enterprise-grade safety.

---

## 4. System Architecture

### High-Level Design
AutoOps AI is built on a 6-layer architecture: Presentation, API Gateway, Agent Orchestrator, AI/ML Engine, Data/Messaging Layer, and Infrastructure. 

### Component Breakdown
1. **Monitoring Agent:** Hooks into Kafka streams to ingest events. Uses Isolation Forests and temporal patterns to flag anomalies.
2. **Root Cause Analysis (RCA) Agent:** Receives the anomaly and traces dependencies (e.g., Service A failed because Database B ran out of connections).
3. **Planning Agent:** Synthesizes the RCA report and interacts with ChromaDB (Vector DB) to retrieve past similar incidents (RAG), generating a structured fix plan.
4. **SLA & Priority Agent:** Determines urgency. If revenue is impacted, it tags the incident as P0 / fast-tracked.
5. **Execution & Validation Agent:** Translates the generic plan into deterministic system commands, validating them against a safety engine and human-in-the-loop approvals before firing via the Docker/K8s API.
6. **Feedback Agent:** Evaluates the post-execution state. If the fix succeeded, it updates the Vector DB so the system is smarter next time.

### Data Flow
`Telemetry -> Kafka -> Monitor Agent -> Shared State -> RCA Agent -> Planner Agent -> SLA Agent -> Human Approval (if gated) -> Execution Agent -> Feedback Agent -> ChromaDB/PostgreSQL`

---

## 5. Tech Stack Justification

Here is a breakdown of the core technologies and *why* I chose them for this architecture:

* **TypeScript & Node.js:** Provides strict type safety across the complex state objects shared between agents while maintaining high asynchronous throughput.
* **Fastify:** Chosen over Express for its significantly higher performance and low-overhead routing, crucial when handling high-frequency API simulator logs.
* **Apache Kafka:** Acts as the circulatory system. Ingesting raw logs requires high throughput and decoupling so the agents aren't overwhelmed by traffic spikes.
* **Groq / LLaMA 3 70B:** Used as the LLM backend. Groq’s LPU architecture provides blazing-fast inference outperforming traditional GPU setups, reducing the critical "thinking" time during an outage.
* **ChromaDB:** A lightweight, high-performance Vector Database. It powers the Retrieval-Augmented Generation (RAG), allowing the system to use historical incidents as memory.
* **PostgreSQL & Redis:** Postgres persists incident history, agent transcripts, and configurations reliably. Redis handles transient caching and rate-limiting.

---

## 6. Core Logic Explanation (VERY IMPORTANT)

The true magic of AutoOps AI lies in its internal processing flow. Here is the step-by-step logic of how an incident is mathematically and logically handled.

### Algorithm & Processing Flow
1. **Ingestion & Feature Extraction:** Logs stream through Kafka. The Monitoring Agent extracts features (latency, CPU spikes). Instead of static thresholds, it uses ensemble scoring. If the weighted anomaly score crosses `0.7`, a state object `IncidentState` is instantiated.
2. **Graph Traversal for RCA:** The RCA agent doesn't just read the log; it parses the system's topological graph. Using temporal correlation, if a memory spike in Service B occurred 5 seconds before Service A timed out, it deduces B is the root source.
3. **RAG-Powered Planning:** 
   - *Algorithm:* `Query Vector Generation -> K-Nearest Neighbors (KNN) in ChromaDB`. 
   - It searches memory: "Have we seen a memory leak in Service B before?" 
   - The Planner constructs a prompt injecting this context to ensure the LLM doesn't hallucinate commands.
4. **Deterministic Execution:** The LLM's plan is purely semantic ("Restart the pod"). The Execution engine maps semantic steps into deterministic templates (`kubectl rollout restart deploy/<name>`). The Command Validation Service blocks destructive commands (e.g., `rm -rf`, `drop table`).
5. **Human-in-the-Loop Gating:** If the SLA agent detects P0 severity, or the executed command mutates critical state, the state graph pauses. A WebSocket event requests manual approval from an administrator.

### Edge Cases Handled
- **Execution Failure:** If a command fails (e.g., timeout), the Execution agent logs the error, updates the state, and the graph routes *back* to the Planning agent to formulate an alternative approach ("Retry logic loop").
- **LLM Hallucination Mitigation:** All LLM outputs are piped through Zod schemas. If the LLM generates malformed JSON, the parser catches it and requests a retry automatically. 

---

## 7. Folder Structure Explanation

* `src/api/` - Fastify route handlers, HTTP/WebSocket servers, and human approval endpoints.
* `src/agents/` - The core AI intelligence. Contains the 6 independent LangGraph agents.
* `src/orchestrator/` - State management (`state.ts`) and the workflow graph (`workflow.ts`) that chains agents together.
* `src/engines/` - Template-based command generation and security validation engines ensuring safe execution.
* `src/services/` - External integrations (Groq LLM client, ChromaDB RAG, Kafka consumer, Memory/Postgres).
* `src/simulator/` - A built-in traffic generation tool allowing developers to simulate raw anomalous logs to test the pipeline natively.
* `docs/` - Comprehensive technical documentation, architecture diagrams, and sequence flows.

---

## 8. Implementation Details

### Key Challenges & Solutions
1. **Challenge: AI Hallucinating Dangerous Commands.**
   * *Solution:* I built a `Command Validation Service` combined with a deterministic `Template Fix Engine`. The LLM is restricted from writing raw shell code. It instead selects from predefined parameterized templates, which are strictly validated before execution.
2. **Challenge: State Management between Asynchronous Agents.**
   * *Solution:* I designed a robust, immutable `IncidentState` object modeled after Redux/LangGraph principles. Agents never blindly overwrite data; they return state mutations that the orchestrator carefully merges, preserving a complete audit trail.
3. **Challenge: Ensuring Data Privacy.**
   * *Solution:* RAG vectors contain anonymized infrastructure data. Secrets and sensitive environment variables are sanitized by a middleware utility before hitting the LLM API.

---

## 9. Optimization & Performance

- **Streaming Instead of Polling:** By utilizing Apache Kafka, the system avoids expensive database polling for new logs. It acts instantly on streams.
- **Connection Pooling:** Postgres utilizes `pg` pooling to prevent connection exhaustion during high-concurrency log parsing.
- **Fast Track SLA:** The system mathematically calculates an SLA risk score. High-risk P0 incidents bypass certain extensive checks (via Fast-Track conditionals) to execute verified fixes instantly, shifting focus from comprehensive logging to immediate rescue.

---

## 10. Testing & Validation

### How the System Was Tested
I developed a custom `log-producer.ts` simulator capable of blasting the Kafka queue with thousands of healthy logs, intermittently injecting realistic anomalies (e.g., an `OOMKilled` array of errors).

### Test Cases & Edge Handling
- **Simulated OOM (Out of Memory):** Verified the RCA agent successfully traces the OOM killer log back to the correct memory-hungry Node process rather than blaming the load balancer that reported the HTTP 502 timeout.
- **Invalid API Response from LLM:** Tested network disconnects to the Groq API. The system gracefully queues the incident state, awaiting network recovery without dropping the alert.
- **Safety Violation Block:** Attempted to inject `rm -rf /` into the execution stream. The Validation Service correctly aborted the workflow and marked the incident as "Failed - Security."

---

## 11. Comparison with Existing Solutions

| Feature | Datadog/PagerDuty | Static Ansible Runbooks | AutoOps AI |
| :--- | :--- | :--- | :--- |
| **Detection** | Threshold-based | None | ML Anomaly & Behavioral |
| **Root Cause** | Manual investigation | None | Automated Dependency Graphing |
| **Resolution** | Paging a Human | Brittle rigid scripts | Context-aware dynamic LLM fixes |
| **Continuous Learning**| None | None | RAG Vector Memory Feedback Loop |
| **Execution** | Manual via UI/CLI| Manual trigger | Autonomous & Gated |

AutoOps AI sits perfectly in the intersection of Observability, LLM intelligence, and Infrastructure as Code—closing the loop completely.

---

## 12. Scalability & Future Improvements

### Scalability
The system is entirely stateless at the agent level. You can horizontally spin up 100 `Monitoring Agent` pods connected to Kafka to handle exabytes of telemetry. PostgreSQL handles historical storage, and ChromaDB easily scales horizontally for rapid vector math.

### Future Upgrades
- Multi-cloud execution targets (automating cross-regional failovers via AWS/GCP APIs natively).
- Direct Terraform manifest manipulation for deep infrastructure-level self-healing.
- Fine-tuning an open-source model (like Llama-3-8B) entirely locally on historical enterprise logs to completely remove third-party API dependency.

---

## 13. How to Run the Project

### Prerequisites
- Node.js (v20+)
- Docker & Docker Compose (for Kafka, Postgres, ChromaDB, Redis)
- A Groq API Key

### Setup & Installation
```bash
# 1. Clone the repository
git clone https://github.com/adithya11sci/autoops_ai.git
cd autoops_ai

# 2. Install dependencies
npm install

# 3. Environment configuration
cp .env.example .env
# Edit .env and supply your GROQ_API_KEY connection info

# 4. Boot infrastructure dependencies
docker-compose up -d

# 5. Start the AutoOps API & Agent Orchestrator
npm run dev
```

### Running Simulations
To see the system in action without breaking real infrastructure:
```bash
# In a new terminal, simulate a massive memory leak scenario
npm run simulate -- --scenario oom_kill --events 100
```

---

## 14. Conclusion

AutoOps AI successfully demonstrates that infrastructure operations no longer need to rely purely on human exhaustion to stay afloat. By combining determinism (Kafka, Fastify, strict templates) with intelligence (LLM RAG, Multi-Agent workflow orchestration), this project bridges the gap between passive monitoring and active, autonomous system healing. It provides an enterprise safety net, saving time, money, and on-call engineering sanity.
