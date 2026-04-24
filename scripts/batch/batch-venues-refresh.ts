#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { runVenueRefreshBatch } from "../../src/operations/semantic-expansion/venue-refresh-batch.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "batch-venues-refresh"
  });

  try {
    const summary = await runVenueRefreshBatch({
      repoRoot: process.cwd(),
      pool
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to refresh venue inventory.");
  console.error(error);
  process.exit(1);
});
