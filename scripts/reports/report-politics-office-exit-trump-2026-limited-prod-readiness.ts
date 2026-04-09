import { Pool } from "pg";

import { loadPoliticsCurrentRefreshEnv } from "../../src/reports/politics-current-state-refresh.js";
import { runPoliticsOfficeExitTrump2026LimitedProdReadinessPass } from "../../src/reports/politics-office-exit-trump-2026-limited-prod-readiness.js";

const main = async (): Promise<void> => {
  loadPoliticsCurrentRefreshEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({ connectionString });
  try {
    await runPoliticsOfficeExitTrump2026LimitedProdReadinessPass({
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


