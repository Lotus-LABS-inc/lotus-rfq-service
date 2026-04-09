#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { PredexonHistoricalClient } from "../src/integrations/predexon/predexon-client.js";
import { PredexonPredictFallbackLoader } from "../src/integrations/predict/predexon-predict-fallback-loader.js";
import type { PredictEnvironment } from "../src/integrations/predict/predict-types.js";
import { PredictFallbackRepository } from "../src/repositories/predict-fallback.repository.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

interface ParsedArgs {
  environment: PredictEnvironment;
  marketIds: readonly string[];
  start: Date;
  end: Date;
}

const parseKeyValueArgs = (): Map<string, string> => {
  const args = new Map<string, string>();
  for (const rawArg of process.argv.slice(2)) {
    if (!rawArg.startsWith("--")) {
      continue;
    }
    const [key, ...rest] = rawArg.slice(2).split("=");
    args.set(key, rest.join("="));
  }
  return args;
};

const parseDateArg = (value: string | undefined, fallback: Date): Date => {
  if (!value) {
    return fallback;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO datetime: ${value}`);
  }
  return parsed;
};

const parseEnvironment = (value: string | undefined): PredictEnvironment => {
  if (!value || value === "mainnet" || value === "testnet") {
    return (value ?? "mainnet") as PredictEnvironment;
  }
  throw new Error(`Invalid Predict environment: ${value}`);
};

const parseMarketIds = (value: string | undefined): readonly string[] => {
  if (!value) {
    throw new Error("marketIds is required. Pass --marketIds=123,456");
  }
  const marketIds = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (marketIds.length === 0) {
    throw new Error("At least one market id is required.");
  }

  return [...new Set(marketIds)];
};

const parseArgs = (): ParsedArgs => {
  const args = parseKeyValueArgs();
  const now = new Date();
  const defaultStart = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
  const environment = parseEnvironment(args.get("environment"));
  const start = parseDateArg(args.get("start"), defaultStart);
  const end = parseDateArg(args.get("end"), now);

  if (start.getTime() >= end.getTime()) {
    throw new Error("start must be earlier than end");
  }

  return {
    environment,
    marketIds: parseMarketIds(args.get("marketIds")),
    start,
    end
  };
};

const buildLogger = () => ({
  info: (...args: unknown[]) => console.log(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args)
});

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const predexonApiKey = process.env.PREDEXON_API_KEY;
  if (!predexonApiKey) {
    throw new Error("PREDEXON_API_KEY is required.");
  }

  const predexonBaseUrl = process.env.PREDEXON_BASE_URL ?? "https://api.predexon.com";
  const logger = buildLogger();
  const args = parseArgs();
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 4,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 120_000,
    query_timeout: 120_000,
    application_name: "ingest-predict-predexon-fallback"
  });

  try {
    const client = new PredexonHistoricalClient({
      baseUrl: predexonBaseUrl,
      apiKey: predexonApiKey,
      logger
    });
    const loader = new PredexonPredictFallbackLoader(client);
    const repository = new PredictFallbackRepository(pool);

    for (const marketId of args.marketIds) {
      logger.info(
        {
          environment: args.environment,
          marketId,
          start: args.start.toISOString(),
          end: args.end.toISOString()
        },
        "Starting Predexon Predict fallback ingestion."
      );

      const snapshots = await loader.load({
        environment: args.environment,
        marketId,
        start: args.start,
        end: args.end
      });

      const inserted = await repository.insertMany(
        snapshots.map((snapshot) => ({
          environment: snapshot.environment,
          marketId: snapshot.marketId,
          provenance: snapshot.provenance,
          fidelity: snapshot.fidelity,
          sourceTimestamp: snapshot.timestamp,
          snapshot: snapshot.snapshot
        }))
      );

      logger.info(
        {
          environment: args.environment,
          marketId,
          fetchedSnapshots: snapshots.length,
          insertedSnapshots: inserted,
          note: "Predexon Predict fallback is orderbook-only and YES-side only per the documented endpoint."
        },
        "Completed Predexon Predict fallback ingestion."
      );
    }
  } finally {
    await pool.end();
  }
};

main().catch((error: unknown) => {
  console.error("Predict Predexon fallback ingestion failed.");
  console.error(error);
  process.exit(1);
});
