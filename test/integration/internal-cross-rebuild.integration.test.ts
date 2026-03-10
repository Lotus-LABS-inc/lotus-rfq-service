import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { Pool } from "pg";
import { connectRedis, createRedisClient, disconnectRedis, type RedisClient } from "../../src/db/redis.js";
import { OrderBook } from "../../src/core/internal-engine/order-book.js";
import { InternalCrossBookRebuilder } from "../../src/core/internal-engine/rebuild-book.js";
import type { InternalOrder } from "../../src/core/internal-engine/types.js";
import { deleteRedisKeysByPrefix } from "../helpers/redis-test-utils.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
const ENV_READY = Boolean(TEST_DB_URL && TEST_REDIS_URL);
const logger = pino({ level: "silent" });

const applyMigrations = async (pool: Pool): Promise<void> => {
  for (const migrationsDir of [path.resolve(process.cwd(), "infra", "migrations"), path.resolve(process.cwd(), "sql", "migrations")]) {
    const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort((a, b) => a.localeCompare(b));
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
          if (code === "42P07" || code === "42710") break;
          attempts += 1;
          if (!message.includes("ECONNRESET") || attempts >= 3) {
            throw error;
          }
        }
      }
    }
  }
};

const clearState = async (pool: Pool): Promise<void> => {
  await pool.query(`TRUNCATE TABLE internal_orders, trades, exposure, exposure_journal, exposure_idempotency RESTART IDENTITY CASCADE`);
};

const makeOrder = (overrides: Partial<InternalOrder> = {}): InternalOrder => ({
  id: overrides.id ?? randomUUID(),
  market_id: overrides.market_id ?? randomUUID(),
  user_id: overrides.user_id ?? randomUUID(),
  side: overrides.side ?? "sell",
  price: overrides.price ?? "0.55",
  initial_size: overrides.initial_size ?? "10",
  remaining_size: overrides.remaining_size ?? "10",
  status: overrides.status ?? "OPEN",
  created_at: overrides.created_at ?? new Date("2026-03-10T12:00:00.000Z"),
  updated_at: overrides.updated_at ?? new Date("2026-03-10T12:00:00.000Z")
});

describe.skipIf(!ENV_READY)("internal-cross rebuild integration", () => {
  let pool: Pool | undefined;
  let redis: RedisClient | undefined;
  let orderBook: OrderBook | undefined;

  const must = <T>(value: T | undefined, name: string): T => {
    if (value === undefined) throw new Error(`${name} not initialized`);
    return value;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL as string });
    await applyMigrations(must(pool, "pool"));
    redis = createRedisClient({ redisUrl: TEST_REDIS_URL as string, logger });
    await connectRedis(must(redis, "redis"));
    orderBook = new OrderBook(must(redis, "redis"));
  }, 120000);

  beforeEach(async () => {
    await clearState(must(pool, "pool"));
    await deleteRedisKeysByPrefix(must(redis, "redis") as any, ["book:"]);
  });

  afterAll(async () => {
    if (redis) await disconnectRedis(redis).catch(() => undefined);
    if (pool) await pool.end();
  }, 120000);

  it("rebuilds Redis snapshots from authoritative Postgres open orders", async () => {
    const pg = must(pool, "pool");
    const book = must(orderBook, "orderBook");
    const order = makeOrder();

    await pg.query(
      `INSERT INTO internal_orders
        (id, market_id, user_id, side, price, initial_size, remaining_size, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [order.id, order.market_id, order.user_id, order.side, order.price, order.initial_size, order.remaining_size, order.status, order.created_at, order.updated_at]
    );

    const rebuilder = new InternalCrossBookRebuilder(pg, book, logger);
    const dryRun = await rebuilder.rebuild({ dryRun: true });
    expect(dryRun.postgresOpenOrders).toBe(1);

    const applied = await rebuilder.rebuild();
    expect(applied.rebuiltOrders).toBe(1);

    const restored = await book.getBestOppositeOrders(order.market_id, "buy", "0.55");
    expect(restored.map((entry) => entry.orderId)).toContain(order.id);
  });
});
