import "dotenv/config";
import path from "node:path";

import { Pool } from "pg";

import { runPoliticsGeopoliticalTrumpAcquireGreenland20261231LimitedProdReadinessPass } from "../../src/reports/politics-geopolitical-trump-acquire-greenland-2026-12-31-limited-prod-readiness.js";

const main = async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    await runPoliticsGeopoliticalTrumpAcquireGreenland20261231LimitedProdReadinessPass({
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
