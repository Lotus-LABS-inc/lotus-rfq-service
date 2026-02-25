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
    canonicalServiceBaseUrl: env.CANONICAL_SERVICE_BASE_URL
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
    const runtime = await startService();
    registerSignals(runtime);
  } catch (error) {
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
