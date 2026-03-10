import { z } from "zod";

const nodeEnvSchema = z.enum(["development", "test", "production"]);
const logLevelSchema = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);
const optionalIsoDateSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().datetime().optional()
);

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
    COMBO_RFQ_ENABLED: z.coerce.boolean().default(false),
    SOR_ENABLED: z.coerce.boolean().default(false),
    SOR_CANARY_SHADOW_ENABLED: z.coerce.boolean().default(false),
    SOR_CANARY_PERCENT: z.coerce.number().min(0).max(1).default(0),
    SOR_CANARY_START_AT: optionalIsoDateSchema,
    SOR_CANARY_END_AT: optionalIsoDateSchema,
    INTERNAL_CROSS_ENABLED: z.coerce.boolean().default(false),
    INTERNAL_CROSS_SHADOW_ENABLED: z.coerce.boolean().default(false),
    INTERNAL_CROSS_SHADOW_PERCENT: z.coerce.number().min(0).max(1).default(0),
    INTERNAL_CROSS_SHADOW_START_AT: optionalIsoDateSchema,
    INTERNAL_CROSS_SHADOW_END_AT: optionalIsoDateSchema,
    INTERNAL_NETTING_ENABLED: z.coerce.boolean().default(false),
    INTERNAL_NETTING_SHADOW_ENABLED: z.coerce.boolean().default(false),
    INTERNAL_NETTING_SHADOW_PERCENT: z.coerce.number().min(0).max(1).default(0),
    INTERNAL_NETTING_SHADOW_START_AT: optionalIsoDateSchema,
    INTERNAL_NETTING_SHADOW_END_AT: optionalIsoDateSchema,
    INTERNAL_NETTING_CANARY_ENABLED: z.coerce.boolean().default(false),
    INTERNAL_NETTING_CANARY_PERCENT: z.coerce.number().min(0).max(1).default(0),
    INTERNAL_NETTING_CANARY_START_AT: optionalIsoDateSchema,
    INTERNAL_NETTING_CANARY_END_AT: optionalIsoDateSchema,
    SOR_ACCEPT_AON_AWAIT: z.coerce.boolean().default(true),
    SOR_ACCEPT_NON_AON_BACKGROUND: z.coerce.boolean().default(true),
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

    if (value.SOR_CANARY_SHADOW_ENABLED && value.SOR_CANARY_PERCENT <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SOR_CANARY_PERCENT"],
        message: "SOR_CANARY_PERCENT must be > 0 when SOR_CANARY_SHADOW_ENABLED is true."
      });
    }

    if (value.INTERNAL_CROSS_SHADOW_ENABLED && value.INTERNAL_CROSS_SHADOW_PERCENT <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["INTERNAL_CROSS_SHADOW_PERCENT"],
        message: "INTERNAL_CROSS_SHADOW_PERCENT must be > 0 when INTERNAL_CROSS_SHADOW_ENABLED is true."
      });
    }

    if (value.INTERNAL_NETTING_SHADOW_ENABLED && value.INTERNAL_NETTING_SHADOW_PERCENT <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["INTERNAL_NETTING_SHADOW_PERCENT"],
        message: "INTERNAL_NETTING_SHADOW_PERCENT must be > 0 when INTERNAL_NETTING_SHADOW_ENABLED is true."
      });
    }

    if (value.INTERNAL_NETTING_CANARY_ENABLED && value.INTERNAL_NETTING_CANARY_PERCENT <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["INTERNAL_NETTING_CANARY_PERCENT"],
        message: "INTERNAL_NETTING_CANARY_PERCENT must be > 0 when INTERNAL_NETTING_CANARY_ENABLED is true."
      });
    }

    if (value.SOR_CANARY_START_AT && value.SOR_CANARY_END_AT) {
      const start = Date.parse(value.SOR_CANARY_START_AT);
      const end = Date.parse(value.SOR_CANARY_END_AT);
      if (Number.isFinite(start) && Number.isFinite(end) && start >= end) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["SOR_CANARY_END_AT"],
          message: "SOR_CANARY_END_AT must be later than SOR_CANARY_START_AT."
        });
      }
    }

    if (value.INTERNAL_CROSS_SHADOW_START_AT && value.INTERNAL_CROSS_SHADOW_END_AT) {
      const start = Date.parse(value.INTERNAL_CROSS_SHADOW_START_AT);
      const end = Date.parse(value.INTERNAL_CROSS_SHADOW_END_AT);
      if (Number.isFinite(start) && Number.isFinite(end) && start >= end) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["INTERNAL_CROSS_SHADOW_END_AT"],
          message: "INTERNAL_CROSS_SHADOW_END_AT must be later than INTERNAL_CROSS_SHADOW_START_AT."
        });
      }
    }

    if (value.INTERNAL_NETTING_SHADOW_START_AT && value.INTERNAL_NETTING_SHADOW_END_AT) {
      const start = Date.parse(value.INTERNAL_NETTING_SHADOW_START_AT);
      const end = Date.parse(value.INTERNAL_NETTING_SHADOW_END_AT);
      if (Number.isFinite(start) && Number.isFinite(end) && start >= end) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["INTERNAL_NETTING_SHADOW_END_AT"],
          message: "INTERNAL_NETTING_SHADOW_END_AT must be later than INTERNAL_NETTING_SHADOW_START_AT."
        });
      }
    }

    if (value.INTERNAL_NETTING_CANARY_START_AT && value.INTERNAL_NETTING_CANARY_END_AT) {
      const start = Date.parse(value.INTERNAL_NETTING_CANARY_START_AT);
      const end = Date.parse(value.INTERNAL_NETTING_CANARY_END_AT);
      if (Number.isFinite(start) && Number.isFinite(end) && start >= end) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["INTERNAL_NETTING_CANARY_END_AT"],
          message: "INTERNAL_NETTING_CANARY_END_AT must be later than INTERNAL_NETTING_CANARY_START_AT."
        });
      }
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
