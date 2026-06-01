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
    LOTUS_SERVICE_MODE: z.string().default("api"),
    LOTUS_ENV: z.string().optional(),
    LOTUS_DEPLOY_ENV: z.string().optional(),
    APP_ENV: z.string().optional(),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: logLevelSchema.default("info"),
    REDIS_URL: z.string().url(),
    CANONICAL_SERVICE_BASE_URL: z.string().url().default("http://localhost:4001"),
    DATABASE_URL: z.string().url().optional(),
    TEST_DATABASE_URL: z.string().url().optional(),
    SUPABASE_DB_URL: z.string().url().optional(),
    JWT_SECRET: z.string().min(32),
    USER_JWT_TTL_SECONDS: z.coerce.number().int().min(300).max(2592000).default(86400),
    ADMIN_CORS_ORIGINS: z.string().optional(),
    ADMIN_ALLOWED_EMAIL_DOMAINS: z.string().optional(),
    ADMIN_AUTH_KEY_PEPPER: z.string().optional(),
    ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),
    ADMIN_JWT_TTL_SECONDS: z.coerce.number().int().min(300).max(86400).default(3600),
    ADMIN_EMAIL_PROVIDER: z.enum(["RESEND"]).optional(),
    RESEND_API_KEY: z.string().optional(),
    ADMIN_EMAIL_FROM: z.string().optional(),
    ADMIN_FRONTEND_BASE_URL: z.string().url().optional(),
    ADMIN_MAGIC_LINK_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    ADMIN_LOGIN_LINK_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
    ADMIN_LOGIN_LINK_RATE_LIMIT_MAX_PER_EMAIL: z.coerce.number().int().min(1).max(1000).default(3),
    ADMIN_LOGIN_LINK_RATE_LIMIT_MAX_PER_IP: z.coerce.number().int().min(1).max(10000).default(20),
    ADMIN_MANUAL_LOGIN_RATE_LIMIT_MAX_PER_EMAIL: z.coerce.number().int().min(1).max(1000).default(5),
    ADMIN_MANUAL_LOGIN_RATE_LIMIT_MAX_PER_IP: z.coerce.number().int().min(1).max(10000).default(30),
    FUNDING_INTENT_CREATE_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(60).max(86400).default(300),
    FUNDING_INTENT_CREATE_RATE_LIMIT_MAX_PER_USER: z.coerce.number().int().min(1).max(1000).default(4),
    FUNDING_INTENT_CREATE_RATE_LIMIT_MAX_PER_IP: z.coerce.number().int().min(1).max(10000).default(20),
    WITHDRAWAL_INTENT_CREATE_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(60).max(86400).default(300),
    WITHDRAWAL_INTENT_CREATE_RATE_LIMIT_MAX_PER_USER: z.coerce.number().int().min(1).max(1000).default(4),
    WITHDRAWAL_INTENT_CREATE_RATE_LIMIT_MAX_PER_IP: z.coerce.number().int().min(1).max(10000).default(20),
    FUNDING_INTENT_CLEANUP_ENABLED: z.coerce.boolean().default(false),
    FUNDING_INTENT_CLEANUP_INTERVAL_MS: z.coerce.number().int().min(30000).max(86400000).default(300000),
    FUNDING_INTENT_CLEANUP_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
    FUNDING_UNUSED_INTENT_DELETE_AFTER_SECONDS: z.coerce.number().int().min(60).max(604800).default(1800),
    FUNDING_UNSUBMITTED_INTENT_CANCEL_AFTER_SECONDS: z.coerce.number().int().min(300).max(604800).default(7200),
    WITHDRAWAL_UNUSED_INTENT_DELETE_AFTER_SECONDS: z.coerce.number().int().min(60).max(604800).default(1800),
    WITHDRAWAL_UNSUBMITTED_INTENT_CANCEL_AFTER_SECONDS: z.coerce.number().int().min(300).max(604800).default(7200),
    MARKET_ORDERBOOK_RECORDER_ENABLED: z.coerce.boolean().default(false),
    DEV_SIMULATION_PREVIEW_ENABLED: z.coerce.boolean().default(false),
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
    INTERNAL_CLEARING_ENABLED: z.coerce.boolean().default(false),
    INTERNAL_CLEARING_SHADOW_ENABLED: z.coerce.boolean().default(false),
    INTERNAL_CLEARING_SHADOW_PERCENT: z.coerce.number().min(0).max(1).default(0),
    INTERNAL_CLEARING_SHADOW_START_AT: optionalIsoDateSchema,
    INTERNAL_CLEARING_SHADOW_END_AT: optionalIsoDateSchema,
    INTERNAL_CLEARING_CANARY_ENABLED: z.coerce.boolean().default(false),
    INTERNAL_CLEARING_CANARY_PERCENT: z.coerce.number().min(0).max(1).default(0),
    INTERNAL_CLEARING_CANARY_START_AT: optionalIsoDateSchema,
    INTERNAL_CLEARING_CANARY_END_AT: optionalIsoDateSchema,
    RESOLUTION_RISK_ENABLED: z.coerce.boolean().default(false),
    RESOLUTION_RISK_SHADOW_ENABLED: z.coerce.boolean().default(false),
    RESOLUTION_RISK_SHADOW_PERCENT: z.coerce.number().min(0).max(1).default(0),
    RESOLUTION_RISK_SHADOW_START_AT: optionalIsoDateSchema,
    RESOLUTION_RISK_SHADOW_END_AT: optionalIsoDateSchema,
    PHASE3A_GUARDRAIL_SHADOW_ENABLED: z.coerce.boolean().default(false),
    PHASE3A_GUARDRAIL_SHADOW_PERCENT: z.coerce.number().min(0).max(1).default(0),
    PHASE3A_GUARDRAIL_SHADOW_START_AT: optionalIsoDateSchema,
    PHASE3A_GUARDRAIL_SHADOW_END_AT: optionalIsoDateSchema,
    SOR_ACCEPT_AON_AWAIT: z.coerce.boolean().default(true),
    SOR_ACCEPT_NON_AON_BACKGROUND: z.coerce.boolean().default(true),
    RELIABILITY_WEIGHT: z.coerce.number().min(0).max(1).default(0.05),
    LATENCY_WEIGHT: z.coerce.number().min(0).max(1).default(0.03),
    FAILURE_WEIGHT: z.coerce.number().min(0).max(1).default(0.08),
    SOR_RESOLUTION_RISK_PENALTY: z.coerce.number().min(0).default(0.05)
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

    if (value.INTERNAL_CLEARING_SHADOW_ENABLED && value.INTERNAL_CLEARING_SHADOW_PERCENT <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["INTERNAL_CLEARING_SHADOW_PERCENT"],
        message: "INTERNAL_CLEARING_SHADOW_PERCENT must be > 0 when INTERNAL_CLEARING_SHADOW_ENABLED is true."
      });
    }

    if (value.INTERNAL_CLEARING_CANARY_ENABLED && value.INTERNAL_CLEARING_CANARY_PERCENT <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["INTERNAL_CLEARING_CANARY_PERCENT"],
        message: "INTERNAL_CLEARING_CANARY_PERCENT must be > 0 when INTERNAL_CLEARING_CANARY_ENABLED is true."
      });
    }

    if (value.RESOLUTION_RISK_SHADOW_ENABLED && value.RESOLUTION_RISK_SHADOW_PERCENT <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["RESOLUTION_RISK_SHADOW_PERCENT"],
        message: "RESOLUTION_RISK_SHADOW_PERCENT must be > 0 when RESOLUTION_RISK_SHADOW_ENABLED is true."
      });
    }

    if (value.PHASE3A_GUARDRAIL_SHADOW_ENABLED && value.PHASE3A_GUARDRAIL_SHADOW_PERCENT <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PHASE3A_GUARDRAIL_SHADOW_PERCENT"],
        message: "PHASE3A_GUARDRAIL_SHADOW_PERCENT must be > 0 when PHASE3A_GUARDRAIL_SHADOW_ENABLED is true."
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

    if (value.INTERNAL_CLEARING_SHADOW_START_AT && value.INTERNAL_CLEARING_SHADOW_END_AT) {
      const start = Date.parse(value.INTERNAL_CLEARING_SHADOW_START_AT);
      const end = Date.parse(value.INTERNAL_CLEARING_SHADOW_END_AT);
      if (Number.isFinite(start) && Number.isFinite(end) && start >= end) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["INTERNAL_CLEARING_SHADOW_END_AT"],
          message: "INTERNAL_CLEARING_SHADOW_END_AT must be later than INTERNAL_CLEARING_SHADOW_START_AT."
        });
      }
    }

    if (value.INTERNAL_CLEARING_CANARY_START_AT && value.INTERNAL_CLEARING_CANARY_END_AT) {
      const start = Date.parse(value.INTERNAL_CLEARING_CANARY_START_AT);
      const end = Date.parse(value.INTERNAL_CLEARING_CANARY_END_AT);
      if (Number.isFinite(start) && Number.isFinite(end) && start >= end) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["INTERNAL_CLEARING_CANARY_END_AT"],
          message: "INTERNAL_CLEARING_CANARY_END_AT must be later than INTERNAL_CLEARING_CANARY_START_AT."
        });
      }
    }

    if (value.RESOLUTION_RISK_SHADOW_START_AT && value.RESOLUTION_RISK_SHADOW_END_AT) {
      const start = Date.parse(value.RESOLUTION_RISK_SHADOW_START_AT);
      const end = Date.parse(value.RESOLUTION_RISK_SHADOW_END_AT);
      if (Number.isFinite(start) && Number.isFinite(end) && start >= end) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["RESOLUTION_RISK_SHADOW_END_AT"],
          message: "RESOLUTION_RISK_SHADOW_END_AT must be later than RESOLUTION_RISK_SHADOW_START_AT."
        });
      }
    }

    if (value.PHASE3A_GUARDRAIL_SHADOW_START_AT && value.PHASE3A_GUARDRAIL_SHADOW_END_AT) {
      const start = Date.parse(value.PHASE3A_GUARDRAIL_SHADOW_START_AT);
      const end = Date.parse(value.PHASE3A_GUARDRAIL_SHADOW_END_AT);
      if (Number.isFinite(start) && Number.isFinite(end) && start >= end) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["PHASE3A_GUARDRAIL_SHADOW_END_AT"],
          message: "PHASE3A_GUARDRAIL_SHADOW_END_AT must be later than PHASE3A_GUARDRAIL_SHADOW_START_AT."
        });
      }
    }
  });

export type EnvConfig = Readonly<z.infer<typeof envSchema> & { DATABASE_URL: string }>;

const resolveDatabaseUrl = (env: z.infer<typeof envSchema>): string => {
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
