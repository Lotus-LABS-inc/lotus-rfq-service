#!/usr/bin/env tsx
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import { loadPoliticsCurrentRefreshEnv } from "../../src/reports/politics-current-state-refresh.js";
import { runPoliticsOfficeWinnerUsPresident2028MatcherPass } from "../../src/reports/politics-office-winner-us-president-2028-matcher.js";

loadPoliticsCurrentRefreshEnv();

const main = async (): Promise<void> => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    application_name: "report-politics-office-winner-us-president-2028-matcher"
  });

  try {
    const result = await runPoliticsOfficeWinnerUsPresident2028MatcherPass({
      pool,
      repoRoot
    });

    console.log(JSON.stringify({
      inputSummary: result.inputSummary,
      finalDecision: result.finalDecision
    }, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to run politics office-winner us-president-2028 matcher pass.");
  console.error(error);
  process.exit(1);
});
