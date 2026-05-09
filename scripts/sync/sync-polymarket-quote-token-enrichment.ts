#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Pool } from "pg";

import {
  buildPolymarketClobTokenEnrichment,
  extractPolymarketQuoteIdentifier,
  polymarketEventSlugCandidatesFromQuoteIdentifier,
  type PolymarketClobTokenEnrichmentResult,
  type PolymarketQuoteProfileForEnrichment
} from "../../src/core/sor/polymarket-clob-token-enrichment.js";
import { PolymarketGammaClient, type PolymarketGammaMarket } from "../../src/integrations/polymarket/polymarket-gamma-client.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

interface ApprovedPolymarketProfileRow {
  profile_id: string;
  canonical_event_id: string;
  canonical_market_id: string | null;
  venue_market_id: string;
  title: string;
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
  quoteOutcomeLabel: string | null;
  blockers: string[];
}

interface EnrichmentArtifact {
  artifactSchemaVersion: 1;
  generatedAt: string;
  mode: "DRY_RUN" | "APPLY";
  status: "PASSED" | "FAILED";
  source: "polymarket_official_api";
  summary: {
    profilesScanned: number;
    plannedOrUpdated: number;
    skipped: number;
    blockerCounts: Record<string, number>;
  };
  safety: {
    sharedCoreApprovedOnly: true;
    noEnvMarketOverrides: true;
    noRawProviderPayloadsStored: true;
    noCredentialsStored: true;
  };
  rows: ArtifactRow[];
}

const APPROVAL_SOURCE = "frontend-curated-catalog";
const SOURCE = "polymarket_official_api";
const artifactDir = path.join(process.cwd(), "artifacts", "shared", "optional");
const metadataVersion = process.env.POLYMARKET_METADATA_VERSION ?? "polymarket-official-v1";

const args = parseArgs();
const generatedAt = new Date().toISOString();
const marketLookupCache = new Map<string, Promise<PolymarketGammaMarket[]>>();
const databaseUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  throw new Error("SUPABASE_DB_URL or DATABASE_URL is required.");
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 10_000,
  application_name: "sync-polymarket-quote-token-enrichment",
  ...(databaseUrl.includes("sslmode=require") || databaseUrl.includes("supabase") ? { ssl: { rejectUnauthorized: false } } : {})
});

const gammaClient = new PolymarketGammaClient({
  baseUrl: process.env.POLYMARKET_GAMMA_BASE_URL ?? "https://gamma-api.polymarket.com",
  clobHost: process.env.POLYMARKET_CLOB_HOST ?? "https://clob.polymarket.com"
});

