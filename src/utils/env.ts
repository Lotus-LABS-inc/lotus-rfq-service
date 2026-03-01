import { z } from "zod";

const nodeEnvSchema = z.enum(["development", "test", "production"]);
const logLevelSchema = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

const envSchema = z
  .object({
    NODE_ENV: nodeEnvSchema.default("development"),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: logLevelSchema.default("info"),
    REDIS_URL: z.string().url(),
    CANONICAL_SERVICE_BASE_URL: z.string().url().default("http://localhost:4001"),
    DATABASE_URL: z.string().url().optional(),
    SUPABASE_DB_URL: z.string().url().optional(),
    JWT_SECRET: z.string().min(32),
    RELIABILITY_WEIGHT: z.coerce.number().min(0).max(1).default(0.05),
    LATENCY_WEIGHT: z.coerce.number().min(0).max(1).default(0.03),
    FAILURE_WEIGHT: z.coerce.number().min(0).max(1).default(0.08)
  })
  .superRefine((value, ctx) => {
    if (!value.DATABASE_URL && !value.SUPABASE_DB_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DATABASE_URL"],
        message: "Either DATABASE_URL or SUPABASE_DB_URL must be provided."
      });
    }
  });

export type EnvConfig = Readonly<z.infer<typeof envSchema> & { DATABASE_URL: string }>;

export const resolveDatabaseUrl = (env: z.infer<typeof envSchema>): string => {
  const databaseUrl = env.DATABASE_URL ?? env.SUPABASE_DB_URL;

  if (!databaseUrl) {
    throw new Error("Either DATABASE_URL or SUPABASE_DB_URL must be provided.");
  }

  return databaseUrl;
};

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): EnvConfig => {
  const parsed = envSchema.parse(source);

  return Object.freeze({
    ...parsed,
    DATABASE_URL: resolveDatabaseUrl(parsed)
  });
};
