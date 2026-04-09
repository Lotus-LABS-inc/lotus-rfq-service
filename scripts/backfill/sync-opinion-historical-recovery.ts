#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { runOpinionHistoricalRecovery } from "../src/integrations/opinion/opinion-historical-market-loader.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  const opinionApiKey = process.env.OPINION_API_KEY;
  const predexonApiKey = process.env.PREDEXON_API_KEY;
  if (!databaseUrl || !opinionApiKey || !predexonApiKey) {
    throw new Error("DATABASE_URL, OPINION_API_KEY, and PREDEXON_API_KEY are required.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "sync-opinion-historical-recovery"
  });

  try {
    const summary = await runOpinionHistoricalRecovery({
      repoRoot: process.cwd(),
      pool,
      opinionBaseUrl: process.env.OPINION_OPENAPI_BASE_URL ?? "https://openapi.opinion.trade/openapi",
      opinionApiKey,
      predexonBaseUrl: process.env.PREDEXON_BASE_URL ?? "https://api.predexon.com",
      predexonApiKey
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to recover historical Opinion markets.");
  console.error(error);
  process.exit(1);
});
