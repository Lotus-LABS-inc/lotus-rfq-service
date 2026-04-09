#!/usr/bin/env tsx
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import { loadPoliticsCurrentRefreshEnv } from "../../src/reports/politics-current-state-refresh.js";
import { runPoliticsManualFamilyPass } from "../../src/reports/politics-manual-family-pass.js";

loadPoliticsCurrentRefreshEnv();

const main = async (): Promise<void> => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    application_name: "report-politics-manual-family-pass"
  });

  try {
    const result = await runPoliticsManualFamilyPass({
      pool,
      repoRoot
    });

    console.log(JSON.stringify({
      fetchSummary: result.fetchSummary,
      decisionSummary: result.decisionSummary,
      deltaVsPostRefresh: result.deltaVsPostRefresh
    }, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to run politics manual family pass.");
  console.error(error);
  process.exit(1);
});
