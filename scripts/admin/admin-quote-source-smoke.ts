import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";

import {
  calculateVenueQuote,
  EnvVenueQuoteMappingResolver,
  QuoteSnapshotCache,
  type QuoteCalculationResult,
  type VenueQuoteMapping,
  type VenueQuoteSnapshotReader
} from "../../src/core/sor/quote-snapshot.js";
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
  requiredVenues: ["POLYMARKET", "LIMITLESS"];
  mappingSummary: {
    sourceEnvPresent: boolean;
    selectedKey: string | null;
    mappingsResolved: number;
    venuesResolved: string[];
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

const requiredVenues = ["POLYMARKET", "LIMITLESS"] as const;
const artifactDir = join(process.cwd(), "artifacts", "execution");
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
const rawMappingJson = process.env.EXECUTION_QUOTE_VENUE_MARKET_MAP_JSON;
const mappingSelection = selectCanonicalInput(rawMappingJson);
const canonicalMarketId = process.env.QUOTE_SOURCE_SMOKE_CANONICAL_MARKET_ID?.trim() || mappingSelection.canonicalMarketId;
const canonicalOutcomeId = process.env.QUOTE_SOURCE_SMOKE_CANONICAL_OUTCOME_ID?.trim() || mappingSelection.canonicalOutcomeId;

const generatedAt = new Date().toISOString();
const rows: QuoteSourceSmokeVenueRow[] = [];
const nextActions: string[] = [];
let mappings: readonly VenueQuoteMapping[] = [];

if (!canonicalMarketId) {
  nextActions.push("Set QUOTE_SOURCE_SMOKE_CANONICAL_MARKET_ID or provide EXECUTION_QUOTE_VENUE_MARKET_MAP_JSON with at least one canonical key.");
}

if (canonicalMarketId) {
  try {
    mappings = await new EnvVenueQuoteMappingResolver(rawMappingJson).resolve({
      canonicalMarketId,
      ...(canonicalOutcomeId ? { canonicalOutcomeId } : {})
    });
  } catch (error) {
    nextActions.push(`Fix EXECUTION_QUOTE_VENUE_MARKET_MAP_JSON parse error: ${errorMessage(error)}.`);
  }
}

const mappingsByVenue = new Map(mappings.map((mapping) => [mapping.venue.toUpperCase(), mapping]));
for (const venue of requiredVenues) {
  const mapping = mappingsByVenue.get(venue);
  if (!mapping) {
    rows.push(emptyVenueRow(venue, ["QUOTE_MAPPING_MISSING"], null));
    nextActions.push(`Add a ${venue} mapping to EXECUTION_QUOTE_VENUE_MARKET_MAP_JSON for the selected canonical key.`);
    continue;
  }
  if (venue === "POLYMARKET" && !mapping.venueOutcomeId) {
    rows.push(emptyVenueRow(venue, ["POLYMARKET_VENUE_OUTCOME_ID_REQUIRED"], null, mapping));
    nextActions.push("Add Polymarket venueOutcomeId as the CLOB token_id; condition/market id alone is not enough for executable orderbook quotes.");
    continue;
  }
  if (mode === "DISCOVER") {
    rows.push(emptyVenueRow(venue, ["DISCOVER_MODE_NO_LIVE_VALIDATION"], null, mapping));
    continue;
  }

  rows.push(await validateVenue(mapping));
}

const secretFindings = findSensitiveValues(rows);
const requiredVenueSet = new Set(requiredVenues);
const passed = rows.length === requiredVenues.length &&
  rows.every((row) =>
    requiredVenueSet.has(row.venue as typeof requiredVenues[number]) &&
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
  requiredVenues: ["POLYMARKET", "LIMITLESS"],
  mappingSummary: {
    sourceEnvPresent: Boolean(rawMappingJson && rawMappingJson.trim().length > 0),
    selectedKey: mappingSelection.selectedKey,
    mappingsResolved: mappings.length,
    venuesResolved: mappings.map((mapping) => mapping.venue.toUpperCase()).sort()
  },
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
  return null;
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
  mapping?: VenueQuoteMapping
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

function selectCanonicalInput(rawJson: string | undefined): {
  selectedKey: string | null;
  canonicalMarketId: string | undefined;
  canonicalOutcomeId: string | undefined;
} {
  if (!rawJson || rawJson.trim().length === 0) {
    return { selectedKey: null, canonicalMarketId: undefined, canonicalOutcomeId: undefined };
  }
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return { selectedKey: null, canonicalMarketId: undefined, canonicalOutcomeId: undefined };
    }
    const selectedKey = Object.keys(parsed as Record<string, unknown>)[0];
    if (!selectedKey) {
      return { selectedKey: null, canonicalMarketId: undefined, canonicalOutcomeId: undefined };
    }
    const [canonicalMarketId, canonicalOutcomeId] = selectedKey.split("|", 2);
    return { selectedKey, canonicalMarketId, canonicalOutcomeId };
  } catch {
    return { selectedKey: null, canonicalMarketId: undefined, canonicalOutcomeId: undefined };
  }
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
