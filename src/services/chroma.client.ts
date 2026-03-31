/**
 * ChromaDB Client — Vector store for RAG-based incident retrieval.
 * Used by Planning Agent to find similar past incidents.
 */
import { ChromaClient, Collection } from "chromadb";
import { config } from "../config";
import { createChildLogger } from "../utils/logger";

const log = createChildLogger("ChromaClient");

let chromaClient: ChromaClient | null = null;
let collection: Collection | null = null;

export async function getChromaCollection(): Promise<Collection> {
    if (collection) return collection;

    chromaClient = new ChromaClient({
        path: `http://${config.chroma.host}:${config.chroma.port}`,
    });

    collection = await chromaClient.getOrCreateCollection({
        name: config.chroma.collectionName,
        metadata: { description: "AutoOps AI incident history for RAG" },
    });

    log.info(
        { collection: config.chroma.collectionName },
        "ChromaDB collection ready"
    );
    return collection;
}

/**
 * Store a resolved incident for future RAG retrieval.
 */
export async function storeIncident(
    incidentId: string,
    description: string,
    metadata: Record<string, any>
): Promise<void> {
    const coll = await getChromaCollection();

    // Sanitize metadata — ChromaDB only accepts string, number, boolean
    const sanitized: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(metadata)) {
        if (
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean"
        ) {
            sanitized[key] = value;
        } else if (value !== null && value !== undefined) {
            sanitized[key] = JSON.stringify(value);
        }
    }

    await coll.add({
        ids: [incidentId],
        documents: [description],
        metadatas: [sanitized],
    });

    log.info({ incidentId }, "Incident stored in ChromaDB");
}

/**
 * Query similar past incidents for RAG context.
 */
export async function querySimilarIncidents(
    queryText: string,
    topK: number = 5
): Promise<
    Array<{ id: string; document: string; metadata: Record<string, any>; distance: number }>
> {
    const coll = await getChromaCollection();

    const results = await coll.query({
        queryTexts: [queryText],
        nResults: topK,
    });

    if (!results.ids[0] || results.ids[0].length === 0) {
        log.info("No similar incidents found in ChromaDB");
        return [];
    }

    const incidents = results.ids[0].map((id, idx) => ({
        id,
        document: results.documents[0]?.[idx] || "",
        metadata: (results.metadatas[0]?.[idx] as Record<string, any>) || {},
        distance: results.distances?.[0]?.[idx] || 0,
    }));

    log.info(
        { count: incidents.length, topDistance: incidents[0]?.distance },
        "Similar incidents retrieved"
    );

    return incidents;
}
