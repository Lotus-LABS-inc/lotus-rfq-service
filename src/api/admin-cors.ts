import type { FastifyCorsOptions } from "@fastify/cors";

const DEFAULT_DEPLOYED_FRONTEND_ORIGINS = [
  "https://app.uselotus.xyz",
  "https://staging.uselotus.xyz",
  "https://admin.uselotus.xyz"
] as const;
const DEFAULT_LOCAL_FRONTEND_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"] as const;

export const parseAdminCorsOrigins = (
  value: string | undefined,
  nodeEnv = process.env.NODE_ENV
): string[] => {
  const configuredOrigins = (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  const defaults = nodeEnv === "production"
    ? DEFAULT_DEPLOYED_FRONTEND_ORIGINS
    : [...DEFAULT_DEPLOYED_FRONTEND_ORIGINS, ...DEFAULT_LOCAL_FRONTEND_ORIGINS];

  return [...new Set([...configuredOrigins, ...defaults])];
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
