import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const resolveRepoRoot = (importMetaUrl) => {
  const scriptPath = fileURLToPath(importMetaUrl);
  let currentDir = path.dirname(scriptPath);
  while (currentDir !== path.dirname(currentDir)) {
    if (existsSync(path.join(currentDir, "package.json"))) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }
  return path.resolve(path.dirname(scriptPath), "..", "..");
};

export const loadRepoEnv = (repoRoot) => {
  const envCandidates = [path.resolve(repoRoot, ".env"), path.resolve(repoRoot, "..", ".env")];
  for (const envPath of envCandidates) {
    if (existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }
  }
};

export const migrationDirsForRepo = (repoRoot) => [
  path.join(repoRoot, "infra", "migrations"),
  path.join(repoRoot, "sql", "migrations")
];

const migrationOrderOverrides = new Map([
  ["2026_03_02_create_combo_tables.sql", -20],
  ["2026_03_02_combine_exec_plans.sql", -19],
  ["2026_03_10_create_combo_netting_tables.sql", -18],
  ["2026_03_10_create_combo_netting_attempts.sql", -17]
]);

const migrationPriority = (filename) => {
  const override = migrationOrderOverrides.get(filename);
  if (override !== undefined) {
    return override;
  }
  if (filename.includes("_create_")) return 0;
  if (filename.includes("_add_")) return 1;
  if (filename.includes("_update_")) return 2;
  if (filename.includes("_combine_")) return 3;
  return 4;
};

export const listMigrationFiles = async (migrationDirs) => {
  const migrations = [];
  for (const migrationsDir of migrationDirs) {
    if (!existsSync(migrationsDir)) {
      continue;
    }
    const files = (await readdir(migrationsDir))
      .filter((name) => name.endsWith(".sql"))
      .sort((left, right) => {
        const leftPriority = migrationPriority(left);
        const rightPriority = migrationPriority(right);
        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }
        return left.localeCompare(right);
      });
    for (const file of files) {
      migrations.push({
        dirName: path.basename(migrationsDir),
        file,
        fullPath: path.join(migrationsDir, file)
      });
    }
  }
  return migrations;
};

export const ensureSchemaMigrationsTable = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      checksum TEXT,
      applied_by TEXT
    )
  `);
};

const migrationRecorded = async (pool, filename) => {
  const result = await pool.query(
    `SELECT 1
       FROM schema_migrations
      WHERE filename = $1
      LIMIT 1`,
    [filename]
  );
  return result.rowCount > 0;
};

const recordMigration = async (pool, filename, checksum, appliedBy) => {
  await pool.query(
    `INSERT INTO schema_migrations (filename, checksum, applied_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (filename) DO NOTHING`,
    [filename, checksum, appliedBy]
  );
};

const checksumForSql = (sql) => createHash("sha256").update(sql).digest("hex");

const isSkippableExistingStateError = (error) => {
  const code = error instanceof Error && "code" in error ? error.code : undefined;
  return code === "42P07" || code === "42710" || code === "42701";
};

export const applyMigrationsWithLedger = async ({
  pool,
  migrationDirs,
  logPrefix,
  appliedBy
}) => {
  await ensureSchemaMigrationsTable(pool);

  let applied = 0;
  let skipped = 0;
  const migrations = await listMigrationFiles(migrationDirs);

  for (const migration of migrations) {
    const filename = `${migration.dirName}/${migration.file}`;
    const sql = await readFile(migration.fullPath, "utf8");
    const checksum = checksumForSql(sql);

    if (await migrationRecorded(pool, filename)) {
      skipped += 1;
      console.log(`[${logPrefix}] skipped recorded ${filename}`);
      continue;
    }

    try {
      await pool.query(sql);
      await recordMigration(pool, filename, checksum, appliedBy);
      applied += 1;
      console.log(`[${logPrefix}] applied ${filename}`);
    } catch (error) {
      if (isSkippableExistingStateError(error)) {
        await recordMigration(pool, filename, checksum, appliedBy);
        skipped += 1;
        console.log(`[${logPrefix}] skipped existing ${filename}`);
        continue;
      }

      throw error;
    }
  }

  return { applied, skipped, total: migrations.length };
};
