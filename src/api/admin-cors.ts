import type { FastifyCorsOptions } from "@fastify/cors";

const DEFAULT_LOCAL_FRONTEND_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"] as const;

export const parseAdminCorsOrigins = (
  value: string | undefined,
  nodeEnv = process.env.NODE_ENV
): string[] => {
  const configuredOrigins = (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (nodeEnv === "production") {
    return configuredOrigins;
  }

  return [...new Set([...configuredOrigins, ...DEFAULT_LOCAL_FRONTEND_ORIGINS])];
};

export const buildAdminCorsOptions = (origins: string[]): FastifyCorsOptions => ({
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    callback(null, origins.includes(origin));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["authorization", "content-type"],
  credentials: false
});
