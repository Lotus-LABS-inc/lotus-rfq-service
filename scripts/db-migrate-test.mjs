import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

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

const migrationDirs = [
  path.join(repoRoot, "infra", "migrations"),
  path.join(repoRoot, "sql", "migrations")
];

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[db:migrate:test] TEST_DATABASE_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });

const run = async () => {
  for (const migrationsDir of migrationDirs) {
    const files = (await readdir(migrationsDir))
      .filter((name) => name.endsWith(".sql"))
      .sort((left, right) => left.localeCompare(right));

    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      try {
        await pool.query(sql);
        console.log(`[db:migrate:test] applied ${path.basename(migrationsDir)}/${file}`);
      } catch (error) {
        const code = error instanceof Error && "code" in error ? error.code : undefined;
        if (code === "42P07" || code === "42710") {
          console.log(`[db:migrate:test] skipped existing ${path.basename(migrationsDir)}/${file}`);
          continue;
        }
        throw error;
      }
    }
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
