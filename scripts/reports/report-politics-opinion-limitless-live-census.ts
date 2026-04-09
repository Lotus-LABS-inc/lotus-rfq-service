import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { Pool } from "pg";

import { loadPoliticsCurrentRefreshEnv } from "../../src/reports/politics-current-state-refresh.js";
import { runPoliticsOpinionLimitlessLiveCensusPass } from "../../src/reports/politics-opinion-limitless-live-census.js";

loadPoliticsCurrentRefreshEnv();

const main = async (): Promise<void> => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    application_name: "report-politics-opinion-limitless-live-census"
  });

  try {
    const result = await runPoliticsOpinionLimitlessLiveCensusPass({
      repoRoot
    });
    console.log(JSON.stringify(result.summary, null, 2));
  } finally {
    await pool.end().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error("Failed to run politics opinion/limitless live census.");
  console.error(error);
  process.exitCode = 1;
});
