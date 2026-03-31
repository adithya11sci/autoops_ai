import pino from "pino";
import { config } from "../config";

export const logger = pino({
    level: config.logLevel,
    transport:
        config.server.env === "development"
            ? { target: "pino-pretty", options: { colorize: true } }
            : undefined,
});

export function createChildLogger(name: string) {
    return logger.child({ agent: name });
}
