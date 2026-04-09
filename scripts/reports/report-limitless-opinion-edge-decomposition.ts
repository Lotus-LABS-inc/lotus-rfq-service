#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { buildLimitlessOpinionEdgeDecomposition } from "../../src/operations/semantic-expansion/limitless-opinion-edge-decomposition.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const args = process.argv.slice(2);
  const summaryPathArg = args.find((arg) => arg.startsWith("--summaryPath="));
  const outputPathArg = args.find((arg) => arg.startsWith("--outputPath="));

  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "report-limitless-opinion-edge-decomposition"
  });

  try {
    const summary = await buildLimitlessOpinionEdgeDecomposition({
      repoRoot: process.cwd(),
      pool,
      ...(summaryPathArg ? { summaryPath: summaryPathArg.slice("--summaryPath=".length) } : {}),
      ...(outputPathArg ? { outputPath: outputPathArg.slice("--outputPath=".length) } : {})
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to build LIMITLESS_OPINION edge decomposition.");
  console.error(error);
  process.exit(1);
});

