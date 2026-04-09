#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { createSimulationAdminService } from "../../src/operations/fast-testing/simulation-admin-service-factory.js";
import { buildTimeBasisRouteabilitySummary } from "../../src/operations/semantic-expansion/time-basis-routeability-summary.js";

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
    application_name: "report-time-basis-routeability-summary"
  });

  try {
    const summary = await buildTimeBasisRouteabilitySummary({
      repoRoot: process.cwd(),
      pool,
      simulationAdminService: createSimulationAdminService({ pool })
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to build time-basis routeability summary.");
  console.error(error);
  process.exit(1);
});

