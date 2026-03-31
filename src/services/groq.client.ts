/**
 * Groq LLM Client — Used by the Planning Agent for remediation plan generation.
 */
import Groq from "groq-sdk";
import { config } from "../config";
import { createChildLogger } from "../utils/logger";

const log = createChildLogger("GroqClient");

let client: Groq | null = null;

export function getGroqClient(): Groq {
    if (!client) {
        if (!config.groq.apiKey) {
            throw new Error("GROQ_API_KEY is not set in environment variables");
        }
        client = new Groq({ apiKey: config.groq.apiKey });
        log.info("Groq client initialized");
    }
    return client;
}

export interface LLMResponse {
    content: string;
    model: string;
    tokensUsed: number;
    latencyMs: number;
}

/**
 * Send a prompt to the Groq LLM and return structured response.
 */
export async function queryLLM(
    systemPrompt: string,
    userPrompt: string
): Promise<LLMResponse> {
    const groq = getGroqClient();
    const start = Date.now();

    log.info({ promptLength: userPrompt.length }, "Sending request to Groq LLM");

    const completion = await groq.chat.completions.create({
        model: config.groq.model,
        temperature: config.groq.temperature,
        max_tokens: config.groq.maxTokens,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
    });

    const latencyMs = Date.now() - start;
    const content = completion.choices[0]?.message?.content || "{}";
    const tokensUsed = completion.usage?.total_tokens || 0;

    log.info({ latencyMs, tokensUsed }, "Groq LLM response received");

    return {
        content,
        model: config.groq.model,
        tokensUsed,
        latencyMs,
    };
}
