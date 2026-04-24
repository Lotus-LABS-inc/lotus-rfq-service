import type {
  CanonicalCategory,
  CanonicalMarketClass,
  CanonicalVenue
} from "../canonical/canonicalization-types.js";
import type {
  InventoryTemporalBasis,
  RouteabilityTemporalBasis
} from "../inventory/inventory-basis-classifier.js";
import type {
  PairClassifierPolicyRecommendation,
  PairEdgeApprovalState,
  PairMatchLabel,
  StructuralMatchOutcome
} from "./match-labels.js";
import type { MatchingProvenance } from "./matching-provenance.js";

export const contractFamilyValues = [
  "FIRST_TO_THRESHOLD_BY_DATE",
  "FDV_THRESHOLD_AFTER_LAUNCH",
  "TOKEN_LAUNCH_BY_DATE",
  "THRESHOLD_BY_DATE",
  "ATH_BY_DATE",
  "SAME_DAY_DIRECTIONAL",
  "PRICE_AT_CLOSE",
  "UP_DOWN_BUCKET",
  "PRICE_RANGE_BUCKET",
  "GENERIC_DIRECTIONAL",
  "MATCHUP_WINNER",
  "CHAMPIONSHIP_WINNER",
  "SEASON_WINNER",
  "TOURNAMENT_WINNER",
  "SERIES_WINNER",
  "FINALS_WINNER",
  "SPLIT_WINNER",
  "LEAGUE_WINNER",
  "BINARY_EVENT_RESOLUTION",
  "DATE_BOUND_EVENT",
  "PERSON_OR_ENTITY_OUTCOME",
  "ELECTION_WINNER",
  "MACRO_THRESHOLD",
  "POLITICS_OFFICE_WINNER",
  "POLITICS_PARTY_CONTROL",
  "POLITICS_NOMINEE_WINNER",
  "POLITICS_CONFIRMATION_APPOINTMENT",
  "POLITICS_THRESHOLD_BY_DATE",
  "POLITICS_OFFICE_EXIT_BY_DATE",
  "POLITICS_GEOPOLITICAL_EVENT_BY_DATE",
  "POLITICS_DIRECTIONAL_RESIDUAL",
  "CULTURE_EVENT",
  "WEATHER_EVENT",
  "OTHER_EVENT_STYLE"
] as const;
export type ContractFamily = typeof contractFamilyValues[number];

export interface MatchingMarketRecord {
  interpretedContractId: string;
  venueMarketProfileId: string;
  canonicalEventId: string;
  venue: CanonicalVenue;
  venueMarketId: string;
  title: string;
  description: string | null;
  rulesText: string | null;
  category: CanonicalCategory;
  marketClass: CanonicalMarketClass;
  sourceMetadataVersion: string;
  confidenceScore: string;
  propositionSemantics: Readonly<Record<string, unknown>>;
  outcomeSemantics: Readonly<Record<string, unknown>>;
  timingSemantics: Readonly<Record<string, unknown>>;
  resolutionSemantics: Readonly<Record<string, unknown>>;
  settlementSemantics: Readonly<Record<string, unknown>>;
  ambiguityFlags: Readonly<Record<string, unknown>>;
  rawLineageReferences: Readonly<Record<string, unknown>>;
  publishedAt: Date | null;
  expiresAt: Date | null;
  resolvesAt: Date | null;
  outcomes: readonly Readonly<Record<string, unknown>>[];
  outcomeSchema: Readonly<Record<string, unknown>>;
  historicalRowCount: number;
  inventoryTemporalBasis: InventoryTemporalBasis;
}

export interface ContractFamilyClassification {
  interpretedContractId: string;
  family: ContractFamily;
  familyConfidence: string;
  classificationReasons: readonly string[];
  ruleIds: readonly string[];
  ambiguityFlags: readonly string[];
  weakStructureLane: boolean;
  classifierVersion: string;
  metadata: Readonly<Record<string, unknown>>;
}

export interface StructuralFingerprint {
  interpretedContractId: string;
  fingerprintHash: string;
  fingerprint: Readonly<Record<string, unknown>>;
  normalizedValues: Readonly<Record<string, unknown>>;
  unresolvedDimensions: readonly string[];
  provenance: Readonly<Record<string, unknown>>;
  fingerprintVersion: string;
}

export interface CandidatePrefilterResult {
  accepted: boolean;
  reasons: readonly string[];
  ruleIds: readonly string[];
}

export interface StructuralMatchResult {
  outcome: StructuralMatchOutcome;
  reasons: readonly string[];
  matchedDimensions: readonly string[];
  ruleIds: readonly string[];
}

export interface PairClassifierDimensionScores {
  familyConsistency: string;
  timeBoundaryConsistency: string;
  thresholdComparatorConsistency: string;
  outcomeStructureConsistency: string;
  competitionSubjectConsistency: string;
  resolutionCompatibilityHints: string;
  settlementCompatibilityHints: string;
  temporalBasisCompatibilityHints: string;
}

export interface PairClassifierResult {
  finalLabel: PairMatchLabel;
  confidenceScore: string;
  reasons: readonly string[];
  dimensionScores: PairClassifierDimensionScores;
  policyRecommendation: PairClassifierPolicyRecommendation;
  ambiguityFlags: readonly string[];
  modelVersion: string;
  promptVersion: string;
  replayMetadata: Readonly<Record<string, unknown>>;
}

export interface EmbeddingShortlistResult {
  shortlisted: boolean;
  similarityScore: string;
  shortlistThreshold: string;
  shortlistReasons: readonly string[];
  modelVersion: string;
}

export interface PairEdgeRecord {
  id: string;
  canonicalEventId: string;
  interpretedContractAId: string;
  interpretedContractBId: string;
  leftVenue: CanonicalVenue;
  rightVenue: CanonicalVenue;
  family: ContractFamily;
  label: PairMatchLabel;
  confidenceScore: string;
  approvalState: PairEdgeApprovalState;
  reasons: readonly string[];
  rejectionReasons: readonly string[];
  temporalBasis: RouteabilityTemporalBasis;
  compatibilityDecisionId: string | null;
  compatibilityClass: string | null;
  matchingVersionId: string;
  provenance: MatchingProvenance;
  computedAt: Date;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewReason: string | null;
}

export interface PairEdgeReviewAction {
  id: string;
  pairEdgeId: string;
  action: "APPROVE" | "REJECT";
  reviewer: string;
  reason: string;
  createdAt: Date;
  metadata: Readonly<Record<string, unknown>>;
}
