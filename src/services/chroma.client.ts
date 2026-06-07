/**
 * AutoOps AI — In-Process Vector Store
 * Replaces ChromaDB server with TF-IDF cosine similarity — no Docker, no downloads.
 * Stores incident embeddings in memory; survives for the lifetime of the process.
 */
import { createChildLogger } from "../utils/logger";

const log = createChildLogger("VectorStore");

interface VectorDoc {
    id: string;
    document: string;
    metadata: Record<string, any>;
    tokens: string[];
}

const store: VectorDoc[] = [];

// ── Text processing ────────────────────────────────

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9_\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 1);
}

function termFreq(tokens: string[]): Map<string, number> {
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    const len = tokens.length || 1;
    for (const [t, c] of tf) tf.set(t, c / len);
    return tf;
}

function inverseDocFreq(): Map<string, number> {
    const N = store.length + 1;
    const df = new Map<string, number>();
    for (const doc of store) {
        for (const t of new Set(doc.tokens)) {
            df.set(t, (df.get(t) || 0) + 1);
        }
    }
    const idf = new Map<string, number>();
    for (const [t, count] of df) {
        idf.set(t, Math.log((N + 1) / (count + 1)) + 1);
    }
    return idf;
}

function tfidfVector(tokens: string[], idf: Map<string, number>): Map<string, number> {
    const tf = termFreq(tokens);
    const vec = new Map<string, number>();
    for (const [t, tfScore] of tf) {
        vec.set(t, tfScore * (idf.get(t) || 1));
    }
    return vec;
}

function cosineSim(a: Map<string, number>, b: Map<string, number>): number {
    let dot = 0, magA = 0, magB = 0;
    for (const [t, s] of a) {
        magA += s * s;
        if (b.has(t)) dot += s * b.get(t)!;
    }
    for (const [, s] of b) magB += s * s;
    if (!magA || !magB) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ── Public API ─────────────────────────────────────

export async function getChromaCollection(): Promise<any> {
    return { size: store.length };
}

export async function storeIncident(
    incidentId: string,
    description: string,
    metadata: Record<string, any>
): Promise<void> {
    // Avoid duplicates
    if (store.find((d) => d.id === incidentId)) return;
    store.push({ id: incidentId, document: description, metadata, tokens: tokenize(description) });
    log.info({ incidentId, totalDocs: store.length }, "Incident stored in vector store");
}

export function getVectorStoreSnapshot() {
    return store.map((d) => ({
        id: d.id,
        document: d.document,
        metadata: d.metadata,
        tokenCount: d.tokens.length,
    }));
}

export async function querySimilarIncidents(
    queryText: string,
    topK: number = 5
): Promise<Array<{ id: string; document: string; metadata: Record<string, any>; distance: number }>> {
    if (store.length === 0) return [];

    const idf = inverseDocFreq();
    const queryVec = tfidfVector(tokenize(queryText), idf);

    const results = store
        .map((doc) => ({
            id: doc.id,
            document: doc.document,
            metadata: doc.metadata,
            distance: 1 - cosineSim(queryVec, tfidfVector(doc.tokens, idf)),
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, topK);

    log.info({ queryText: queryText.slice(0, 60), results: results.length, topDistance: results[0]?.distance.toFixed(3) }, "Vector query complete");
    return results;
}
