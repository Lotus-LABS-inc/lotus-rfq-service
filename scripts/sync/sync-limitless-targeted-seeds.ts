#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { runLimitlessTargetedExpansion } from "../src/operations/semantic-expansion/limitless-targeted-expansion.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const main = async (): Promise<void> => {
  const venueMarketIds = process.argv
    .slice(2)
    .filter((argument) => argument.startsWith("--venueMarketId="))
    .map((argument) => argument.slice("--venueMarketId=".length))
    .filter((value) => value.length > 0);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "sync-limitless-targeted-seeds"
  });

  try {
    const summary = await runLimitlessTargetedExpansion({
      repoRoot: process.cwd(),
      pool,
      venueMarketIds
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to seed targeted Limitless markets.");
  console.error(error);
  process.exit(1);
});
