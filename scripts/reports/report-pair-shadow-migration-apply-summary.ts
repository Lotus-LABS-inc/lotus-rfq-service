#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { Pool } from "pg";

import { PairRouteAdminService } from "../../src/api/admin/pair-route-admin-service.js";
import { writePairShadowMigrationApplySummary } from "../../src/operations/semantic-expansion/pair-shadow-migration-apply-summary.js";

for (const envPath of [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")]) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const main = async (): Promise<void> => {
  if (!process.env.DATABASE_URL || !process.env.SUPABASE_DB_URL) {
    throw new Error("DATABASE_URL and SUPABASE_DB_URL are required.");
  }
  const localPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    application_name: "report-pair-shadow-migration-local"
  });
  const authoritativePool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    application_name: "report-pair-shadow-migration-supabase"
  });
  try {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const pairRouteAdminService = new PairRouteAdminService({
      pool: localPool,
      shadowPool: authoritativePool,
      repoRoot
    });
    const summary = await writePairShadowMigrationApplySummary(repoRoot, {
      authoritativePool,
      localPool,
      pairRouteAdminService
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await authoritativePool.end();
    await localPool.end();
  }
};

main().catch((error) => {
  console.error("Failed to build pair shadow migration apply summary.");
  console.error(error);
  process.exit(1);
});


