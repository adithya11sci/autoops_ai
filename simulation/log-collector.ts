import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { publishEvents } from '../src/services/kafka.service';
import { RawEvent } from '../src/orchestrator/state';
import { config } from '../src/config';

export function startCollector() {
    console.log("Starting Docker log collector...");
    // -f = follow, --no-log-prefix to simplify parsing.
    const proc = spawn('docker', ['compose', '-f', 'simulation/docker-compose.sim.yml', 'logs', '-f', '--no-color'], { shell: true });
    
    proc.stdout.on('data', async (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        const events: RawEvent[] = [];

        for (const line of lines) {
            // Logs look like: `crash-service-1  | Starting crash-service...`
            const match = line.match(/^([^\|\s]+)\s+\|\s+(.*)$/);
            if (!match) continue;
            
            const service = match[1];
            const message = match[2];
            
            // Determine severity quickly
            let severity: RawEvent['severity'] = 'info';
            if (message.includes('FATAL') || message.includes('Error')) severity = 'critical';
            else if (message.includes('WARN')) severity = 'medium';
            else if (message.includes('OOMKilled')) severity = 'high';
            
            const event: RawEvent = {
                eventId: uuidv4(),
                timestamp: new Date().toISOString(),
                source: {
                    type: 'docker',
                    service: service.replace(/-1$/, ''), // remove trailing instance id
                },
                eventType: 'log_entry',
                severity,
                data: { message }
            };
            events.push(event);
        }

        if (events.length > 0) {
            try {
                await publishEvents(config.kafka.topics.rawEvents || "autoops.raw-events", events);
            } catch (e) {
                console.error("Collector failed to publish events:", e);
            }
        }
    });

    proc.stderr.on('data', (data) => {
        console.error(`Collector Error: ${data}`);
    });
    
    return proc;
}

if (require.main === module) {
    startCollector();
}