try {
  const profiles = await listApprovedPolymarketProfiles(pool, args);
  const resolved = await mapConcurrent(profiles, args.concurrency, async (row) => ({
    row,
    result: await resolveEnrichment(toProfile(row))
  }));
  const artifactRows: ArtifactRow[] = [];
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
        artifactRows.push({
          profileId: row.profile_id,
          canonicalEventId: row.canonical_event_id,
          canonicalMarketId: row.canonical_market_id,
          approvedVenueMarketId: row.venue_market_id,
          title: row.title,
          matchedIdentifier: result.enrichment.matchedIdentifier,
          status: args.apply ? "UPDATED" : "PLANNED",
          quoteMarketId: result.enrichment.quoteMarketId,
          quoteOutcomeLabel: result.enrichment.quoteOutcomeLabel,
          blockers: []
        });
        continue;
      }

      for (const blocker of result.blockers) {
        blockerCounts.set(blocker, (blockerCounts.get(blocker) ?? 0) + 1);
      }
      if (args.apply) {
        await clearUnverifiedProfileQuoteEvidence(pool, row, result.blockers);
      }
      artifactRows.push({
        profileId: row.profile_id,
        canonicalEventId: row.canonical_event_id,
        canonicalMarketId: row.canonical_market_id,
        approvedVenueMarketId: row.venue_market_id,
        title: row.title,
        matchedIdentifier: result.matchedIdentifier,
        status: "SKIPPED",
        quoteMarketId: null,
        quoteOutcomeLabel: null,
        blockers: [...result.blockers]
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
    status: artifactRows.some((row) => row.blockers.length > 0) ? "FAILED" : "PASSED",
    source: SOURCE,
    summary: {
      profilesScanned: profiles.length,
      plannedOrUpdated: artifactRows.filter((row) => row.status === "PLANNED" || row.status === "UPDATED").length,
      skipped: artifactRows.filter((row) => row.status === "SKIPPED").length,
      blockerCounts: Object.fromEntries([...blockerCounts.entries()].sort(([left], [right]) => left.localeCompare(right)))
    },
    safety: {
      sharedCoreApprovedOnly: true,
      noEnvMarketOverrides: true,
      noRawProviderPayloadsStored: true,
      noCredentialsStored: true
    },
    rows: artifactRows
  };

  await writeArtifacts(artifact);
  console.log(`Polymarket quote-token enrichment: ${artifact.status}`);
  console.log(`mode=${artifact.mode}`);
  console.log(`profilesScanned=${artifact.summary.profilesScanned}`);
  console.log(`plannedOrUpdated=${artifact.summary.plannedOrUpdated}`);
  console.log(`skipped=${artifact.summary.skipped}`);
  if (artifact.status !== "PASSED" && process.env.POLYMARKET_QUOTE_TOKEN_ENRICHMENT_ALLOW_FAILURE !== "true") {
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}

async function clearUnverifiedProfileQuoteEvidence(
  db: Pool,
  row: ApprovedPolymarketProfileRow,
  blockers: readonly string[]
): Promise<void> {
  const normalizedPayload = withoutQuoteEvidence(row.normalized_payload);
  const rawSourcePayload = withoutQuoteEvidence(row.raw_source_payload);
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

function withoutQuoteEvidence(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  for (const key of [
    "quoteMarketId",
    "quote_market_id",
    "quoteTokenId",
    "quote_token_id",
    "quoteOutcomeId",
    "quote_outcome_id",
    "quoteOutcomeLabel",
    "quoteOutcomeTokenIds",
    "quote_outcome_token_ids",
    "quoteSource",
    "quoteMatchedIdentifier",
    "quoteMetadataVersion",
    "quoteEnrichedAt",
    "quoteEvidence"
  ]) {
    delete record[key];
  }
  return record;
}

async function resolveEnrichment(profile: PolymarketQuoteProfileForEnrichment): Promise<PolymarketClobTokenEnrichmentResult> {
  const identifier = extractPolymarketQuoteIdentifier(profile);
  if (!identifier) {
    return buildPolymarketClobTokenEnrichment({ profile, markets: [], generatedAt, metadataVersion, source: SOURCE });
  }

  try {
    const direct = await listMarketsCached(`identifier:${identifier}`, () => gammaClient.getMarketByIdentifier(identifier));
    const primary = buildPolymarketClobTokenEnrichment({ profile, markets: direct, generatedAt, metadataVersion, source: SOURCE });
    if (primary.ok || !primary.blockers.includes("POLYMARKET_SOURCE_MATCH_MISSING")) {
      return primary;
    }

    const eventSlugs = polymarketEventSlugCandidatesFromQuoteIdentifier(identifier);
    if (eventSlugs.length === 0 && !/^\d+$/.test(identifier) && !/^0x[0-9a-f]{64}$/i.test(identifier)) {
      eventSlugs.push(identifier);
    }
    for (const eventSlug of eventSlugs) {
      const eventMarkets = await listMarketsCached(`event:${eventSlug}`, () => gammaClient.getEventMarketsBySlug(eventSlug));
      const eventResult = buildPolymarketClobTokenEnrichment({ profile, markets: eventMarkets, generatedAt, metadataVersion, source: SOURCE });
      if (eventResult.ok) {
        return eventResult;
      }
    }

    if (!profile.title) {
      return primary;
    }
    const titleMarkets = await listMarketsCached(`search:${profile.title}`, () => gammaClient.searchMarkets(profile.title ?? ""));
    return buildPolymarketClobTokenEnrichment({ profile, markets: titleMarkets, generatedAt, metadataVersion, source: SOURCE });
  } catch {
    return {
      ok: false,
      profileId: profile.profileId,
      matchedIdentifier: identifier,
      blockers: ["POLYMARKET_SOURCE_LOOKUP_FAILED"]
    };
  }
}

function listMarketsCached(key: string, load: () => Promise<PolymarketGammaMarket[]>): Promise<PolymarketGammaMarket[]> {
  const existing = marketLookupCache.get(key);
  if (existing) {
    return existing;
  }
  const pending = listMarketsWithRetry(load).catch((error) => {
    marketLookupCache.delete(key);
    throw error;
  });
  marketLookupCache.set(key, pending);
  return pending;
}

async function listMarketsWithRetry(load: () => Promise<PolymarketGammaMarket[]>): Promise<PolymarketGammaMarket[]> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await load();
    } catch (error) {
      lastError = error;
      await sleep(750 * (attempt + 1));
    }
  }
  throw lastError;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function listApprovedPolymarketProfiles(
  db: Pool,
  input: ParsedArgs
): Promise<ApprovedPolymarketProfileRow[]> {
  const params: unknown[] = [APPROVAL_SOURCE, input.limit, SOURCE];
  const profileFilter = input.profileId
    ? `AND vmp.id = $${params.push(input.profileId)}`
    : "";
  const result = await db.query<ApprovedPolymarketProfileRow>(
    `SELECT
       vmp.id::text AS profile_id,
       ce.id::text AS canonical_event_id,
       cem.id AS canonical_market_id,
       vmp.venue_market_id,
       vmp.title,
       vmp.normalized_payload,
       vmp.raw_source_payload
     FROM canonical_events ce
     JOIN frontend_market_approvals fma
       ON fma.canonical_event_id = ce.id
      AND fma.status = 'APPROVED'
      AND fma.metadata->>'source' = $1
     JOIN venue_market_profiles vmp
       ON vmp.canonical_event_id = ce.id
      AND vmp.venue = 'POLYMARKET'
     LEFT JOIN canonical_executable_market_members mem
       ON mem.venue_market_profile_id = vmp.id
     LEFT JOIN canonical_executable_markets cem
       ON cem.id = mem.canonical_executable_market_id
    WHERE (
       vmp.normalized_payload->>'quoteTokenId' IS NULL
       OR vmp.normalized_payload->>'quoteMarketId' IS NULL
       OR COALESCE(vmp.normalized_payload->>'quoteSource', '') <> $3
       OR COALESCE(vmp.normalized_payload->>'imageUrl', vmp.raw_source_payload->>'imageUrl', '') = ''
       OR COALESCE(vmp.normalized_payload->>'iconUrl', vmp.raw_source_payload->>'iconUrl', '') = ''
       OR COALESCE(vmp.normalized_payload->>'expiresAt', vmp.raw_source_payload->>'expiresAt', '') = ''
       OR COALESCE(vmp.normalized_payload->>'change24h', vmp.raw_source_payload->>'change24h', '') = ''
       OR COALESCE(vmp.normalized_payload->>'volume24h', vmp.raw_source_payload->>'volume24h', '') = ''
       OR COALESCE(vmp.normalized_payload->>'liquidity', vmp.raw_source_payload->>'liquidity', '') = ''
    )
      ${profileFilter}
    ORDER BY COALESCE(fma.sort_priority, 1000), ce.updated_at DESC, vmp.title
    LIMIT $2`,
    params
  );
  return result.rows;
}

