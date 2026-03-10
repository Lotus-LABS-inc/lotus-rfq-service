import pg from "pg";

import {
  applyMigrationsWithLedger,
  loadRepoEnv,
  migrationDirsForRepo,
  resolveRepoRoot
} from "./db-migration-lib.mjs";

const { Pool } = pg;

const repoRoot = resolveRepoRoot(import.meta.url);
loadRepoEnv(repoRoot);

const databaseUrl = process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  console.error("[db:migrate:supabase] SUPABASE_DB_URL must be set.");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });

const run = async () => {
  const target = new URL(databaseUrl);
  const summary = await applyMigrationsWithLedger({
    pool,
    migrationDirs: migrationDirsForRepo(repoRoot),
    logPrefix: "db:migrate:supabase",
    appliedBy: "db-migrate-supabase"
  });
  console.log(
    `[db:migrate:supabase] target=${target.host}${target.pathname} applied=${summary.applied} skipped=${summary.skipped} total=${summary.total}`
  );
};

run()
  .then(async () => {
    await pool.end();
  })
  .catch(async (error) => {
    console.error("[db:migrate:supabase] migration failed.", error);
    await pool.end();
    process.exit(1);
  });
