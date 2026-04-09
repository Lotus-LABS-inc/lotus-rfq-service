import "dotenv/config";
import path from "node:path";

import { Pool } from "pg";

import { runPoliticsGeopoliticalTrumpVisitChinaFamilyPass } from "../../src/reports/politics-geopolitical-trump-visit-china-family-pass.js";

const main = async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    await runPoliticsGeopoliticalTrumpVisitChinaFamilyPass({
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
