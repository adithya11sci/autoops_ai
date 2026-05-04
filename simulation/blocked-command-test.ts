import { publishEvents } from '../src/services/kafka.service';
import { config } from '../src/config';
import { v4 as uuidv4 } from 'uuid';
import { RawEvent } from '../src/orchestrator/state';
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
    console.log("Waiting for API health check...");
    for (let i = 0; i < maxRetries; i++) {
        if (await checkHealth()) return;
        await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("Timeout");
}

export async function runBlockedCommandTest() {
    await waitForHealthCheck();
    console.log("Simulating BLOCKED COMMAND security alert...");
    const event: RawEvent = {
        eventId: uuidv4(),
        timestamp: new Date().toISOString(),
        source: {
            type: 'kubernetes',
            service: 'bash-exec',
        },
        eventType: 'COMMAND_EXECUTION',
        severity: 'critical',
        data: { message: 'rm -rf /*' }
    };
    
    await publishEvents(config.kafka.topics.rawEvents || "autoops.raw-events", [event]);
    console.log("Published blocked command execution attempt.");

    // Also push to API manually as requested
    const postReq = http.request('http://127.0.0.1:3000/api/incidents/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    });
    postReq.write(JSON.stringify({ events: [event] }));
    postReq.end();
    console.log("Pushed to API manually.");
}

if (require.main === module) runBlockedCommandTest().catch(console.error);