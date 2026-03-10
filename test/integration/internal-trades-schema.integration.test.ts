import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const ENV_READY = Boolean(TEST_DB_URL);

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const applyMigrations = async (pool: Pool): Promise<void> => {
  const migrationDirs = [
    path.resolve(process.cwd(), "infra", "migrations"),
    path.resolve(process.cwd(), "sql", "migrations")
  ];

  for (const migrationsDir of migrationDirs) {
    const files = (await readdir(migrationsDir))
      .filter((name) => name.endsWith(".sql"))
      .sort((left, right) => left.localeCompare(right));

    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      try {
        await pool.query(sql);
      } catch (error) {
        const code = error instanceof Error && "code" in error ? (error as { code?: string }).code : undefined;
        if (code === "42P07" || code === "42710") {
          continue;
        }
        throw error;
      }
    }
  }
};

const clearState = async (pool: Pool): Promise<void> => {
  let attempts = 0;
  while (attempts < 5) {
    try {
      await pool.query(
        `TRUNCATE TABLE
          trades,
          internal_orders,
          route_history,
          route_steps,
          route_candidates,
          routing_plans,
          rfq_executions,
          rfq_events,
          rfq_quotes,
          lp_keys,
          rfq_sessions
        RESTART IDENTITY CASCADE`
      );
      return;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? (error as { code?: string }).code : undefined;
      if (code !== "40P01") {
        throw error;
      }
      attempts += 1;
      await sleep(100 * attempts);
    }
  }

  throw new Error("Unable to clear internal trade schema integration state due to repeated deadlocks.");
};

describe.skipIf(!ENV_READY)("internal trades schema integration", () => {
  let pool: Pool | undefined;

  const must = <T>(value: T | undefined, name: string): T => {
    if (value === undefined) {
      throw new Error(`${name} not initialized`);
    }
    return value;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL as string });
    await applyMigrations(must(pool, "pool"));
    await clearState(must(pool, "pool"));
  }, 60000);

  beforeEach(async () => {
    await clearState(must(pool, "pool"));
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  }, 60000);

  it("creates the trades table with the required indexes", async () => {
    const db = must(pool, "pool");

    const tableResult = await db.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'trades'`
    );

    const indexResult = await db.query<{ indexname: string }>(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'trades'`
    );

    const indexNames = new Set(indexResult.rows.map((row) => row.indexname));

    expect(tableResult.rowCount).toBe(1);
    expect(indexNames.has("idx_trades_market_id")).toBe(true);
    expect(indexNames.has("idx_trades_buy_order_id")).toBe(true);
    expect(indexNames.has("idx_trades_sell_order_id")).toBe(true);
  });

  it("extends internal_order_status enum with PARTIAL", async () => {
    const db = must(pool, "pool");
    const enumResult = await db.query<{ enumlabel: string }>(
      `SELECT enumlabel
       FROM pg_enum
       JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
       WHERE pg_type.typname = 'internal_order_status'
       ORDER BY enumsortorder`
    );

    expect(enumResult.rows.map((row) => row.enumlabel)).toContain("PARTIAL");
  });

  it("prevents duplicate match insertion via the unique constraint", async () => {
    const db = must(pool, "pool");
    const marketId = `market-${randomUUID()}`;
    const buyOrderId = randomUUID();
    const sellOrderId = randomUUID();

    await db.query(
      `INSERT INTO trades (id, market_id, buy_order_id, sell_order_id, price, size)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), marketId, buyOrderId, sellOrderId, "1.25", "10"]
    );

    await expect(
      db.query(
        `INSERT INTO trades (id, market_id, buy_order_id, sell_order_id, price, size)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), marketId, buyOrderId, sellOrderId, "1.25", "10"]
      )
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "uq_trades_match"
    });
  });
});
