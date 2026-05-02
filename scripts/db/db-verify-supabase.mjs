import pg from "pg";

import { requiredIndexes, requiredTables } from "./db-schema-targets.mjs";
import {
  listMigrationFiles,
  loadRepoEnv,
  migrationDirsForRepo,
  resolveRepoRoot
} from "./db-migration-lib.mjs";

const { Pool } = pg;

const repoRoot = resolveRepoRoot(import.meta.url);
loadRepoEnv(repoRoot);

const databaseUrl = process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  console.error("[db:verify:supabase] SUPABASE_DB_URL must be set.");
  process.exit(1);
}

const pool = new Pool(poolConfigFor(databaseUrl));

const run = async () => {
  const target = new URL(databaseUrl);
  const migrations = await listMigrationFiles(migrationDirsForRepo(repoRoot));
  const expectedFilenames = migrations.map((migration) => `${migration.dirName}/${migration.file}`);

  const migrationResult = await pool.query(
    `SELECT filename
       FROM schema_migrations
      WHERE filename = ANY($1::text[])`,
    [expectedFilenames]
  );
  const foundMigrations = new Set(migrationResult.rows.map((row) => row.filename));
  const missingMigrations = expectedFilenames.filter((filename) => !foundMigrations.has(filename));

  const tableResult = await pool.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])`,
    [requiredTables]
  );
  const foundTables = new Set(tableResult.rows.map((row) => row.table_name));
  const missingTables = requiredTables.filter((table) => !foundTables.has(table));

  const indexResult = await pool.query(
    `SELECT indexname
       FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ANY($1::text[])`,
    [requiredIndexes]
  );
  const foundIndexes = new Set(indexResult.rows.map((row) => row.indexname));
  const missingIndexes = requiredIndexes.filter((indexName) => !foundIndexes.has(indexName));

  console.log(`[db:verify:supabase] target=${target.host}${target.pathname}`);
  console.log(
    `[db:verify:supabase] migrations=${expectedFilenames.length} missing_migrations=${missingMigrations.length} missing_tables=${missingTables.length} missing_indexes=${missingIndexes.length}`
  );

  if (missingMigrations.length > 0) {
    console.error(`[db:verify:supabase] missing migration ledger rows: ${missingMigrations.join(", ")}`);
  }
  if (missingTables.length > 0) {
    console.error(`[db:verify:supabase] missing tables: ${missingTables.join(", ")}`);
  }
  if (missingIndexes.length > 0) {
    console.error(`[db:verify:supabase] missing indexes: ${missingIndexes.join(", ")}`);
  }

  if (missingMigrations.length > 0 || missingTables.length > 0 || missingIndexes.length > 0) {
    throw new Error("Supabase schema verification failed.");
  }
};

run()
  .then(async () => {
    await pool.end();
    console.log("[db:verify:supabase] verification complete.");
  })
  .catch(async (error) => {
    console.error("[db:verify:supabase] verification failed.", error);
    await pool.end();
    process.exit(1);
  });

function poolConfigFor(connectionString) {
  return {
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: Number.parseInt(process.env.SUPABASE_DB_CONNECT_TIMEOUT_MS ?? "30000", 10)
  };
}
