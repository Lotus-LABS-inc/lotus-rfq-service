import pg from "pg";
import { requiredIndexes, requiredMaterializedViews, requiredTables } from "./db-schema-targets.mjs";
import { loadRepoEnv, resolveRepoRoot } from "./db-migration-lib.mjs";

const { Pool } = pg;
const repoRoot = resolveRepoRoot(import.meta.url);
loadRepoEnv(repoRoot);

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[db:schema:validate] TEST_DATABASE_URL or DATABASE_URL must be set.");
  process.exit(1);
}

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

  const materializedViewResult = await pool.query(
    `SELECT matviewname
     FROM pg_matviews
     WHERE schemaname = 'public'
       AND matviewname = ANY($1::text[])`,
    [requiredMaterializedViews]
  );
  const foundMaterializedViews = new Set(materializedViewResult.rows.map((row) => row.matviewname));
  const missingMaterializedViews = requiredMaterializedViews.filter((viewName) => !foundMaterializedViews.has(viewName));
  if (missingMaterializedViews.length > 0) {
    throw new Error(`Missing materialized views: ${missingMaterializedViews.join(", ")}`);
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
