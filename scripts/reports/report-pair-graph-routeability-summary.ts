#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { writeArtifact } from "../../src/operations/semantic-expansion/shared.js";
import { buildPairGraphRouteabilitySummary } from "../../src/reports/pair-graph-routeability-summary.js";

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
    application_name: "report-pair-graph-routeability-summary"
  });

  try {
    const report = await buildPairGraphRouteabilitySummary(pool, { refresh: true });
    writeArtifact(process.cwd(), "docs/pair-graph-routeability-summary.json", report);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to build pair graph routeability summary.");
  console.error(error);
  process.exit(1);
});

