#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

const envCandidates = [path.resolve(process.cwd(), "..", ".env"), path.resolve(process.cwd(), ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const resetTables = [
  "historical_simulation_results",
  "historical_simulation_runs",
  "historical_market_states",
  "historical_simulation_risk_assessments",
  "historical_simulation_profiles",
  "resolution_risk_assessments",
  "resolution_profiles",
  "canonical_executable_market_members",
  "canonical_executable_markets",
  "compatibility_edges",
  "venue_settlement_profiles",
  "venue_resolution_profiles",
  "proposition_fingerprints",
  "venue_market_profiles",
  "canonical_events"
] as const;

type ResetTable = typeof resetTables[number];

const countRows = async (pool: Pool, table: ResetTable): Promise<number> => {
  const result = await pool.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${table}`);
  return result.rows[0]?.count ?? 0;
};

const main = async (): Promise<void> => {
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "reset-canonical-ingestion-state",
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000
  });

  try {
    const before = new Map<ResetTable, number>();
    for (const table of resetTables) {
      before.set(table, await countRows(pool, table));
    }

    await pool.query("BEGIN");
    try {
      await pool.query(`TRUNCATE TABLE ${resetTables.join(", ")} RESTART IDENTITY CASCADE`);
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }

    const after = new Map<ResetTable, number>();
    for (const table of resetTables) {
      after.set(table, await countRows(pool, table));
    }

    console.log("Reset canonical ingestion state.");
    for (const table of resetTables) {
      console.log(`${table}\tbefore=${before.get(table) ?? 0}\tafter=${after.get(table) ?? 0}`);
    }
  } finally {
    await pool.end();
  }
};

main().catch((error: unknown) => {
  console.error("Failed to reset canonical ingestion state.");
  console.error(error);
  process.exit(1);
});
