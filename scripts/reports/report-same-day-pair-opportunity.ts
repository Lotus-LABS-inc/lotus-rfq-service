#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { buildSameDayPairOpportunityReport } from "../../src/operations/semantic-expansion/same-day-pair-opportunity-report.js";

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
    application_name: "report-same-day-pair-opportunity"
  });

  try {
    const report = await buildSameDayPairOpportunityReport({
      repoRoot: process.cwd(),
      pool
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to build same-day pair opportunity report.");
  console.error(error);
  process.exit(1);
});

