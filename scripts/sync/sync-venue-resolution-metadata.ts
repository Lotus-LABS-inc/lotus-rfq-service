#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Pool } from "pg";

import {
  createVenueResolutionMetadataClients,
  runVenueResolutionMetadataEnrichment,
  type VenueResolutionMetadataSummary
} from "../../src/operations/semantic-expansion/venue-resolution-metadata-enrichment.js";

const envCandidates = [path.resolve(process.cwd(), "..", ".env"), path.resolve(process.cwd(), ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

interface ParsedArgs {
  apply: boolean;
  limit: number;
  concurrency: number;
  approvalSource: string;
  profileId: string | null;
  venue: string | null;
  venueMarketId: string | null;
  includeAll: boolean;
}

const artifactDir = path.join(process.cwd(), "artifacts", "shared", "optional");
const args = parseArgs();
const databaseUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("SUPABASE_DB_URL or DATABASE_URL is required.");
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 10_000,
  application_name: "sync-venue-resolution-metadata",
  ...(requiresSsl(databaseUrl) ? { ssl: { rejectUnauthorized: false } } : {})
});

try {
  const artifact = await runVenueResolutionMetadataEnrichment({
    pool,
    clients: createVenueResolutionMetadataClients(process.env),
    options: args
  });
  await writeArtifacts(artifact);
  console.log(`Venue resolution metadata enrichment: ${artifact.mode}`);
  console.log(`profilesScanned=${artifact.summary.profilesScanned}`);
  console.log(`plannedOrUpdated=${artifact.summary.plannedOrUpdated}`);
  console.log(`skipped=${artifact.summary.skipped}`);
  console.log(`unresolved=${artifact.summary.unresolved}`);
  console.log(`artifact=${path.join(artifactDir, "venue-resolution-metadata-enrichment-latest.json")}`);
} finally {
  await pool.end();
}

function parseArgs(): ParsedArgs {
  const values = new Map<string, string>();
  for (const raw of process.argv.slice(2)) {
    if (!raw.startsWith("--")) {
      continue;
    }
    const [key, ...rest] = raw.slice(2).split("=");
    values.set(key, rest.join("=") || "true");
  }
  const limit = Number.parseInt(values.get("limit") ?? "200", 10);
  const concurrency = Number.parseInt(values.get("concurrency") ?? "2", 10);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error("limit must be a positive integer.");
  }
  if (!Number.isFinite(concurrency) || concurrency <= 0) {
    throw new Error("concurrency must be a positive integer.");
  }
  return {
    apply: values.get("apply") === "true",
    limit,
    concurrency,
    approvalSource: values.get("approvalSource") ?? "frontend-curated-catalog",
    profileId: values.get("profileId") ?? null,
    venue: values.get("venue") ?? null,
    venueMarketId: values.get("venueMarketId") ?? null,
    includeAll: values.get("includeAll") === "true"
  };
}

function requiresSsl(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    return url.hostname.includes("supabase.") || url.hostname.includes("pooler.supabase.com") || url.searchParams.has("sslmode");
  } catch {
    return false;
  }
}

async function writeArtifacts(artifact: VenueResolutionMetadataSummary): Promise<void> {
  await mkdir(artifactDir, { recursive: true });
  const json = `${JSON.stringify(artifact, null, 2)}\n`;
  const safeTimestamp = artifact.generatedAt.replace(/[:.]/g, "-");
  await writeFile(path.join(artifactDir, `venue-resolution-metadata-enrichment-${safeTimestamp}.json`), json, "utf8");
  await writeFile(path.join(artifactDir, "venue-resolution-metadata-enrichment-latest.json"), json, "utf8");
  await writeFile(path.join(artifactDir, "venue-resolution-metadata-enrichment-latest.md"), renderMarkdown(artifact), "utf8");
}

function renderMarkdown(artifact: VenueResolutionMetadataSummary): string {
  const blockerRows = Object.entries(artifact.summary.blockerCounts)
    .map(([blocker, count]) => `| ${blocker} | ${count} |`)
    .join("\n") || "| none | 0 |";
  const changedRows = artifact.rows
    .filter((row) => row.status === "PLANNED" || row.status === "UPDATED")
    .slice(0, 50)
    .map((row) => `| ${row.status} | ${row.venue} | ${row.venueMarketId} | ${row.fetchedBy ?? ""} | ${row.rulePreview ?? ""} |`)
    .join("\n") || "| none |  |  |  |  |";
  return `# Venue Resolution Metadata Enrichment

- generatedAt: ${artifact.generatedAt}
- mode: ${artifact.mode}
- status: ${artifact.status}
- profiles scanned: ${artifact.summary.profilesScanned}
- planned/updated: ${artifact.summary.plannedOrUpdated}
- skipped: ${artifact.summary.skipped}
- unresolved: ${artifact.summary.unresolved}

## Blockers

| blocker | count |
| --- | ---: |
${blockerRows}

## Updated/Planned Rows

| status | venue | venueMarketId | fetchedBy | rule preview |
| --- | --- | --- | --- | --- |
${changedRows}

## Safety

- approved markets only: ${artifact.safety.approvedMarketsOnly}
- display metadata only: ${artifact.safety.displayMetadataOnly}
- no execution changes: ${artifact.safety.noExecutionChanges}
- no raw provider payloads in artifact: ${artifact.safety.noRawProviderPayloadsInArtifact}
- no secrets in artifact: ${artifact.safety.noSecretsInArtifact}
`;
}
