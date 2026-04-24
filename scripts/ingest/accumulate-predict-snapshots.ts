#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import type { PredictEnvironment } from "../../src/integrations/predict/predict-types.js";
import { runPredictSnapshotAccumulation } from "../../src/operations/semantic-expansion/predict-snapshot-accumulation.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

interface ParsedArgs {
  environment: PredictEnvironment;
  sampleSize: number;
  targetSnapshotCount: number;
  wallClockBudgetMs: number;
  pollIntervalMs: number;
  recorderDurationMs: number;
}

const parseArgs = (): ParsedArgs => {
  const args = new Map<string, string>();
  for (const rawArg of process.argv.slice(2)) {
    if (!rawArg.startsWith("--")) {
      continue;
    }
    const [key, ...rest] = rawArg.slice(2).split("=");
    args.set(key, rest.join("="));
  }

  const environment = (args.get("environment") ?? "mainnet") as PredictEnvironment;
  if (environment !== "mainnet" && environment !== "testnet") {
    throw new Error(`Invalid Predict environment: ${environment}`);
  }

  return {
    environment,
    sampleSize: Number.parseInt(args.get("sampleSize") ?? "8", 10),
    targetSnapshotCount: Number.parseInt(args.get("targetSnapshotCount") ?? "100", 10),
    wallClockBudgetMs: Number.parseInt(args.get("wallClockBudgetMs") ?? String(4 * 60 * 60 * 1000), 10),
    pollIntervalMs: Number.parseInt(args.get("pollIntervalMs") ?? "5000", 10),
    recorderDurationMs: Number.parseInt(args.get("recorderDurationMs") ?? "5000", 10)
  };
};

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const args = parseArgs();
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "accumulate-predict-snapshots"
  });

  try {
    const summary = await runPredictSnapshotAccumulation({
      repoRoot: process.cwd(),
      pool,
      environment: args.environment,
      sampleSize: args.sampleSize,
      targetSnapshotCount: args.targetSnapshotCount,
      wallClockBudgetMs: args.wallClockBudgetMs,
      pollIntervalMs: args.pollIntervalMs,
      recorderDurationMs: args.recorderDurationMs
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to accumulate Predict snapshots.");
  console.error(error);
  process.exit(1);
});
