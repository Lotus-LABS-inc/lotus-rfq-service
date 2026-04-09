#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { Pool } from "pg";

import {
  type HistoricalRouteManifestEntry,
  runProvenHistoricalBatch
} from "../src/operations/fast-testing/proven-historical-batch.js";
import { createSimulationAdminService } from "../src/operations/fast-testing/simulation-admin-service-factory.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

interface ParsedArgs {
  curationPath: string;
  requestedNotional: string;
  strategyKey: string;
  dryRun: boolean;
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

  return {
    curationPath: args.get("curationPath") ?? path.resolve(process.cwd(), "docs", "historical-route-curation.json"),
    requestedNotional: args.get("requestedNotional") ?? "100",
    strategyKey: args.get("strategyKey") ?? "strategy.sim.v1",
    dryRun: (args.get("dryRun") ?? "false").toLowerCase() === "true"
  };
};

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const args = parseArgs();
  const manifest = JSON.parse(await readFile(args.curationPath, "utf8")) as {
    routes?: readonly HistoricalRouteManifestEntry[];
  };
  const routes = manifest.routes ?? [];
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "batch-historical-proven"
  });

  try {
    const simulationAdminService = createSimulationAdminService({
      pool
    });
    const summary = await runProvenHistoricalBatch({
      routes,
      simulationAdminService,
      requestedNotional: args.requestedNotional,
      strategyKey: args.strategyKey,
      dryRun: args.dryRun
    });

    console.log(JSON.stringify({
      requestedNotional: args.requestedNotional,
      strategyKey: args.strategyKey,
      dryRun: args.dryRun,
      plannedRunCount: summary.plannedRuns.length,
      skippedRouteCount: summary.skippedRoutes.length,
      completedRunCount: summary.completedRuns.length,
      failedRunCount: summary.failedRuns.length,
      skippedRoutes: summary.skippedRoutes,
      completedRuns: summary.completedRuns.map((result) => ({
        canonicalEventId: result.plan.canonicalEventId,
        canonicalMarketId: result.plan.canonicalMarketId,
        routeMode: result.plan.routeMode,
        side: result.plan.side,
        from: result.plan.from.toISOString(),
        to: result.plan.to.toISOString(),
        runId: result.runId,
        status: result.status,
        persistedResultCount: result.persistedResultCount,
        blockedSliceCount: result.blockedSliceCount,
        sliceCount: result.sliceCount
      })),
      failedRuns: summary.failedRuns.map((result) => ({
        canonicalEventId: result.plan.canonicalEventId,
        canonicalMarketId: result.plan.canonicalMarketId,
        routeMode: result.plan.routeMode,
        side: result.plan.side,
        from: result.plan.from.toISOString(),
        to: result.plan.to.toISOString(),
        errorCode: result.errorCode,
        errorMessage: result.errorMessage
      }))
    }, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to run proven historical simulation batch.");
  console.error(error);
  process.exit(1);
});
