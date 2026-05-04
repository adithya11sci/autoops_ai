import { subscribeAndConsume } from '../src/services/kafka.service';
import { config } from '../src/config';

export async function startObserver() {
    console.log("Starting Results Observer on topic:", config.kafka.topics.agentResults);
    await subscribeAndConsume(config.kafka.topics.agentResults || "autoops.agent-results", async (events) => {
        for (const event of events) {
            console.log("\n==================================");
            console.log("      🔔 NEW INCIDENT OUTCOME      ");
            console.log("==================================");
            console.log(JSON.stringify(event, null, 2));
            console.log("==================================\n");
        }
    });
}

if (require.main === module) {
    startObserver().catch(console.error);
}