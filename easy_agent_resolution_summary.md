# How the AI Solves the Problem (Simple Explanation for the Judge)

When we run the simulation, several different AI "Agents" work together like a team of human engineers to fix the broken servers. Here is the exact step-by-step story of what each agent does, in plain English.

### Step 1: The Incident Occurs
The **Simulator** runs and purposefully breaks a server (for example, intentionally causing a "Memory Leak" that makes the server crash).
* *What happens:* The server starts throwing error logs and sending them to our Kafka messaging queue.

### Step 2: Detection (The Monitoring Agent)
* **Who:** 🕵️ **Monitoring Agent** (The Watchdog)
* **What it does:** It constantly reads the logs. It sees the "Out of Memory" or "Crash" errors coming from the server.
* **The Result:** It raises an alert and creates a ticket: *"Hey team, the Payment Service just crashed because of a memory leak!"*

### Step 3: Investigation (The RCA Agent)
* **Who:** 🧠 **RCA Agent** (Root Cause Analysis / The Detective)
* **What it does:** It looks at the history of the logs and the code to figure out *why* it crashed.
* **The Result:** It diagnoses the exact root cause. *"The server ran out of RAM because the database connection pool wasn't closing properly."*

### Step 4: Making a Fix (The Planning Agent)
* **Who:** 📋 **Planning Agent** (The Architect)
* **What it does:** Now that it knows the problem, it writes an automated script or a set of shell commands to fix the issue (e.g., restarting the container, clearing the cache, or safely rolling back a bad update).
* **The Result:** It creates a fix plan: `docker restart payment-service`

### Step 5: Safety Check (The Risk & Validator Agents)
* **Who:** 🛡️ **Risk & Validator Agents** (The Security Guards)
* **What they do:** They review the Planning Agent's script. 
    1. The **Validator** checks against a blacklist: *"Is this trying to delete our database? (e.g., `rm -rf`)"*. If yes, it blocks it instantly.
    2. The **Risk Agent** checks the impact: *"Is this a low-risk restart, or a high-risk database wipe?"*
* **The Result:** If it's low-risk and safe, it approves the script automatically. If it's a terrifying command, it pauses and waits for a Human Administrator to click "Approve".

### Step 6: Fixing the Server (The Execution Agent)
* **Who:** ⚡ **Execution Agent** (The Mechanic)
* **What it does:** Once approved, this agent takes the safe script and actually runs the commands on our infrastructure on our behalf.
* **The Result:** The broken container is restarted, the cache is cleared, and the server comes back online.

### Step 7: Verification (The Feedback Agent)
* **Who:** ✅ **Feedback/Monitoring Agent** (The QA Tester)
* **What it does:** It watches the logs for the next 30 seconds to make sure the errors stopped.
* **The Result:** It marks the incident as "Resolved" and closes the ticket. 

---
### **Summary to tell the judge:**
*"Instead of waking up an engineer at 3:00 AM, our AI detected the crash, diagnosed the root cause, wrote a safe script to fix it, verified it wasn't a dangerous hacker command, executed the fix, and verified the server was healthy again—all in about 15 seconds."*