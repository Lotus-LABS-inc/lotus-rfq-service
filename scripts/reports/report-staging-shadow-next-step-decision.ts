#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { Pool } from "pg";

import { PairRouteAdminService } from "../../src/api/admin/pair-route-admin-service.js";
import { writeStagingShadowNextStepDecisionArtifact } from "../../src/operations/semantic-expansion/staging-shadow-next-step-decision.js";

for (const envPath of [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")]) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const main = async (): Promise<void> => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    application_name: "report-staging-shadow-next-step-decision"
  });
  const shadowPool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL,
    application_name: "report-staging-shadow-next-step-decision-shadow"
  });
  try {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const pairRouteAdminService = new PairRouteAdminService({ pool, shadowPool, repoRoot });
    const artifact = await writeStagingShadowNextStepDecisionArtifact(repoRoot, pairRouteAdminService);
    console.log(JSON.stringify(artifact, null, 2));
  } finally {
    await shadowPool.end();
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to build staging shadow next-step decision.");
  console.error(error);
  process.exit(1);
});

