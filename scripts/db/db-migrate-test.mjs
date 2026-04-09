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

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[db:migrate:test] TEST_DATABASE_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });

const run = async () => {
  const summary = await applyMigrationsWithLedger({
    pool,
    migrationDirs: migrationDirsForRepo(repoRoot),
    logPrefix: "db:migrate:test",
    appliedBy: "db-migrate-test"
  });
  console.log(
    `[db:migrate:test] migration run complete. applied=${summary.applied} skipped=${summary.skipped} total=${summary.total}`
  );
};

run()
  .then(async () => {
    await pool.end();
  })
  .catch(async (error) => {
    console.error("[db:migrate:test] migration failed.", error);
    await pool.end();
    process.exit(1);
  });
