/**
 * AutoOps AI — Vercel serverless entry point.
 *
 * Vercel maps this catch-all to every /api/* request. The dashboard itself is
 * served straight from public/ by the platform, so this function only handles API
 * traffic. The Fastify app is built once per warm instance and each request is
 * replayed into its underlying Node http server.
 *
 * Known serverless limitations (see VERCEL_DEPLOY.md):
 *   - No WebSocket. /api/simulate runs the pipeline inline and returns a transcript.
 *   - In-memory state (incidents, vector store, cache) resets on cold start.
 *   - The human approval gate escalates instead of waiting for an operator.
 */
import type { IncomingMessage, ServerResponse } from "http";
import type { FastifyInstance } from "fastify";
import { createServer } from "../src/api/server";

// Cached across warm invocations — building the app per request would re-register
// every plugin and route on each call.
let appPromise: Promise<FastifyInstance> | null = null;

function getApp(): Promise<FastifyInstance> {
    if (!appPromise) {
        appPromise = (async () => {
            const app = await createServer();
            await app.ready();
            return app;
        })().catch((err) => {
            // Don't cache a failed boot; the next invocation gets a clean retry.
            appPromise = null;
            throw err;
        });
    }
    return appPromise;
}

export default async function handler(
    req: IncomingMessage,
    res: ServerResponse
): Promise<void> {
    try {
        const app = await getApp();
        app.server.emit("request", req, res);
    } catch (err: any) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "Server initialization failed", detail: err?.message }));
    }
}
