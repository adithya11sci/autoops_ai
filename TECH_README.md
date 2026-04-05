# ⚙️ AutoOps AI — Deep Technical Implementation & Flow Guide

> **Target Audience:** Engineering Leadership, Principal SREs, System Architects, and Code Reviewers.
> 
> *This document provides an exhaustive, code-level breakdown of the mathematical models, software engineering patterns, and execution flow of the AutoOps AI agent framework. It maps exactly **how** data moves and changes state throughout the system.*

---

## 1. High-Level System Architecture

At its core, AutoOps AI is an event-driven, multi-agent orchestration engine. We chose a microservice-like internal structure coordinated by an immutable Redux-like state graph, avoiding the brittle nature of traditional sequential runbooks.

```mermaid
graph TD
    %% External Sources
    subgraph Ingestion Layer
        A1["Prometheus Metrics"] --> K["Apache Kafka (Topics)"]
        A2["Fluentd Logs"] --> K
        A3["System Alerts"] --> K
    end

    %% Gateway & Streaming
    subgraph API & Streaming
        K --> B["Fastify Stream Consumer"]
        B --> |"Rate Limits & Backpressure"| C["Event Normalizer"]
    end

    %% State Orchestrator
    subgraph LangGraph Orchestrator
        C --> D["Monitor Agent (Anomaly ML)"]
        D --> |"Anomaly > 0.7"| E["RCA Agent (Graph Traversal)"]
        E --> F["Planning Agent (RAG)"]
        F --> G["SLA Agent (Risk Scoring)"]
        G --> H["Approval Gate (Human in the Loop)"]
        H --> I["Execution Agent (Templates)"]
        I --> J["Feedback Agent (Learning)"]
        
        %% Lifecycle Loops
        I -.->|"Retry / Failure Context"| F
    end

    %% Persistent Storage
    subgraph Persistence & Memory
        F <-->|"KNN Search / Injection"| V[(ChromaDB Vector Store)]
        J -->|"Embed Lessons Learned"| V
        J -->|"Audit Logs"| P[(PostgreSQL)]
    end
    
    %% Execution Envelope
    I --> |"Shell / API Call"| X["Docker / K8s Cluster"]

    classDef core fill:#0b3d91,stroke:#0f52ba,stroke-width:2px,color:#fff;
    classDef agent fill:#228b22,stroke:#32cd32,stroke-width:2px,color:#fff;
    classDef db fill:#8b0000,stroke:#dc143c,stroke-width:2px,color:#fff;
    
    class D,E,F,G,H,I,J agent;
    class V,P db;
```

---

## 2. The Agentic State Machine (LangGraph Orchestrator)

Unlike simple LangChain sequences which are DAGs (Directed Acyclic Graphs), an infrastructure outage resolution requires cyclical flows (e.g., trying a fix, failing, going back to plan a new fix). 

### How State Mutates
Every incident initialized by the orchestrator creates an instance of `IncidentState`. Agents execute asynchronously, pulling context from `IncidentState`. However, agents **cannot mutate** the global state directly. They return a *State Patch* which the orchestrator strictly merges. This guarantees thread safety and an immutable audit trail.

```mermaid
stateDiagram-v2
    [*] --> Idle

    state "Data Stream" as DS
    Idle --> DS : "Consume Log"
    
    state "Monitor Agent" as MA
    DS --> MA : "_evaluate_anomaly()_"
    
    MA --> Idle : "Anomaly < 0.7"
    MA --> RCA_Agent : "Anomaly >= 0.7"
    
    state "RCA Agent" as RCA
    RCA --> Planning_Agent : "Dependency Traced"
    
    state "Planning Agent" as Planner
    Planner --> SLA_Agent : "Fix Generated"
    
    state "SLA Agent" as SLA
    SLA --> Human_Gate : "P0 (Critical)"
    SLA --> Execution_Agent : "P1-P4"
    
    state "Human Gate" as Gate
    Gate --> Execution_Agent : "Approved"
    Gate --> Idle : "Rejected"
    
    state "Execution Agent" as Exec
    Exec --> Feedback_Agent : "Success"
    Exec --> Planner : "Timeout / Failure (Retry)"
    
    state "Feedback Agent" as Feedback
    Feedback --> [*] : "Resolution Stored"
```

---

## 3. Ingestion & Anomaly Detection Flow

### The Mathematics Behind Detection
If we relied on hardcoded thresholds (e.g., `Memory > 90%`), the system would suffer from alert fatigue because normal traffic spikes trigger false alarms.

1. **Ingestion Buffer:** Kafka streams push to the Fastify consumer. To prevent an event loop crash under heavy traffic, events are buffered in memory blocks.
2. **Feature Extraction:** Non-numerical logs are vectorized structurally. The time delta from the last spike is calculated.
3. **Isolation Forest Model:** 
    - The ML engine evaluates new events in real-time against an active tree. 
    - *Calculation:* The fewer nodes an event must pass through to be "isolated" from normal traffic clusters, the more anomalous it is.
4. **Temporal Decay Tracking:** The isolation score is combined with a time-decay weight $W = e^{-\lambda t}$. This deduplicates rapid error spams (preventing 10 alerts for the same repeating error).

