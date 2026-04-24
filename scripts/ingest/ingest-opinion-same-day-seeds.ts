#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { runOpinionExactSeedAcquisition } from "../../src/operations/semantic-expansion/opinion-exact-seed-acquisition.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const main = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  const opinionApiKey = process.env.OPINION_API_KEY;
  const opinionBaseUrl = process.env.OPINION_OPENAPI_BASE_URL ?? "https://openapi.opinion.trade/openapi";
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }
  if (!opinionApiKey) {
    throw new Error("OPINION_API_KEY is required.");
  }

  const args = process.argv.slice(2);
  const seedSourceArg = args.find((arg) => arg.startsWith("--seedSource="));
  const categoriesArg = args.find((arg) => arg.startsWith("--categories="));
  const summaryPathArg = args.find((arg) => arg.startsWith("--summaryPath="));
  const familyModeArg = args.find((arg) => arg.startsWith("--familyMode="));
  const seedSource =
    seedSourceArg?.slice("--seedSource=".length) === "pm_limitless_routeable"
      ? "pm_limitless_routeable"
      : seedSourceArg?.slice("--seedSource=".length) === "pm_limitless_opinion_constrained"
        ? "pm_limitless_opinion_constrained"
        : seedSourceArg?.slice("--seedSource=".length) === "pm_limitless_crypto_date_aligned"
          ? "pm_limitless_crypto_date_aligned"
        : "all_relevant";
  const familyMode =
    familyModeArg?.slice("--familyMode=".length) === "same_family_only"
      ? "same_family_only"
      : "default";
  const categories = categoriesArg
    ? categoriesArg
        .slice("--categories=".length)
        .split(",")
        .map((value) => value.trim())
        .filter((value): value is "CRYPTO" | "SPORTS" | "ESPORTS" | "POLITICS" => ["CRYPTO", "SPORTS", "ESPORTS", "POLITICS"].includes(value))
    : undefined;
  const summaryOutputPath = summaryPathArg?.slice("--summaryPath=".length) || undefined;

  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "ingest-opinion-same-day-seeds"
  });

  try {
    const summary = await runOpinionExactSeedAcquisition({
      repoRoot: process.cwd(),
      pool,
      opinionBaseUrl,
      opinionApiKey,
      sameDayOnly: true,
      seedSource,
      categories,
      summaryOutputPath,
      familyMode,
      sameDayOnly: familyMode === "same_family_only" ? false : true
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to ingest same-day Opinion seeds.");
  console.error(error);
  process.exit(1);
});
