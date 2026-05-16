import http from 'http';

const API_BASE = 'http://127.0.0.1:3000';

function httpGet(path: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const req = http.get(`${API_BASE}${path}`, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch { resolve(null); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

export async function startObserver(durationMs = 120_000): Promise<void> {
    console.log('Starting Results Observer (HTTP polling /api/incidents)...');
    const seen = new Set<string>();
    const deadline = Date.now() + durationMs;

    return new Promise((resolve) => {
        const interval = setInterval(async () => {
            try {
                const data = await httpGet('/api/incidents?limit=50');
                const incidents: any[] = data?.incidents ?? [];

                for (const inc of incidents) {
                    const id = inc.incidentId || inc.id;
                    if (!id || seen.has(id)) continue;
                    if (!inc.outcome) continue; // still running
                    seen.add(id);

                    console.log('\n==================================');
                    console.log('      🔔 NEW INCIDENT OUTCOME      ');
                    console.log('==================================');
                    console.log(`  ID:       ${id}`);
                    console.log(`  Outcome:  ${(inc.outcome || '—').toUpperCase()}`);
                    console.log(`  Service:  ${inc.rootCauseService || inc.root_cause_service || '—'}`);
                    console.log(`  Severity: ${inc.severity || '—'}`);
                    console.log(`  MTTR:     ${inc.durationSeconds ?? inc.duration_seconds ?? '—'}s`);
                    console.log('==================================\n');
                }
            } catch { /* API not ready yet — keep polling */ }

            if (Date.now() >= deadline) {
                clearInterval(interval);
                resolve();
            }
        }, 2000);
    });
}

if (require.main === module) {
    startObserver().catch(console.error);
}
