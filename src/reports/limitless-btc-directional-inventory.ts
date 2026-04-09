import { normalizeFreeText } from "../canonical/canonicalization-types.js";
import { LimitlessHistoricalClient } from "../integrations/limitless/limitless-client.js";
import { loadLimitlessLiveMarkets, type LimitlessLiveMarket } from "../integrations/limitless/limitless-live-market-loader.js";
import { classifyCryptoFamily } from "../matching/crypto/crypto-family-classifier.js";
import { buildCryptoStructuralFingerprint } from "../matching/crypto/crypto-structural-fingerprint.js";
import type { MatchingMarketRecord } from "../matching/matching-types.js";
import type {
  LimitlessBtcDirectionalCandidate,
  LimitlessBtcDirectionalExcludedRow,
  LimitlessBtcDirectionalInventoryArtifact
} from "./limitless-btc-directional-types.js";

const buildMatchingRecord = (market: LimitlessLiveMarket): MatchingMarketRecord => ({
  interpretedContractId: `limitless-proof-${market.venueMarketId}`,
  venueMarketProfileId: `limitless-proof-profile-${market.venueMarketId}`,
  canonicalEventId: `limitless-proof-event-${market.venueMarketId}`,
  venue: "LIMITLESS",
  venueMarketId: market.venueMarketId,
  title: market.title,
  description: market.description,
  rulesText: market.description,
  category: market.canonicalCategory,
  marketClass: "BINARY",
  sourceMetadataVersion: "limitless-btc-directional-proof-v1",
  confidenceScore: "1",
  propositionSemantics: {},
  outcomeSemantics: {},
  timingSemantics: {},
  resolutionSemantics: {},
  settlementSemantics: {},
  ambiguityFlags: {},
  rawLineageReferences: {},
  publishedAt: market.createdAt,
  expiresAt: market.expiresAt,
  resolvesAt: market.expiresAt,
  outcomes: [],
  outcomeSchema: {},
  historicalRowCount: 0,
  inventoryTemporalBasis: "LIVE_CURRENT_STATE"
});

const buildCandidate = (
  market: LimitlessLiveMarket,
  sourceSurfaces: readonly string[]
): LimitlessBtcDirectionalCandidate => {
  const record = buildMatchingRecord(market);
  const classification = classifyCryptoFamily(record);
  const fingerprint = buildCryptoStructuralFingerprint(record, classification);

  return {
    venueMarketId: market.venueMarketId,
    rawTitle: market.title,
    normalizedTitle: normalizeFreeText(market.title),
    asset: "BTC",
    family: "SAME_DAY_DIRECTIONAL",
    familyConfidence: classification.familyConfidence,
    comparator: typeof fingerprint.fingerprint["comparator"] === "string" ? fingerprint.fingerprint["comparator"] : null,
    date: String(fingerprint.fingerprint["dateKey"]),
    cutoffTimestamp: typeof fingerprint.fingerprint["cutoffTimestamp"] === "string" ? fingerprint.fingerprint["cutoffTimestamp"] : null,
    timezoneNormalizedCutoff: typeof fingerprint.fingerprint["timezoneNormalizedCutoffKey"] === "string"
      ? fingerprint.fingerprint["timezoneNormalizedCutoffKey"]
      : null,
    bucketGranularity: typeof fingerprint.fingerprint["bucketGranularity"] === "string"
      ? fingerprint.fingerprint["bucketGranularity"]
      : null,
    observationType: typeof fingerprint.fingerprint["observationType"] === "string"
      ? fingerprint.fingerprint["observationType"]
      : null,
    binaryStructure: typeof fingerprint.fingerprint["binaryStructure"] === "string"
      ? fingerprint.fingerprint["binaryStructure"]
      : null,
    sourceSurfaces,
    discoveryTimestamp: market.fetchedAt.toISOString(),
    currentlyActive: market.status === null || market.status.toLowerCase() === "open" || market.status.toLowerCase() === "active",
    ambiguityFlags: classification.ambiguityFlags
  };
};

const buildExcludedRow = (
  market: LimitlessLiveMarket,
  source: string,
  reasons: readonly string[]
): LimitlessBtcDirectionalExcludedRow => ({
  surface: source,
  venueMarketId: market.venueMarketId,
  title: market.title,
  reasons
});

const isLikelyBtcDirectional = (market: LimitlessLiveMarket): boolean =>
  /\b(bitcoin|btc)\b/i.test(`${market.title} ${market.description ?? ""}`)
  && /\b(up or down|higher or lower)\b/i.test(`${market.title} ${market.description ?? ""}`);

