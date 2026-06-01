import { fileURLToPath } from "node:url";
import { config as loadDotenvFile } from "dotenv";
import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import type { Pool } from "pg";
import { buildServer } from "./api/server.js";
import { closePgPool, createDrizzleDb, createPgPool, type AppDb } from "./db/postgres.js";
import {
  connectRedis,
  createRedisClient,
  disconnectRedis,
  type RedisClient
} from "./db/redis.js";
import { initializeTracing, shutdownTracing } from "./observability/tracing.js";
import { loadEnv, type EnvConfig } from "./utils/env.js";
import { createLogger } from "./utils/logger.js";

export interface ServiceRuntime {
  env: EnvConfig;
  logger: Logger;
  redisClient: RedisClient;
  pgPool: Pool;
  pairShadowPool: Pool;
  db: AppDb;
  app: FastifyInstance;
  shutdown: () => Promise<void>;
}

export interface BootstrapModules {
  loadEnv: () => EnvConfig;
  createLogger: (level: EnvConfig["LOG_LEVEL"]) => Logger;
  createRedisClient: (config: { redisUrl: string; logger: Logger }) => RedisClient;
  connectRedis: (client: RedisClient) => Promise<void>;
  createPgPool: (config: { databaseUrl: string; logger: Logger }) => Pool;
  createDrizzleDb: (pool: Pool) => AppDb;
  buildServer: (deps: {
    logger: Logger;
    redisClient: RedisClient;
    pgPool: Pool;
    pairShadowPool?: Pool;
    db: AppDb;
    canonicalServiceBaseUrl: string;
    jwtSecret: string;
    devSimulationPreviewEnabled?: boolean;
    sorEnabled?: boolean;
    sorCanaryShadowEnabled?: boolean;
    sorCanaryPercent?: number;
    sorCanaryStartAt?: string;
    sorCanaryEndAt?: string;
    internalCrossEnabled?: boolean;
    internalCrossShadowEnabled?: boolean;
    internalCrossShadowPercent?: number;
    internalCrossShadowStartAt?: string;
    internalCrossShadowEndAt?: string;
    internalNettingEnabled?: boolean;
    internalNettingShadowEnabled?: boolean;
    internalNettingShadowPercent?: number;
    internalNettingShadowStartAt?: string;
    internalNettingShadowEndAt?: string;
    internalNettingCanaryEnabled?: boolean;
    internalNettingCanaryPercent?: number;
    internalNettingCanaryStartAt?: string;
    internalNettingCanaryEndAt?: string;
    internalClearingEnabled?: boolean;
    internalClearingShadowEnabled?: boolean;
    internalClearingShadowPercent?: number;
    internalClearingShadowStartAt?: string;
    internalClearingShadowEndAt?: string;
    internalClearingCanaryEnabled?: boolean;
    internalClearingCanaryPercent?: number;
    internalClearingCanaryStartAt?: string;
    internalClearingCanaryEndAt?: string;
    resolutionRiskEnabled?: boolean;
    resolutionRiskShadowEnabled?: boolean;
    resolutionRiskShadowPercent?: number;
    resolutionRiskShadowStartAt?: string;
    resolutionRiskShadowEndAt?: string;
    phase3AGuardrailShadowEnabled?: boolean;
    phase3AGuardrailShadowPercent?: number;
    phase3AGuardrailShadowStartAt?: string;
    phase3AGuardrailShadowEndAt?: string;
    reliabilityWeight: number;
    latencyWeight: number;
    failureWeight: number;
    sorResolutionRiskPenalty?: number;
    sorAcceptAonAwait: boolean;
    sorAcceptNonAonBackground: boolean;
    runtimeMode?: "api" | "worker";
  }) => Promise<FastifyInstance>;
  disconnectRedis: (client: RedisClient) => Promise<void>;
  closePgPool: (pool: Pool) => Promise<void>;
}

const defaultModules: BootstrapModules = {
  loadEnv,
  createLogger,
  createRedisClient,
  connectRedis,
  createPgPool,
  createDrizzleDb,
  buildServer,
  disconnectRedis,
  closePgPool
};

export const POLYMARKET_RELAY_SERVICE_MODE = "polymarket-execution-relay";
export const ORDERBOOK_STREAM_SERVICE_MODE = "orderbook-stream-service";
export const WORKER_SERVICE_MODE = "worker";

