import { startCollector } from './log-collector';
import { startObserver } from './results-observer';
import { spawn } from 'child_process';
import http from 'http';

function checkHealth(): Promise<boolean> {
    return new Promise((resolve) => {
        const req = http.get('http://127.0.0.1:3000/api/health', (res) => {
            resolve(res.statusCode === 200);
        });
        req.on('error', () => {
            resolve(false);
        });
        req.end();
    });
}

async function waitForHealthCheck(maxRetries = 60) {
    console.log("Waiting for API health check (localhost:3000/api/health)...");
    for (let i = 0; i < maxRetries; i++) {
        const isHealthy = await checkHealth();
        if (isHealthy) {
            console.log("API is healthy! Proceeding...");
            return;
        }
        process.stdout.write(".");
        await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("Timeout waiting for API health check after 60 seconds");
}

async function main() {
    console.log("====== BEGINNING ENTERPRISE AUTOOPS SIMULATION ======");
    await waitForHealthCheck();

    console.log("-> Starting Local Docker Environments...");
    
    // Bring down previous instances just in case
    spawn('docker', ['compose', '-f', 'simulation/docker-compose.sim.yml', 'down'], { stdio: 'inherit', shell: true }).on('close', async () => {
        // Start containers
        const docker = spawn('docker', ['compose', '-f', 'simulation/docker-compose.sim.yml', 'up', '--build', '--force-recreate'], { shell: true });
        docker.stdout.on('data', d => process.stdout.write(d));
        docker.stderr.on('data', d => process.stderr.write(d));

        console.log("-> Starting Results Observer...");
        await startObserver();

        console.log("-> Starting Log Collector...");
        startCollector();

        // Chain the other tests
        setTimeout(() => {
            console.log("-> Triggering High-Risk Test...");
            spawn('npx', ['tsx', 'simulation/high-risk-test.ts'], { stdio: 'inherit', shell: true });
        }, 10000);

        setTimeout(() => {
            console.log("-> Triggering Blocked Command Test...");
            spawn('npx', ['tsx', 'simulation/blocked-command-test.ts'], { stdio: 'inherit', shell: true });
        }, 15000);
    });
}

main().catch(console.error);