#!/usr/bin/env tsx
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import { loadPoliticsCurrentRefreshEnv } from "../../src/reports/politics-current-state-refresh.js";
import { runPoliticsNominee2028RepublicanTriMatcherPass } from "../../src/reports/politics-nominee-2028-republican-tri-matcher.js";

loadPoliticsCurrentRefreshEnv();

const main = async (): Promise<void> => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    application_name: "report-politics-nominee-2028-republican-tri-matcher"
  });

  try {
    const result = await runPoliticsNominee2028RepublicanTriMatcherPass({
      pool,
      repoRoot
    });

    console.log(JSON.stringify({
      inputSummary: result.inputSummary,
      lanes: result.lanes,
      finalDecision: result.finalDecision
    }, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to run politics nominee 2028 Republican tri matcher.");
  console.error(error);
  process.exit(1);
});
