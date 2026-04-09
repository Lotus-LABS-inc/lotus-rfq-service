#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { runLimitlessLiveMarketIngestion } from "../src/jobs/ingest-limitless-live-markets.job.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const main = async (): Promise<void> => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    application_name: "sync-limitless-live-current-state"
  });

  try {
    const summary = await runLimitlessLiveMarketIngestion({
      repoRoot: process.cwd(),
      pool,
      fetchRemote: false
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to sync Limitless live current-state markets.");
  console.error(error);
  process.exit(1);
});
