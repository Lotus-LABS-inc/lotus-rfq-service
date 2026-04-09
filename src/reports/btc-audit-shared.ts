import { buildStableUuid } from "../canonical/canonicalization-types.js";
import { OpinionClient } from "../integrations/opinion/opinion-client.js";
import { OpinionMarketAdapter } from "../integrations/opinion/opinion-market-adapter.js";
import { loadLimitlessLiveMarkets } from "../integrations/limitless/limitless-live-market-loader.js";
import { PredexonHistoricalAdapter } from "../integrations/predexon/predexon-historical-adapter.js";
import { PredexonHistoricalClient } from "../integrations/predexon/predexon-client.js";
import { classifyCryptoFamily } from "../matching/crypto/crypto-family-classifier.js";
import { buildCryptoStructuralFingerprint } from "../matching/crypto/crypto-structural-fingerprint.js";
import type { ContractFamilyClassification, MatchingMarketRecord, PairEdgeRecord, StructuralFingerprint } from "../matching/matching-types.js";
import { PairEdgeRepository } from "../repositories/pair-edge.repository.js";
import type { BtcAuditData, BtcAuditMarketContext, BtcAuditVenue, BtcInventoryAlignmentRow, BtcStructuralEligibilityStatus } from "./btc-audit-types.js";
import type { Pool } from "pg";

export interface RemoteAuditConfig {
  repoRoot: string;
  opinionBaseUrl: string;
  opinionApiKey: string;
  predexonBaseUrl: string;
  predexonApiKey: string;
  limitlessBaseUrl?: string;
  limitlessApiKey?: string;
}

const TARGET_VENUES = new Set<BtcAuditVenue>(["POLYMARKET", "LIMITLESS", "OPINION"]);
const TARGET_FAMILIES = new Set(["THRESHOLD_BY_DATE", "ATH_BY_DATE", "SAME_DAY_DIRECTIONAL", "PRICE_AT_CLOSE", "UP_DOWN_BUCKET", "PRICE_RANGE_BUCKET", "GENERIC_DIRECTIONAL"]);

const emptyRecord = Object.freeze({});
const emptyArray = Object.freeze([]) as readonly Record<string, unknown>[];

const buildRemoteMatchingMarket = (input: {
  venue: BtcAuditVenue;
  venueMarketId: string;
  title: string;
  rulesText: string | null;
  publishedAt?: Date | null;
  expiresAt?: Date | null;
  resolvesAt?: Date | null;
}): MatchingMarketRecord => ({
  interpretedContractId: `remote-${input.venue}-${input.venueMarketId}`,
  venueMarketProfileId: `remote-profile-${input.venue}-${input.venueMarketId}`,
  canonicalEventId: buildStableUuid(`remote-btc-audit:${input.venue}:${input.venueMarketId}`),
  venue: input.venue,
  venueMarketId: input.venueMarketId,
  title: input.title,
  description: input.rulesText,
  rulesText: input.rulesText,
  category: "CRYPTO",
  marketClass: "BINARY",
  sourceMetadataVersion: "btc-audit-remote-v1",
  confidenceScore: "1",
  propositionSemantics: emptyRecord,
  outcomeSemantics: emptyRecord,
  timingSemantics: emptyRecord,
  resolutionSemantics: emptyRecord,
  settlementSemantics: emptyRecord,
  ambiguityFlags: emptyRecord,
  rawLineageReferences: emptyRecord,
  publishedAt: input.publishedAt ?? null,
  expiresAt: input.expiresAt ?? null,
  resolvesAt: input.resolvesAt ?? null,
  outcomes: emptyArray,
  outcomeSchema: emptyRecord,
  historicalRowCount: 0,
  inventoryTemporalBasis: "LIVE_CURRENT_STATE"
});

const hasCryptoSignal = (title: string, rulesText: string | null): boolean =>
  /\b(bitcoin|btc)\b/i.test(`${title} ${rulesText ?? ""}`);

export const determineBtcStructuralEligibilityStatus = (classification: ContractFamilyClassification): BtcStructuralEligibilityStatus => {
  const asset = classification.metadata["normalizedAsset"];
  if (classification.metadata["sourceHygieneStatus"] === "REJECT") {
    return "SOURCE_HYGIENE_REJECTED";
  }
  if (asset !== "BTC") {
    return "NON_BTC_ASSET";
  }
  if (classification.metadata["structuralLaneEligible"] !== true || classification.weakStructureLane) {
    return "STRUCTURAL_REJECTED";
  }
  return "BTC_STRUCTURAL_ELIGIBLE";
};

