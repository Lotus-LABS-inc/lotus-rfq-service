import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pino from "pino";
import { Pool } from "pg";
import { connectRedis, createRedisClient, disconnectRedis, type RedisClient } from "../../src/db/redis.js";
import { InternalCrossingEngine } from "../../src/core/internal-engine/engine.js";
import { OrderBook } from "../../src/core/internal-engine/order-book.js";
import { OrderLocker } from "../../src/core/internal-engine/locker.js";
import type { InternalOrder } from "../../src/core/internal-engine/types.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
const ENV_READY = Boolean(TEST_DB_URL && TEST_REDIS_URL);

const logger = pino({ level: "silent" });

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const hasRequiredTables = async (pool: Pool): Promise<boolean> => {
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])`,
    [[
      "internal_orders",
      "trades",
      "exposure",
      "exposure_journal",
      "exposure_idempotency"
    ]]
  );

  return result.rows.length === 5;
};

const applyMigrations = async (pool: Pool): Promise<void> => {
  if (await hasRequiredTables(pool)) {
    return;
  }

  const migrationDirs = [
    path.resolve(process.cwd(), "sql", "migrations")
  ];

  for (const migrationsDir of migrationDirs) {
    const files = (await readdir(migrationsDir))
      .filter((name) => name.endsWith(".sql"))
      .sort((left, right) => left.localeCompare(right));

    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      let attempts = 0;
      while (attempts < 3) {
        try {
          await pool.query(sql);
          break;
        } catch (error) {
          const code = error instanceof Error && "code" in error ? (error as { code?: string }).code : undefined;
          const message = error instanceof Error ? error.message : "";
          if (code === "42P07" || code === "42710") {
            break;
          }
          attempts += 1;
          if (!message.includes("ECONNRESET") || attempts >= 3) {
            throw error;
          }
          await sleep(250 * attempts);
        }
      }
    }
  }
};

const makeOrder = (
  overrides: Partial<InternalOrder> & Pick<InternalOrder, "id" | "market_id" | "user_id" | "side" | "price" | "initial_size" | "remaining_size">
): InternalOrder => ({
  id: overrides.id,
  market_id: overrides.market_id,
  user_id: overrides.user_id,
  side: overrides.side,
  price: overrides.price,
  initial_size: overrides.initial_size,
  remaining_size: overrides.remaining_size,
  status: overrides.status ?? "OPEN",
  created_at: overrides.created_at ?? new Date("2026-03-10T12:00:00.000Z"),
  updated_at: overrides.updated_at ?? new Date("2026-03-10T12:00:00.000Z")
});

const insertInternalOrder = async (pool: Pool, order: InternalOrder): Promise<void> => {
  await pool.query(
    `INSERT INTO internal_orders
      (id, market_id, user_id, side, price, initial_size, remaining_size, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      order.id,
      order.market_id,
      order.user_id,
      order.side,
      order.price,
      order.initial_size,
      order.remaining_size,
      order.status,
      order.created_at,
      order.updated_at
    ]
  );
};

const loadExposureRows = async (
  pool: Pool,
  marketId: string
): Promise<Array<{ user_id: string; side: string; gross_notional: string; net_notional: string }>> => {
  const result = await pool.query<{
    user_id: string;
    side: string;
    gross_notional: string;
    net_notional: string;
  }>(
    `SELECT user_id, side, gross_notional::text, net_notional::text
     FROM exposure
     WHERE canonical_market_id = $1
     ORDER BY user_id ASC, side ASC`,
    [marketId]
  );
  return result.rows;
};

const loadJournalRows = async (
  pool: Pool,
  tradeId: string
): Promise<Array<{ source: string; payload: Record<string, string> }>> => {
  const result = await pool.query<{ source: string; payload: Record<string, string> }>(
    `SELECT source, payload
     FROM exposure_journal
     WHERE reference_id = $1
     ORDER BY id ASC`,
    [tradeId]
  );
  return result.rows;
};

