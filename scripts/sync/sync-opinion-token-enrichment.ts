#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Pool } from "pg";

import {
  buildOpinionTokenEnrichment,
  extractOpinionQuoteIdentifier,
  opinionLookupCandidatesFromIdentifier,
  opinionLookupCandidatesFromTitle,
  withoutOpinionQuoteEvidence,
  type OpinionQuoteProfileForEnrichment,
  type OpinionTokenEnrichmentResult
} from "../../src/core/sor/opinion-token-enrichment.js";
import { OpinionClient } from "../../src/integrations/opinion/opinion-client.js";
import { normalizeOpinionMarketRecord } from "../../src/integrations/opinion/opinion-market-adapter.js";
import type { OpinionNormalizedMarket } from "../../src/integrations/opinion/opinion-types.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

interface ApprovedOpinionProfileRow {
  profile_id: string;
  canonical_event_id: string;
  canonical_market_id: string | null;
  venue_market_id: string;
  title: string;
  outcomes: unknown;
  normalized_payload: unknown;
  raw_source_payload: unknown;
}

interface ParsedArgs {
  apply: boolean;
  limit: number;
  concurrency: number;
  profileId: string | null;
}

interface ArtifactRow {
  profileId: string;
  canonicalEventId: string;
  canonicalMarketId: string | null;
  approvedVenueMarketId: string;
  title: string;
  matchedIdentifier: string | null;
  status: "UPDATED" | "PLANNED" | "SKIPPED";
  quoteMarketId: string | null;
  quoteOutcomeTokenIds: { YES: string; NO: string } | null;
  blockers: string[];
  suggestedOpinionLookup: string | null;
}

interface EnrichmentArtifact {
  artifactSchemaVersion: 1;
  generatedAt: string;
  mode: "DRY_RUN" | "APPLY";
  status: "PASSED" | "FAILED";
  source: "opinion_openapi_market_detail";
  summary: {
    profilesScanned: number;
    plannedOrUpdated: number;
    skipped: number;
    blockerCounts: Record<string, number>;
  };
  safety: {
    sharedCoreApprovedOnly: true;
    quoteReadinessOnly: true;
    noExecutionAuthorityChange: true;
    noCredentialsStored: true;
    noRawProviderPayloadsStored: true;
  };
  rows: ArtifactRow[];
}

const APPROVAL_SOURCE = "frontend-curated-catalog";
const SOURCE = "opinion_openapi_market_detail";
const artifactDir = path.join(process.cwd(), "artifacts", "shared", "optional");
const metadataVersion = process.env.OPINION_METADATA_VERSION ?? "opinion-openapi-v1";
const generatedAt = new Date().toISOString();
const args = parseArgs();
const databaseUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
const opinionApiKey = process.env.OPINION_API_KEY ?? process.env.OPINION_BUILDER_API_KEY;
const opinionBaseUrl = process.env.OPINION_OPENAPI_BASE_URL ?? process.env.OPINION_CLOB_BASE_URL ?? "https://openapi.opinion.trade/openapi";

if (!databaseUrl) {
  throw new Error("SUPABASE_DB_URL or DATABASE_URL is required.");
}
if (!opinionApiKey) {
  throw new Error("OPINION_API_KEY is required.");
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 10_000,
  application_name: "sync-opinion-token-enrichment",
  ...(databaseUrl.includes("sslmode=require") || databaseUrl.includes("supabase") ? { ssl: { rejectUnauthorized: false } } : {})
});

const client = new OpinionClient({
  baseUrl: opinionBaseUrl,
  apiKey: opinionApiKey,
  requestTimeoutMs: Number.parseInt(process.env.OPINION_QUOTE_TIMEOUT_MS ?? "8000", 10)
});
const marketLookupCache = new Map<string, Promise<OpinionNormalizedMarket | null>>();

