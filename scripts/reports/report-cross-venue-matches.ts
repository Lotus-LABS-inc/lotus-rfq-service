#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { buildCrossVenueMatchReport } from "../../src/operations/semantic-expansion/cross-venue-match-report.js";
import { writeArtifact } from "../../src/operations/semantic-expansion/shared.js";

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
    application_name: "report-cross-venue-matches"
  });

  try {
    const report = await buildCrossVenueMatchReport(pool, {
      afterRulepackRefresh: args.get("afterRulepackRefresh") === "true"
    });
    writeArtifact(process.cwd(), "docs/cross-venue-match-report.json", report);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to build cross-venue match report.");
  console.error(error);
  process.exit(1);
});

