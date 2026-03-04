import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repoRoot = path.resolve(scriptDir, "..");
const migrationsDir = path.join(repoRoot, "infra", "migrations");

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[db:migrate:test] TEST_DATABASE_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });

const run = async () => {
  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    await pool.query(sql);
    console.log(`[db:migrate:test] applied ${file}`);
  }
};

run()
  .then(async () => {
    await pool.end();
    console.log("[db:migrate:test] migration run complete.");
  })
  .catch(async (error) => {
    console.error("[db:migrate:test] migration failed.", error);
    await pool.end();
    process.exit(1);
  });
