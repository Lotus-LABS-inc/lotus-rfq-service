#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { runPredictExactSeedAcquisition } from "../../src/operations/semantic-expansion/predict-exact-seed-acquisition.js";
import type { PredictEnvironment } from "../../src/integrations/predict/predict-types.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const args = new Map<string, string>();
for (const rawArg of process.argv.slice(2)) {
  if (!rawArg.startsWith("--")) {
    continue;
  }
  const [key, ...rest] = rawArg.slice(2).split("=");
  args.set(key, rest.join("="));
}

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  const predictApiKey = process.env.PREDICT_API_KEY;
  const environment = (args.get("environment") ?? "mainnet") as PredictEnvironment;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }
  if (!predictApiKey) {
    throw new Error("PREDICT_API_KEY is required.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "ingest-predict-same-day-seeds"
  });

  try {
    const summary = await runPredictExactSeedAcquisition({
      repoRoot: process.cwd(),
      pool,
      environment,
      apiKey: predictApiKey,
      sameDayOnly: true
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to ingest same-day Predict seeds.");
  console.error(error);
  process.exit(1);
});