```mermaid
sequenceDiagram
    participant Kafka Topic
    participant Fastify Node
    participant ML Isolation Forest
    participant StateGraph
    
    Kafka Topic->>Fastify Node: Stream raw JSON logs (Batch 500)
    Fastify Node->>Fastify Node: Backpressure logic (Check Event Loop Lag)
    Fastify Node->>ML Isolation Forest: Extract numerical features (CPU, Latency, Errors)
    ML Isolation Forest-->>Fastify Node: Return Anomaly Score (e.g., 0.85)

    alt Score >= 0.7
        Fastify Node->>StateGraph: TRIGGER: instantiate `IncidentState`
    else Score < 0.7
        Fastify Node->>Fastify Node: Drop / Log silently
    end
```

---

## 4. Problem Solving Flow: RAG Query & Planning

Once the Root Cause tracking is finished, the **Planning Agent** leverages ChromaDB (Retrieval-Augmented Generation) and Groq LLaMA 3 70B for zero-latency semantic reasoning.

### The RAG Mechanism Steps:
1. **Stringification:** The RCA agent outputs a JSON report. This report is stringified into a narrative text block (`"Service A crashed due to downstream timeout scaling from DB connection limit..."`).
2. **Embedding:** We utilize local or embedded models to convert this narrative into a 1536-dimensional vector float array.
3. **ChromaDB K-NN:** The array is cross-referenced using Cosine Similarity against all past incidents.
4. **Prompt Building:** 
    - *System Prompt:* "You are a senior DevOps engineer."
    - *Context Window:* Pre-loads the top 3 resolutions that previously solved similar mathematical embeddings.
    - *Current Outage:* Appends the current live data.
5. **Deterministic Schema:** The Groq API is forced to respond only in a structured `Zod` output format (strictly enforcing `Array<FixStep>`).

```mermaid
flowchart LR
    A["RCA Report JSON"] --> B("Embedding Generator")
    B --> |"1D Vector Float"| C[("ChromaDB Cluster")]
    C -- "Cosine Sim: >0.82" --> D["Top 3 Historic Fixes"]
    
    D --> E{Prompt Compiler}
    A --> E
    
    E --> F(("LLaMA 3 (Groq LPU)"))
    F --> |"Structured JSON"| G["Zod Schema Validator"]
    
    G -- "Valid" --> H["Planning Agent Phase Complete"]
    G -- "Hallucination" --> E
```

---

## 5. Safely Executing Fixes (The Constraint Flow)

Allowing an AI execution engine uncontrolled root terminal access is an enterprise disaster waiting to happen. AutoOps prevents chaos utilizing a **Template-Based Fix Engine**.

### How safe execution is guaranteed:
Instead of generating generic bash commands (`#!/bin/bash sudo rm ...`), the LLM only suggests an intent and specifies template parameters.

1. **Semantic Match:** LLM recommends `intent: "RESTART_POD", target: "auth-service"`.
2. **Template Expansion:** The execution engine maps this to an internal, highly audited constant string: `kubectl rollout restart deployment/{{target}} -n production`.
3. **Regex Validator:** The parameters pass a strict validator checking for command injection (e.g., ensuring `target` doesn't contain `; rm -rf /`).
4. **SLA Gating Check:** If the SLA agent flagged this as a critical path, the execution pauses and sends a WebSocket payload to the Front-End Dashboard. An Admin must click "Approve" (calling the Fastify `approvals.router.ts`), unblocking the StateGraph promise.
5. **Node.js Spawn/Exec:** The `child_process.exec` physically patches the environment.

```mermaid
sequenceDiagram
    participant LLM Output
    participant Execution Engine
    participant Security Validator
    participant Approval Router
    participant Docker/K8s Env
    
    LLM Output->>Execution Engine: intent: "SCALE_UP", {target: "db", max: 5}
    Execution Engine->>Security Validator: Map to Template: "kubernetes_scale"
    Security Validator-->>Execution Engine: Param Validation: OK
    
    Execution Engine->>Approval Router: Check SLA Agent Flag
    
    alt P0 / High Danger
        Approval Router->>Execution Engine: PAUSE (Await Callback)
        Approval Router->>UI: Request User Signature
        UI-->>Approval Router: HTTP POST /api/approvals (Grant)
        Approval Router->>Execution Engine: UNPAUSE
    end
    
    Execution Engine->>Docker/K8s Env: Execute Restrictive Command
    Docker/K8s Env-->>Execution Engine: Exit Code 0 (Success)
```

---

## 6. Feedback Loop (Continuous Maturation)

The final agent in the StateGraph is the **Feedback Agent**.
It evaluates the success of the execution (did latency drop? Did errors stop?).

If the execution succeeded:
- The exact state graph inputs, vectors, and execution logs are fed back into ChromaDB.
- This creates semantic density. The next time a similar incident arises, the vectors will cluster more tightly, granting higher confidence to the prompt injection.
- Over time, MTTR (Mean Time To Recovery) approaches $T_{execution}$, as the planning phase converges instantly onto historic truth.
