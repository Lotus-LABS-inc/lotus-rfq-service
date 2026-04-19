import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { applyMigrations } from "../support/phase3a-proof-support.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const ENV_READY = Boolean(TEST_DB_URL);

const requiredTables = [
  "combo_rfqs",
  "combo_netting_groups",
  "route_candidates",
  "historical_market_states",
  "predict_fallback_historical_snapshots"
] as const;

const adminDatabaseUrlFor = (databaseUrl: string): string => {
  const parsed = new URL(databaseUrl);
  parsed.pathname = "/postgres";
  return parsed.toString();
};

const databaseUrlFor = (databaseUrl: string, databaseName: string): string => {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
};

describe.skipIf(!ENV_READY)("phase3a migration ordering", () => {
  const adminPool = new Pool({ connectionString: adminDatabaseUrlFor(TEST_DB_URL as string) });
  const databaseName = `phase3a_order_${randomUUID().replace(/-/g, "")}`;
  const dbPool = new Pool({ connectionString: databaseUrlFor(TEST_DB_URL as string, databaseName) });

  afterAll(async () => {
    await dbPool.end().catch(() => undefined);

    await adminPool.query(
      `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
        WHERE datname = $1
          AND pid <> pg_backend_pid()`,
      [databaseName]
    ).catch(() => undefined);
    await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}"`).catch(() => undefined);
    await adminPool.end().catch(() => undefined);
  }, 180000);

  it("applies the phase3a migration sequence on a fresh database", async () => {
    await adminPool.query(`CREATE DATABASE "${databaseName}"`);

    await expect(applyMigrations(dbPool)).resolves.toBeUndefined();

    for (const tableName of requiredTables) {
      const result = await dbPool.query<{ oid: string | null }>(
        `SELECT to_regclass($1) AS oid`,
        [`public.${tableName}`]
      );
      expect(result.rows[0]?.oid).toBe(tableName);
    }

    const remainingSizeColumn = await dbPool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'combo_legs'
           AND column_name = 'remaining_size'
       ) AS exists`
    );
    expect(remainingSizeColumn.rows[0]?.exists).toBe(true);
  }, 180000);
});