export const buildLimitlessBtcDirectionalInventoryArtifact = async (input: {
  repoRoot: string;
  limitlessBaseUrl?: string;
  limitlessApiKey?: string | null;
  loadedMarkets?: readonly LimitlessLiveMarket[];
  sourceRefCountOverride?: number;
  detailVerifier?: (venueMarketId: string) => Promise<boolean>;
}): Promise<LimitlessBtcDirectionalInventoryArtifact> => {
  const loaded = input.loadedMarkets
    ? {
      markets: input.loadedMarkets,
      summary: {
        observedAt: new Date().toISOString(),
        fetchedFromLiveSurface: false,
        sourceRefs: [],
        totalMarkets: input.loadedMarkets.length,
        categories: {},
        families: {},
        assets: {}
      }
    }
    : await loadLimitlessLiveMarkets({
      repoRoot: input.repoRoot,
      fetchRemote: true
    });

  const client = input.limitlessApiKey
    ? new LimitlessHistoricalClient({
      baseUrl: input.limitlessBaseUrl ?? "https://api.limitless.exchange",
      apiKey: input.limitlessApiKey
    })
    : null;

  const marketsById = new Map<string, LimitlessLiveMarket>();
  const sourceSurfacesById = new Map<string, string[]>();
  for (const market of loaded.markets) {
    marketsById.set(market.venueMarketId, market);
    sourceSurfacesById.set(market.venueMarketId, [market.sourceRef]);
  }

  if (input.detailVerifier) {
    for (const market of loaded.markets.filter(isLikelyBtcDirectional)) {
      if (await input.detailVerifier(market.venueMarketId)) {
        const surfaces = sourceSurfacesById.get(market.venueMarketId) ?? [];
        if (!surfaces.includes("limitless-client-market-detail")) {
          surfaces.push("limitless-client-market-detail");
        }
        sourceSurfacesById.set(market.venueMarketId, surfaces);
      }
    }
  } else if (client) {
    for (const market of loaded.markets.filter(isLikelyBtcDirectional)) {
      try {
        await client.getMarketDetail(market.venueMarketId);
        const surfaces = sourceSurfacesById.get(market.venueMarketId) ?? [];
        if (!surfaces.includes("limitless-client-market-detail")) {
          surfaces.push("limitless-client-market-detail");
        }
        sourceSurfacesById.set(market.venueMarketId, surfaces);
      } catch {
        // Best-effort enrichment only.
      }
    }
  }

  const candidates: LimitlessBtcDirectionalCandidate[] = [];
  const exclusions: LimitlessBtcDirectionalExcludedRow[] = [];

  for (const market of marketsById.values()) {
    const record = buildMatchingRecord(market);
    const classification = classifyCryptoFamily(record);
    const fingerprint = buildCryptoStructuralFingerprint(record, classification);
    const reasons: string[] = [];

    if (classification.metadata["normalizedAsset"] !== "BTC") {
      reasons.push(classification.metadata["normalizedAsset"] === null ? "missing_btc_signal" : "non_btc_asset");
    }
    if (classification.family !== "SAME_DAY_DIRECTIONAL") {
      reasons.push("family_not_same_day_directional");
    }
    if (typeof fingerprint.fingerprint["dateKey"] !== "string") {
      reasons.push("insufficient_time_boundary");
    }
    if (classification.metadata["sourceHygieneStatus"] === "REJECT") {
      reasons.push("bad_crypto_row");
    }

    if (reasons.length > 0) {
      exclusions.push(buildExcludedRow(market, market.sourceRef, reasons));
      continue;
    }

    candidates.push(buildCandidate(
      market,
      sourceSurfacesById.get(market.venueMarketId) ?? [market.sourceRef]
    ));
  }

  candidates.sort((left, right) =>
    left.date.localeCompare(right.date)
    || left.venueMarketId.localeCompare(right.venueMarketId)
  );

  return {
    observedAt: new Date().toISOString(),
    reachableSurfaceCount: input.sourceRefCountOverride ?? (loaded.summary.sourceRefs.length + (client || input.detailVerifier ? 1 : 0)),
    authenticatedEnrichmentAttempted: client !== null || Boolean(input.detailVerifier),
    candidates,
    exclusions: exclusions.sort((left, right) => left.venueMarketId.localeCompare(right.venueMarketId))
  };
};

export const buildLimitlessBtcDirectionalInventoryMarkdown = (
  artifact: LimitlessBtcDirectionalInventoryArtifact
): string => [
  "# Limitless BTC SAME_DAY_DIRECTIONAL Inventory",
  "",
  `- candidates: ${artifact.candidates.length}`,
  `- exclusions: ${artifact.exclusions.length}`,
  `- authenticated enrichment attempted: ${artifact.authenticatedEnrichmentAttempted ? "yes" : "no"}`,
  "",
  "| Market | Date | Cutoff | Observation Type | Surfaces | Active |",
  "| --- | --- | --- | --- | --- | --- |",
  ...artifact.candidates.map((candidate) =>
    `| ${candidate.rawTitle} | ${candidate.date} | ${candidate.timezoneNormalizedCutoff ?? "none"} | ${candidate.observationType ?? "unknown"} | ${candidate.sourceSurfaces.join(", ")} | ${candidate.currentlyActive ? "yes" : "no"} |`
  ),
  ""
].join("\n");
