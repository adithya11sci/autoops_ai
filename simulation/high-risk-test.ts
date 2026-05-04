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

export async function runHighRiskTest() {
    await waitForHealthCheck();
    console.log("Simulating HIGH RISK administrative command execution...");
    const event: RawEvent = {
        eventId: uuidv4(),
        timestamp: new Date().toISOString(),
        source: {
            type: 'kubernetes',
            service: 'db-service-master',
        },
        eventType: 'DROP_TABLE',
        severity: 'critical',
        data: { message: 'Executed user query: DROP TABLE production_users;' }
    };
    
    await publishEvents(config.kafka.topics.rawEvents || "autoops.raw-events", [event]);
    console.log("Published high-risk dataset deletion event.");
    
    // Also push to API manually as requested
    const postReq = http.request('http://127.0.0.1:3000/api/incidents/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    });
    postReq.write(JSON.stringify({ events: [event] }));
    postReq.end();
    console.log("Pushed to API manually.");
}

if (require.main === module) runHighRiskTest().catch(console.error);