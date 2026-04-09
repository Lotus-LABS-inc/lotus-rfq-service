import "dotenv/config";
import path from "node:path";

import { Pool } from "pg";

import { runPoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherPass } from "../../src/reports/politics-geopolitical-trump-acquire-greenland-2026-12-31-matcher.js";

const main = async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    await runPoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherPass({
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
