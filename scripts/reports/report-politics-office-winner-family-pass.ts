#!/usr/bin/env tsx
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import { loadPoliticsCurrentRefreshEnv } from "../../src/reports/politics-current-state-refresh.js";
import { runPoliticsOfficeWinnerFamilyPass } from "../../src/reports/politics-office-winner-family-pass.js";

loadPoliticsCurrentRefreshEnv();

const main = async (): Promise<void> => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    application_name: "report-politics-office-winner-family-pass"
  });

  try {
    const result = await runPoliticsOfficeWinnerFamilyPass({
      pool,
      repoRoot
    });

    console.log(JSON.stringify({
      fetchSummary: result.fetchSummary,
      finalDecision: result.finalDecision
    }, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to run politics office-winner family pass.");
  console.error(error);
  process.exit(1);
});
