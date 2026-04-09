import path from "node:path";

import { Pool } from "pg";

import { runPoliticsPartyControlBalanceOfPower2026MatcherPass } from "../../src/reports/politics-party-control-balance-of-power-2026-matcher.js";
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
    const result = await runPoliticsPartyControlBalanceOfPower2026MatcherPass({
      pool,
      repoRoot
    });
    console.log(JSON.stringify(result.finalDecision, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
