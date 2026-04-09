import type { CanonicalVenue } from "../canonical/canonicalization-types.js";
import type { ContractFamilyClassification, MatchingMarketRecord, PairEdgeRecord, StructuralFingerprint } from "../matching/matching-types.js";

export type BtcAuditVenue = Extract<CanonicalVenue, "POLYMARKET" | "LIMITLESS" | "OPINION">;

export type BtcStructuralEligibilityStatus =
  | "BTC_STRUCTURAL_ELIGIBLE"
  | "NON_BTC_ASSET"
  | "SOURCE_HYGIENE_REJECTED"
  | "STRUCTURAL_REJECTED";

export interface BtcInventoryAlignmentRow {
  source: "LOCAL_INVENTORY" | "REMOTE_AUDIT";
  venue: BtcAuditVenue;
  venueMarketId: string;
  title: string;
  canonicalEventId: string | null;
  canonicalMarketId: string | null;
  normalizedAsset: string | null;
  normalizedFamily: string;
  comparator: string | null;
  threshold: string | null;
  thresholdUnit: string | null;
  date: string | null;
  cutoffTimestamp: string | null;
  timezoneNormalizedCutoff: string | null;
  bucketGranularity: string | null;
  observationType: string | null;
  binaryStructure: string | null;
  structuralEligibilityStatus: BtcStructuralEligibilityStatus;
  structuralRejectionReasons: readonly string[];
  sourceHygieneReasons: readonly string[];
  exactWindowKey: string | null;
  familyDateKey: string | null;
}

export interface BtcAuditMarketContext {
  market: MatchingMarketRecord;
  classification: ContractFamilyClassification;
  fingerprint: StructuralFingerprint;
  row: BtcInventoryAlignmentRow;
}

export type BtcMissingEdgeRootCause =
  | "UPSTREAM_INVENTORY_MISSING"
  | "INGESTION_MISSING"
  | "NORMALIZATION_MISSING"
  | "TRUE_STRUCTURE_MISMATCH";

export interface BtcMissingEdgeRootCauseEntry {
  family: string;
  venuePair: string;
  windowLabel: string;
  rootCause: BtcMissingEdgeRootCause;
  rationale: string;
  localCandidateCount: number;
  remoteCandidateCount: number;
  exactEdgePresent: boolean;
}

export interface BtcFamilyConvergenceFamilySummary {
  family: string;
  priorityRank: number;
  countsByVenue: Record<BtcAuditVenue, number>;
  localCountsByVenue: Record<BtcAuditVenue, number>;
  remoteCountsByVenue: Record<BtcAuditVenue, number>;
  exactCandidateWindows: readonly string[];
  nearExactWindows: readonly string[];
  missingCounterpartWindows: readonly string[];
  exactSafeEdgesByVenuePair: Record<string, number>;
  likelyTriViability: string;
}

export interface BtcFamilyConvergenceSummary {
  observedAt: string;
  sourceCryptoMarketCount: number;
  btcEligibleMarketCount: number;
  selectedFamily: string;
  selectionRationale: string;
  families: readonly BtcFamilyConvergenceFamilySummary[];
}

export interface BtcMissingEdgeRootCauseSummary {
  observedAt: string;
  countsByRootCause: Record<BtcMissingEdgeRootCause, number>;
  entries: readonly BtcMissingEdgeRootCauseEntry[];
  dominantRootCause: BtcMissingEdgeRootCause;
}

export interface BtcTargetedIngestionRecoverySummary {
  observedAt: string;
  executed: boolean;
  rationale: string;
  actions: readonly {
    venue: BtcAuditVenue;
    action: string;
    candidateWindowCount: number;
    newEligibleWindows: number;
  }[];
  beforeExactSafeEdges: number;
  afterExactSafeEdges: number;
}

export interface BtcSourceHygieneSummary {
  observedAt: string;
  rejectedRowCount: number;
  reasons: Record<string, number>;
  examples: readonly {
    venue: BtcAuditVenue;
    venueMarketId: string;
    title: string;
    reasons: readonly string[];
  }[];
}

export type BtcNextStepDecisionLabel =
  | "BTC_MATCHER_READY__INVENTORY_BLOCKED"
  | "BTC_INGESTION_GAP_FOUND__RECOVERY_NEXT"
  | "BTC_NORMALIZATION_GAP_FOUND__FIX_NEXT"
  | "BTC_FAMILY_CONVERGENCE_READY__TRI_POSSIBLE_SOON";

export interface BtcNextStepDecision {
  observedAt: string;
  decision: BtcNextStepDecisionLabel;
  selectedFamily: string;
  rationale: string;
  exactSafeEdges: number;
  limitlessOpinionExactPath: boolean;
  triCapableFamily: string | null;
}

export interface BtcAuditData {
  localMarkets: readonly BtcAuditMarketContext[];
  remoteMarkets: readonly BtcInventoryAlignmentRow[];
  pairEdges: readonly PairEdgeRecord[];
}
