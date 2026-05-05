# AutoOps AI - Simple Presentation Script for Judges

To present this to the judges, you will need to open **3 separate terminal windows** (or tabs). Follow this exact script.

---

## 🛠️ Prep-Work (Do this *before* the judge comes over)

**Open Terminal 1** (This will run your database and AI backend)
1. Run: `docker-compose up -d`
   *(This starts the database and Kafka in the background)*
2. Run: `npm run db:init`
   *(This creates the database tables)*
3. Run: `npm run dev`
   *(This starts the main AI system. Leave this running!)*

**Open Terminal 2** (This will run the log generator)
1. Run: `cd go-ingester`
2. Run: `go run main.go`
   *(This starts shooting fake server error logs to the AI. Leave this running!)*

---

## 🎤 The Presentation (Do this *while* the judge is watching)

**Open Terminal 3** (You will use this terminal to run the show)

### 1. Show the "Standard Fix"
**Action:** Type `npm run simulate:all` in Terminal 3 and press Enter.
**What to say to the judge:** 
> *"Our system is currently listening to server logs. I just simulated a server crashing. Watch the AI detect the error from the logs, write a script to fix it, check if the script is safe, and automatically execute it to bring the server back online without human help."*

### 2. Show the "High Risk Pause"
**Action:** Type `npm run simulate:high-risk` in Terminal 3 and press Enter.
**What to say to the judge:** 
> *"Now, I'm simulating a massive database failure. Because fixing a database is dangerous, our AI 'Risk Agent' detects this is a high-risk operation. Instead of acting autonomously, it safely pauses and asks for a human administrator's approval before running the fix."*

### 3. Show the "Security Blocker"
**Action:** Type `npm run simulate:blocked` in Terminal 3 and press Enter.
**What to say to the judge:** 
> *"Finally, this shows our security sandbox. I'm simulating a scenario where a malicious command (like deleting all files) tries to get executed. Our Command Validator instantly blocks it, ensuring the AI cannot accidentally or maliciously destroy our infrastructure."*

### 4. Show the Tests (Optional)
**Action:** Type `npm run test` in Terminal 3 and press Enter.
**What to say to the judge:** 
> *"And here is our automated test suite running to prove that all our AI boundaries and safety checks work perfectly under the hood."*