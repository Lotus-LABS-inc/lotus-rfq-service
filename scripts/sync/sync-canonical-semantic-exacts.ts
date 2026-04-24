#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { syncSemanticExactOverlaps } from "../../src/operations/semantic-expansion/semantic-exact-sync.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const args = new Map<string, string>();
for (const rawArg of process.argv.slice(2)) {
  if (!rawArg.startsWith("--")) {
    continue;
  }
  const [key, ...rest] = rawArg.slice(2).split("=");
  args.set(key, rest.join("="));
}

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "sync-canonical-semantic-exacts"
  });

  try {
    const summary = await syncSemanticExactOverlaps({
      repoRoot: process.cwd(),
      pool,
      reportPath: args.get("reportPath") || undefined
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to sync semantic exact overlaps.");
  console.error(error);
  process.exit(1);
});
