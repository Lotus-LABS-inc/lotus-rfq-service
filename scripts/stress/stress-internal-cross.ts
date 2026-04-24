#!/usr/bin/env tsx
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import pino from "pino";
import { connectRedis, createRedisClient, disconnectRedis } from "../../src/db/redis.js";
import { InternalCrossingEngine } from "../../src/core/internal-engine/engine.js";
import { OrderBook } from "../../src/core/internal-engine/order-book.js";
import { OrderLockError, OrderLocker } from "../../src/core/internal-engine/locker.js";
import type { InternalOrder } from "../../src/core/internal-engine/types.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
const logger = pino({ level: process.env.LOG_LEVEL ?? "warn" });
const DB_POOL_MAX = Number(process.env.INTERNAL_CROSS_STRESS_DB_POOL_MAX ?? "4");
const WORKER_CONCURRENCY = Number(process.env.INTERNAL_CROSS_STRESS_CONCURRENCY ?? "4");
const MAX_ATTEMPT_RETRIES = Number(process.env.INTERNAL_CROSS_STRESS_RETRIES ?? "2");
const STATEMENT_TIMEOUT_MS = Number(process.env.INTERNAL_CROSS_STRESS_STATEMENT_TIMEOUT_MS ?? "5000");

const sleep = async (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isTransientInfraError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("Connection terminated unexpectedly") ||
    error.message.includes("ECONNRESET") ||
    error.message.includes("MaxClientsInSessionMode") ||
    error.message.includes("canceling statement due to statement timeout")
  );
};

const withTransientRetry = async <T>(operation: () => Promise<T>, label: string, attempt = 0): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (attempt < MAX_ATTEMPT_RETRIES && isTransientInfraError(error)) {
      logger.warn({ label, attempt: attempt + 1, err: error }, "Retrying transient internal-cross stress operation.");
      await sleep((attempt + 1) * 150);
      return withTransientRetry(operation, label, attempt + 1);
    }

    throw error;
  }
};

const ensureSchema = async (pool: Pool): Promise<void> => {
  await withTransientRetry(() => pool.query("SELECT 1 FROM internal_orders LIMIT 1"), "ensure-schema:internal_orders");
  await withTransientRetry(() => pool.query("SELECT 1 FROM trades LIMIT 1"), "ensure-schema:trades");
};

const makeOrder = (marketId: string, side: "buy" | "sell", size: number, price: string, userId?: string): InternalOrder => ({
  id: randomUUID(),
  market_id: marketId,
  user_id: userId ?? randomUUID(),
  side,
  price,
  initial_size: size.toString(),
  remaining_size: size.toString(),
  status: "OPEN",
  created_at: new Date(),
  updated_at: new Date()
});

