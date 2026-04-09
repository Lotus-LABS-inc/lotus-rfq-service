#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { buildCategoryGroupedCanonicalReport } from "../../src/operations/fast-testing/simulation-canonical-report.js";
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
    application_name: "report-simulation-canonical-events"
  });

  try {
    const simulationAdminService = createSimulationAdminService({
      pool
    });
    const report = await buildCategoryGroupedCanonicalReport({
      pool,
      simulationAdminService
    });

    writeArtifact(process.cwd(), "docs/simulation-canonical-events.json", report);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to generate simulation canonical event report.");
  console.error(error);
  process.exit(1);
});

