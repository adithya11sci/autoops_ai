/**
 * Kafka Service — Producer and Consumer for high-volume event streaming.
 */
import { Kafka, Producer, Consumer, EachMessagePayload } from "kafkajs";
import { config } from "../config";
import { createChildLogger } from "../utils/logger";
import { RawEvent } from "../orchestrator/state";

const log = createChildLogger("KafkaService");

let kafka: Kafka | null = null;
let producer: Producer | null = null;
let consumer: Consumer | null = null;

function getKafka(): Kafka {
    if (!kafka) {
        kafka = new Kafka({
            clientId: config.kafka.clientId,
            brokers: config.kafka.brokers,
            retry: { retries: 5, initialRetryTime: 300 },
        });
    }
    return kafka;
}

// ── Producer ──────────────────────────────────────

export async function connectProducer(): Promise<Producer> {
    if (producer) return producer;
    producer = getKafka().producer();
    await producer.connect();
    log.info("Kafka producer connected");
    return producer;
}

export async function publishEvents(
    topic: string,
    events: RawEvent[]
): Promise<void> {
    const prod = await connectProducer();
    const messages = events.map((event) => ({
        key: event.source.service,
        value: JSON.stringify(event),
        timestamp: new Date().getTime().toString(),
    }));

    await prod.send({ topic, messages });
    log.info({ topic, count: events.length }, "Events published to Kafka");
}

// ── Consumer ──────────────────────────────────────

export async function connectConsumer(): Promise<Consumer> {
    if (consumer) return consumer;
    consumer = getKafka().consumer({ groupId: config.kafka.groupId });
    await consumer.connect();
    log.info("Kafka consumer connected");
    return consumer;
}

export async function subscribeAndConsume(
    topic: string,
    handler: (events: RawEvent[]) => Promise<void>,
    batchSize: number = 50
): Promise<void> {
    const cons = await connectConsumer();
    await cons.subscribe({ topic, fromBeginning: false });

    let buffer: RawEvent[] = [];
    let flushTimer: NodeJS.Timeout | null = null;

    const flush = async () => {
        if (buffer.length === 0) return;
        const batch = buffer.splice(0, buffer.length);
        log.info({ batchSize: batch.length }, "Processing event batch");
        try {
            await handler(batch);
        } catch (err) {
            log.error({ err }, "Error processing event batch");
        }
    };

    await cons.run({
        eachMessage: async ({ message }: EachMessagePayload) => {
            try {
                const event: RawEvent = JSON.parse(message.value?.toString() || "{}");
                buffer.push(event);

                if (buffer.length >= batchSize) {
                    if (flushTimer) clearTimeout(flushTimer);
                    await flush();
                } else if (!flushTimer) {
                    flushTimer = setTimeout(async () => {
                        await flush();
                        flushTimer = null;
                    }, 1000);
                }
            } catch (err) {
                log.error({ err }, "Failed to parse Kafka message");
            }
        },
    });

    log.info({ topic }, "Kafka consumer subscribed and running");
}

// ── Cleanup ───────────────────────────────────────

export async function disconnectKafka(): Promise<void> {
    if (producer) await producer.disconnect();
    if (consumer) await consumer.disconnect();
    log.info("Kafka connections closed");
}
