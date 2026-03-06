import pg from "pg";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { Pool } = pg;

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repoRoot = path.resolve(scriptDir, "..");
const envCandidates = [
  path.resolve(repoRoot, ".env"),
  path.resolve(repoRoot, "..", ".env")
];

for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[db:schema:validate] TEST_DATABASE_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const requiredTables = [
  "rfq_sessions",
  "rfq_quotes",
  "rfq_events",
  "rfq_executions",
  "lp_keys",
  "lp_stats",
  "routing_plans",
  "route_candidates",
  "route_steps",
  "route_history"
];

const requiredIndexes = [
  "idx_rfq_sessions_taker_created",
  "idx_rfq_quotes_session_created",
  "idx_rfq_events_session_created",
  "idx_lp_stats_lp_id",
  "idx_routing_plans_rfq",
  "idx_route_candidates_plan",
  "idx_route_steps_plan"
];

const pool = new Pool({ connectionString: databaseUrl });

const run = async () => {
  const tableResult = await pool.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])`,
    [requiredTables]
  );
  const foundTables = new Set(tableResult.rows.map((row) => row.table_name));
  const missingTables = requiredTables.filter((table) => !foundTables.has(table));
  if (missingTables.length > 0) {
    throw new Error(`Missing tables: ${missingTables.join(", ")}`);
  }

  const indexResult = await pool.query(
    `SELECT indexname
     FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = ANY($1::text[])`,
    [requiredIndexes]
  );
  const foundIndexes = new Set(indexResult.rows.map((row) => row.indexname));
  const missingIndexes = requiredIndexes.filter((indexName) => !foundIndexes.has(indexName));
  if (missingIndexes.length > 0) {
    throw new Error(`Missing indexes: ${missingIndexes.join(", ")}`);
  }
};

run()
  .then(async () => {
    await pool.end();
    console.log("[db:schema:validate] schema validation complete.");
  })
  .catch(async (error) => {
    console.error("[db:schema:validate] validation failed.", error);
    await pool.end();
    process.exit(1);
  });
