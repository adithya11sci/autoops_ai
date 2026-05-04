# 🧪 Simulation Working: End-to-End OOM Error Resolution

This document breaks down exactly what happened during the latest `oom_kill` simulation. It explains the journey of the error from injection to complete autonomous resolution by AutoOps AI.

---

## 1. How the Error Occurs & How it is Triggered

The error is an **Out of Memory (OOM)** crash occurring inside the `payment-api` Kubernetes pods. 

We triggered the error manually using the AutoOps API simulator endpoint. The following command was sent to the system telling it to simulate 5 consecutive pod crashes:

```json
POST http://localhost:3000/api/simulate
{
  "scenario": "oom_kill",
  "eventCount": 5
}
```

Upon receiving this request, the **Log Simulator** generated 5 synthetic crash logs mimicking real-world Kubernetes events (Error 137, Reason: `OOMKilled`, Memory Usage: `505Mi` exceeding limit `512Mi`).

---

## 2. How the System Detects the Error

The mock events were ingested into the pipeline, triggering the autonomous workflow:

- **Agent Involved:** `Monitoring Agent`
- **What it did:** The agent calculated anomaly scores across statistical (`statScore`), pattern (`patScore`), and rule-based (`ruleScore`) metrics.
- **The Result:** It generated an ensemble score of **0.914**, immediately flagging the events as a **CRITICAL Anomaly** (`issue: pod_crash`).

---

## 3. How the System Finds the Root Cause

Once the anomaly was detected, the incident was passed to the Root Cause Analysis engine.

- **Agent Involved:** `RCA Agent`
- **What it did:** It evaluated the incoming anomaly data against its dependency graph and internal rule engine. It matched the logs against the "OOMKilled Detection" rule.
- **The Result:** The RCA Agent confidently concluded (95% confidence) that the root cause was a **`memory_leak`** originating specifically in the **`payment-api`** service. 

---

## 4. How the System Solves the Error

With the root cause identified, the system orchestrated a plan to fix the broken pods without any human intervention.

- **Agent Involved:** `Planning Agent`
  - It generated a 4-step remediation plan to isolate and recover the pods safely.
  
- **Agents Involved:** `SLA Agent` & `Risk Service`
  - Rated the incident priority as **P1 (Platinum Tier)**.
  - Calculated a risk score of *44 (Medium)*, making the autonomous decision to proceed with the fix while notifying administrators (`EXECUTE_NOTIFY`).

- **Agent Involved:** `Execution Agent`
  - The Execution payload sequentially carried out the 4 simulated steps:
    1. ✅ `scale_deployment` (Spins up extra nodes to handle lost capacity).
    2. ✅ `rolling_restart` (Gracefully restarts the failing pods to clear the memory leak).
    3. ✅ `update_resource_limits` (Increases the memory allocation to prevent immediate re-crashing).
    4. ✅ Final validation checks.

---

## 5. How the System is Now

**Status:** `Fully Operational & Resolved`

The entire incident lifecycle—from the exact millisecond the logs hit the system to the final deployment restart—was completed autonomously in **7.4 seconds**.

**Final Output Summary:**
```json
{
    "incidentId": "inc-41b00555",
    "outcome": "resolved",
    "workflowStatus": "completed",
    "duration": "7.4s",
    "summary": {
        "issue": "pod_crash",
        "rootCause": "memory_leak",
        "plan": "Fallback: Remediate memory_leak in payment-api",
        "priority": "P1",
        "executionStatus": "success",
        "stepsCompleted": 4
    }
}
```

The system is now back at rest, actively monitoring for the next incident, with the `payment-api` successfully brought back online.
