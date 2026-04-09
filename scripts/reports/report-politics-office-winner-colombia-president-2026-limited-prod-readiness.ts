import path from "node:path";

import { Pool } from "pg";

import { runPoliticsOfficeWinnerColombiaPresident2026LimitedProdReadinessPass } from "../../src/reports/politics-office-winner-colombia-president-2026-limited-prod-readiness.js";
import { loadPoliticsCurrentRefreshEnv } from "../../src/reports/politics-current-state-refresh.js";

const main = async () => {
  loadPoliticsCurrentRefreshEnv();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const repoRoot = path.resolve(process.cwd());
    const result = await runPoliticsOfficeWinnerColombiaPresident2026LimitedProdReadinessPass({
      pool,
      repoRoot
    });
    console.log(JSON.stringify(result.artifacts.readiness, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
