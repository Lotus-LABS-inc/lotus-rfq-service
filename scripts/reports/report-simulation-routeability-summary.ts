#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { createSimulationAdminService } from "../../src/operations/fast-testing/simulation-admin-service-factory.js";
import { writeArtifact } from "../../src/operations/semantic-expansion/shared.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "report-simulation-routeability-summary"
  });

  try {
    const simulationAdminService = createSimulationAdminService({ pool });
    const summary = await simulationAdminService.getRouteabilitySummary({});
    writeArtifact(process.cwd(), "docs/simulation-routeability-summary.json", summary);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to generate simulation routeability summary.");
  console.error(error);
  process.exit(1);
});

