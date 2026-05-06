import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";

import {
  calculateVenueQuote,
  QuoteSnapshotCache,
  SharedCoreVenueQuoteMappingResolver,
  type QuoteCalculationResult,
  type SharedCoreQuoteReadinessMarket,
  type VenueQuoteMapping,
  type VenueQuoteMappingReadiness,
  type VenueQuoteSnapshotReader
} from "../../src/core/sor/quote-snapshot.js";
import { SharedCoreQuoteMappingRepository } from "../../src/repositories/market-catalog.repository.js";
import {
  PolymarketQuoteReader,
  PolymarketRestOrderbookClient
} from "../../src/integrations/polymarket/polymarket-quote-reader.js";
import {
  LimitlessQuoteReader,
  LimitlessRestOrderbookClient
} from "../../src/integrations/limitless/limitless-quote-reader.js";
import { LimitlessProfileFeeReader } from "../../src/integrations/limitless/limitless-fee-reader.js";
import { PolymarketClobFeeReader } from "../../src/integrations/polymarket/polymarket-fee-reader.js";
import { PredictClient } from "../../src/integrations/predict/predict-client.js";
import { PredictQuoteReader } from "../../src/integrations/predict/predict-quote-reader.js";
import { OpinionClient } from "../../src/integrations/opinion/opinion-client.js";
import { OpinionQuoteReader } from "../../src/integrations/opinion/opinion-quote-reader.js";
import { MyriadClient } from "../../src/integrations/myriad/myriad-client.js";
import { MyriadQuoteReader } from "../../src/integrations/myriad/myriad-quote-reader.js";

loadDotenv();

type SmokeStatus = "PASSED" | "FAILED";
type SmokeMode = "VALIDATE" | "DISCOVER";

interface QuoteSourceSmokeVenueRow {
  venue: string;
  mappingPresent: boolean;
  venueMarketIdPresent: boolean;
  venueOutcomeIdPresent: boolean;
  quoteQuality: string | null;
  quoteSource: string | null;
  freshnessMs: number | null;
  quotedPrice: number | null;
  availableSize: number | null;
  spreadBps: number | null;
  slippageBps: number | null;
  liquidityScore: number | null;
  confidencePenaltyBps: number | null;
  feeBpsPresent: boolean;
  feeAmount: number | null;
  effectiveFeeBps: number | null;
  feeModel: string | null;
  feeSource: string | null;
  feeConfidence: string | null;
  fixedFeePresent: boolean;
  settlementEvidenceSupported: boolean | null;
  missingFactors: string[];
  blockers: string[];
  error: string | null;
}

interface QuoteSourceSmokeArtifact {
  artifactSchemaVersion: 1;
  generatedAt: string;
  status: SmokeStatus;
  mode: SmokeMode;
  canonicalInput: {
    canonicalMarketId: string | null;
    canonicalOutcomeId: string | null;
    side: "buy" | "sell";
    amount: number;
  };
  requiredVenues: string[];
  mappingSummary: {
    source: "POSTGRES_SHARED_CORE";
    mappingsResolved: number;
    venuesResolved: string[];
  };
  approvedMarketAudit?: {
    limit: number;
    marketsScanned: number;
    venueProfilesScanned: number;
    quoteReadyVenueProfiles: number;
    blockedVenueProfiles: number;
    markets: Array<{
      canonicalEventId: string;
      canonicalMarketIds: string[];
      title: string;
      category: string;
      venues: Array<{
        venue: string;
        quoteReady: boolean;
        blockers: string[];
      }>;
    }>;
  };
  venues: QuoteSourceSmokeVenueRow[];
  safety: {
    readOnly: true;
    noRawPayloadsStored: true;
    noCredentialsStored: true;
    secretScanPassed: boolean;
    secretFindings: string[];
  };
  nextActions: string[];
}

const requiredVenues = parseRequiredVenues(process.env.QUOTE_SOURCE_SMOKE_REQUIRED_VENUES);
const artifactDir = join(process.cwd(), "artifacts", "shared", "optional");
const sensitiveKeyPatterns = [
  /api[-_]?key/i,
  /api[-_]?secret/i,
  /authorization/i,
  /auth[-_]?header/i,
  /private[-_]?key/i,
  /^password$/i,
  /^secret$/i,
  /^jwt$/i,
  /^token$/i,
  /^signature$/i
];

