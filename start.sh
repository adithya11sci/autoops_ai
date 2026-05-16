#!/usr/bin/env bash
# AutoOps AI — Enterprise one-command startup (Linux/macOS/WSL)
set -euo pipefail

DASHBOARD_URL="http://localhost:3000"

echo "╔══════════════════════════════════════════════╗"
echo "║   AutoOps AI — Enterprise Startup           ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── 1. Install Node dependencies if needed ─────────────────
if [ ! -d "node_modules" ]; then
  echo "→ Installing Node dependencies..."
  npm install
fi

# ── 2. Start infrastructure via Docker Compose ─────────────
echo "→ Starting infrastructure (Postgres, Kafka, ChromaDB, Redis)..."
docker compose up -d postgres kafka chromadb redis

# ── 3. Wait for all infrastructure health checks ───────────
echo "→ Waiting for services to become healthy..."
SERVICES=(postgres kafka chromadb redis)
MAX_WAIT=120
ELAPSED=0
while true; do
  ALL_HEALTHY=true
  for svc in "${SERVICES[@]}"; do
    STATUS=$(docker inspect --format='{{.State.Health.Status}}' "autoops-${svc}" 2>/dev/null || echo "unknown")
    if [ "$STATUS" != "healthy" ]; then
      ALL_HEALTHY=false
      break
    fi
  done
  if $ALL_HEALTHY; then
    echo "✅ All infrastructure services healthy."
    break
  fi
  if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo "⚠️  Timed out waiting for services. Check: docker compose ps"
    break
  fi
  sleep 3
  ELAPSED=$((ELAPSED + 3))
  echo -n "."
done
echo ""

# ── 4. Start the AutoOps AI app ─────────────────────────────
echo "→ Starting AutoOps AI server (npm run dev)..."
echo "   Dashboard will be available at: ${DASHBOARD_URL}"
echo ""
echo "   Press Ctrl+C to stop."
echo ""
npm run dev
