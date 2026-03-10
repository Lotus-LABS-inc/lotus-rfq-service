#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import pino from "pino";
import { connectRedis, createRedisClient, disconnectRedis } from "../src/db/redis.js";
import { OrderBook } from "../src/core/internal-engine/order-book.js";
import { InternalCrossBookRebuilder } from "../src/core/internal-engine/rebuild-book.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const marketArgs = process.argv
  .slice(2)
  .filter((value) => value.startsWith("--market="))
  .map((value) => value.slice("--market=".length))
  .filter((value) => value.length > 0);

if (!databaseUrl || !redisUrl) {
  logger.error("TEST_DATABASE_URL/DATABASE_URL and TEST_REDIS_URL/REDIS_URL are required.");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });
const redis = createRedisClient({ redisUrl, logger });

const run = async (): Promise<void> => {
  await connectRedis(redis);
  const rebuilder = new InternalCrossBookRebuilder(pool, new OrderBook(redis), logger);
  const result = await rebuilder.rebuild({
    dryRun,
    ...(marketArgs.length > 0 ? { scope: { marketIds: marketArgs } } : {})
  });

  logger.info(result, "Internal-cross Redis rebuild completed.");
};

run()
  .then(async () => {
    await disconnectRedis(redis);
    await pool.end();
  })
  .catch(async (error) => {
    logger.error({ err: error }, "Internal-cross Redis rebuild failed.");
    await disconnectRedis(redis).catch(() => undefined);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
