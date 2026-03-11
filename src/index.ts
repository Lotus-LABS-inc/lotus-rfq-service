import { fileURLToPath } from "node:url";
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
    db: AppDb;
    canonicalServiceBaseUrl: string;
    jwtSecret: string;
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
    reliabilityWeight: number;
    latencyWeight: number;
    failureWeight: number;
    sorAcceptAonAwait: boolean;
    sorAcceptNonAonBackground: boolean;
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

export const startService = async (
  modules: Partial<BootstrapModules> = {}
): Promise<ServiceRuntime> => {
  const impl: BootstrapModules = { ...defaultModules, ...modules };

  const env = impl.loadEnv();
  const logger = impl.createLogger(env.LOG_LEVEL);
  const redisClient = impl.createRedisClient({
    redisUrl: env.REDIS_URL,
    logger
  });

  await impl.connectRedis(redisClient);

  const pgPool = impl.createPgPool({
    databaseUrl: env.DATABASE_URL,
    logger
  });
  const db = impl.createDrizzleDb(pgPool);

  const app = await impl.buildServer({
    logger,
    redisClient,
    pgPool,
    db,
    canonicalServiceBaseUrl: env.CANONICAL_SERVICE_BASE_URL,
    jwtSecret: env.JWT_SECRET,
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
    reliabilityWeight: env.RELIABILITY_WEIGHT,
    latencyWeight: env.LATENCY_WEIGHT,
    failureWeight: env.FAILURE_WEIGHT,
    sorAcceptAonAwait: env.SOR_ACCEPT_AON_AWAIT,
    sorAcceptNonAonBackground: env.SOR_ACCEPT_NON_AON_BACKGROUND
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
    await impl.disconnectRedis(redisClient);
    await impl.closePgPool(pgPool);
    logger.info("Service shutdown completed.");
  };

  logger.info({ host: env.HOST, port: env.PORT }, "Service started.");

  return {
    env,
    logger,
    redisClient,
    pgPool,
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
