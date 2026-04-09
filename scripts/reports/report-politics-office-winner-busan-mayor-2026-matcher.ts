import "dotenv/config";

import path from "node:path";

import { Pool } from "pg";

import { runPoliticsOfficeWinnerBusanMayor2026MatcherPass } from "../../src/reports/politics-office-winner-busan-mayor-2026-matcher.js";

const repoRoot = path.resolve(process.cwd());

const main = async (): Promise<void> => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    const result = await runPoliticsOfficeWinnerBusanMayor2026MatcherPass({
      pool,
      repoRoot
    });
    console.log(JSON.stringify(result.finalDecision, null, 2));
  } finally {
    await pool.end();
  }
};

await main();
