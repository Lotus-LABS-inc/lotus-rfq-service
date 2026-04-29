import type { FastifyCorsOptions } from "@fastify/cors";

export const parseAdminCorsOrigins = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

export const buildAdminCorsOptions = (origins: string[]): FastifyCorsOptions => ({
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    callback(null, origins.includes(origin));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["authorization", "content-type"],
  credentials: false
});
