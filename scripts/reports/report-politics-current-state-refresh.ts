#!/usr/bin/env tsx
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import {
  loadPoliticsCurrentRefreshEnv,
  runPoliticsCurrentStateRefresh
} from "../../src/reports/politics-current-state-refresh.js";

loadPoliticsCurrentRefreshEnv();

const main = async (): Promise<void> => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    application_name: "report-politics-current-state-refresh"
  });

  try {
    const result = await runPoliticsCurrentStateRefresh({
      pool,
      repoRoot
    });

    console.log(JSON.stringify({
      fetchSummary: result.fetchSummary,
      admissionSummary: result.admissionSummary,
      finalDecision: result.postRefreshFinalDecision
    }, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to run politics current-state refresh.");
  console.error(error);
  process.exit(1);
});