type RuntimeMode = "api" | "worker";

export const shouldRunPolymarketRelayEntrypoint = (
  env: NodeJS.ProcessEnv = process.env
): boolean => env.LOTUS_SERVICE_MODE === POLYMARKET_RELAY_SERVICE_MODE;

export const shouldRunOrderbookStreamEntrypoint = (
  env: NodeJS.ProcessEnv = process.env
): boolean => env.LOTUS_SERVICE_MODE === ORDERBOOK_STREAM_SERVICE_MODE;

export const shouldRunWorkerEntrypoint = (
  env: NodeJS.ProcessEnv = process.env
): boolean => env.LOTUS_SERVICE_MODE === WORKER_SERVICE_MODE;

const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

const connectRedisForStartup = async (
  client: RedisClient,
  connect: (client: RedisClient) => Promise<void>,
  logger: Logger
): Promise<void> => {
  const maxAttempts = 5;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await connect(client);
      return;
    } catch (error) {
      lastError = error;
      if (isRedisAlreadyConnectingOrConnected(error)) {
        logger.warn(
          { err: error, attempt, maxAttempts },
          "Redis startup connect raced with the client's reconnect loop. Continuing startup."
        );
        return;
      }
      if (attempt === maxAttempts) {
        break;
      }
      const retryDelayMs = attempt * 1_000;
      logger.warn(
        { err: error, attempt, maxAttempts, retryDelayMs },
        "Redis startup connection failed. Retrying before failing service startup."
      );
      await sleep(retryDelayMs);
    }
  }

  throw lastError;
};

const isRedisAlreadyConnectingOrConnected = (error: unknown): boolean =>
  error instanceof Error && error.message === "Redis is already connecting/connected";

const isTransientRedisStartupError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    isRedisAlreadyConnectingOrConnected(error) ||
    error.message.includes("ECONNRESET") ||
    error.message.includes("Connection is closed") ||
    error.message.includes("ETIMEDOUT") ||
    error.message.includes("Socket closed unexpectedly")
  );
};

const isProductionDeploy = (env: EnvConfig): boolean =>
  [env.LOTUS_DEPLOY_ENV, env.LOTUS_ENV, env.APP_ENV].some((value) =>
    typeof value === "string" && ["prod", "production"].includes(value.trim().toLowerCase())
  );

const localDatabaseHosts = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

