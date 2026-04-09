#!/usr/bin/env tsx
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import { loadPoliticsCurrentRefreshEnv } from "../../src/reports/politics-current-state-refresh.js";
import { runPoliticsNominee2028DemocraticLimitedProdReadinessPass } from "../../src/reports/politics-nominee-2028-democratic-limited-prod-readiness.js";

loadPoliticsCurrentRefreshEnv();

const main = async (): Promise<void> => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    application_name: "report-politics-nominee-2028-democratic-limited-prod-readiness"
  });

  try {
    const result = await runPoliticsNominee2028DemocraticLimitedProdReadinessPass({
      pool,
      repoRoot
    });

    console.log(JSON.stringify({
      readiness: result.artifacts.readiness,
      adminSurfaceSummary: result.artifacts.adminSurfaceSummary
    }, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to run politics nominee 2028 Democratic limited-prod readiness.");
  console.error(error);
  process.exit(1);
});