export const buildExactWindowKey = (fingerprint: StructuralFingerprint): string | null => {
  const value = fingerprint.fingerprint;
  if (value.asset !== "BTC" || typeof value.family !== "string" || !TARGET_FAMILIES.has(value.family)) {
    return null;
  }
  const date = typeof value.dateKey === "string" ? value.dateKey : null;
  if (!date) {
    return null;
  }
  return [
    value.asset,
    value.family,
    date,
    String(value.timezoneNormalizedCutoffKey ?? "none"),
    String(value.threshold ?? "none"),
    String(value.comparator ?? "none"),
    String(value.observationType ?? "none"),
    String(value.bucketGranularity ?? "none"),
    String(value.binaryStructure ?? "none"),
    String(value.structuralContractClass ?? "none")
  ].join("|");
};

export const buildFamilyDateKey = (fingerprint: StructuralFingerprint): string | null => {
  const value = fingerprint.fingerprint;
  if (value.asset !== "BTC" || typeof value.family !== "string" || !TARGET_FAMILIES.has(value.family)) {
    return null;
  }
  const date = typeof value.dateKey === "string" ? value.dateKey : null;
  return date ? [value.asset, value.family, date].join("|") : null;
};

const toAlignmentRow = (
  market: MatchingMarketRecord,
  classification: ContractFamilyClassification,
  fingerprint: StructuralFingerprint,
  source: BtcInventoryAlignmentRow["source"],
  canonicalRefs: { canonicalEventId: string | null; canonicalMarketId: string | null }
): BtcInventoryAlignmentRow => ({
  source,
  venue: market.venue as BtcAuditVenue,
  venueMarketId: market.venueMarketId,
  title: market.title,
  canonicalEventId: canonicalRefs.canonicalEventId,
  canonicalMarketId: canonicalRefs.canonicalMarketId,
  normalizedAsset: classification.metadata["normalizedAsset"] as string | null ?? null,
  normalizedFamily: classification.family,
  comparator: typeof fingerprint.fingerprint.comparator === "string" ? fingerprint.fingerprint.comparator : null,
  threshold: typeof fingerprint.fingerprint.threshold === "string" ? fingerprint.fingerprint.threshold : null,
  thresholdUnit: typeof fingerprint.fingerprint.thresholdUnit === "string" ? fingerprint.fingerprint.thresholdUnit : null,
  date: typeof fingerprint.fingerprint.dateKey === "string" ? fingerprint.fingerprint.dateKey : null,
  cutoffTimestamp: typeof fingerprint.fingerprint.cutoffTimestamp === "string" ? fingerprint.fingerprint.cutoffTimestamp : null,
  timezoneNormalizedCutoff: typeof fingerprint.fingerprint.timezoneNormalizedCutoffKey === "string" ? fingerprint.fingerprint.timezoneNormalizedCutoffKey : null,
  bucketGranularity: typeof fingerprint.fingerprint.bucketGranularity === "string" ? fingerprint.fingerprint.bucketGranularity : null,
  observationType: typeof fingerprint.fingerprint.observationType === "string" ? fingerprint.fingerprint.observationType : null,
  binaryStructure: typeof fingerprint.fingerprint.binaryStructure === "string" ? fingerprint.fingerprint.binaryStructure : null,
  structuralEligibilityStatus: determineBtcStructuralEligibilityStatus(classification),
  structuralRejectionReasons: classification.ambiguityFlags,
  sourceHygieneReasons: Array.isArray(classification.metadata["sourceHygieneReasons"])
    ? (classification.metadata["sourceHygieneReasons"] as readonly string[])
    : [],
  exactWindowKey: buildExactWindowKey(fingerprint),
  familyDateKey: buildFamilyDateKey(fingerprint)
});

const buildContext = (
  market: MatchingMarketRecord,
  source: BtcInventoryAlignmentRow["source"]
): BtcAuditMarketContext => {
  const classification = classifyCryptoFamily(market);
  const fingerprint = buildCryptoStructuralFingerprint(market, classification);
  return {
    market,
    classification,
    fingerprint,
    row: toAlignmentRow(
      market,
      classification,
      fingerprint,
      source,
      {
        canonicalEventId: source === "LOCAL_INVENTORY" ? market.canonicalEventId : null,
        canonicalMarketId: null
      }
    )
  };
};

const isTargetLocalMarket = (market: MatchingMarketRecord): boolean =>
  market.category === "CRYPTO" && TARGET_VENUES.has(market.venue as BtcAuditVenue);

const loadOpinionRemoteContexts = async (config: RemoteAuditConfig): Promise<readonly BtcAuditMarketContext[]> => {
  try {
    const client = new OpinionClient({
      baseUrl: config.opinionBaseUrl,
      apiKey: config.opinionApiKey
    });
    const adapter = new OpinionMarketAdapter({
      client,
      metadataVersion: "btc-audit-opinion-remote-v1"
    });
    const rows: BtcAuditMarketContext[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const markets = await adapter.listMarkets({ page, limit: 100 });
      if (markets.length === 0) {
        break;
      }
      for (const market of markets) {
        if (adapter.inferCanonicalCategory(market) !== "CRYPTO" || !hasCryptoSignal(market.title, market.rules)) {
          continue;
        }
        rows.push(buildContext(buildRemoteMatchingMarket({
          venue: "OPINION",
          venueMarketId: market.venueMarketId,
          title: market.title,
          rulesText: market.rules,
          publishedAt: market.createdAt,
          expiresAt: market.cutoffAt,
          resolvesAt: market.resolvedAt
        }), "REMOTE_AUDIT"));
      }
      if (markets.length < 100) {
        break;
      }
    }
    return rows;
  } catch {
    return [];
  }
};

