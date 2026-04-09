import type { ContractFamilyClassification, MatchingMarketRecord, PairEdgeRecord, StructuralFingerprint } from "../../src/matching/matching-types.js";
import type { MatchingProvenance } from "../../src/matching/matching-provenance.js";
import type { BtcAuditData, BtcAuditMarketContext, BtcAuditVenue, BtcInventoryAlignmentRow } from "../../src/reports/btc-audit-types.js";

const defaultProvenance: MatchingProvenance = {
  familyClassifierRuleIds: [],
  fingerprintRuleIds: [],
  prefilterRuleIds: [],
  structuralRuleIds: [],
  classifierRuleIds: [],
  embeddingRuleIds: [],
  temporalBasis: "LIVE_ONLY",
  replay: {
    replayReference: null,
    deterministicInputHash: "fixture",
    evaluationVersion: "fixture"
  }
};

const buildMarket = (row: BtcInventoryAlignmentRow): MatchingMarketRecord => ({
  interpretedContractId: `${row.venueMarketId}-ic`,
  venueMarketProfileId: `${row.venueMarketId}-vmp`,
  canonicalEventId: row.canonicalEventId ?? `${row.venueMarketId}-event`,
  venue: row.venue,
  venueMarketId: row.venueMarketId,
  title: row.title,
  description: null,
  rulesText: null,
  category: "CRYPTO",
  marketClass: "BINARY",
  sourceMetadataVersion: "fixture",
  confidenceScore: "1",
  propositionSemantics: {},
  outcomeSemantics: {},
  timingSemantics: {},
  resolutionSemantics: {},
  settlementSemantics: {},
  ambiguityFlags: {},
  rawLineageReferences: {},
  publishedAt: null,
  expiresAt: null,
  resolvesAt: null,
  outcomes: [],
  outcomeSchema: {},
  historicalRowCount: 0,
  inventoryTemporalBasis: "LIVE_CURRENT_STATE"
});

const buildClassification = (row: BtcInventoryAlignmentRow): ContractFamilyClassification => ({
  interpretedContractId: `${row.venueMarketId}-ic`,
  family: row.normalizedFamily as ContractFamilyClassification["family"],
  familyConfidence: "1",
  classificationReasons: [],
  ruleIds: [],
  ambiguityFlags: row.structuralRejectionReasons,
  weakStructureLane: row.structuralEligibilityStatus !== "BTC_STRUCTURAL_ELIGIBLE",
  classifierVersion: "fixture",
  metadata: {
    normalizedAsset: row.normalizedAsset,
    normalizedDateKey: row.date,
    structuralLaneEligible: row.structuralEligibilityStatus === "BTC_STRUCTURAL_ELIGIBLE",
    sourceHygieneStatus: row.structuralEligibilityStatus === "SOURCE_HYGIENE_REJECTED" ? "REJECT" : "PASS",
    sourceHygieneReasons: row.sourceHygieneReasons
  }
});

const buildFingerprint = (row: BtcInventoryAlignmentRow): StructuralFingerprint => ({
  interpretedContractId: `${row.venueMarketId}-ic`,
  fingerprintHash: `${row.venueMarketId}-fp`,
  fingerprint: {
    asset: row.normalizedAsset,
    family: row.normalizedFamily,
    comparator: row.comparator,
    threshold: row.threshold,
    dateKey: row.date,
    cutoffTimestamp: row.cutoffTimestamp,
    timezoneNormalizedCutoffKey: row.timezoneNormalizedCutoff,
    bucketGranularity: row.bucketGranularity,
    observationType: row.observationType,
    binaryStructure: row.binaryStructure,
    structuralContractClass: "fixture"
  },
  normalizedValues: {},
  unresolvedDimensions: [],
  provenance: {},
  fingerprintVersion: "fixture"
});

export const buildBtcAuditContext = (row: BtcInventoryAlignmentRow): BtcAuditMarketContext => ({
  market: buildMarket(row),
  classification: buildClassification(row),
  fingerprint: buildFingerprint(row),
  row
});

