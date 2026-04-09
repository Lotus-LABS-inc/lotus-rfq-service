import "dotenv/config";
import path from "node:path";

import { Pool } from "pg";

import { runPoliticsGeopoliticalTrumpAcquireGreenlandFamilyPass } from "../../src/reports/politics-geopolitical-trump-acquire-greenland-family-pass.js";

const main = async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    await runPoliticsGeopoliticalTrumpAcquireGreenlandFamilyPass({
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
