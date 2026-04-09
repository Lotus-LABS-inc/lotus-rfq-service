import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { Pool } from "pg";

import { runPoliticsOfficeWinnerSeoulMayor2026LimitedProdReadinessPass } from "../../src/reports/politics-office-winner-seoul-mayor-2026-limited-prod-readiness.js";

dotenv.config();

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "..", "..");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  application_name: "report-politics-office-winner-seoul-mayor-2026-limited-prod-readiness"
});

try {
  const result = await runPoliticsOfficeWinnerSeoulMayor2026LimitedProdReadinessPass({
    pool,
    repoRoot
  });
  console.log(JSON.stringify(result.artifacts.readiness, null, 2));
} finally {
  await pool.end();
}