export const buildBtcRow = (input: Partial<BtcInventoryAlignmentRow> & Pick<BtcInventoryAlignmentRow, "venue" | "venueMarketId" | "title" | "normalizedFamily">): BtcInventoryAlignmentRow => ({
  source: input.source ?? "LOCAL_INVENTORY",
  venue: input.venue,
  venueMarketId: input.venueMarketId,
  title: input.title,
  canonicalEventId: input.canonicalEventId ?? `${input.venueMarketId}-event`,
  canonicalMarketId: input.canonicalMarketId ?? null,
  normalizedAsset: input.normalizedAsset ?? "BTC",
  normalizedFamily: input.normalizedFamily,
  comparator: input.comparator ?? "ABOVE",
  threshold: input.threshold ?? "100000",
  thresholdUnit: input.thresholdUnit ?? "USD",
  date: input.date ?? "2026-03-31",
  cutoffTimestamp: input.cutoffTimestamp ?? "2026-03-31T23:59:59Z",
  timezoneNormalizedCutoff: input.timezoneNormalizedCutoff ?? "2026-03-31T23:59:59Z",
  bucketGranularity: input.bucketGranularity ?? "DAY",
  observationType: input.observationType ?? "ANY_TIME_BEFORE",
  binaryStructure: input.binaryStructure ?? "YES_NO",
  structuralEligibilityStatus: input.structuralEligibilityStatus ?? "BTC_STRUCTURAL_ELIGIBLE",
  structuralRejectionReasons: input.structuralRejectionReasons ?? [],
  sourceHygieneReasons: input.sourceHygieneReasons ?? [],
  exactWindowKey: input.exactWindowKey ?? `BTC|${input.normalizedFamily}|${input.date ?? "2026-03-31"}|${input.timezoneNormalizedCutoff ?? "2026-03-31T23:59:59Z"}|${input.threshold ?? "100000"}|${input.comparator ?? "ABOVE"}|${input.observationType ?? "ANY_TIME_BEFORE"}|${input.bucketGranularity ?? "DAY"}|${input.binaryStructure ?? "YES_NO"}|fixture`,
  familyDateKey: input.familyDateKey ?? `BTC|${input.normalizedFamily}|${input.date ?? "2026-03-31"}`
});

export const buildPairEdge = (input: Partial<PairEdgeRecord> & Pick<PairEdgeRecord, "id" | "family" | "leftVenue" | "rightVenue">): PairEdgeRecord => ({
  id: input.id,
  canonicalEventId: input.canonicalEventId ?? `${input.id}-event`,
  interpretedContractAId: input.interpretedContractAId ?? `${input.id}-a`,
  interpretedContractBId: input.interpretedContractBId ?? `${input.id}-b`,
  leftVenue: input.leftVenue,
  rightVenue: input.rightVenue,
  family: input.family,
  label: input.label ?? "EXACT",
  confidenceScore: input.confidenceScore ?? "0.99",
  approvalState: input.approvalState ?? "autoApproved",
  reasons: input.reasons ?? [],
  rejectionReasons: input.rejectionReasons ?? [],
  temporalBasis: input.temporalBasis ?? "LIVE_ONLY",
  compatibilityDecisionId: input.compatibilityDecisionId ?? null,
  compatibilityClass: input.compatibilityClass ?? null,
  matchingVersionId: input.matchingVersionId ?? "fixture",
  provenance: input.provenance ?? defaultProvenance,
  computedAt: input.computedAt ?? new Date("2026-04-02T00:00:00Z"),
  reviewedBy: input.reviewedBy ?? null,
  reviewedAt: input.reviewedAt ?? null,
  reviewReason: input.reviewReason ?? null
});

export const buildBtcAuditData = (input: {
  localRows?: readonly BtcInventoryAlignmentRow[];
  remoteRows?: readonly BtcInventoryAlignmentRow[];
  pairEdges?: readonly PairEdgeRecord[];
}): BtcAuditData => ({
  localMarkets: (input.localRows ?? []).map(buildBtcAuditContext),
  remoteMarkets: input.remoteRows ?? [],
  pairEdges: input.pairEdges ?? []
});