describe.skipIf(!ENV_READY)("internal crossing engine integration", () => {
  let pool: Pool | undefined;
  let redis: RedisClient | undefined;
  let orderBook: OrderBook | undefined;
  let engine: InternalCrossingEngine | undefined;

  const must = <T>(value: T | undefined, name: string): T => {
    if (value === undefined) {
      throw new Error(`${name} not initialized`);
    }
    return value;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL as string });
    await applyMigrations(must(pool, "pool"));

    redis = createRedisClient({
      redisUrl: TEST_REDIS_URL as string,
      logger
    });
    await connectRedis(must(redis, "redis"));

    orderBook = new OrderBook(must(redis, "redis"));
    engine = new InternalCrossingEngine(
      must(pool, "pool"),
      must(orderBook, "orderBook"),
      new OrderLocker(must(redis, "redis"), {
        baseDelayMs: 5,
        lockTtlMs: 3000
      }),
      logger
    );
  }, 180000);

  afterAll(async () => {
    if (redis) {
      try {
        await disconnectRedis(redis);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!message.includes("Connection is closed")) {
          throw error;
        }
      }
    }
    if (pool) {
      await pool.end();
    }
  }, 180000);

  it("persists PARTIAL after a partial fill and later settles maker to FILLED", async () => {
    const pg = must(pool, "pool");
    const book = must(orderBook, "orderBook");
    const crossingEngine = must(engine, "engine");
    const marketId = randomUUID();
    const maker = makeOrder({
      id: randomUUID(),
      market_id: marketId,
      user_id: randomUUID(),
      side: "sell",
      price: "0.60",
      initial_size: "10",
      remaining_size: "10"
    });

    await insertInternalOrder(pg, maker);
    await book.addOrder(maker);

    const firstTaker = makeOrder({
      id: randomUUID(),
      market_id: marketId,
      user_id: randomUUID(),
      side: "buy",
      price: "0.60",
      initial_size: "4",
      remaining_size: "4"
    });

    const firstResult = await crossingEngine.attemptCross(firstTaker);
    const partialState = await pg.query<{ status: string; remaining_size: string }>(
      `SELECT status, remaining_size::text
       FROM internal_orders
       WHERE id = $1`,
      [maker.id]
    );

    expect(firstResult.filledSize).toBe(4);
    expect(firstResult.remainingSize).toBe(0);
    expect(partialState.rows[0]?.status).toBe("PARTIAL");
    expect(partialState.rows[0]?.remaining_size).toBe("6");

    const secondTaker = makeOrder({
      id: randomUUID(),
      market_id: marketId,
      user_id: randomUUID(),
      side: "buy",
      price: "0.60",
      initial_size: "6",
      remaining_size: "6"
    });

    const secondResult = await crossingEngine.attemptCross(secondTaker);
    const finalState = await pg.query<{ status: string; remaining_size: string }>(
      `SELECT status, remaining_size::text
       FROM internal_orders
       WHERE id = $1`,
      [maker.id]
    );
    const trades = await pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM trades
       WHERE sell_order_id = $1`,
      [maker.id]
    );

    expect(secondResult.filledSize).toBe(6);
    expect(secondResult.remainingSize).toBe(0);
    expect(finalState.rows[0]?.status).toBe("FILLED");
    expect(finalState.rows[0]?.remaining_size).toBe("0");
    expect(trades.rows[0]?.count).toBe("2");
    expect(await book.getBestOppositeOrders(marketId, "buy", "0.60")).toEqual([]);
  }, 90000);

  it("rejects self-trade and leaves book and persistence unchanged", async () => {
    const pg = must(pool, "pool");
    const book = must(orderBook, "orderBook");
    const crossingEngine = must(engine, "engine");
    const marketId = randomUUID();
    const userId = randomUUID();
    const maker = makeOrder({
      id: randomUUID(),
      market_id: marketId,
      user_id: userId,
      side: "sell",
      price: "0.55",
      initial_size: "8",
      remaining_size: "8"
    });

    await insertInternalOrder(pg, maker);
    await book.addOrder(maker);

    const taker = makeOrder({
      id: randomUUID(),
      market_id: marketId,
      user_id: userId,
      side: "buy",
      price: "0.55",
      initial_size: "4",
      remaining_size: "4"
    });

    const result = await crossingEngine.attemptCross(taker);
    const trades = await pg.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM trades WHERE market_id = $1",
      [marketId]
    );
    const makerState = await pg.query<{ status: string; remaining_size: string }>(
      `SELECT status, remaining_size::text
       FROM internal_orders
       WHERE id = $1`,
      [maker.id]
    );
    const exposures = await pg.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM exposure WHERE canonical_market_id = $1",
      [marketId]
    );

    expect(result.filledSize).toBe(0);
    expect(result.remainingSize).toBe(0);
    expect(trades.rows[0]?.count).toBe("0");
    expect(exposures.rows[0]?.count).toBe("0");
    expect(makerState.rows[0]?.status).toBe("OPEN");
    expect(makerState.rows[0]?.remaining_size).toBe("8");
    expect(await book.getBestOppositeOrders(marketId, "buy", "0.55")).toHaveLength(1);
  }, 90000);

  it("fully fills a maker, persists one trade, and removes it from the book", async () => {
    const pg = must(pool, "pool");
    const book = must(orderBook, "orderBook");
    const crossingEngine = must(engine, "engine");
    const marketId = randomUUID();
    const maker = makeOrder({
      id: randomUUID(),
      market_id: marketId,
      user_id: randomUUID(),
      side: "sell",
      price: "0.40",
      initial_size: "5",
      remaining_size: "5"
    });

    await insertInternalOrder(pg, maker);
    await book.addOrder(maker);

    const taker = makeOrder({
      id: randomUUID(),
      market_id: marketId,
      user_id: randomUUID(),
      side: "buy",
      price: "0.40",
      initial_size: "5",
      remaining_size: "5"
    });

    const result = await crossingEngine.attemptCross(taker);
    const makerState = await pg.query<{ status: string; remaining_size: string }>(
      `SELECT status, remaining_size::text
       FROM internal_orders
       WHERE id = $1`,
      [maker.id]
    );
    const trades = await pg.query<{ id: string; size: string }>(
      `SELECT id, size::text
       FROM trades
       WHERE sell_order_id = $1`,
      [maker.id]
    );

    expect(result.filledSize).toBe(5);
    expect(result.remainingSize).toBe(0);
    expect(trades.rows).toHaveLength(1);
    expect(trades.rows[0]?.size).toBe("5");
    expect(makerState.rows[0]?.status).toBe("FILLED");
    expect(makerState.rows[0]?.remaining_size).toBe("0");
    expect(await book.getBestOppositeOrders(marketId, "buy", "0.40")).toEqual([]);
  }, 90000);

  it("is idempotent on retry and does not double-apply exposure", async () => {
    const pg = must(pool, "pool");
    const book = must(orderBook, "orderBook");
    const crossingEngine = must(engine, "engine");
    const marketId = randomUUID();
    const maker = makeOrder({
      id: randomUUID(),
      market_id: marketId,
      user_id: randomUUID(),
      side: "sell",
      price: "0.60",
      initial_size: "5",
      remaining_size: "5"
    });
    const takerId = randomUUID();

    await insertInternalOrder(pg, maker);
    await book.addOrder(maker);

    const taker = makeOrder({
      id: takerId,
      market_id: marketId,
      user_id: randomUUID(),
      side: "buy",
      price: "0.60",
      initial_size: "5",
      remaining_size: "5"
    });

    const first = await crossingEngine.attemptCross(taker);
    const second = await crossingEngine.attemptCross(taker);
    const trades = await pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM trades
       WHERE buy_order_id = $1`,
      [takerId]
    );
    const journals = await pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM exposure_journal
       WHERE reference_id IN (
         SELECT id
         FROM trades
         WHERE buy_order_id = $1
       )`,
      [takerId]
    );

    expect(first.filledSize).toBe(5);
    expect(second.filledSize).toBe(0);
    expect(second.remainingSize).toBe(5);
    expect(trades.rows[0]?.count).toBe("1");
    expect(journals.rows[0]?.count).toBe("2");
  }, 90000);

  it("persists exposure rows and journal payloads with correct prediction-market deltas", async () => {
    const pg = must(pool, "pool");
    const book = must(orderBook, "orderBook");
    const crossingEngine = must(engine, "engine");
    const marketId = randomUUID();
    const makerUserId = randomUUID();
    const takerUserId = randomUUID();
    const maker = makeOrder({
      id: randomUUID(),
      market_id: marketId,
      user_id: makerUserId,
      side: "sell",
      price: "0.60",
      initial_size: "10",
      remaining_size: "10"
    });

    await insertInternalOrder(pg, maker);
    await book.addOrder(maker);

    const taker = makeOrder({
      id: randomUUID(),
      market_id: marketId,
      user_id: takerUserId,
      side: "buy",
      price: "0.60",
      initial_size: "10",
      remaining_size: "10"
    });

    const result = await crossingEngine.attemptCross(taker);
    const tradeId = result.trades[0]?.id;
    expect(tradeId).toBeDefined();

    const exposures = await loadExposureRows(pg, marketId);
    const takerExposure = exposures.find((row) => row.user_id === takerUserId);
    const makerExposure = exposures.find((row) => row.user_id === makerUserId);
    const journalRows = await loadJournalRows(pg, String(tradeId));

    expect(takerExposure).toEqual({
      user_id: takerUserId,
      side: "buy",
      gross_notional: "6",
      net_notional: "-2"
    });
    expect(makerExposure).toEqual({
      user_id: makerUserId,
      side: "sell",
      gross_notional: "4",
      net_notional: "2"
    });

    expect(journalRows).toHaveLength(2);
    expect(Number(journalRows[0]?.payload.maxLossDelta ?? "0")).toBeCloseTo(6, 8);
    expect(Number(journalRows[0]?.payload.maxGainDelta ?? "0")).toBeCloseTo(4, 8);
    expect(Number(journalRows[1]?.payload.maxLossDelta ?? "0")).toBeCloseTo(4, 8);
    expect(Number(journalRows[1]?.payload.maxGainDelta ?? "0")).toBeCloseTo(6, 8);
  }, 90000);

  it("handles concurrent takers without duplicate trade pairs or overfill", async () => {
    const pg = must(pool, "pool");
    const book = must(orderBook, "orderBook");
    const crossingEngine = must(engine, "engine");
    const marketId = randomUUID();

    const makerA = makeOrder({
      id: randomUUID(),
      market_id: marketId,
      user_id: randomUUID(),
      side: "sell",
      price: "0.60",
      initial_size: "5",
      remaining_size: "5"
    });
    const makerB = makeOrder({
      id: randomUUID(),
      market_id: marketId,
      user_id: randomUUID(),
      side: "sell",
      price: "0.60",
      initial_size: "5",
      remaining_size: "5"
    });

    await insertInternalOrder(pg, makerA);
    await insertInternalOrder(pg, makerB);
    await book.addOrder(makerA);
    await book.addOrder(makerB);

    const takerA = makeOrder({
      id: randomUUID(),
      market_id: marketId,
      user_id: randomUUID(),
      side: "buy",
      price: "0.60",
      initial_size: "6",
      remaining_size: "6"
    });
    const takerB = makeOrder({
      id: randomUUID(),
      market_id: marketId,
      user_id: randomUUID(),
      side: "buy",
      price: "0.60",
      initial_size: "6",
      remaining_size: "6"
    });

    const settled = await Promise.allSettled([
      crossingEngine.attemptCross(takerA),
      crossingEngine.attemptCross(takerB)
    ]);
    const results = settled
      .filter((entry): entry is PromiseFulfilledResult<{ filledSize: number; remainingSize: number; trades: any[] }> => entry.status === "fulfilled")
      .map((entry) => entry.value);
    const rejected = settled.filter((entry) => entry.status === "rejected");

    const trades = await pg.query<{ buy_order_id: string; sell_order_id: string }>(
      `SELECT buy_order_id, sell_order_id FROM trades WHERE market_id = $1`,
      [marketId]
    );
    const uniquePairs = new Set(trades.rows.map((row) => `${row.buy_order_id}:${row.sell_order_id}`));
    const totalFilled = results.reduce((sum, result) => sum + result.filledSize, 0);

    expect(results.length).toBeGreaterThan(0);
    expect(rejected.length).toBeLessThanOrEqual(1);
    expect(trades.rowCount).toBe(uniquePairs.size);
    expect(totalFilled).toBeLessThanOrEqual(10);
  }, 90000);
});