const databaseHost = (databaseUrl: string): string => {
  try {
    return new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
};

const isSupabaseDatabaseHost = (host: string): boolean =>
  host === "supabase.com" || host.endsWith(".supabase.com") || host.includes(".supabase.co");

export const validateDatabaseTargetSafety = (env: EnvConfig): void => {
  if (!isProductionDeploy(env)) {
    return;
  }

  const databaseHostName = databaseHost(env.DATABASE_URL);
  const supabaseHostName = env.SUPABASE_DB_URL ? databaseHost(env.SUPABASE_DB_URL) : "";

  if (!env.SUPABASE_DB_URL) {
    throw new Error("Production deploy requires SUPABASE_DB_URL so prod cannot silently fall back to VPS-local Postgres.");
  }

  if (localDatabaseHosts.has(databaseHostName) || localDatabaseHosts.has(supabaseHostName)) {
    throw new Error("Production deploy database URLs must not point at localhost/VPS-local Postgres.");
  }

  if (!isSupabaseDatabaseHost(databaseHostName) || !isSupabaseDatabaseHost(supabaseHostName)) {
    throw new Error("Production deploy DATABASE_URL and SUPABASE_DB_URL must point at Supabase Postgres hosts.");
  }
};

export const startService = async (
  modules: Partial<BootstrapModules> = {}
): Promise<ServiceRuntime> => {
  loadDotenvFile();
  const impl: BootstrapModules = { ...defaultModules, ...modules };

  const env = impl.loadEnv();
  const logger = impl.createLogger(env.LOG_LEVEL);
  validateDatabaseTargetSafety(env);
  const runtimeMode: RuntimeMode = shouldRunWorkerEntrypoint({ LOTUS_SERVICE_MODE: env.LOTUS_SERVICE_MODE })
    ? "worker"
    : "api";
  const redisClient = impl.createRedisClient({
    redisUrl: env.REDIS_URL,
    logger
  });

  let redisConnected = false;
  try {
    await connectRedisForStartup(redisClient, impl.connectRedis, logger);
    redisConnected = true;
  } catch (error) {
    if (!env.DEV_SIMULATION_PREVIEW_ENABLED && !isTransientRedisStartupError(error)) {
      throw error;
    }

    logger.warn(
      { err: error },
      "Redis connection failed during startup. Continuing while the Redis client reconnects in the background."
    );
  }

  const pgPool = impl.createPgPool({
    databaseUrl: env.DATABASE_URL,
    logger
  });
  const pairShadowPool =
    env.SUPABASE_DB_URL && env.SUPABASE_DB_URL !== env.DATABASE_URL
      ? impl.createPgPool({
          databaseUrl: env.SUPABASE_DB_URL,
          logger
        })
      : pgPool;
  const db = impl.createDrizzleDb(pgPool);

  const app = await impl.buildServer({
    logger,
    redisClient,
    pgPool,
    pairShadowPool,
    db,
    canonicalServiceBaseUrl: env.CANONICAL_SERVICE_BASE_URL,
    jwtSecret: env.JWT_SECRET,
    devSimulationPreviewEnabled: env.DEV_SIMULATION_PREVIEW_ENABLED,
    sorEnabled: env.SOR_ENABLED,
    sorCanaryShadowEnabled: env.SOR_CANARY_SHADOW_ENABLED,
    sorCanaryPercent: env.SOR_CANARY_PERCENT,
    ...(env.SOR_CANARY_START_AT ? { sorCanaryStartAt: env.SOR_CANARY_START_AT } : {}),
    ...(env.SOR_CANARY_END_AT ? { sorCanaryEndAt: env.SOR_CANARY_END_AT } : {}),
    internalCrossEnabled: env.INTERNAL_CROSS_ENABLED,
    internalCrossShadowEnabled: env.INTERNAL_CROSS_SHADOW_ENABLED,
    internalCrossShadowPercent: env.INTERNAL_CROSS_SHADOW_PERCENT,
    ...(env.INTERNAL_CROSS_SHADOW_START_AT ? { internalCrossShadowStartAt: env.INTERNAL_CROSS_SHADOW_START_AT } : {}),
    ...(env.INTERNAL_CROSS_SHADOW_END_AT ? { internalCrossShadowEndAt: env.INTERNAL_CROSS_SHADOW_END_AT } : {}),
    internalNettingEnabled: env.INTERNAL_NETTING_ENABLED,
    internalNettingShadowEnabled: env.INTERNAL_NETTING_SHADOW_ENABLED,
    internalNettingShadowPercent: env.INTERNAL_NETTING_SHADOW_PERCENT,
    ...(env.INTERNAL_NETTING_SHADOW_START_AT ? { internalNettingShadowStartAt: env.INTERNAL_NETTING_SHADOW_START_AT } : {}),
    ...(env.INTERNAL_NETTING_SHADOW_END_AT ? { internalNettingShadowEndAt: env.INTERNAL_NETTING_SHADOW_END_AT } : {}),
    internalNettingCanaryEnabled: env.INTERNAL_NETTING_CANARY_ENABLED,
    internalNettingCanaryPercent: env.INTERNAL_NETTING_CANARY_PERCENT,
    ...(env.INTERNAL_NETTING_CANARY_START_AT ? { internalNettingCanaryStartAt: env.INTERNAL_NETTING_CANARY_START_AT } : {}),
    ...(env.INTERNAL_NETTING_CANARY_END_AT ? { internalNettingCanaryEndAt: env.INTERNAL_NETTING_CANARY_END_AT } : {}),
    internalClearingEnabled: env.INTERNAL_CLEARING_ENABLED,
    internalClearingShadowEnabled: env.INTERNAL_CLEARING_SHADOW_ENABLED,
    internalClearingShadowPercent: env.INTERNAL_CLEARING_SHADOW_PERCENT,
    ...(env.INTERNAL_CLEARING_SHADOW_START_AT ? { internalClearingShadowStartAt: env.INTERNAL_CLEARING_SHADOW_START_AT } : {}),
    ...(env.INTERNAL_CLEARING_SHADOW_END_AT ? { internalClearingShadowEndAt: env.INTERNAL_CLEARING_SHADOW_END_AT } : {}),
    internalClearingCanaryEnabled: env.INTERNAL_CLEARING_CANARY_ENABLED,
    internalClearingCanaryPercent: env.INTERNAL_CLEARING_CANARY_PERCENT,
    ...(env.INTERNAL_CLEARING_CANARY_START_AT ? { internalClearingCanaryStartAt: env.INTERNAL_CLEARING_CANARY_START_AT } : {}),
    ...(env.INTERNAL_CLEARING_CANARY_END_AT ? { internalClearingCanaryEndAt: env.INTERNAL_CLEARING_CANARY_END_AT } : {}),
    resolutionRiskEnabled: env.RESOLUTION_RISK_ENABLED,
    resolutionRiskShadowEnabled: env.RESOLUTION_RISK_SHADOW_ENABLED,
    resolutionRiskShadowPercent: env.RESOLUTION_RISK_SHADOW_PERCENT,
    ...(env.RESOLUTION_RISK_SHADOW_START_AT ? { resolutionRiskShadowStartAt: env.RESOLUTION_RISK_SHADOW_START_AT } : {}),
    ...(env.RESOLUTION_RISK_SHADOW_END_AT ? { resolutionRiskShadowEndAt: env.RESOLUTION_RISK_SHADOW_END_AT } : {}),
    phase3AGuardrailShadowEnabled: env.PHASE3A_GUARDRAIL_SHADOW_ENABLED,
    phase3AGuardrailShadowPercent: env.PHASE3A_GUARDRAIL_SHADOW_PERCENT,
    ...(env.PHASE3A_GUARDRAIL_SHADOW_START_AT
      ? { phase3AGuardrailShadowStartAt: env.PHASE3A_GUARDRAIL_SHADOW_START_AT }
      : {}),
    ...(env.PHASE3A_GUARDRAIL_SHADOW_END_AT
      ? { phase3AGuardrailShadowEndAt: env.PHASE3A_GUARDRAIL_SHADOW_END_AT }
      : {}),
    reliabilityWeight: env.RELIABILITY_WEIGHT,
    latencyWeight: env.LATENCY_WEIGHT,
    failureWeight: env.FAILURE_WEIGHT,
    sorResolutionRiskPenalty: env.SOR_RESOLUTION_RISK_PENALTY,
    sorAcceptAonAwait: env.SOR_ACCEPT_AON_AWAIT,
    sorAcceptNonAonBackground: env.SOR_ACCEPT_NON_AON_BACKGROUND,
    runtimeMode
  });

  await app.listen({
    host: env.HOST,
    port: env.PORT
  });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.info("Service shutdown started.");
    await app.close();
    if (redisConnected) {
      await impl.disconnectRedis(redisClient);
    }
    if (pairShadowPool !== pgPool) {
      await impl.closePgPool(pairShadowPool);
    }
    await impl.closePgPool(pgPool);
    logger.info("Service shutdown completed.");
  };

  logger.info({ host: env.HOST, port: env.PORT, runtimeMode }, "Service started.");

  return {
    env,
    logger,
    redisClient,
    pgPool,
    pairShadowPool,
    db,
    app,
    shutdown
  };
};

