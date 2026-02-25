import pino, { type Logger } from "pino";

export type LoggerLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

export const createLogger = (level: LoggerLevel): Logger => pino({ level });

export const logger = createLogger((process.env.LOG_LEVEL as LoggerLevel | undefined) ?? "info");
