#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { writeArtifact } from "../../src/operations/semantic-expansion/shared.js";
import { buildMatchingQualitySummary } from "../../src/reports/matching-quality-summary.js";

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
    application_name: "report-matching-quality-summary"
  });

  try {
    const report = await buildMatchingQualitySummary(pool, { refresh: true });
    writeArtifact(process.cwd(), "docs/matching-quality-summary.json", report);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to build matching quality summary.");
  console.error(error);
  process.exit(1);
});

