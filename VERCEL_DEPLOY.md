# Deploying AutoOps AI to Vercel

This deploys the dashboard and REST API as a Vercel serverless function. It works,
but Vercel is a poor structural fit for this system — read
[What does not work](#what-does-not-work-on-vercel) before you rely on it.
For the full experience (live WebSocket feed, persistent memory, human approval gate),
deploy to a platform that runs a persistent process: Render, Railway, or Fly.io.

---

## Environment variables

Set these in **Vercel → Project → Settings → Environment Variables**.

### Required

| Key | Value |
|---|---|
| `GROQ_API_KEY` | Your Groq key (`gsk_...`). Every agent calls Groq; nothing works without it. |

### Strongly recommended

| Key | Value | Why |
|---|---|---|
| `AUTOOPS_API_KEY` | A long random string | Without it the approve/deny endpoints accept **any** caller — see [approvals.router.ts:16-24](src/api/approvals.router.ts#L16-L24) |
| `APP_URL` | `https://<your-app>.vercel.app` | Used to build approval links in Slack notifications |
| `GROQ_MODEL_PLANNING` | `llama-3.3-70b-versatile` | Planning/RCA model |
| `GROQ_MODEL_FAST` | `llama-3.1-8b-instant` | Classification model |
| `EXECUTION_MODE` | `simulate` | `simulate` never touches real infrastructure. Keep it here. |
| `LOG_LEVEL` | `info` | |

`NODE_ENV=production` is set by Vercel automatically — don't add it. Keeping it at
`production` matters: in `development` the logger loads `pino-pretty`
([logger.ts:8](src/utils/logger.ts#L8)), a devDependency that isn't installed in a
production build.

### Optional tuning

All have working defaults; set only what you want to change.

| Key | Default |
|---|---|
| `ANOMALY_THRESHOLD` | `0.7` |
| `MAX_RETRIES` | `3` |
| `VECTOR_SIMILARITY_THRESHOLD` | `0.82` |
| `TRUST_THRESHOLD_SUCCESS_COUNT` | `3` |
| `SLACK_WEBHOOK_URL` | *(none — notifications skipped)* |
| `EMAIL_ALERT_ADDRESS` | *(none)* |

### Do NOT set

- `PORT`, `HOST` — platform-managed.
- `POSTGRES_*`, `KAFKA_*`, `CHROMA_*`, `REDIS_*` — dead config. These backends were
  replaced with in-process implementations
  ([database.ts](src/services/database.ts), [kafka.service.ts](src/services/kafka.service.ts),
  [chroma.client.ts](src/services/chroma.client.ts), [memory.service.ts:67](src/services/memory.service.ts#L67)).
  Nothing reads them.
- `APPROVAL_TIMEOUT_MS`, `APPROVAL_GROUP_WINDOW_MS` — ignored on Vercel; the approval
  gate is short-circuited (see below).

---

## Deploy

```bash
npm i -g vercel
vercel link
vercel env add GROQ_API_KEY production
vercel env add AUTOOPS_API_KEY production
vercel --prod
```

Or import the repo in the Vercel dashboard — [vercel.json](vercel.json) already sets the
build command, output directory, and function limits.

### How it's wired

- [api/[...path].ts](api/[...path].ts) — catch-all function. Vercel routes every
  `/api/*` request here; it boots the Fastify app once per warm instance and replays
  the request into its HTTP server.
- `public/` — served directly by Vercel as static assets, so the dashboard loads
  without touching the function.
- [vercel.json](vercel.json) — `maxDuration: 60`, `memory: 1024`. A full pipeline run
  makes several sequential Groq calls, so it needs the headroom.

`maxDuration: 60` requires a **Pro** plan. On Hobby the ceiling is lower and long runs
will be cut off mid-pipeline.

---

## What does not work on Vercel

These are structural limits of serverless, not bugs. The code detects Vercel via the
`VERCEL` env var ([config/index.ts](src/config/index.ts)) and degrades explicitly
rather than failing silently.

**1. No live WebSocket feed.** Serverless functions never receive an HTTP upgrade, so
`/ws` isn't registered. Instead, `/api/simulate` runs the pipeline **inline** and
returns the full message transcript in the response body; the dashboard replays it
locally to drive the same UI. The result: you see the run animate after it finishes,
not while it happens. The status pill reads `Batch (serverless)`.

**2. State resets on cold start.** Incidents, the TF-IDF vector store, the TTL cache
and metrics all live in process memory. A cold start wipes them, and concurrent
requests may land on different instances. Practically: the incident table and the
learned-fix memory will look inconsistent, and the RL/trust scoring never accumulates
across runs. This is the biggest loss — memory-driven fix reuse is a core feature.

**3. The human approval gate can't work.** A high-risk plan needs an operator decision,
but the approve POST is a separate invocation with its own memory and would never be
observed by the waiting request. `waitForDecision` now returns immediately in
serverless mode ([approval.service.ts](src/services/approval.service.ts)), which the
workflow treats as a timeout and **escalates** — failing closed, never auto-executing
an unapproved high-risk plan. Safe, but the demo of the approval flow is gone.

**4. Metrics persistence is ephemeral.** `metrics.json` is written to `/tmp` (the
project directory is read-only) and vanishes with the instance.

**5. Long runs may be truncated.** If the pipeline exceeds the function limit, the
response never arrives and the dashboard logs a warning rather than hanging.

If any of 1–3 matter for your use case, use Render/Railway/Fly with the existing
[Dockerfile](Dockerfile) and the same env vars — everything works there unchanged.
