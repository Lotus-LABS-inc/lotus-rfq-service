#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { Pool } from "pg";

import { PairRouteAdminService } from "../../src/api/admin/pair-route-admin-service.js";
import { writeCryptoProdArtifacts } from "../../src/operations/semantic-expansion/crypto-prod-readiness.js";

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
    application_name: "report-crypto-prod-readiness"
  });
  const shadowPool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL,
    application_name: "report-crypto-prod-readiness-shadow"
  });
  try {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const pairRouteAdminService = new PairRouteAdminService({ pool, shadowPool, repoRoot });
    const artifacts = await writeCryptoProdArtifacts(repoRoot, pairRouteAdminService);
    console.log(JSON.stringify({
      decision: artifacts.readinessSummary.overallDecision,
      routes: artifacts.readinessSummary.routes.map((route) => ({
        routeClass: route.routeClass,
        readinessDecision: route.readinessDecision,
        scopeLabel: route.approvedScope.scopeLabel,
        blockers: route.blockers
      }))
    }, null, 2));
  } finally {
    await shadowPool.end();
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to build crypto production readiness artifacts.");
  console.error(error);
  process.exit(1);
});
