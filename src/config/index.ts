import dotenv from "dotenv";
dotenv.config();

export const config = {
    server: {
        port: parseInt(process.env.PORT || "3000"),
        host: process.env.HOST || "0.0.0.0",
        env: process.env.NODE_ENV || "development",
    },
    groq: {
        apiKey: process.env.GROQ_API_KEY || "",
        model: "llama-3.3-70b-versatile",
        temperature: 0.1,
        maxTokens: 2048,
    },
    postgres: {
        host: process.env.POSTGRES_HOST || "localhost",
        port: parseInt(process.env.POSTGRES_PORT || "5432"),
        database: process.env.POSTGRES_DB || "autoops",
        user: process.env.POSTGRES_USER || "autoops",
        password: process.env.POSTGRES_PASSWORD || "autoops_secret",
    },
    kafka: {
        brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
        clientId: process.env.KAFKA_CLIENT_ID || "autoops-ai",
        groupId: process.env.KAFKA_GROUP_ID || "autoops-agents",
        topics: {
            rawEvents: "autoops.raw-events",
            agentResults: "autoops.agent-results",
        },
    },
    chroma: {
        host: process.env.CHROMA_HOST || "localhost",
        port: parseInt(process.env.CHROMA_PORT || "8000"),
        collectionName: "incident_history",
    },
    agents: {
        anomalyThreshold: parseFloat(process.env.ANOMALY_THRESHOLD || "0.7"),
        maxRetries: parseInt(process.env.MAX_RETRIES || "3"),
        executionMode: (process.env.EXECUTION_MODE || "simulate") as "simulate" | "live",
    },
    logLevel: process.env.LOG_LEVEL || "info",
};
