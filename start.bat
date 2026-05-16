@echo off
:: AutoOps AI — Enterprise one-command startup (Windows)
setlocal EnableDelayedExpansion

set DASHBOARD_URL=http://localhost:3000

echo ╔══════════════════════════════════════════════╗
echo ║   AutoOps AI — Enterprise Startup           ║
echo ╚══════════════════════════════════════════════╝
echo.

:: ── 1. Install Node dependencies if needed ──────────────────
if not exist "node_modules\" (
    echo ^>^> Installing Node dependencies...
    call npm install
    if errorlevel 1 ( echo ERROR: npm install failed & exit /b 1 )
)

:: ── 2. Start infrastructure via Docker Compose ──────────────
echo ^>^> Starting infrastructure (Postgres, Kafka, ChromaDB, Redis)...
docker compose up -d postgres kafka chromadb redis
if errorlevel 1 ( echo ERROR: docker compose failed. Is Docker Desktop running? & exit /b 1 )

:: ── 3. Wait for all infrastructure health checks ────────────
echo ^>^> Waiting for services to become healthy (up to 120s)...
set ELAPSED=0
:WAIT_LOOP
if %ELAPSED% GEQ 120 (
    echo WARNING: Timed out waiting for services. Continuing anyway...
    goto START_APP
)

set UNHEALTHY=0
for %%S in (postgres kafka chromadb redis) do (
    for /f "delims=" %%H in ('docker inspect --format "{{.State.Health.Status}}" autoops-%%S 2^>nul') do (
        if not "%%H"=="healthy" set UNHEALTHY=1
    )
)
if %UNHEALTHY%==0 (
    echo.
    echo ^>^> All infrastructure services healthy.
    goto START_APP
)

timeout /t 3 /nobreak >nul
set /a ELAPSED+=3
set /p =.< nul
goto WAIT_LOOP

:START_APP
echo.
echo ^>^> Starting AutoOps AI server...
echo    Dashboard: %DASHBOARD_URL%
echo    Press Ctrl+C to stop.
echo.
call npm run dev