const loadLimitlessRemoteContexts = async (config: RemoteAuditConfig): Promise<readonly BtcAuditMarketContext[]> => {
  const loaded = await loadLimitlessLiveMarkets({
    repoRoot: config.repoRoot,
    fetchRemote: true
  });
  return loaded.markets
    .filter((market) => market.canonicalCategory === "CRYPTO" && hasCryptoSignal(market.title, market.description))
    .map((market) => buildContext(buildRemoteMatchingMarket({
      venue: "LIMITLESS",
      venueMarketId: market.venueMarketId,
      title: market.title,
      rulesText: market.description,
      publishedAt: market.createdAt,
      expiresAt: market.expiresAt,
      resolvesAt: market.expiresAt
    }), "REMOTE_AUDIT"));
};

const loadPolymarketRemoteContexts = async (config: RemoteAuditConfig): Promise<readonly BtcAuditMarketContext[]> => {
  try {
    const adapter = new PredexonHistoricalAdapter({
      client: new PredexonHistoricalClient({
        baseUrl: config.predexonBaseUrl,
        apiKey: config.predexonApiKey
      }),
      metadataVersion: "btc-audit-predexon-remote-v1"
    });
    const rows: BtcAuditMarketContext[] = [];
    for (let offset = 0; offset < 500; offset += 100) {
      const markets = await adapter.listHistoricalMarkets({
        search: "Bitcoin",
        limit: 100,
        offset,
        sort: "relevance"
      });
      if (markets.length === 0) {
        break;
      }
      for (const market of markets) {
        const raw = market.raw as Record<string, unknown>;
        const endTime = typeof raw["end_time"] === "string" ? new Date(raw["end_time"]) : null;
        if (!hasCryptoSignal(market.title, null)) {
          continue;
        }
        rows.push(buildContext(buildRemoteMatchingMarket({
          venue: "POLYMARKET",
          venueMarketId: market.conditionId,
          title: market.title,
          rulesText: typeof raw["description"] === "string" ? raw["description"] : null,
          publishedAt: typeof raw["created_time"] === "string" ? new Date(raw["created_time"]) : null,
          expiresAt: endTime,
          resolvesAt: endTime
        }), "REMOTE_AUDIT"));
      }
      if (markets.length < 100) {
        break;
      }
    }
    return rows;
  } catch {
    return [];
  }
};

export const loadBtcAuditData = async (
  pool: Pool,
  remoteConfig: RemoteAuditConfig
): Promise<BtcAuditData> => {
  const repository = new PairEdgeRepository(pool);
  const [localMarkets, pairEdges, remoteOpinion, remoteLimitless, remotePolymarket] = await Promise.all([
    repository.listMatchingMarkets(),
    repository.listPairEdges(),
    loadOpinionRemoteContexts(remoteConfig),
    loadLimitlessRemoteContexts(remoteConfig),
    loadPolymarketRemoteContexts(remoteConfig)
  ]);

  const localContexts = localMarkets
    .filter(isTargetLocalMarket)
    .map((market) => buildContext(market, "LOCAL_INVENTORY"));

  return {
    localMarkets: localContexts,
    remoteMarkets: [...remoteOpinion, ...remoteLimitless, ...remotePolymarket].map((entry) => entry.row),
    pairEdges
  };
};

export const listBtcEligibleRows = (rows: readonly BtcInventoryAlignmentRow[]): readonly BtcInventoryAlignmentRow[] =>
  rows.filter((row) => row.structuralEligibilityStatus === "BTC_STRUCTURAL_ELIGIBLE");

export const listBtcSourceHygieneRejectedRows = (rows: readonly BtcInventoryAlignmentRow[]): readonly BtcInventoryAlignmentRow[] =>
  rows.filter((row) => row.structuralEligibilityStatus === "SOURCE_HYGIENE_REJECTED");

export const buildWindowLabel = (row: BtcInventoryAlignmentRow): string =>
  `${row.normalizedFamily}|${row.date ?? "unknown-date"}|${row.timezoneNormalizedCutoff ?? "unknown-cutoff"}`;

export const getExactApprovedEdges = (pairEdges: readonly PairEdgeRecord[]): readonly PairEdgeRecord[] =>
  pairEdges.filter((edge) => edge.label === "EXACT" && (edge.approvalState === "approved" || edge.approvalState === "autoApproved"));
