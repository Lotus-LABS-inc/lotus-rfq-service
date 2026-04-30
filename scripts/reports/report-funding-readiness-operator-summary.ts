import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";

import { FundingReadinessAdminService } from "../../src/api/admin/funding-readiness-admin-service.js";
import { FundingRepository } from "../../src/repositories/funding.repository.js";

loadDotenv();

const databaseUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("SUPABASE_DB_URL, DATABASE_URL, or TEST_DATABASE_URL is required to generate the funding readiness operator summary.");
}

const artifactDir = join(process.cwd(), "artifacts", "funding");
const pool = new Pool({ connectionString: databaseUrl });

function renderMarkdown(summary: Awaited<ReturnType<FundingReadinessAdminService["getSummary"]>>): string {
  return [
    "# Funding Readiness Operator Summary",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    "## Totals",
    "",
    `- Funding intents: ${summary.totalFundingIntents}`,
    `- Route legs: ${summary.totalRouteLegs}`,
    `- READY_TO_TRADE rows: ${summary.readyToTrade}`,
    `- VENUE_CREDIT_PENDING rows: ${summary.venueCreditPending}`,
    `- DESTINATION_NOT_CONFIRMED rows: ${summary.destinationNotConfirmed}`,
    `- FAILED rows: ${summary.failed}`,
    `- UNKNOWN rows: ${summary.unknown}`,
    `- Split-capable intents: ${summary.splitCapableIntents}`,
    `- Partial-ready intents: ${summary.partialReadyIntents}`,
    "",
    "## Counts By Venue",
    "",
    ...renderRecord(summary.countsByVenue),
    "",
    "## Counts By Readiness Status",
    "",
    ...renderRecord(summary.countsByReadinessStatus),
    "",
    "## Counts By Checker Mode",
    "",
    ...renderRecord(summary.countsByCheckerMode),
    "",
    "## Counts By Route Provider",
    "",
    ...renderRecord(summary.countsByRouteProvider),
    "",
    "## Stale Age Buckets",
    "",
    ...renderRecord(summary.staleAgeBuckets),
    "",
    "## Review Needed",
    "",
    `- Destination not confirmed: ${summary.blockedRows.destinationNotConfirmed.length}`,
    `- Venue credit pending: ${summary.blockedRows.venueCreditPending.length}`,
    `- Checker disabled or not configured: ${summary.blockedRows.checkerDisabledOrNotConfigured.length}`,
    `- Failed: ${summary.blockedRows.failed.length}`,
    `- Unknown/malformed: ${summary.blockedRows.unknown.length}`,
    "",
    "## Safety Notes",
    "",
    "- This report is read-only.",
    "- Live LI.FI execution remains controlled by runtime flags.",
    "- Funding preflight enforcement remains controlled by runtime flags.",
    "- READY_TO_TRADE requires persisted venue readiness reconciliation.",
    "- Raw LI.FI transaction internals, provider secrets, auth headers, and private keys are not included.",
    ""
  ].join("\n");
}

function renderRecord(record: Record<string, number>): string[] {
  const entries = Object.entries(record);
  return entries.length > 0 ? entries.map(([key, value]) => `- ${key}: ${value}`) : ["- none: 0"];
}

try {
  const service = new FundingReadinessAdminService({
    repository: new FundingRepository(pool),
    env: process.env
  });
  const summary = await service.getSummary();
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    join(artifactDir, "funding-readiness-operator-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    join(artifactDir, "funding-readiness-operator-summary.md"),
    renderMarkdown(summary),
    "utf8"
  );
  console.log(`Funding readiness operator summary written to ${artifactDir}`);
} finally {
  await pool.end();
}