try {
  const profiles = await listApprovedOpinionProfiles(pool, args);
  const resolved = await mapConcurrent(profiles, args.concurrency, async (row) => ({
    row,
    result: await resolveEnrichment(toProfile(row))
  }));
  const rows: ArtifactRow[] = [];
  const blockerCounts = new Map<string, number>();

  if (args.apply) {
    await pool.query("BEGIN");
  }
  try {
    for (const { row, result } of resolved) {
      if (result.ok) {
        if (args.apply) {
          await updateProfile(pool, result.enrichment);
        }
        rows.push({
          profileId: row.profile_id,
          canonicalEventId: row.canonical_event_id,
          canonicalMarketId: row.canonical_market_id,
          approvedVenueMarketId: row.venue_market_id,
          title: row.title,
          matchedIdentifier: result.enrichment.matchedIdentifier,
          status: args.apply ? "UPDATED" : "PLANNED",
          quoteMarketId: result.enrichment.quoteMarketId,
          quoteOutcomeTokenIds: result.enrichment.quoteOutcomeTokenIds,
          blockers: [],
          suggestedOpinionLookup: null
        });
        continue;
      }

      for (const blocker of result.blockers) {
        blockerCounts.set(blocker, (blockerCounts.get(blocker) ?? 0) + 1);
      }
      if (args.apply) {
        await clearUnverifiedProfileQuoteEvidence(pool, row, result.blockers);
      }
      rows.push({
        profileId: row.profile_id,
        canonicalEventId: row.canonical_event_id,
        canonicalMarketId: row.canonical_market_id,
        approvedVenueMarketId: row.venue_market_id,
        title: row.title,
        matchedIdentifier: result.matchedIdentifier,
        status: "SKIPPED",
        quoteMarketId: null,
        quoteOutcomeTokenIds: null,
        blockers: result.blockers,
        suggestedOpinionLookup: suggestedOpinionLookup(row)
      });
    }
    if (args.apply) {
      await pool.query("COMMIT");
    }
  } catch (error) {
    if (args.apply) {
      await pool.query("ROLLBACK");
    }
    throw error;
  }

  const artifact: EnrichmentArtifact = {
    artifactSchemaVersion: 1,
    generatedAt,
    mode: args.apply ? "APPLY" : "DRY_RUN",
    status: rows.some((row) => row.blockers.length > 0) ? "FAILED" : "PASSED",
    source: SOURCE,
    summary: {
      profilesScanned: profiles.length,
      plannedOrUpdated: rows.filter((row) => row.status === "PLANNED" || row.status === "UPDATED").length,
      skipped: rows.filter((row) => row.status === "SKIPPED").length,
      blockerCounts: Object.fromEntries([...blockerCounts.entries()].sort(([left], [right]) => left.localeCompare(right)))
    },
    safety: {
      sharedCoreApprovedOnly: true,
      quoteReadinessOnly: true,
      noExecutionAuthorityChange: true,
      noCredentialsStored: true,
      noRawProviderPayloadsStored: true
    },
    rows
  };

  await writeArtifacts(artifact);
  console.log(`Opinion token enrichment: ${artifact.status}`);
  console.log(`mode=${artifact.mode}`);
  console.log(`profilesScanned=${artifact.summary.profilesScanned}`);
  console.log(`plannedOrUpdated=${artifact.summary.plannedOrUpdated}`);
  console.log(`skipped=${artifact.summary.skipped}`);
  if (artifact.status !== "PASSED" && process.env.OPINION_TOKEN_ENRICHMENT_ALLOW_FAILURE !== "true") {
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}

async function resolveEnrichment(profile: OpinionQuoteProfileForEnrichment): Promise<OpinionTokenEnrichmentResult> {
  const identifier = extractOpinionQuoteIdentifier(profile);
  const candidates = [
    ...(identifier ? opinionLookupCandidatesFromIdentifier(identifier) : []),
    ...opinionLookupCandidatesFromTitle(profile.title)
  ];

  for (const candidate of [...new Set(candidates)]) {
    const market = await lookupMarket(candidate);
    if (!market) {
      continue;
    }
    const result = buildOpinionTokenEnrichment({ profile, market, matchedIdentifier: candidate, generatedAt, metadataVersion });
    if (result.ok || !result.blockers.includes("OPINION_SOURCE_MATCH_MISSING")) {
      return result;
    }
  }

  return buildOpinionTokenEnrichment({ profile, market: null, matchedIdentifier: identifier, generatedAt, metadataVersion });
}

async function lookupMarket(identifier: string): Promise<OpinionNormalizedMarket | null> {
  const cached = marketLookupCache.get(identifier);
  if (cached) {
    return cached;
  }
  const pending = lookupMarketUncached(identifier).catch((error) => {
    marketLookupCache.delete(identifier);
    throw error;
  });
  marketLookupCache.set(identifier, pending);
  return pending;
}

async function lookupMarketUncached(identifier: string): Promise<OpinionNormalizedMarket | null> {
  const calls = /^\d+$/.test(identifier)
    ? [
      () => client.getMarketById({ marketId: identifier }),
      () => client.getCategoricalMarketById({ marketId: identifier })
    ]
    : [() => client.getMarketBySlug({ slug: identifier })];

  for (const call of calls) {
    try {
      const payload = await call();
      return normalizeOpinionMarketRecord(payload, metadataVersion);
    } catch {
      continue;
    }
  }
  return null;
}

async function listApprovedOpinionProfiles(
  db: Pool,
  input: ParsedArgs
): Promise<ApprovedOpinionProfileRow[]> {
  const params: unknown[] = [APPROVAL_SOURCE, input.limit, SOURCE];
  const profileFilter = input.profileId
    ? `AND vmp.id = $${params.push(input.profileId)}`
    : "";
  const result = await db.query<ApprovedOpinionProfileRow>(
    `SELECT
       vmp.id::text AS profile_id,
       ce.id::text AS canonical_event_id,
       cem.id AS canonical_market_id,
       vmp.venue_market_id,
       vmp.title,
       vmp.outcomes,
       vmp.normalized_payload,
       vmp.raw_source_payload
     FROM venue_market_profiles vmp
     JOIN canonical_events ce
       ON ce.id = vmp.canonical_event_id
     LEFT JOIN frontend_market_approvals fma
       ON fma.canonical_event_id = ce.id
      AND fma.status = 'APPROVED'
      AND fma.metadata->>'source' = $1
     LEFT JOIN canonical_executable_market_members mem
       ON mem.venue_market_profile_id = vmp.id
     LEFT JOIN canonical_executable_markets cem
       ON cem.id = mem.canonical_executable_market_id
    WHERE vmp.venue = 'OPINION'
      AND (fma.canonical_event_id IS NOT NULL OR mem.venue_market_profile_id IS NOT NULL)
      AND (
       vmp.normalized_payload->>'quoteTokenId' IS NULL
       OR vmp.normalized_payload->>'quoteMarketId' IS NULL
       OR vmp.normalized_payload->'quoteOutcomeTokenIds' IS NULL
       OR COALESCE(vmp.normalized_payload->>'quoteSource', '') <> $3
    )
      ${profileFilter}
    ORDER BY COALESCE(fma.sort_priority, 1000), ce.updated_at DESC, vmp.title
    LIMIT $2`,
    params
  );
  return result.rows;
}

async function clearUnverifiedProfileQuoteEvidence(
  db: Pool,
  row: ApprovedOpinionProfileRow,
  blockers: readonly string[]
): Promise<void> {
  const normalizedPayload = withoutOpinionQuoteEvidence(row.normalized_payload);
  const rawSourcePayload = withoutOpinionQuoteEvidence(row.raw_source_payload);
  normalizedPayload.quoteVerificationBlockers = [...blockers];
  normalizedPayload.quoteVerificationSource = SOURCE;
  normalizedPayload.quoteVerificationCheckedAt = generatedAt;
  await db.query(
    `UPDATE venue_market_profiles
        SET normalized_payload = $2::jsonb,
            raw_source_payload = $3::jsonb,
            updated_at = now()
      WHERE id = $1`,
    [
      row.profile_id,
      JSON.stringify(normalizedPayload),
      JSON.stringify(rawSourcePayload)
    ]
  );
}

async function updateProfile(
  db: Pool,
  enrichment: Extract<OpinionTokenEnrichmentResult, { ok: true }>["enrichment"]
): Promise<void> {
  await db.query(
    `UPDATE venue_market_profiles
        SET normalized_payload = $2::jsonb,
            raw_source_payload = $3::jsonb,
            updated_at = now()
      WHERE id = $1`,
    [
      enrichment.profileId,
      JSON.stringify(enrichment.normalizedPayload),
      JSON.stringify(enrichment.rawSourcePayload)
    ]
  );
}

function toProfile(row: ApprovedOpinionProfileRow): OpinionQuoteProfileForEnrichment {
  return {
    profileId: row.profile_id,
    canonicalEventId: row.canonical_event_id,
    canonicalMarketId: row.canonical_market_id,
    approvedVenueMarketId: row.venue_market_id,
    title: row.title,
    outcomes: row.outcomes,
    normalizedPayload: row.normalized_payload,
    rawSourcePayload: row.raw_source_payload
  };
}

function suggestedOpinionLookup(row: ApprovedOpinionProfileRow): string {
  return `https://opinion.trade/search?q=${encodeURIComponent(row.title)}`;
}

async function writeArtifacts(artifact: EnrichmentArtifact): Promise<void> {
  await mkdir(artifactDir, { recursive: true });
  const safeTimestamp = generatedAt.replace(/[:.]/g, "-");
  const json = `${JSON.stringify(artifact, null, 2)}\n`;
  await writeFile(path.join(artifactDir, `opinion-token-enrichment-${safeTimestamp}.json`), json, "utf8");
  await writeFile(path.join(artifactDir, "opinion-token-enrichment-latest.json"), json, "utf8");
  await writeFile(path.join(artifactDir, "opinion-token-enrichment-latest.md"), renderMarkdown(artifact), "utf8");
}

function renderMarkdown(artifact: EnrichmentArtifact): string {
  return [
    "# Opinion Token Enrichment",
    "",
    `Generated: ${artifact.generatedAt}`,
    `Status: ${artifact.status}`,
    `Mode: ${artifact.mode}`,
    `Profiles scanned: ${artifact.summary.profilesScanned}`,
    `Planned/updated: ${artifact.summary.plannedOrUpdated}`,
    `Skipped: ${artifact.summary.skipped}`,
    "",
    "| Profile | Canonical Market | Status | Identifier | Quote Market | Blockers | Suggested Lookup |",
    "|---|---|---|---|---|---|---|",
    ...artifact.rows.map((row) => [
      row.profileId,
      row.canonicalMarketId ?? "n/a",
      row.status,
      row.matchedIdentifier ?? "n/a",
      row.quoteMarketId ?? "n/a",
      row.blockers.length > 0 ? row.blockers.join("; ") : "none",
      row.suggestedOpinionLookup ?? "n/a"
    ].join(" | ")).map((line) => `| ${line} |`)
  ].join("\n");
}

async function mapConcurrent<T, U>(
  items: readonly T[],
  concurrency: number,
  map: (item: T) => Promise<U>
): Promise<U[]> {
  const output: U[] = [];
  let index = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (index < items.length) {
      const itemIndex = index;
      index += 1;
      output[itemIndex] = await map(items[itemIndex]!);
    }
  });
  await Promise.all(workers);
  return output;
}

function parseArgs(): ParsedArgs {
  const values = new Map<string, string>();
  let apply = false;
  for (const rawArg of process.argv.slice(2)) {
    if (rawArg === "--apply") {
      apply = true;
      continue;
    }
    if (!rawArg.startsWith("--")) {
      continue;
    }
    const [key, ...rest] = rawArg.slice(2).split("=");
    values.set(key, rest.join("="));
  }
  return {
    apply,
    limit: positiveInt(values.get("limit"), 100),
    concurrency: positiveInt(values.get("concurrency"), 2),
    profileId: values.get("profileId") ?? null
  };
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Expected a positive integer argument.");
  }
  return parsed;
}
