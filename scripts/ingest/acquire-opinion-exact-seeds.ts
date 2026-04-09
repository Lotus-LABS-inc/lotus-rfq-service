#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { runOpinionExactSeedAcquisition } from "../src/operations/semantic-expansion/opinion-exact-seed-acquisition.js";

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
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }
  if (!opinionApiKey) {
    throw new Error("OPINION_API_KEY is required.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "acquire-opinion-exact-seeds"
  });

  try {
    const summary = await runOpinionExactSeedAcquisition({
      repoRoot: process.cwd(),
      pool,
      opinionBaseUrl,
      opinionApiKey
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to acquire exact-seed Opinion candidates.");
  console.error(error);
  process.exit(1);
});
