/**
 * AutoOps AI — In-Process Event Bus (Kafka replacement)
 * Emulates Kafka producer/consumer API using Node.js EventEmitter.
 * No broker, no Docker, no Java — works entirely in-process.
 *
 * External Kafka is attempted first; falls back to this bus automatically.
 */
import { EventEmitter } from "events";
import { createChildLogger } from "../utils/logger";
import { RawEvent } from "../orchestrator/state";

const log = createChildLogger("EventBus");

// ── Singleton in-process bus ──────────────────────
const bus = new EventEmitter();
bus.setMaxListeners(20);

let busHandler: ((events: RawEvent[]) => Promise<void>) | null = null;
let busActive = false;

// ── Public API (mirrors kafka.service shape) ──────

export async function connectProducer(): Promise<any> {
    return { connected: true };
}

export async function publishEvents(
    topic: string,
    events: RawEvent[]
): Promise<void> {
    if (busActive) {
        bus.emit(topic, events);
        log.info({ topic, count: events.length }, "Events published to in-process bus");
    }
}

export async function connectConsumer(): Promise<any> {
    return { connected: true };
}

export async function subscribeAndConsume(
    topic: string,
    handler: (events: RawEvent[]) => Promise<void>,
    _batchSize: number = 50
): Promise<void> {
    busHandler = handler;
    busActive = true;

    bus.on(topic, async (events: RawEvent[]) => {
        log.info({ topic, count: events.length }, "In-process bus: processing event batch");
        try {
            await handler(events);
        } catch (err: any) {
            log.error({ err: err.message }, "Error processing event batch from bus");
        }
    });

    log.info({ topic }, "✅ In-process event bus active (Kafka replacement — no Docker required)");
}

export async function disconnectKafka(): Promise<void> {
    bus.removeAllListeners();
    busActive = false;
    log.info("In-process event bus disconnected");
}

// ── Export bus so server.ts can publish simulate events through it ──
export { bus, busActive };