const insertOrder = async (pool: Pool, order: InternalOrder): Promise<void> => {
  await withTransientRetry(
    () =>
      pool.query(
        `INSERT INTO internal_orders
          (id, market_id, user_id, side, price, initial_size, remaining_size, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [order.id, order.market_id, order.user_id, order.side, order.price, order.initial_size, order.remaining_size, order.status, order.created_at, order.updated_at]
      ),
    `insert-order:${order.id}`
  );
};

const runWithConcurrency = async <T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  concurrency: number
): Promise<PromiseSettledResult<T>[]> => {
  const results: PromiseSettledResult<T>[] = [];
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const currentIndex = cursor;
      cursor += 1;
      try {
        const value = await tasks[currentIndex]!();
        results[currentIndex] = { status: "fulfilled", value };
      } catch (error) {
        results[currentIndex] = { status: "rejected", reason: error };
      }
    }
  });

  await Promise.all(workers);
  return results;
};

const run = async (): Promise<void> => {
  if (!databaseUrl || !redisUrl) {
    throw new Error("TEST_DATABASE_URL/DATABASE_URL and TEST_REDIS_URL/REDIS_URL are required.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: DB_POOL_MAX,
    min: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    query_timeout: STATEMENT_TIMEOUT_MS,
    application_name: "stress-internal-cross"
  });
  pool.on("error", (error) => {
    logger.warn({ err: error }, "Stress pool emitted a client error.");
  });
  const redis = createRedisClient({ redisUrl, logger });
  await connectRedis(redis);
  await ensureSchema(pool);

  const orderBook = new OrderBook(redis);
  const engine = new InternalCrossingEngine(pool, orderBook, new OrderLocker(redis, { baseDelayMs: 5, lockTtlMs: 3000 }), logger);

  const sharedSelfTraderId = randomUUID();
  const marketIds = Array.from({ length: 25 }, () => randomUUID());
  const makers = marketIds.flatMap((marketId, marketIndex) =>
    Array.from({ length: 12 }, (_, index) =>
      makeOrder(
        marketId,
        "sell",
        4 + (index % 4),
        "0.55",
        (marketIndex + index) % 16 === 0 ? sharedSelfTraderId : undefined
      )
    )
  );
  for (const maker of makers) {
    await insertOrder(pool, maker);
    await orderBook.addOrder(maker);
  }
  const makerIds = makers.map((maker) => maker.id);

  const retryOrderIds = Array.from({ length: 8 }, () => randomUUID());
  const takers = Array.from({ length: 200 }, (_, index) => {
    const sharedOrderId = index % 25 === 0 ? retryOrderIds[Math.floor(index / 25)] ?? randomUUID() : randomUUID();
    const marketId = marketIds[index % marketIds.length] ?? marketIds[0]!;
    return {
      ...makeOrder(marketId, "buy", 2 + (index % 4), "0.55"),
      id: sharedOrderId,
      user_id: index % 20 === 0 ? sharedSelfTraderId : randomUUID()
    };
  });
  const retriedOrderIds = new Set(retryOrderIds);

  const runAttempt = async (order: InternalOrder, index: number, attempt = 0): Promise<{ orderId: string; index: number; result: Awaited<ReturnType<InternalCrossingEngine["attemptCross"]>> }> => {
    try {
      await sleep(Math.floor(Math.random() * 20));
      const result = await engine.attemptCross(order);
      return { orderId: order.id, index, result };
    } catch (error) {
      if (attempt < MAX_ATTEMPT_RETRIES && isTransientInfraError(error)) {
        logger.warn({ orderId: order.id, attempt: attempt + 1, err: error }, "Retrying internal-cross stress order after transient infra failure.");
        await sleep((attempt + 1) * 100);
        return runAttempt(order, index, attempt + 1);
      }

      throw error;
    }
  };

  const results = await runWithConcurrency(
    takers.map((order, index) => async () => runAttempt(order, index)),
    WORKER_CONCURRENCY
  );

  const rejected = results.filter((entry) => entry.status === "rejected");
  const unexpectedRejections = rejected.filter(
    (entry) =>
      !(entry.reason instanceof OrderLockError) &&
      !(entry.reason instanceof Error && entry.reason.name === "OrderLockError") &&
      !isTransientInfraError(entry.reason)
  );
  if (unexpectedRejections.length > 0) {
    logger.error(
      {
        sampleErrors: unexpectedRejections.slice(0, 3).map((entry) => {
          const reason = entry.reason;
          return reason instanceof Error ? { name: reason.name, message: reason.message } : { reason };
        })
      },
      "Unexpected internal-cross stress rejections."
    );
    throw new Error(`Internal-cross stress had ${unexpectedRejections.length} unexpected rejected promises.`);
  }

  const trades = await pool.query<{ buy_order_id: string; sell_order_id: string; size: string }>(
    `SELECT buy_order_id, sell_order_id, size::text
       FROM trades
      WHERE buy_order_id = ANY($1::uuid[])
         OR sell_order_id = ANY($2::uuid[])`,
    [Array.from(new Set(takers.map((order) => order.id).filter((id) => !retriedOrderIds.has(id)).concat(retryOrderIds))), makerIds]
  );
  const duplicateTrades = new Set<string>();
  const seenTradePairs = new Set<string>();
  for (const row of trades.rows) {
    const key = `${row.buy_order_id}:${row.sell_order_id}`;
    if (seenTradePairs.has(key)) duplicateTrades.add(key);
    seenTradePairs.add(key);
  }

  const negativeRemaining = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM internal_orders
      WHERE id = ANY($1::uuid[])
        AND remaining_size < 0`,
    [makerIds]
  );
  const orphanLocks = await Promise.all(
    takers.slice(0, 20).map((order) => redis.get(`order_lock:${order.id}`))
  );

  logger.info(
    {
      takers: takers.length,
      trades: trades.rowCount,
      dbPoolMax: DB_POOL_MAX,
      workerConcurrency: WORKER_CONCURRENCY,
      statementTimeoutMs: STATEMENT_TIMEOUT_MS,
      duplicateTrades: duplicateTrades.size,
      negativeRemaining: Number(negativeRemaining.rows[0]?.count ?? "0"),
      orphanLocks: orphanLocks.filter((entry) => entry !== null).length,
      lockRejections: rejected.length,
      transientRejections: rejected.filter((entry) => isTransientInfraError(entry.reason)).length
    },
    "Internal-cross stress summary."
  );

  if (duplicateTrades.size > 0) {
    throw new Error("Duplicate internal trades detected under stress.");
  }
  if (Number(negativeRemaining.rows[0]?.count ?? "0") > 0) {
    throw new Error("Negative remaining_size detected after internal-cross stress.");
  }
  if (orphanLocks.some((entry) => entry !== null)) {
    throw new Error("Orphan order locks detected after internal-cross stress.");
  }

  await disconnectRedis(redis);
  await pool.end();
};

run().catch((error) => {
  logger.error({ err: error }, "stress-internal-cross failed");
  process.exit(1);
});
