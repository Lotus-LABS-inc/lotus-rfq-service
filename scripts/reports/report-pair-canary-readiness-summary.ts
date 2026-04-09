#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { Pool } from "pg";

import { PairRouteAdminService } from "../../src/api/admin/pair-route-admin-service.js";
import { writePairCanaryReadinessArtifacts } from "../../src/operations/semantic-expansion/pair-canary-readiness-summary.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
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
    application_name: "report-pair-canary-readiness-summary"
  });
  const shadowPool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL,
    application_name: "report-pair-canary-readiness-summary-shadow"
  });
  try {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const pairRouteAdminService = new PairRouteAdminService({ pool, shadowPool, repoRoot });
    const artifact = await writePairCanaryReadinessArtifacts(repoRoot, pairRouteAdminService);
    console.log(JSON.stringify({
      observedAt: artifact.observedAt,
      routes: artifact.routes.map((route) => ({
        routeClass: route.routeClass,
        recommendation: route.canaryReadiness.recommendation,
        blockers: route.blockers
      }))
    }, null, 2));
  } finally {
    await shadowPool.end();
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to build pair canary readiness summary.");
  console.error(error);
  process.exit(1);
});