async function updateProfile(
  db: Pool,
  enrichment: Extract<PolymarketClobTokenEnrichmentResult, { ok: true }>["enrichment"]
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

function toProfile(row: ApprovedPolymarketProfileRow): PolymarketQuoteProfileForEnrichment {
  return {
    profileId: row.profile_id,
    approvedVenueMarketId: row.venue_market_id,
    title: row.title,
    normalizedPayload: row.normalized_payload,
    rawSourcePayload: row.raw_source_payload
  };
}

async function writeArtifacts(artifact: EnrichmentArtifact): Promise<void> {
  await mkdir(artifactDir, { recursive: true });
  const safeTimestamp = generatedAt.replace(/[:.]/g, "-");
  const json = `${JSON.stringify(artifact, null, 2)}\n`;
  await writeFile(path.join(artifactDir, `polymarket-quote-token-enrichment-${safeTimestamp}.json`), json, "utf8");
  await writeFile(path.join(artifactDir, "polymarket-quote-token-enrichment-latest.json"), json, "utf8");
  await writeFile(path.join(artifactDir, "polymarket-quote-token-enrichment-latest.md"), renderMarkdown(artifact), "utf8");
}

function renderMarkdown(artifact: EnrichmentArtifact): string {
  return [
    "# Polymarket Quote Token Enrichment",
    "",
    `Generated: ${artifact.generatedAt}`,
    `Status: ${artifact.status}`,
    `Mode: ${artifact.mode}`,
    `Source: ${artifact.source}`,
    `Profiles scanned: ${artifact.summary.profilesScanned}`,
    `Planned/updated: ${artifact.summary.plannedOrUpdated}`,
    `Skipped: ${artifact.summary.skipped}`,
    "",
    "| Profile | Canonical Event | Status | Identifier | Quote Market | Outcome | Blockers |",
    "|---|---|---|---|---|---|---|",
    ...artifact.rows.map((row) => [
      row.profileId,
      row.canonicalEventId,
      row.status,
      row.matchedIdentifier ?? "n/a",
      row.quoteMarketId ?? "n/a",
      row.quoteOutcomeLabel ?? "n/a",
      row.blockers.length > 0 ? row.blockers.join("; ") : "none"
    ].join(" | ")).map((line) => `| ${line} |`)
  ].join("\n");
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
    limit: clampLimit(values.get("limit")),
    concurrency: clampConcurrency(values.get("concurrency")),
    profileId: values.get("profileId")?.trim() || null
  };
}

function clampLimit(value: string | undefined): number {
  const parsed = value ? Number.parseInt(value, 10) : 250;
  return Number.isFinite(parsed) ? Math.max(1, Math.min(1000, parsed)) : 250;
}

function clampConcurrency(value: string | undefined): number {
  const parsed = value ? Number.parseInt(value, 10) : 2;
  return Number.isFinite(parsed) ? Math.max(1, Math.min(8, parsed)) : 2;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const output: R[] = [];
  let index = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, values.length)) }, async () => {
    while (index < values.length) {
      const current = index;
      index += 1;
      output[current] = await mapper(values[current]!);
    }
  });
  await Promise.all(workers);
  return output;
}
