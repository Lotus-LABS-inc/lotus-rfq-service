import "dotenv/config";
import path from "node:path";

import { Pool } from "pg";

import { runPoliticsGeopoliticalTrumpVisitChina20260430LimitedProdReadinessPass } from "../../src/reports/politics-geopolitical-trump-visit-china-2026-04-30-limited-prod-readiness.js";

const main = async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    await runPoliticsGeopoliticalTrumpVisitChina20260430LimitedProdReadinessPass({
      pool,
      repoRoot: path.resolve(process.cwd())
    });
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
