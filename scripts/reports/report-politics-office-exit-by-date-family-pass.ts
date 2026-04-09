import { Pool } from "pg";

import { runPoliticsOfficeExitByDateFamilyPass } from "../../src/reports/politics-office-exit-by-date-family-pass.js";
import { loadPoliticsCurrentRefreshEnv } from "../../src/reports/politics-current-state-refresh.js";

const main = async (): Promise<void> => {
  loadPoliticsCurrentRefreshEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({ connectionString });
  try {
    await runPoliticsOfficeExitByDateFamilyPass({
      pool,
      repoRoot: process.cwd()
    });
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
