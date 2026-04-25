import pino, { type Logger } from "pino";

type LoggerLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

export const createLogger = (level: LoggerLevel): Logger => pino({ level });
