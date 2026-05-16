/**
 * ChromaDB Client — In-memory fallback (no ChromaDB / Docker required).
 * Stores incidents in-process; querySimilarIncidents always returns empty
 * so the planning agent generates fresh plans via Groq on every incident.
 */
import { createChildLogger } from "../utils/logger";

const log = createChildLogger("ChromaClient");

const inMemoryDocs: Array<{
    id: string;
    document: string;
    metadata: Record<string, any>;
}> = [];

export async function getChromaCollection(): Promise<any> {
    return null;
}

export async function storeIncident(
    incidentId: string,
    description: string,
    metadata: Record<string, any>
): Promise<void> {
    inMemoryDocs.push({ id: incidentId, document: description, metadata });
    log.info({ incidentId }, "Incident stored in memory (ChromaDB not available — no-Docker mode)");
}

export async function querySimilarIncidents(
    _queryText: string,
    _topK: number = 5
): Promise<Array<{ id: string; document: string; metadata: Record<string, any>; distance: number }>> {
    // No vector DB available — return empty so planning agent always uses Groq
    return [];
}
