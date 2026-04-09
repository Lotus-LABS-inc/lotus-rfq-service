#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { Pool } from "pg";

import { PairRouteAdminService } from "../../src/api/admin/pair-route-admin-service.js";
import { writeCryptoFinalCanaryPackage } from "../../src/reports/crypto-final-canary-package.js";

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
    application_name: "report-crypto-final-canary-package"
  });
  const shadowPool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL,
    application_name: "report-crypto-final-canary-package-shadow"
  });
  try {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const pairRouteAdminService = new PairRouteAdminService({ pool, shadowPool, repoRoot });
    const artifacts = await writeCryptoFinalCanaryPackage(repoRoot, pairRouteAdminService);
    console.log(JSON.stringify({
      routeClass: artifacts.finalPackageSummary.routeClass,
      finalDecision: artifacts.finalPackageSummary.finalDecision,
      approvalState: artifacts.finalPackageSummary.approvalState,
      nextOperatorAction: artifacts.finalPackageSummary.nextOperatorAction
    }, null, 2));
  } finally {
    await shadowPool.end();
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to build crypto final canary package artifacts.");
  console.error(error);
  process.exit(1);
});
