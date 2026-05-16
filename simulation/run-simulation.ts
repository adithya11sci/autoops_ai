import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import { startCollector } from './log-collector';
import { startObserver } from './results-observer';

const API_BASE = 'http://127.0.0.1:3000';

function httpGet(path: string): Promise<number | null> {
    return new Promise((resolve) => {
        const req = http.get(`${API_BASE}${path}`, (res) => resolve(res.statusCode ?? null));
        req.on('error', () => resolve(null));
        req.end();
    });
}

async function waitForApi(maxRetries = 60): Promise<void> {
    console.log('Waiting for AutoOps AI API at', `${API_BASE}/api/health`, '...');
    for (let i = 0; i < maxRetries; i++) {
        const status = await httpGet('/api/health');
        if (status === 200) {
            console.log('✅ API is healthy — proceeding.\n');
            return;
        }
        process.stdout.write('.');
        await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`API not reachable after ${maxRetries}s. Start the server first:\n  npm run dev`);
}

function spawnDetached(cmd: string, args: string[]): ChildProcess {
    const proc = spawn(cmd, args, { stdio: 'inherit', shell: true });
    proc.on('error', (e) => console.error(`[spawn error] ${cmd}:`, e.message));
    return proc;
}

async function bringUpSimContainers(): Promise<void> {
    console.log('→ Stopping any previous sim containers...');
    await new Promise<void>((resolve) => {
        const down = spawn(
            'docker',
            ['compose', '-f', 'simulation/docker-compose.sim.yml', 'down', '--remove-orphans'],
            { stdio: 'inherit', shell: true }
        );
        down.on('close', () => resolve());
        down.on('error', () => resolve());
    });

    console.log('→ Starting simulated microservices (crash / memory-leak / slow)...');
    spawnDetached('docker', [
        'compose', '-f', 'simulation/docker-compose.sim.yml',
        'up', '--build', '--force-recreate',
    ]);
    // Give containers a moment to start emitting logs
    await new Promise((r) => setTimeout(r, 3000));
}

async function runScenario(script: string, label: string): Promise<void> {
    console.log(`\n→ ${label}`);
    await new Promise<void>((resolve, reject) => {
        const proc = spawn('npx', ['tsx', script], { stdio: 'inherit', shell: true });
        proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))));
        proc.on('error', reject);
    });
}

async function main() {
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║   AutoOps AI — Enterprise Simulation Suite  ║');
    console.log('╚══════════════════════════════════════════════╝\n');

    await waitForApi();

    // Start Docker sim containers (non-blocking — they emit logs that log-collector forwards)
    await bringUpSimContainers();

    // Start log collector (Docker container logs → AutoOps AI pipeline)
    console.log('→ Starting log collector (Docker → AutoOps AI)...');
    startCollector();

    // Start results observer (polls /api/incidents, prints outcomes to console)
    console.log('→ Starting results observer (polling /api/incidents)...\n');
    const observerPromise = startObserver(90_000);

    // Run the three demo scenarios with staggered delays
    await new Promise((r) => setTimeout(r, 5000));
    await runScenario('simulation/high-risk-test.ts', 'Scenario 1: High-Risk Administrative Command');

    await new Promise((r) => setTimeout(r, 8000));
    await runScenario('simulation/blocked-command-test.ts', 'Scenario 2: Blocked Command Security Alert');

    // Wait for observer to finish printing results
    await observerPromise;

    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║   Simulation complete.                       ║');
    console.log(`║   Dashboard → http://localhost:3000           ║`);
    console.log('╚══════════════════════════════════════════════╝\n');

    // Tear down sim containers
    spawn('docker', ['compose', '-f', 'simulation/docker-compose.sim.yml', 'down'], {
        stdio: 'ignore', shell: true,
    });

    process.exit(0);
}

main().catch((err) => {
    console.error('\n❌ Simulation failed:', err.message);
    process.exit(1);
});