const mode = parseMode(process.env.QUOTE_SOURCE_SMOKE_MODE);
const side = parseSide(process.env.QUOTE_SOURCE_SMOKE_SIDE);
const amount = parsePositiveNumber(process.env.QUOTE_SOURCE_SMOKE_AMOUNT, 1);
const auditLimit = Math.floor(parsePositiveNumber(process.env.QUOTE_SOURCE_AUDIT_LIMIT, 100));
const canonicalMarketId = process.env.QUOTE_SOURCE_SMOKE_CANONICAL_MARKET_ID?.trim();
const canonicalOutcomeId = process.env.QUOTE_SOURCE_SMOKE_CANONICAL_OUTCOME_ID?.trim();

const generatedAt = new Date().toISOString();
const rows: QuoteSourceSmokeVenueRow[] = [];
const nextActions: string[] = [];
let mappings: readonly VenueQuoteMapping[] = [];
let readinessRows: readonly VenueQuoteMappingReadiness[] = [];
let auditMarkets: readonly SharedCoreQuoteReadinessMarket[] = [];
let mappingPool: Pool | null = null;

try {
  const databaseUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("SUPABASE_DB_URL or DATABASE_URL is required to read shared-core quote mappings.");
  }
    const ssl = databaseUrl.includes("sslmode=require") || databaseUrl.includes("supabase")
      ? { rejectUnauthorized: false }
      : undefined;
  mappingPool = new Pool({ connectionString: databaseUrl, ...(ssl ? { ssl } : {}) });
  const resolver = new SharedCoreVenueQuoteMappingResolver(new SharedCoreQuoteMappingRepository(mappingPool));
  if (canonicalMarketId) {
    readinessRows = await resolver.getReadiness({
      canonicalMarketId,
      ...(canonicalOutcomeId ? { canonicalOutcomeId } : {})
    });
    mappings = await resolver.resolve({
      canonicalMarketId,
      ...(canonicalOutcomeId ? { canonicalOutcomeId } : {})
    });
  } else {
    auditMarkets = await resolver.listApprovedReadiness({ limit: auditLimit });
  }
} catch (error) {
  nextActions.push(`Fix shared-core quote mapping lookup: ${errorMessage(error)}.`);
} finally {
  await mappingPool?.end();
}

const mappingsByVenue = new Map(mappings.map((mapping) => [mapping.venue.toUpperCase(), mapping]));
if (canonicalMarketId) {
  for (const venue of requiredVenues) {
    const mapping = mappingsByVenue.get(venue);
    if (!mapping) {
      const readiness = readinessRows.find((row) => row.venue.toUpperCase() === venue);
      rows.push(emptyVenueRow(venue, readiness?.blockers.length ? [...readiness.blockers] : ["QUOTE_MAPPING_MISSING"], null, readiness));
      nextActions.push(`Store complete executable quote identifiers for ${venue} on the approved shared-core venue profile.`);
      continue;
    }
    if (venue === "POLYMARKET" && !mapping.venueOutcomeId) {
      rows.push(emptyVenueRow(venue, ["POLYMARKET_VENUE_OUTCOME_ID_REQUIRED"], null, mapping));
      nextActions.push("Store the Polymarket CLOB token_id on the approved shared-core venue profile.");
      continue;
    }
    if (mode === "DISCOVER") {
      rows.push(emptyVenueRow(venue, ["DISCOVER_MODE_NO_LIVE_VALIDATION"], null, mapping));
      continue;
    }

    rows.push(await validateVenue(mapping));
  }
}

const secretFindings = findSensitiveValues(rows);
const requiredVenueSet = new Set(requiredVenues);
const auditOnly = !canonicalMarketId;
if (auditOnly && auditMarkets.length === 0 && nextActions.length === 0) {
  nextActions.push("No approved shared-core markets were found for quote-readiness audit.");
}
const passed = auditOnly
  ? auditMarkets.length > 0 && secretFindings.length === 0 && nextActions.length === 0
  : rows.length === requiredVenues.length &&
  rows.every((row) =>
    requiredVenueSet.has(row.venue) &&
    row.mappingPresent &&
    row.error === null &&
    row.blockers.length === 0
  ) &&
  secretFindings.length === 0;

const artifact: QuoteSourceSmokeArtifact = {
  artifactSchemaVersion: 1,
  generatedAt,
  status: passed ? "PASSED" : "FAILED",
  mode,
  canonicalInput: {
    canonicalMarketId: canonicalMarketId ?? null,
    canonicalOutcomeId: canonicalOutcomeId ?? null,
    side,
    amount
  },
  requiredVenues,
  mappingSummary: {
    source: "POSTGRES_SHARED_CORE",
    mappingsResolved: mappings.length,
    venuesResolved: mappings.map((mapping) => mapping.venue.toUpperCase()).sort()
  },
  ...(auditOnly ? { approvedMarketAudit: toAuditSummary(auditMarkets, auditLimit) } : {}),
  venues: rows,
  safety: {
    readOnly: true,
    noRawPayloadsStored: true,
    noCredentialsStored: true,
    secretScanPassed: secretFindings.length === 0,
    secretFindings
  },
  nextActions: [...new Set(nextActions)]
};