const registerSignals = (runtime: ServiceRuntime): void => {
  const onSignal = async (signal: NodeJS.Signals): Promise<void> => {
    runtime.logger.info({ signal }, "Signal received.");
    await runtime.shutdown();
    await shutdownTracing();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void onSignal("SIGINT");
  });

  process.once("SIGTERM", () => {
    void onSignal("SIGTERM");
  });
};

export const run = async (): Promise<void> => {
  try {
    if (shouldRunPolymarketRelayEntrypoint()) {
      const { runPolymarketExecutionRelay } = await import("./polymarket-execution-relay.js");
      await runPolymarketExecutionRelay();
      return;
    }

    if (shouldRunOrderbookStreamEntrypoint()) {
      const { runOrderbookStreamService } = await import("./orderbook-stream-service.js");
      await runOrderbookStreamService();
      return;
    }

    await initializeTracing();
    const runtime = await startService();
    registerSignals(runtime);
  } catch (error) {
    await shutdownTracing();
    const startupLogger = createLogger("error");
    startupLogger.error({ err: error }, "Service failed to start.");
    process.exit(1);
  }
};

const isMainModule = (): boolean => {
  const entryPath = process.argv[1];
  const thisPath = fileURLToPath(import.meta.url);
  return Boolean(entryPath) && entryPath === thisPath;
};

if (isMainModule()) {
  void run();
}
