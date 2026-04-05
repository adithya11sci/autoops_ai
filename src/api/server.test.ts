import { describe, it, expect, vi } from "vitest";
import { createServer } from "./server";

describe("API Server", () => {
    it("should return healthy status from /api/health", async () => {
        const app = await createServer();
        const response = await app.inject({
            method: "GET",
            url: "/api/health"
        });

        expect(response.statusCode).toBe(200);
        const payload = JSON.parse(response.payload);
        expect(payload.status).toBe("healthy");
        expect(payload.services.api).toBe("running");
        
        await app.close();
    });
});