await mkdir(artifactDir, { recursive: true });
const safeTimestamp = generatedAt.replace(/[:.]/g, "-");
const timestampedPath = join(artifactDir, `admin-quote-source-smoke-${safeTimestamp}.json`);
const latestPath = join(artifactDir, "admin-quote-source-smoke-latest.json");
const markdownPath = join(artifactDir, "admin-quote-source-smoke-latest.md");
await writeFile(timestampedPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
await writeFile(latestPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
await writeFile(markdownPath, renderMarkdown(artifact), "utf8");

console.log(`Admin quote-source smoke: ${artifact.status}`);
console.log(`artifact=${timestampedPath}`);
if (artifact.status !== "PASSED" && process.env.QUOTE_SOURCE_SMOKE_ALLOW_FAILURE !== "true") {
  process.exitCode = 1;
}

async function validateVenue(mapping: VenueQuoteMapping): Promise<QuoteSourceSmokeVenueRow> {
  const reader = readerForVenue(mapping.venue);
  if (!reader) {
    return emptyVenueRow(mapping.venue, ["QUOTE_READER_UNAVAILABLE"], null, mapping);
  }
  try {
    const snapshot = await reader.getQuoteSnapshot({
      canonicalMarketId: canonicalMarketId ?? "",
      ...(canonicalOutcomeId ? { canonicalOutcomeId } : {}),
      venueMarketId: mapping.venueMarketId,
      ...(mapping.venueOutcomeId ? { venueOutcomeId: mapping.venueOutcomeId } : {}),
      side,
      quantity: amount
    });
    if (!snapshot) {
      return emptyVenueRow(mapping.venue, ["QUOTE_SNAPSHOT_MISSING"], null, mapping);
    }
    const calculated = calculateVenueQuote({ snapshot, side, amount });
    return rowFromCalculation(mapping, calculated);
  } catch (error) {
    return emptyVenueRow(mapping.venue, ["QUOTE_READER_ERROR"], errorMessage(error), mapping);
  }
}

function readerForVenue(venue: string): VenueQuoteSnapshotReader | null {
  const normalizedVenue = venue.toUpperCase();
  if (normalizedVenue === "POLYMARKET") {
    const clobHost = process.env.POLYMARKET_CLOB_HOST ?? "https://clob.polymarket.com";
    return new PolymarketQuoteReader({
      streamCache: new QuoteSnapshotCache(),
      client: new PolymarketRestOrderbookClient({
        clobHost
      }),
      feeBps: parseOptionalNumber(process.env.POLYMARKET_QUOTE_FEE_BPS),
      feeReader: new PolymarketClobFeeReader({ clobHost })
    });
  }
  if (normalizedVenue === "LIMITLESS") {
    const limitlessBaseUrl = process.env.LIMITLESS_BASE_URL ?? "https://api.limitless.exchange";
    return new LimitlessQuoteReader({
      streamCache: new QuoteSnapshotCache(),
      client: new LimitlessRestOrderbookClient({
        baseUrl: limitlessBaseUrl
      }),
      feeBps: parseOptionalNumber(process.env.LIMITLESS_QUOTE_FEE_BPS),
      feeReader: new LimitlessProfileFeeReader({
        baseUrl: limitlessBaseUrl,
        apiKey: process.env.LIMITLESS_API_KEY,
        hmacTokenId: process.env.LIMITLESS_PARTNER_ACCOUNT_HMAC_TOKEN_ID ?? process.env.LIMITLESS_WITHDRAWAL_ADAPTER_API_KEY,
        hmacSecret: process.env.LIMITLESS_PARTNER_ACCOUNT_HMAC_SECRET ?? process.env.LIMITLESS_WITHDRAWAL_ADAPTER_HMAC_SECRET,
        account: process.env.LIMITLESS_QUOTE_FEE_PROFILE_ACCOUNT ?? process.env.LIMITLESS_WITHDRAWAL_ADAPTER_PROFILE_WALLET_ADDRESS
      })
    });
  }
  if (normalizedVenue === "PREDICT" || normalizedVenue === "PREDICT_FUN") {
    const environment = process.env.PREDICT_ENVIRONMENT === "testnet" ? "testnet" : "mainnet";
    return new PredictQuoteReader({
      streamCache: new QuoteSnapshotCache(),
      environment,
      client: new PredictClient({
        environment,
        baseUrl: environment === "testnet" ? process.env.PREDICT_TESTNET_BASE_URL : process.env.PREDICT_MAINNET_BASE_URL,
        apiKey: process.env.PREDICT_API_KEY
      }),
      feeBps: parseOptionalNumber(process.env.PREDICT_QUOTE_FEE_BPS)
    });
  }
  if (normalizedVenue === "OPINION") {
    if (!process.env.OPINION_API_KEY) {
      return null;
    }
    return new OpinionQuoteReader({
      streamCache: new QuoteSnapshotCache(),
      client: new OpinionClient({
        baseUrl: process.env.OPINION_CLOB_BASE_URL ?? process.env.OPINION_OPENAPI_BASE_URL ?? "https://proxy.opinion.trade:8443/openapi",
        apiKey: process.env.OPINION_API_KEY
      }),
      topicRate: parseOptionalNumber(process.env.OPINION_QUOTE_TOPIC_RATE),
      feeBps: parseOptionalNumber(process.env.OPINION_QUOTE_FEE_BPS)
    });
  }
  if (normalizedVenue === "MYRIAD") {
    return new MyriadQuoteReader({
      streamCache: new QuoteSnapshotCache(),
      client: new MyriadClient({
        baseUrl: process.env.MYRIAD_BASE_URL ?? "https://api-v2.myriadprotocol.com/",
        apiKey: process.env.MYRIAD_API_KEY
      })
    });
  }
  return null;
}

function toAuditSummary(markets: readonly SharedCoreQuoteReadinessMarket[], limit: number): QuoteSourceSmokeArtifact["approvedMarketAudit"] {
  const venues = markets.flatMap((market) => market.venues);
  return {
    limit,
    marketsScanned: markets.length,
    venueProfilesScanned: venues.length,
    quoteReadyVenueProfiles: venues.filter((venue) => venue.quoteReady).length,
    blockedVenueProfiles: venues.filter((venue) => !venue.quoteReady).length,
    markets: markets.map((market) => ({
      canonicalEventId: market.canonicalEventId,
      canonicalMarketIds: [...market.canonicalMarketIds],
      title: market.title,
      category: market.category,
      venues: market.venues.map((venue) => ({
        venue: venue.venue,
        quoteReady: venue.quoteReady,
        blockers: [...venue.blockers]
      }))
    }))
  };
}

function rowFromCalculation(mapping: VenueQuoteMapping, calculated: QuoteCalculationResult): QuoteSourceSmokeVenueRow {
  return {
    venue: mapping.venue.toUpperCase(),
    mappingPresent: true,
    venueMarketIdPresent: mapping.venueMarketId.length > 0,
    venueOutcomeIdPresent: Boolean(mapping.venueOutcomeId),
    quoteQuality: calculated.quoteQuality,
    quoteSource: calculated.source,
    freshnessMs: calculated.freshnessMs,
    quotedPrice: calculated.price,
    availableSize: calculated.availableSize,
    spreadBps: calculated.spreadBps,
    slippageBps: calculated.slippageBps,
    liquidityScore: calculated.liquidityScore,
    confidencePenaltyBps: calculated.confidencePenaltyBps,
    feeBpsPresent: calculated.effectiveFeeBps !== undefined,
    feeAmount: calculated.feeAmount ?? null,
    effectiveFeeBps: calculated.effectiveFeeBps ?? null,
    feeModel: calculated.feeQuote?.feeModel ?? null,
    feeSource: calculated.feeQuote?.feeSource ?? null,
    feeConfidence: calculated.feeQuote?.confidence ?? null,
    fixedFeePresent: calculated.fixedFee !== undefined,
    settlementEvidenceSupported: calculated.settlementEvidenceSupported ?? null,
    missingFactors: [...calculated.missingFactors],
    blockers: [...calculated.blockers],
    error: null
  };
}

function emptyVenueRow(
  venue: string,
  blockers: string[],
  error: string | null,
  mapping?: VenueQuoteMapping | VenueQuoteMappingReadiness
): QuoteSourceSmokeVenueRow {
  return {
    venue: venue.toUpperCase(),
    mappingPresent: mapping !== undefined,
    venueMarketIdPresent: Boolean(mapping?.venueMarketId),
    venueOutcomeIdPresent: Boolean(mapping?.venueOutcomeId),
    quoteQuality: null,
    quoteSource: null,
    freshnessMs: null,
    quotedPrice: null,
    availableSize: null,
    spreadBps: null,
    slippageBps: null,
    liquidityScore: null,
    confidencePenaltyBps: null,
    feeBpsPresent: false,
    feeAmount: null,
    effectiveFeeBps: null,
    feeModel: null,
    feeSource: null,
    feeConfidence: null,
    fixedFeePresent: false,
    settlementEvidenceSupported: null,
    missingFactors: [],
    blockers,
    error
  };
}

function renderMarkdown(artifact: QuoteSourceSmokeArtifact): string {
  return [
    "# Admin Quote Source Smoke",
    "",
    `Generated: ${artifact.generatedAt}`,
    `Status: ${artifact.status}`,
    `Mode: ${artifact.mode}`,
    `Canonical Market: ${artifact.canonicalInput.canonicalMarketId ?? "n/a"}`,
    `Canonical Outcome: ${artifact.canonicalInput.canonicalOutcomeId ?? "n/a"}`,
    `Side/Amount: ${artifact.canonicalInput.side} ${artifact.canonicalInput.amount}`,
    "",
    "| Venue | Mapping | Outcome Id | Quality | Source | Freshness ms | Price | Depth | Spread bps | Slippage bps | Fee | Fee bps | Fee model | Fee source | Liquidity | Penalty bps | Missing | Blockers | Error |",
    "|---|---:|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---:|---:|---|---|---|",
    ...artifact.venues.map((row) => [
      row.venue,
      row.mappingPresent,
      row.venueOutcomeIdPresent,
      row.quoteQuality ?? "n/a",
      row.quoteSource ?? "n/a",
      row.freshnessMs ?? "n/a",
      row.quotedPrice ?? "n/a",
      row.availableSize ?? "n/a",
      row.spreadBps ?? "n/a",
      row.slippageBps ?? "n/a",
      row.feeAmount ?? "n/a",
      row.effectiveFeeBps ?? "n/a",
      row.feeModel ?? "n/a",
      row.feeSource ?? "n/a",
      row.liquidityScore ?? "n/a",
      row.confidencePenaltyBps ?? "n/a",
      row.missingFactors.length > 0 ? row.missingFactors.join("; ") : "none",
      row.blockers.length > 0 ? row.blockers.join("; ") : "none",
      row.error ?? "none"
    ].join(" | ")).map((line) => `| ${line} |`),
    "",
    "## Safety",
    "",
    "- This smoke is read-only.",
    "- Raw venue payloads are not stored.",
    "- Credentials and env values are not stored.",
    `- Secret scan: ${artifact.safety.secretScanPassed ? "passed" : "failed"}`,
    ...(artifact.approvedMarketAudit ? [
      "",
      "## Approved Market Audit",
      "",
      `- markets scanned: ${artifact.approvedMarketAudit.marketsScanned}`,
      `- venue profiles scanned: ${artifact.approvedMarketAudit.venueProfilesScanned}`,
      `- quote-ready venue profiles: ${artifact.approvedMarketAudit.quoteReadyVenueProfiles}`,
      `- blocked venue profiles: ${artifact.approvedMarketAudit.blockedVenueProfiles}`
    ] : []),
    "",
    "## Next Actions",
    "",
    ...(artifact.nextActions.length > 0 ? artifact.nextActions.map((action) => `- ${action}`) : ["- none"]),
    ""
  ].join("\n");
}

function findSensitiveValues(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findSensitiveValues(entry, `${path}[${index}]`));
  }
  if (!isRecord(value)) {
    return [];
  }
  const findings: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (isSensitiveKey(key) && child !== null && child !== undefined && String(child).length > 0 && String(child) !== "<redacted>") {
      findings.push(childPath);
      continue;
    }
    findings.push(...findSensitiveValues(child, childPath));
  }
  return findings;
}

function isSensitiveKey(key: string): boolean {
  return sensitiveKeyPatterns.some((pattern) => pattern.test(key));
}

function parseMode(value: string | undefined): SmokeMode {
  return value?.toUpperCase() === "DISCOVER" ? "DISCOVER" : "VALIDATE";
}

function parseRequiredVenues(value: string | undefined): string[] {
  const venues = (value ?? "POLYMARKET,LIMITLESS")
    .split(",")
    .map((venue) => venue.trim().toUpperCase())
    .filter((venue) => venue.length > 0);
  return [...new Set(venues)];
}

function parseSide(value: string | undefined): "buy" | "sell" {
  return value?.toLowerCase() === "sell" ? "sell" : "buy";
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = parseOptionalNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
