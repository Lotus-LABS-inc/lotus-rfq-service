#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { runBtcInventoryGapDiagnostic } from "../../src/operations/semantic-expansion/btc-inventory-gap-diagnostic.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  const opinionApiKey = process.env.OPINION_API_KEY;
  const opinionBaseUrl = process.env.OPINION_OPENAPI_BASE_URL ?? "https://openapi.opinion.trade/openapi";
  const predexonApiKey = process.env.PREDEXON_API_KEY ?? null;
  const predexonBaseUrl = process.env.PREDEXON_BASE_URL ?? "https://api.predexon.com";
  const limitlessApiKey = process.env.LIMITLESS_API_KEY ?? null;
  const limitlessBaseUrl = process.env.LIMITLESS_BASE_URL ?? "https://api.limitless.exchange";
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }
  if (!opinionApiKey) {
    throw new Error("OPINION_API_KEY is required.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "report-btc-inventory-gap-diagnostic"
  });

  try {
    const result = await runBtcInventoryGapDiagnostic({
      repoRoot: process.cwd(),
      pool,
      opinionBaseUrl,
      opinionApiKey,
      predexonBaseUrl,
      predexonApiKey,
      limitlessBaseUrl,
      limitlessApiKey
    });
    console.log(JSON.stringify(result.summary, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to build BTC inventory-gap diagnostic.");
  console.error(error);
  process.exit(1);
});

