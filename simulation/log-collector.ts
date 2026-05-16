import { spawn } from 'child_process';
import http from 'http';
import { v4 as uuidv4 } from 'uuid';
import { publishEvents } from '../src/services/kafka.service';
import { RawEvent } from '../src/orchestrator/state';
import { config } from '../src/config';

const API_BASE = 'http://127.0.0.1:3000';

function httpTrigger(events: RawEvent[]): Promise<void> {
    return new Promise((resolve) => {
        const body = JSON.stringify({ events });
        const req = http.request(`${API_BASE}/api/incidents/trigger`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        }, () => resolve());
        req.on('error', (e) => {
            console.error('HTTP fallback error:', e.message);
            resolve();
        });
        req.write(body);
        req.end();
    });
}

async function publishWithFallback(events: RawEvent[]): Promise<void> {
    try {
        await publishEvents(config.kafka.topics.rawEvents, events);
    } catch {
        // Kafka unavailable — fall back to HTTP API
        await httpTrigger(events);
    }
}

export function startCollector() {
    console.log('Starting Docker log collector...');
    const proc = spawn(
        'docker',
        ['compose', '-f', 'simulation/docker-compose.sim.yml', 'logs', '-f', '--no-color'],
        { shell: true }
    );

    proc.stdout.on('data', async (data: Buffer) => {
        const lines = data.toString().split('\n').filter(Boolean);
        const events: RawEvent[] = [];

        for (const line of lines) {
            // Log lines: `crash-service-1  | Starting crash-service...`
            const match = line.match(/^([^|\s]+)\s+\|\s+(.*)$/);
            if (!match) continue;

            const service = match[1].replace(/-\d+$/, '');
            const message = match[2];

            let severity: RawEvent['severity'] = 'info';
            if (message.includes('FATAL') || message.includes('Error')) severity = 'critical';
            else if (message.includes('WARN')) severity = 'medium';
            else if (message.includes('OOMKilled')) severity = 'high';

            events.push({
                eventId: uuidv4(),
                timestamp: new Date().toISOString(),
                source: { type: 'docker', service },
                eventType: 'log_entry',
                severity,
                data: { message },
            });
        }

        if (events.length > 0) {
            await publishWithFallback(events);
        }
    });

    proc.stderr.on('data', (data: Buffer) => {
        console.error('Collector Error:', data.toString());
    });

    return proc;
}

if (require.main === module) {
    startCollector();
}
