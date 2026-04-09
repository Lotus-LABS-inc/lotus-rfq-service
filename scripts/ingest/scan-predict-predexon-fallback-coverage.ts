#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { PredexonHistoricalClient, PredexonRateLimitError } from "../src/integrations/predexon/predexon-client.js";
import { PredexonPredictFallbackLoader } from "../src/integrations/predict/predexon-predict-fallback-loader.js";
import type { PredictEnvironment } from "../src/integrations/predict/predict-types.js";
import { PredictReadinessRepository } from "../src/repositories/predict-readiness.repository.js";

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

const sleep = async (durationMs: number): Promise<void> => {
  if (durationMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, durationMs));
  }
};

const stderrLogger = {
  info: (...args: readonly unknown[]) => {
    console.error(...args);
  },
  warn: (...args: readonly unknown[]) => {
    console.error(...args);
  },
  error: (...args: readonly unknown[]) => {
    console.error(...args);
  }
};

const parseArgs = (): ParsedArgs => {
  const args = new Map<string, string>();
  for (const rawArg of process.argv.slice(2)) {
    if (!rawArg.startsWith("--")) continue;
    const [key, ...rest] = rawArg.slice(2).split("=");
    args.set(key, rest.join("="));
  }

  const environment = (args.get("environment") ?? "mainnet") as PredictEnvironment;
  if (environment !== "mainnet" && environment !== "testnet") {
    throw new Error(`Invalid Predict environment: ${environment}`);
  }

  const marketIds = (args.get("marketIds") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (marketIds.length === 0) {
    throw new Error("marketIds is required. Pass --marketIds=123,456");
  }

  const start = new Date(args.get("start") ?? "");
  const end = new Date(args.get("end") ?? "");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("start and end must be valid ISO datetimes.");
  }
  if (start.getTime() >= end.getTime()) {
    throw new Error("start must be earlier than end.");
  }

  return {
    environment,
    marketIds: [...new Set(marketIds)],
    start,
    end
  };
};

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  const predexonApiKey = process.env.PREDEXON_API_KEY;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  if (!predexonApiKey) throw new Error("PREDEXON_API_KEY is required.");

  const args = parseArgs();
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "scan-predict-predexon-fallback-coverage"
  });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS predict_fallback_coverage_scans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        environment TEXT NOT NULL,
        market_id TEXT NOT NULL,
        window_start TIMESTAMPTZ NOT NULL,
        window_end TIMESTAMPTZ NOT NULL,
        snapshot_count INTEGER NOT NULL,
        first_snapshot_at TIMESTAMPTZ NULL,
        last_snapshot_at TIMESTAMPTZ NULL,
        scan_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_predict_fallback_coverage_scans UNIQUE(environment, market_id, window_start, window_end)
      )`);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_predict_fallback_coverage_scans_env_market_window
      ON predict_fallback_coverage_scans(environment, market_id, window_start, window_end)`);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_predict_fallback_coverage_scans_snapshot_count
      ON predict_fallback_coverage_scans(snapshot_count)`);

    const repository = new PredictReadinessRepository(pool);
    const client = new PredexonHistoricalClient({
      baseUrl: process.env.PREDEXON_BASE_URL ?? "https://api.predexon.com",
      apiKey: predexonApiKey,
      logger: stderrLogger
    });
    const loader = new PredexonPredictFallbackLoader(client);
    const report: Array<Record<string, unknown>> = [];
    const maxRateLimitRetries = 2;
    const defaultBackoffMs = 5_000;

    for (const marketId of args.marketIds) {
      let snapshots = [] as Awaited<ReturnType<typeof loader.load>>;
      let rateLimitRetries = 0;
      let marketError: string | null = null;

      while (true) {
        try {
          snapshots = await loader.load({
            environment: args.environment,
            marketId,
            start: args.start,
            end: args.end
          });
          break;
        } catch (error) {
          if (error instanceof PredexonRateLimitError && rateLimitRetries < maxRateLimitRetries) {
            rateLimitRetries += 1;
            const waitMs = error.retryAfterMs ?? defaultBackoffMs;
            console.error(
              `Predexon rate limit for market ${marketId}. Retrying ${rateLimitRetries}/${maxRateLimitRetries} after ${waitMs}ms.`
            );
            await sleep(waitMs);
            continue;
          }
          marketError = error instanceof Error ? error.message : String(error);
          break;
        }
      }

      const firstSnapshotAt = snapshots[0]?.timestamp ?? null;
      const lastSnapshotAt = snapshots.length > 0 ? snapshots[snapshots.length - 1]!.timestamp : null;

      await repository.upsertFallbackCoverageScan({
        environment: args.environment,
        marketId,
        windowStart: args.start,
        windowEnd: args.end,
        snapshotCount: snapshots.length,
        firstSnapshotAt,
        lastSnapshotAt,
        metadata: {
          provenance: "PREDExON_FALLBACK",
          fidelity: snapshots.some((snapshot) => snapshot.fidelity === "ORDERBOOK") ? "ORDERBOOK" : "NONE",
          documentedConstraint: "predict_predexon_orderbook_only_yes_side_only",
          rateLimitRetries,
          error: marketError
        }
      });

      report.push({
        marketId,
        environment: args.environment,
        snapshotCount: snapshots.length,
        firstSnapshotAt: firstSnapshotAt?.toISOString() ?? null,
        lastSnapshotAt: lastSnapshotAt?.toISOString() ?? null,
        hasCoverage: snapshots.length > 0,
        rateLimitRetries,
        error: marketError
      });
    }

    process.stdout.write(`${JSON.stringify({
      environment: args.environment,
      windowStart: args.start.toISOString(),
      windowEnd: args.end.toISOString(),
      marketsScanned: args.marketIds.length,
      nonEmptyCoverageCount: report.filter((entry) => entry.hasCoverage === true).length,
      errorCount: report.filter((entry) => typeof entry.error === "string" && entry.error.length > 0).length,
      report
    }, null, 2)}\n`);
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Predict Predexon fallback coverage scan failed.");
  console.error(error);
  process.exit(1);
});
