#!/usr/bin/env tsx
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import { loadPoliticsCurrentRefreshEnv } from "../../src/reports/politics-current-state-refresh.js";
import { runPoliticsNomineeLimitedProdReadinessPass } from "../../src/reports/politics-nominee-limited-prod-readiness.js";

loadPoliticsCurrentRefreshEnv();

const main = async (): Promise<void> => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    application_name: "report-politics-nominee-limited-prod-readiness"
  });

  try {
    const result = await runPoliticsNomineeLimitedProdReadinessPass({
      pool,
      repoRoot
    });

    console.log(JSON.stringify({
      readinessSummary: result.artifacts.readinessSummary
    }, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to run politics nominee limited-prod readiness.");
  console.error(error);
  process.exit(1);
});
