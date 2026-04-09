import type { MatchingMarketRecord } from "../matching-types.js";

export const politicsTargetVenueValues = ["POLYMARKET", "LIMITLESS", "OPINION", "MYRIAD", "PREDICT"] as const;
export type PoliticsTargetVenue = typeof politicsTargetVenueValues[number];

export const politicsDerivedFamilyValues = [
  "OFFICE_WINNER",
  "PARTY_CONTROL",
  "NOMINEE_WINNER",
  "CONFIRMATION_APPOINTMENT",
  "THRESHOLD_BY_DATE",
  "OFFICE_EXIT_BY_DATE",
  "GEOPOLITICAL_EVENT_BY_DATE",
  "GEOPOLITICAL_EVENT",
  "DIRECTIONAL_RESIDUAL",
  "OUT_OF_SCOPE"
] as const;
export type PoliticsDerivedFamily = typeof politicsDerivedFamilyValues[number];

export const politicsFamilyEligibilityValues = [
  "MATCHING_ELIGIBLE",
  "ELIGIBLE_AFTER_SPLIT",
  "TOO_NOISY",
  "TOO_THIN",
  "BASIS_FRAGMENTED",
  "OUT_OF_SCOPE"
] as const;
export type PoliticsFamilyEligibility = typeof politicsFamilyEligibilityValues[number];

export const politicsPairRejectionValues = [
  "FAMILY_MISMATCH",
  "JURISDICTION_MISMATCH",
  "OFFICE_MISMATCH",
  "INSTITUTION_MISMATCH",
  "CHAMBER_MISMATCH",
  "CYCLE_MISMATCH",
  "STAGE_MISMATCH",
  "CANDIDATE_SET_MISMATCH",
  "PARTY_STRUCTURE_MISMATCH",
  "THRESHOLD_STRUCTURE_MISMATCH",
  "DATE_WINDOW_MISMATCH",
  "BASIS_MISMATCH",
  "OUTCOME_STRUCTURE_MISMATCH",
  "RESOLUTION_RULE_MISMATCH",
  "UNKNOWN_CRITICAL_FIELD",
  "FAMILY_NOT_MATCHING_ELIGIBLE"
] as const;
export type PoliticsPairRejection = typeof politicsPairRejectionValues[number];

export const politicsFinalDecisionValues = [
  "POLITICS_INVENTORY_PROVEN_MATCHING_READY",
  "POLITICS_INVENTORY_PROVEN_PAIR_FIRST",
  "POLITICS_INVENTORY_PROVEN_TRI_LATER",
  "POLITICS_INVENTORY_THIN",
  "POLITICS_ONTOLOGY_NOISY",
  "POLITICS_BASIS_FRAGMENTED",
  "POLITICS_BEATS_SPORTS_FRONTIER",
  "POLITICS_DOES_NOT_BEAT_SPORTS",
  "POLITICS_BELOW_CRYPTO_PRIORITY",
  "POLITICS_HOLD"
] as const;
export type PoliticsFinalDecisionLabel = typeof politicsFinalDecisionValues[number];

export const politicsNomineeFetchStatusValues = [
  "SUCCESS",
  "EMPTY",
  "DEGRADED",
  "UNAVAILABLE",
  "PARTIAL"
] as const;
export type PoliticsNomineeFetchStatus = typeof politicsNomineeFetchStatusValues[number];

export const politicsNomineeAdmissionLabelValues = [
  "NOMINEE_ADMITTED",
  "PRIMARY_WINNER_NOT_NOMINEE",
  "OFFICE_WINNER_NOT_NOMINEE",
  "PARTY_CONTROL_NOT_NOMINEE",
  "CONFIRMATION_NOT_NOMINEE",
  "EVENT_DATE_NOT_NOMINEE",
  "TITLE_TOO_AMBIGUOUS",
  "OUTCOME_SET_TOO_AMBIGUOUS",
  "MISSING_OFFICE_OR_CYCLE",
  "OUT_OF_SCOPE"
] as const;
export type PoliticsNomineeAdmissionLabel = typeof politicsNomineeAdmissionLabelValues[number];

export const politicsNomineeFragmentationLabelValues = [
  "OFFICE_FRAGMENTED",
  "JURISDICTION_FRAGMENTED",
  "CYCLE_FRAGMENTED",
  "PARTY_BASIS_FRAGMENTED",
  "CANDIDATE_SET_FRAGMENTED",
  "RESOLUTION_BASIS_FRAGMENTED",
  "OUTCOME_STRUCTURE_FRAGMENTED",
  "MISSING_CRITICAL_FIELD",
  "COMPARABLE_EXACT_CANDIDATE",
  "COMPARABLE_AFTER_SPLIT",
  "NOT_COMPARABLE"
] as const;
export type PoliticsNomineeFragmentationLabel = typeof politicsNomineeFragmentationLabelValues[number];

export const politicsNomineeEligibilityStateValues = [
  "MATCHING_ELIGIBLE",
  "ELIGIBLE_AFTER_SPLIT",
  "BASIS_FRAGMENTED",
  "TOO_THIN",
  "TOO_UNKNOWN"
] as const;
export type PoliticsNomineeEligibilityState = typeof politicsNomineeEligibilityStateValues[number];

export const politicsNomineeFinalDecisionValues = [
  "NOMINEE_LIVE_REFRESH_NO_CHANGE",
  "NOMINEE_BASIS_FRAGMENTATION_CONFIRMED",
  "NOMINEE_ELIGIBLE_AFTER_SPLIT",
  "NOMINEE_MATCHING_ELIGIBLE_READY_FOR_MATCHER",
  "NOMINEE_TOO_THIN_AFTER_LIVE_REFRESH",
  "NOMINEE_UNKNOWN_FIELDS_STILL_BLOCKING"
] as const;
export type PoliticsNomineeFinalDecision = typeof politicsNomineeFinalDecisionValues[number];

export const politicsManualFamilyClassificationValues = [
  "NOMINEE_WINNER",
  "OFFICE_EXIT_BY_DATE",
  "OFFICE_WINNER",
  "GEOPOLITICAL_EVENT_BY_DATE",
  "GEOPOLITICAL_EVENT",
  "OUT_OF_SCOPE",
  "UNKNOWN_POLITICS_FAMILY",
  "INSUFFICIENT_EVIDENCE"
] as const;
export type PoliticsManualFamilyClassification = typeof politicsManualFamilyClassificationValues[number];

export const politicsManualComparabilityLabelValues = [
  "EXACT_COMPARABLE",
  "NARROW_COMPARABLE",
  "BASIS_FRAGMENTED",
  "DATE_BOUNDARY_MISMATCH",
  "CANDIDATE_SET_MISMATCH",
  "OFFICE_MISMATCH",
  "JURISDICTION_MISMATCH",
  "EVENT_ACTOR_MISMATCH",
  "CONDITION_SCOPE_MISMATCH",
  "UNKNOWN_CRITICAL_FIELD"
] as const;
export type PoliticsManualComparabilityLabel = typeof politicsManualComparabilityLabelValues[number];

export const politicsManualFamilyDecisionLabelValues = [
  "FAMILY_REFRESHED_NO_SUPPLY",
  "FAMILY_REFRESHED_SINGLE_VENUE_ONLY",
  "FAMILY_REFRESHED_BASIS_FRAGMENTED",
  "FAMILY_REFRESHED_BOUNDARY_MISMATCH",
  "FAMILY_REFRESHED_CANDIDATE_SET_MISMATCH",
  "FAMILY_REFRESHED_OFFICE_SCOPE_MISMATCH",
  "FAMILY_REFRESHED_EVENT_SCOPE_MISMATCH",
  "FAMILY_NOW_NARROW_MATCHER_READY",
  "FAMILY_STILL_NOT_MATCHER_READY"
] as const;
export type PoliticsManualFamilyDecisionLabel = typeof politicsManualFamilyDecisionLabelValues[number];

export const politicsNomineeTopicKeyValues = [
  "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
  "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC"
] as const;
export type PoliticsNomineeTopicKey = typeof politicsNomineeTopicKeyValues[number];

export const politicsNomineeRuleCompatibilityValues = [
  "EXACT_RULE_COMPATIBLE",
  "SEMANTICALLY_COMPATIBLE_REWORDING",
  "REVIEW_REQUIRED_RULE_VARIANCE",
  "RULES_MATERIALLY_INCOMPATIBLE",
  "UNKNOWN_RULE_MEANING"
] as const;
export type PoliticsNomineeRuleCompatibilityClass = typeof politicsNomineeRuleCompatibilityValues[number];

export const politicsNomineeOutcomeRouteabilityValues = [
  "EXACT_AUTO_ROUTEABLE",
  "REVIEW_REQUIRED_ROUTEABLE",
  "EXCLUDED_OTHER_BUCKET",
  "EXCLUDED_NOT_SHARED",
  "EXCLUDED_INCOMPATIBLE",
  "EXCLUDED_UNKNOWN"
] as const;
export type PoliticsNomineeOutcomeRouteabilityClass = typeof politicsNomineeOutcomeRouteabilityValues[number];

export const politicsNomineeTopicDecisionValues = [
  "TOPIC_SHARED_CORE_TRI_READY",
  "TOPIC_SHARED_CORE_PAIR_ONLY",
  "TOPIC_SHARED_CORE_ROUTEABLE_WITH_REVIEW",
  "TOPIC_SHARED_BUT_MATERIALLY_INCOMPATIBLE",
  "TOPIC_SHARED_BUT_OUTCOME_CORE_TOO_THIN",
  "TOPIC_SINGLE_VENUE_ONLY",
  "TOPIC_NO_USABLE_SHARED_CORE"
] as const;
export type PoliticsNomineeTopicDecision = typeof politicsNomineeTopicDecisionValues[number];

export interface PoliticsNomineeSharedCoreMarketRow {
  interpretedContractId: string;
  venue: Extract<PoliticsTargetVenue, "POLYMARKET" | "OPINION" | "LIMITLESS">;
  venueMarketId: string;
  title: string;
  topicKey: PoliticsNomineeTopicKey;
  canonicalFamily: "NOMINEE_WINNER";
  canonicalOffice: "US_PRESIDENT";
  canonicalJurisdiction: "USA";
  canonicalCycle: "2028";
  canonicalParty: "REPUBLICAN" | "DEMOCRATIC";
  canonicalTopicLabel: string;
  canonicalResolutionMeaning: string | null;
  canonicalResolutionSourceType: string;
  interpretationConfidence: PoliticsExtractedRow["extractionConfidence"] | "UNKNOWN";
  interpretationNotes: readonly string[];
  ruleCompatibilityClass: PoliticsNomineeRuleCompatibilityClass;
  rejectionReason: string | null;
  candidateMenuType: "FIELD_MULTI_CANDIDATE" | "CANDIDATE_SPECIFIC_BINARY" | "PARTIAL_MULTI_CANDIDATE" | "UNKNOWN_MENU";
  hasOthersBucket: boolean;
  fullMenuKnown: boolean;
  fullMenuComparable: boolean;
  partialMenuComparable: boolean;
  reviewRequired: boolean;
  materiallyIncompatible: boolean;
}

export interface PoliticsNomineeSharedCoreOutcomeRow {
  venue: Extract<PoliticsTargetVenue, "POLYMARKET" | "OPINION" | "LIMITLESS">;
  venueMarketId: string;
  topicKey: PoliticsNomineeTopicKey;
  rawOutcomeLabel: string;
  normalizedCandidateName: string | null;
  candidateIdentityKey: string | null;
  outcomeType: "NAMED_CANDIDATE" | "OTHERS_BUCKET" | "UNKNOWN_COMPOSITE";
  isNamedCandidate: boolean;
  isOthersBucket: boolean;
  sharedAcrossVenueCount: number;
  sharedAcrossWhichVenues: readonly string[];
  routeabilityClass: PoliticsNomineeOutcomeRouteabilityClass;
}

export const politicsNomineeTriLaneDecisionValues = [
  "TRI_EXACT_AUTO_ROUTEABLE",
  "TRI_ROUTEABLE_WITH_REVIEW",
  "TRI_NO_SHARED_CORE",
  "TRI_BLOCKED_RULE_MISMATCH",
  "TRI_BLOCKED_UNKNOWN_RULES"
] as const;
export type PoliticsNomineeTriLaneDecision = typeof politicsNomineeTriLaneDecisionValues[number];

export const politicsNomineeTriTopicDecisionValues = [
  "TRI_EXACT_AUTO_ROUTEABLE",
  "TRI_READY_BUT_PAIR_FIRST",
  "PAIR_ONLY_STILL_BEST",
  "NOT_TRI_JUSTIFIED"
] as const;
export type PoliticsNomineeTriTopicDecision = typeof politicsNomineeTriTopicDecisionValues[number];

export interface PoliticsNomineeTriLaneCandidateSummary {
  candidateIdentityKey: string;
  normalizedCandidateName: string;
  routeabilityClass: Extract<PoliticsNomineeOutcomeRouteabilityClass, "EXACT_AUTO_ROUTEABLE" | "REVIEW_REQUIRED_ROUTEABLE">;
  venueOutcomes: readonly {
    venue: Extract<PoliticsTargetVenue, "POLYMARKET" | "OPINION" | "LIMITLESS">;
    venueMarketId: string;
    rawOutcomeLabel: string;
  }[];
}

export interface PoliticsNomineeTriLaneSummary {
  topicKey: PoliticsNomineeTopicKey;
  venueSet: "LIMITLESS|OPINION|POLYMARKET";
  triDecision: PoliticsNomineeTriLaneDecision;
  ruleDecision: PoliticsNomineeRuleCompatibilityClass;
  safeCandidates: readonly PoliticsNomineeTriLaneCandidateSummary[];
  excludedCandidates: readonly {
    candidateIdentityKey: string | null;
    normalizedCandidateName: string | null;
    exclusionReasons: readonly string[];
    sharedAcrossWhichVenues: readonly string[];
  }[];
  matcherEvalJustified: boolean;
  thinness: "THIN" | "STRONG";
}

export interface PoliticsNomineeTriEvalTopicSummary {
  topicKey: PoliticsNomineeTopicKey;
  sharedCoreTopicDecision: PoliticsNomineeTopicDecision;
  bestPairLane: {
    venuePair: string;
    pairDecision: string;
    ruleDecision: PoliticsNomineeRuleCompatibilityClass;
    sharedNamedCandidateCount: number;
    exactRouteableCandidateCount: number;
    reviewRequiredCandidateCount: number;
    matcherEvalJustified: boolean;
    excludedCandidates: readonly {
      candidateIdentityKey: string | null;
      rawOutcomeLabels: readonly string[];
      exclusionClasses: readonly PoliticsNomineeOutcomeRouteabilityClass[];
    }[];
  } | null;
  triLane: PoliticsNomineeTriLaneSummary;
  triSafeCandidateCount: number;
  pairSafeCandidateCount: number;
  topicFinalDecision: PoliticsNomineeTriTopicDecision;
  operatorCredible: boolean;
}

export interface PoliticsNomineeTriEvalFinalDecision {
  overallTriDecision:
    | "NOMINEE_2028_TRI_APPROVED"
    | "NOMINEE_2028_TRI_PARTIAL_PAIR_PREFERRED"
    | "NOMINEE_2028_TRI_NOT_JUSTIFIED";
  republicanDecision: PoliticsNomineeTriTopicDecision;
  democraticDecision: PoliticsNomineeTriTopicDecision;
  recommendedStartingLane: {
    topicKey: PoliticsNomineeTopicKey;
    laneType: "TRI" | "PAIR";
    venueSet: string;
    safeCandidateCount: number;
  } | null;
  triOperatorCredible: boolean;
  pairStillPreferred: boolean;
  nextBestAction: string;
}

export const politicsNomineeRepublicanPairMatcherRouteabilityDecisionValues = [
  "PAIR_EXACT_AUTO_ROUTEABLE",
  "PAIR_REVIEW_REQUIRED",
  "PAIR_REJECTED"
] as const;
export type PoliticsNomineeRepublicanPairMatcherRouteabilityDecision =
  typeof politicsNomineeRepublicanPairMatcherRouteabilityDecisionValues[number];

export const politicsNomineeRepublicanPairMatcherRejectionReasonValues = [
  "NOT_SHARED",
  "OTHERS_EXCLUDED",
  "UNKNOWN_COMPOSITE",
  "RULE_MISMATCH",
  "PAIR_EDGE_MISSING",
  "THIN_LANE",
  "PAIR_ONLY_ELSEWHERE"
] as const;
export type PoliticsNomineeRepublicanPairMatcherRejectionReason =
  typeof politicsNomineeRepublicanPairMatcherRejectionReasonValues[number];

export interface PoliticsNomineeRepublicanPairMatcherLane {
  topicKey: Extract<PoliticsNomineeTopicKey, "NOMINEE|US_PRESIDENT|2028|REPUBLICAN">;
  venuePair: string;
  candidateIdentityKey: string;
  normalizedCandidateName: string;
  routeabilityDecision: PoliticsNomineeRepublicanPairMatcherRouteabilityDecision;
  rulesDecision: PoliticsNomineeRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: Extract<PoliticsTargetVenue, "POLYMARKET" | "OPINION" | "LIMITLESS">;
    venueMarketId: string;
    rawOutcomeLabel: string;
  }[];
  notes: readonly string[];
}

export interface PoliticsNomineeRepublicanPairMatcherRejection {
  scope: "candidate" | "lane";
  candidateIdentityKey?: string | null;
  normalizedCandidateName?: string | null;
  venuePair?: string | null;
  reason: PoliticsNomineeRepublicanPairMatcherRejectionReason;
  notes: string;
}

export interface PoliticsNomineeRepublicanPairMatcherFinalDecision {
  overallDecision:
    | "REPUBLICAN_PAIR_MATCHER_READY"
    | "REPUBLICAN_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
    | "REPUBLICAN_PAIR_MATCHER_HELD_ON_RULES"
    | "REPUBLICAN_PAIR_MATCHER_THIN_BUT_VALID";
  bestPair: string | null;
  bestStartingCandidates: readonly string[];
  pairMatcherReady: boolean;
  operatorCredible: boolean;
  pairFallbackStillPreferred: boolean;
  singleBestNextAction: string;
}

export const politicsNomineeDemocraticPairMatcherRouteabilityDecisionValues = [
  "PAIR_EXACT_AUTO_ROUTEABLE",
  "PAIR_REVIEW_REQUIRED",
  "PAIR_REJECTED"
] as const;
export type PoliticsNomineeDemocraticPairMatcherRouteabilityDecision =
  typeof politicsNomineeDemocraticPairMatcherRouteabilityDecisionValues[number];

export const politicsNomineeDemocraticPairMatcherRejectionReasonValues = [
  "NOT_SHARED",
  "OTHERS_EXCLUDED",
  "UNKNOWN_COMPOSITE",
  "RULE_MISMATCH",
  "PAIR_EDGE_MISSING",
  "THIN_LANE",
  "CANDIDATE_IDENTITY_UNRESOLVED",
  "OUT_OF_SCOPE_TOPIC"
] as const;
export type PoliticsNomineeDemocraticPairMatcherRejectionReason =
  typeof politicsNomineeDemocraticPairMatcherRejectionReasonValues[number];

export interface PoliticsNomineeDemocraticPairMatcherLane {
  topicKey: Extract<PoliticsNomineeTopicKey, "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC">;
  venuePair: string;
  candidateIdentityKey: string;
  normalizedCandidateName: string;
  routeabilityDecision: PoliticsNomineeDemocraticPairMatcherRouteabilityDecision;
  rulesDecision: PoliticsNomineeRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: Extract<PoliticsTargetVenue, "POLYMARKET" | "OPINION" | "LIMITLESS">;
    venueMarketId: string;
    rawOutcomeLabel: string;
  }[];
  notes: readonly string[];
}

export interface PoliticsNomineeDemocraticPairMatcherRejection {
  scope: "candidate" | "lane";
  candidateIdentityKey?: string | null;
  normalizedCandidateName?: string | null;
  venuePair?: string | null;
  reason: PoliticsNomineeDemocraticPairMatcherRejectionReason;
  notes: string;
}

export interface PoliticsNomineeDemocraticPairMatcherFinalDecision {
  overallDecision:
    | "DEMOCRATIC_PAIR_MATCHER_READY"
    | "DEMOCRATIC_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
    | "DEMOCRATIC_PAIR_MATCHER_HELD_ON_RULES"
    | "DEMOCRATIC_PAIR_MATCHER_THIN_BUT_VALID"
    | "DEMOCRATIC_PAIR_MATCHER_NOT_LIMITED_PROD_READY";
  bestPair: string | null;
  bestStartingCandidates: readonly string[];
  pairMatcherReady: boolean;
  operatorCredible: boolean;
  pairPreferred: boolean;
  triNotYetPreferred: boolean;
  exactSafeCandidateCount: number;
  singleBestNextAction: string;
}

export const politicsNomineeRepublicanTriMatcherRouteabilityDecisionValues = [
  "TRI_EXACT_AUTO_ROUTEABLE",
  "TRI_REVIEW_REQUIRED",
  "TRI_REJECTED"
] as const;
export type PoliticsNomineeRepublicanTriMatcherRouteabilityDecision =
  typeof politicsNomineeRepublicanTriMatcherRouteabilityDecisionValues[number];

export const politicsNomineeRepublicanTriMatcherRejectionReasonValues = [
  "NOT_APPROVED_CANDIDATE",
  "OTHERS_EXCLUDED",
  "UNKNOWN_COMPOSITE",
  "RULE_MISMATCH",
  "TRI_EDGE_MISSING",
  "PAIR_ONLY_OUTSIDE_SUBSET"
] as const;
export type PoliticsNomineeRepublicanTriMatcherRejectionReason =
  typeof politicsNomineeRepublicanTriMatcherRejectionReasonValues[number];

export interface PoliticsNomineeRepublicanTriMatcherLane {
  topicKey: Extract<PoliticsNomineeTopicKey, "NOMINEE|US_PRESIDENT|2028|REPUBLICAN">;
  canonicalTriVenueSet: "LIMITLESS|OPINION|POLYMARKET";
  candidateIdentityKey: string;
  normalizedCandidateName: string;
  routeabilityDecision: PoliticsNomineeRepublicanTriMatcherRouteabilityDecision;
  rulesDecision: PoliticsNomineeRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: Extract<PoliticsTargetVenue, "POLYMARKET" | "OPINION" | "LIMITLESS">;
    venueMarketId: string;
    rawOutcomeLabel: string;
  }[];
  notes: readonly string[];
}

export interface PoliticsNomineeRepublicanTriMatcherRejection {
  candidateIdentityKey?: string | null;
  rejectionReason: PoliticsNomineeRepublicanTriMatcherRejectionReason;
  laneReason?: string | null;
  ruleReason?: PoliticsNomineeRuleCompatibilityClass | null;
  notes: string;
}

export interface PoliticsNomineeRepublicanTriMatcherFinalDecision {
  overallDecision:
    | "REPUBLICAN_TRI_MATCHER_READY"
    | "REPUBLICAN_TRI_MATCHER_READY_PENDING_OPERATOR_REVIEW"
    | "REPUBLICAN_TRI_MATCHER_HELD_ON_RULES"
    | "REPUBLICAN_TRI_MATCHER_READY_NARROW_SUBSET_ONLY";
  operatorCredible: boolean;
  exactTriLaneReady: boolean;
  pairFallbackStillPreferredOutsideSubset: boolean;
  approvedCandidates: readonly string[];
  recommendedStartingLane: "LIMITLESS|OPINION|POLYMARKET" | null;
  singleBestNextAction: string;
}

export const politicsNomineeDemocraticTriMatcherRouteabilityDecisionValues = [
  "TRI_EXACT_AUTO_ROUTEABLE",
  "TRI_REVIEW_REQUIRED",
  "TRI_REJECTED"
] as const;
export type PoliticsNomineeDemocraticTriMatcherRouteabilityDecision =
  typeof politicsNomineeDemocraticTriMatcherRouteabilityDecisionValues[number];

export const politicsNomineeDemocraticTriMatcherRejectionReasonValues = [
  "OTHERS_EXCLUDED",
  "NOT_SHARED",
  "TRI_EDGE_MISSING",
  "RULE_MISMATCH",
  "UNKNOWN_COMPOSITE",
  "CANDIDATE_IDENTITY_UNRESOLVED",
  "THIN_TRI_LANE",
  "OUT_OF_SCOPE_TOPIC",
  "PAIR_ONLY"
] as const;
export type PoliticsNomineeDemocraticTriMatcherRejectionReason =
  typeof politicsNomineeDemocraticTriMatcherRejectionReasonValues[number];

export interface PoliticsNomineeDemocraticTriMatcherLane {
  topicKey: Extract<PoliticsNomineeTopicKey, "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC">;
  canonicalTriVenueSet: "LIMITLESS|OPINION|POLYMARKET";
  candidateIdentityKey: string;
  normalizedCandidateName: string;
  routeabilityDecision: PoliticsNomineeDemocraticTriMatcherRouteabilityDecision;
  rulesDecision: PoliticsNomineeRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: Extract<PoliticsTargetVenue, "POLYMARKET" | "OPINION" | "LIMITLESS">;
    venueMarketId: string;
    rawOutcomeLabel: string;
  }[];
  notes: readonly string[];
}

export interface PoliticsNomineeDemocraticTriMatcherRejection {
  candidateIdentityKey?: string | null;
  normalizedCandidateName?: string | null;
  rejectionReason: PoliticsNomineeDemocraticTriMatcherRejectionReason;
  laneReason?: string | null;
  ruleReason?: PoliticsNomineeRuleCompatibilityClass | null;
  notes: string;
}

export interface PoliticsNomineeDemocraticTriMatcherFinalDecision {
  overallDecision:
    | "DEMOCRATIC_TRI_MATCHER_READY"
    | "DEMOCRATIC_TRI_READY_BUT_PAIR_FIRST"
    | "DEMOCRATIC_TRI_REVIEW_REQUIRED"
    | "DEMOCRATIC_TRI_NOT_JUSTIFIED_PAIR_ONLY"
    | "DEMOCRATIC_TRI_FAILED_CLOSED";
  triReady: boolean;
  pairStillPreferred: boolean;
  bestTriLaneIfAny: "LIMITLESS|OPINION|POLYMARKET" | null;
  bestPairFallback: {
    venuePair: string;
    candidates: readonly string[];
  } | null;
  exactSafeTriCandidateCount: number;
  exactSafePairFallbackCandidateCount: number;
  ruleStatus: PoliticsNomineeRuleCompatibilityClass;
  operatorCredible: boolean;
  readinessReviewJustified: boolean;
  singleBestNextAction: string;
}

export const politicsNomineeLimitedProdReadinessDecisionValues = [
  "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
  "READY_FOR_CANARY_ONLY",
  "READY_BUT_MISSING_OPERATOR_CONTROLS",
  "NOT_READY_FOR_LIMITED_PROD"
] as const;
export type PoliticsNomineeLimitedProdReadinessDecision =
  typeof politicsNomineeLimitedProdReadinessDecisionValues[number];

export const politicsNomineeLimitedProdLaneTypeValues = ["PAIR", "TRI"] as const;
export type PoliticsNomineeLimitedProdLaneType = typeof politicsNomineeLimitedProdLaneTypeValues[number];

export interface PoliticsNomineeLimitedProdLaneSummary {
  laneId: string;
  topicKey: PoliticsNomineeTopicKey;
  laneType: PoliticsNomineeLimitedProdLaneType;
  venueSet: string;
  candidateSet: readonly string[];
  readinessDecision: PoliticsNomineeLimitedProdReadinessDecision;
  operatorCredible: boolean;
  pairPreferred: boolean;
  triAllowed: boolean;
  blockers: readonly string[];
  sourceArtifactRefs: readonly string[];
}

export interface PoliticsNomineeLimitedProdRollbackPlan {
  laneId: string;
  rollbackTarget: "INTERNAL_ONLY" | "PAIR_FALLBACK" | "LANE_HOLD";
  fallbackLaneId: string | null;
  holdConditions: readonly string[];
  operatorSteps: readonly string[];
}

export const politicsOfficeWinnerUsPresident2028MatcherRouteabilityDecisionValues = [
  "PAIR_EXACT_AUTO_ROUTEABLE",
  "PAIR_REVIEW_REQUIRED",
  "PAIR_REJECTED"
] as const;
export type PoliticsOfficeWinnerUsPresident2028MatcherRouteabilityDecision =
  typeof politicsOfficeWinnerUsPresident2028MatcherRouteabilityDecisionValues[number];

export const politicsOfficeWinnerUsPresident2028MatcherRejectionReasonValues = [
  "NOT_SHARED",
  "OTHERS_EXCLUDED",
  "UNKNOWN_COMPOSITE",
  "RULE_MISMATCH",
  "PAIR_EDGE_MISSING",
  "THIN_LANE",
  "CANDIDATE_IDENTITY_UNRESOLVED",
  "OUT_OF_SCOPE_TOPIC",
  "VENUE_NOT_PRESENT_FOR_TOPIC"
] as const;
export type PoliticsOfficeWinnerUsPresident2028MatcherRejectionReason =
  typeof politicsOfficeWinnerUsPresident2028MatcherRejectionReasonValues[number];

export interface PoliticsOfficeWinnerUsPresident2028MatcherLane {
  canonicalTopicKey: "OFFICE_WINNER|USA|US_PRESIDENT|2028";
  venuePair: "LIMITLESS|POLYMARKET";
  candidateIdentityKey: string;
  normalizedCandidateName: string;
  routeabilityDecision: PoliticsOfficeWinnerUsPresident2028MatcherRouteabilityDecision;
  rulesDecision: PoliticsNomineeRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: Extract<PoliticsTargetVenue, "POLYMARKET" | "LIMITLESS">;
    venueMarketId: string;
    rawOutcomeLabel: string;
  }[];
  notes: readonly string[];
}

export interface PoliticsOfficeWinnerUsPresident2028MatcherRejection {
  scope: "candidate" | "lane" | "venue";
  candidateIdentityKey?: string | null;
  normalizedCandidateName?: string | null;
  venuePair?: string | null;
  venue?: string | null;
  reason: PoliticsOfficeWinnerUsPresident2028MatcherRejectionReason;
  notes: string;
}

export interface PoliticsOfficeWinnerUsPresident2028MatcherFinalDecision {
  overallDecision:
    | "OFFICE_WINNER_US_PRESIDENT_2028_PAIR_MATCHER_READY"
    | "OFFICE_WINNER_US_PRESIDENT_2028_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
    | "OFFICE_WINNER_US_PRESIDENT_2028_PAIR_MATCHER_HELD_ON_RULES"
    | "OFFICE_WINNER_US_PRESIDENT_2028_PAIR_MATCHER_THIN_BUT_VALID"
    | "OFFICE_WINNER_US_PRESIDENT_2028_PAIR_MATCHER_NOT_READY";
  bestPair: "LIMITLESS|POLYMARKET" | null;
  bestStartingCandidates: readonly string[];
  pairMatcherReady: boolean;
  operatorCredible: boolean;
  pairPreferred: boolean;
  exactSafeCandidateCount: number;
  ruleStatus: PoliticsNomineeRuleCompatibilityClass;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export interface PoliticsOfficeWinnerBusanMayor2026MatcherLane {
  canonicalTopicKey: "OFFICE_WINNER|BUSAN|MAYOR|2026";
  venuePair: "LIMITLESS|POLYMARKET";
  candidateIdentityKey: string;
  normalizedCandidateName: string;
  routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE" | "PAIR_REVIEW_REQUIRED" | "PAIR_REJECTED";
  rulesDecision: PoliticsNomineeRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: Extract<PoliticsTargetVenue, "POLYMARKET" | "LIMITLESS">;
    venueMarketId: string;
    rawOutcomeLabel: string;
  }[];
  notes: readonly string[];
}

export interface PoliticsOfficeWinnerBusanMayor2026MatcherRejection {
  scope: "candidate" | "lane" | "venue";
  candidateIdentityKey?: string | null;
  normalizedCandidateName?: string | null;
  venuePair?: "LIMITLESS|POLYMARKET" | null;
  venue?: "MYRIAD" | "OPINION" | "PREDICT" | null;
  reason:
    | "NOT_SHARED"
    | "OTHERS_EXCLUDED"
    | "UNKNOWN_COMPOSITE"
    | "RULE_MISMATCH"
    | "PAIR_EDGE_MISSING"
    | "THIN_LANE"
    | "CANDIDATE_IDENTITY_UNRESOLVED"
    | "OUT_OF_SCOPE_TOPIC"
    | "VENUE_NOT_PRESENT_FOR_TOPIC";
  notes: string;
}

export interface PoliticsOfficeWinnerBusanMayor2026MatcherFinalDecision {
  overallDecision:
    | "OFFICE_WINNER_BUSAN_MAYOR_2026_PAIR_MATCHER_READY"
    | "OFFICE_WINNER_BUSAN_MAYOR_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
    | "OFFICE_WINNER_BUSAN_MAYOR_2026_PAIR_MATCHER_THIN_BUT_VALID"
    | "OFFICE_WINNER_BUSAN_MAYOR_2026_PAIR_MATCHER_HELD_ON_RULES"
    | "OFFICE_WINNER_BUSAN_MAYOR_2026_PAIR_MATCHER_NOT_READY";
  bestPair: "LIMITLESS|POLYMARKET" | null;
  bestStartingCandidates: readonly string[];
  pairMatcherReady: boolean;
  operatorCredible: boolean;
  pairPreferred: true;
  exactSafeCandidateCount: number;
  ruleStatus: PoliticsNomineeRuleCompatibilityClass;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export interface PoliticsOfficeWinnerColombiaPresident2026MatcherLane {
  canonicalTopicKey: "OFFICE_WINNER|COLOMBIA|US_PRESIDENT|2026";
  venuePair: "LIMITLESS|POLYMARKET";
  candidateIdentityKey: string;
  normalizedCandidateName: string;
  routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE" | "PAIR_REVIEW_REQUIRED" | "PAIR_REJECTED";
  rulesDecision: PoliticsNomineeRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: Extract<PoliticsTargetVenue, "POLYMARKET" | "LIMITLESS">;
    venueMarketId: string;
    rawOutcomeLabel: string;
  }[];
  notes: readonly string[];
}

export interface PoliticsOfficeWinnerColombiaPresident2026MatcherRejection {
  scope: "candidate" | "lane" | "venue";
  candidateIdentityKey?: string | null;
  normalizedCandidateName?: string | null;
  venuePair?: "LIMITLESS|POLYMARKET" | null;
  venue?: "MYRIAD" | "OPINION" | "PREDICT" | null;
  reason:
    | "NOT_SHARED"
    | "OTHERS_EXCLUDED"
    | "UNKNOWN_COMPOSITE"
    | "RULE_MISMATCH"
    | "PAIR_EDGE_MISSING"
    | "THIN_LANE"
    | "CANDIDATE_IDENTITY_UNRESOLVED"
    | "OUT_OF_SCOPE_TOPIC"
    | "VENUE_NOT_PRESENT_FOR_TOPIC";
  notes: string;
}

export interface PoliticsOfficeWinnerColombiaPresident2026MatcherFinalDecision {
  overallDecision:
    | "OFFICE_WINNER_COLOMBIA_PRESIDENT_2026_PAIR_MATCHER_READY"
    | "OFFICE_WINNER_COLOMBIA_PRESIDENT_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
    | "OFFICE_WINNER_COLOMBIA_PRESIDENT_2026_PAIR_MATCHER_THIN_BUT_VALID"
    | "OFFICE_WINNER_COLOMBIA_PRESIDENT_2026_PAIR_MATCHER_HELD_ON_RULES"
    | "OFFICE_WINNER_COLOMBIA_PRESIDENT_2026_PAIR_MATCHER_NOT_READY";
  bestPair: "LIMITLESS|POLYMARKET" | null;
  bestStartingCandidates: readonly string[];
  pairMatcherReady: boolean;
  operatorCredible: boolean;
  pairPreferred: true;
  exactSafeCandidateCount: number;
  ruleStatus: PoliticsNomineeRuleCompatibilityClass;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export const politicsOfficeWinnerLimitedProdReadinessDecisionValues = [
  "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
  "READY_BUT_MISSING_OPERATOR_REVIEW",
  "NOT_READY_FOR_LIMITED_PROD"
] as const;
export type PoliticsOfficeWinnerLimitedProdReadinessDecision =
  typeof politicsOfficeWinnerLimitedProdReadinessDecisionValues[number];

export const politicsOfficeWinnerUsPresident2028LimitedProdReadinessLabelValues = [
  "OFFICE_WINNER_US_PRESIDENT_2028_LIMITED_PROD_READY_FOR_REVIEW",
  "OFFICE_WINNER_US_PRESIDENT_2028_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW",
  "OFFICE_WINNER_US_PRESIDENT_2028_LIMITED_PROD_HELD",
  "OFFICE_WINNER_US_PRESIDENT_2028_LIMITED_PROD_NOT_APPROVED"
] as const;
export type PoliticsOfficeWinnerUsPresident2028LimitedProdReadinessLabel =
  typeof politicsOfficeWinnerUsPresident2028LimitedProdReadinessLabelValues[number];

export const politicsOfficeWinnerBusanMayor2026LimitedProdReadinessLabelValues = [
  "OFFICE_WINNER_BUSAN_MAYOR_2026_LIMITED_PROD_READY_FOR_REVIEW",
  "OFFICE_WINNER_BUSAN_MAYOR_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW",
  "OFFICE_WINNER_BUSAN_MAYOR_2026_LIMITED_PROD_HELD",
  "OFFICE_WINNER_BUSAN_MAYOR_2026_LIMITED_PROD_NOT_APPROVED"
] as const;
export type PoliticsOfficeWinnerBusanMayor2026LimitedProdReadinessLabel =
  typeof politicsOfficeWinnerBusanMayor2026LimitedProdReadinessLabelValues[number];

export const politicsOfficeWinnerColombiaPresident2026LimitedProdReadinessLabelValues = [
  "OFFICE_WINNER_COLOMBIA_PRESIDENT_2026_LIMITED_PROD_READY_FOR_REVIEW",
  "OFFICE_WINNER_COLOMBIA_PRESIDENT_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW",
  "OFFICE_WINNER_COLOMBIA_PRESIDENT_2026_LIMITED_PROD_HELD",
  "OFFICE_WINNER_COLOMBIA_PRESIDENT_2026_LIMITED_PROD_NOT_APPROVED"
] as const;
export type PoliticsOfficeWinnerColombiaPresident2026LimitedProdReadinessLabel =
  typeof politicsOfficeWinnerColombiaPresident2026LimitedProdReadinessLabelValues[number];

export const politicsOfficeWinnerSeoulMayor2026LimitedProdReadinessLabelValues = [
  "OFFICE_WINNER_SEOUL_MAYOR_2026_LIMITED_PROD_READY_FOR_REVIEW",
  "OFFICE_WINNER_SEOUL_MAYOR_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW",
  "OFFICE_WINNER_SEOUL_MAYOR_2026_LIMITED_PROD_HELD",
  "OFFICE_WINNER_SEOUL_MAYOR_2026_LIMITED_PROD_NOT_APPROVED"
] as const;
export type PoliticsOfficeWinnerSeoulMayor2026LimitedProdReadinessLabel =
  typeof politicsOfficeWinnerSeoulMayor2026LimitedProdReadinessLabelValues[number];

export interface PoliticsOfficeWinnerLimitedProdLaneSummary {
  laneId: string;
  topicKey:
    | "OFFICE_WINNER|USA|US_PRESIDENT|2028"
    | "OFFICE_WINNER|SEOUL|MAYOR|2026"
    | "OFFICE_WINNER|BUSAN|MAYOR|2026"
    | "OFFICE_WINNER|COLOMBIA|US_PRESIDENT|2026";
  laneType: "PAIR" | "TRI";
  venueSet: "LIMITLESS|POLYMARKET" | "LIMITLESS|OPINION|POLYMARKET";
  candidateSet: readonly string[];
  readinessDecision: PoliticsOfficeWinnerLimitedProdReadinessDecision;
  operatorCredible: boolean;
  operatorRuleReviewRequired: boolean;
  pairPreferred: boolean;
  blockers: readonly string[];
  sourceArtifactRefs: readonly string[];
}

export interface PoliticsOfficeWinnerLimitedProdRollbackPlan {
  laneId: string;
  rollbackTarget: "INTERNAL_ONLY" | "LANE_HOLD";
  fallbackLaneId: string | null;
  holdConditions: readonly string[];
  operatorSteps: readonly string[];
}

export const politicsOfficeWinnerSeoulMayor2026PairRouteabilityDecisionValues = [
  "PAIR_EXACT_AUTO_ROUTEABLE",
  "PAIR_REVIEW_REQUIRED",
  "PAIR_REJECTED"
] as const;
export type PoliticsOfficeWinnerSeoulMayor2026PairRouteabilityDecision =
  typeof politicsOfficeWinnerSeoulMayor2026PairRouteabilityDecisionValues[number];

export const politicsOfficeWinnerSeoulMayor2026TriRouteabilityDecisionValues = [
  "TRI_EXACT_AUTO_ROUTEABLE",
  "TRI_REVIEW_REQUIRED",
  "TRI_REJECTED",
  "TRI_NOT_JUSTIFIED_PAIR_ONLY"
] as const;
export type PoliticsOfficeWinnerSeoulMayor2026TriRouteabilityDecision =
  typeof politicsOfficeWinnerSeoulMayor2026TriRouteabilityDecisionValues[number];

export const politicsOfficeWinnerSeoulMayor2026MatcherRejectionReasonValues = [
  "NOT_SHARED",
  "OTHERS_EXCLUDED",
  "UNKNOWN_COMPOSITE",
  "RULE_MISMATCH",
  "PAIR_EDGE_MISSING",
  "TRI_EDGE_MISSING",
  "THIN_LANE",
  "CANDIDATE_IDENTITY_UNRESOLVED",
  "OUT_OF_SCOPE_TOPIC",
  "VENUE_NOT_PRESENT_FOR_TOPIC"
] as const;
export type PoliticsOfficeWinnerSeoulMayor2026MatcherRejectionReason =
  typeof politicsOfficeWinnerSeoulMayor2026MatcherRejectionReasonValues[number];

export interface PoliticsOfficeWinnerSeoulMayor2026PairLane {
  canonicalTopicKey: "OFFICE_WINNER|SEOUL|MAYOR|2026";
  venuePair: "LIMITLESS|OPINION" | "LIMITLESS|POLYMARKET" | "OPINION|POLYMARKET";
  candidateIdentityKey: string;
  normalizedCandidateName: string;
  routeabilityDecision: PoliticsOfficeWinnerSeoulMayor2026PairRouteabilityDecision;
  rulesDecision: PoliticsNomineeRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: Extract<PoliticsTargetVenue, "POLYMARKET" | "LIMITLESS" | "OPINION">;
    venueMarketId: string;
    rawOutcomeLabel: string;
  }[];
  notes: readonly string[];
}

export interface PoliticsOfficeWinnerSeoulMayor2026TriLane {
  canonicalTopicKey: "OFFICE_WINNER|SEOUL|MAYOR|2026";
  canonicalTriVenueSet: "LIMITLESS|OPINION|POLYMARKET";
  candidateIdentityKey: string;
  normalizedCandidateName: string;
  routeabilityDecision: PoliticsOfficeWinnerSeoulMayor2026TriRouteabilityDecision;
  rulesDecision: PoliticsNomineeRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: Extract<PoliticsTargetVenue, "POLYMARKET" | "LIMITLESS" | "OPINION">;
    venueMarketId: string;
    rawOutcomeLabel: string;
  }[];
  notes: readonly string[];
}

export interface PoliticsOfficeWinnerSeoulMayor2026MatcherRejection {
  scope: "candidate" | "pair_lane" | "tri_lane" | "venue";
  candidateIdentityKey?: string | null;
  normalizedCandidateName?: string | null;
  venuePair?: string | null;
  venueSet?: string | null;
  venue?: string | null;
  reason: PoliticsOfficeWinnerSeoulMayor2026MatcherRejectionReason;
  notes: string;
}

export interface PoliticsOfficeWinnerSeoulMayor2026MatcherFinalDecision {
  overallDecision:
    | "OFFICE_WINNER_SEOUL_MAYOR_2026_PAIR_MATCHER_READY"
    | "OFFICE_WINNER_SEOUL_MAYOR_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
    | "OFFICE_WINNER_SEOUL_MAYOR_2026_TRI_READY_BUT_PAIR_FIRST"
    | "OFFICE_WINNER_SEOUL_MAYOR_2026_TRI_REVIEW_REQUIRED"
    | "OFFICE_WINNER_SEOUL_MAYOR_2026_TRI_NOT_JUSTIFIED_PAIR_ONLY"
    | "OFFICE_WINNER_SEOUL_MAYOR_2026_MATCHER_NOT_READY";
  bestPair: "LIMITLESS|OPINION" | "LIMITLESS|POLYMARKET" | "OPINION|POLYMARKET" | null;
  bestTriIfAny: "LIMITLESS|OPINION|POLYMARKET" | null;
  pairMatcherReady: boolean;
  triMatcherReady: boolean;
  pairStillPreferred: boolean;
  exactSafePairCandidateCount: number;
  exactSafeTriCandidateCount: number;
  ruleStatus: PoliticsNomineeRuleCompatibilityClass;
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export const politicsPartyControlBalanceOfPower2026PairRouteabilityDecisionValues = [
  "PAIR_EXACT_AUTO_ROUTEABLE",
  "PAIR_REVIEW_REQUIRED",
  "PAIR_REJECTED"
] as const;
export type PoliticsPartyControlBalanceOfPower2026PairRouteabilityDecision =
  typeof politicsPartyControlBalanceOfPower2026PairRouteabilityDecisionValues[number];

export const politicsPartyControlBalanceOfPower2026TriRouteabilityDecisionValues = [
  "TRI_EXACT_AUTO_ROUTEABLE",
  "TRI_REVIEW_REQUIRED",
  "TRI_REJECTED"
] as const;
export type PoliticsPartyControlBalanceOfPower2026TriRouteabilityDecision =
  typeof politicsPartyControlBalanceOfPower2026TriRouteabilityDecisionValues[number];

export const politicsPartyControlBalanceOfPower2026MatcherRejectionReasonValues = [
  "NOT_SHARED",
  "OTHERS_EXCLUDED",
  "UNKNOWN_COMPOSITE",
  "RULE_MISMATCH",
  "PAIR_EDGE_MISSING",
  "TRI_EDGE_MISSING",
  "THIN_LANE",
  "OUT_OF_SCOPE_TOPIC",
  "VENUE_NOT_PRESENT_FOR_TOPIC"
] as const;
export type PoliticsPartyControlBalanceOfPower2026MatcherRejectionReason =
  typeof politicsPartyControlBalanceOfPower2026MatcherRejectionReasonValues[number];

export interface PoliticsPartyControlBalanceOfPower2026PairLane {
  canonicalTopicKey: "PARTY_CONTROL|USA|CONGRESS|2026|BALANCE_OF_POWER";
  venuePair: "OPINION|POLYMARKET" | "OPINION|PREDICT" | "POLYMARKET|PREDICT";
  outcomeIdentityKey: string;
  normalizedOutcomeName: string;
  routeabilityDecision: PoliticsPartyControlBalanceOfPower2026PairRouteabilityDecision;
  rulesDecision: PoliticsNomineeRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: Extract<PoliticsTargetVenue, "POLYMARKET" | "OPINION" | "PREDICT">;
    venueMarketId: string;
    rawOutcomeLabel: string;
  }[];
  notes: readonly string[];
}

export interface PoliticsPartyControlBalanceOfPower2026TriLane {
  canonicalTopicKey: "PARTY_CONTROL|USA|CONGRESS|2026|BALANCE_OF_POWER";
  canonicalTriVenueSet: "OPINION|POLYMARKET|PREDICT";
  outcomeIdentityKey: string;
  normalizedOutcomeName: string;
  routeabilityDecision: PoliticsPartyControlBalanceOfPower2026TriRouteabilityDecision;
  rulesDecision: PoliticsNomineeRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: Extract<PoliticsTargetVenue, "POLYMARKET" | "OPINION" | "PREDICT">;
    venueMarketId: string;
    rawOutcomeLabel: string;
  }[];
  notes: readonly string[];
}

export interface PoliticsPartyControlBalanceOfPower2026MatcherRejection {
  scope: "outcome" | "pair_lane" | "tri_lane" | "venue";
  outcomeIdentityKey?: string | null;
  normalizedOutcomeName?: string | null;
  venuePair?: string | null;
  venueSet?: string | null;
  venue?: string | null;
  reason: PoliticsPartyControlBalanceOfPower2026MatcherRejectionReason;
  notes: string;
}

export interface PoliticsPartyControlBalanceOfPower2026MatcherFinalDecision {
  overallDecision:
    | "PARTY_CONTROL_BALANCE_OF_POWER_2026_PAIR_MATCHER_READY"
    | "PARTY_CONTROL_BALANCE_OF_POWER_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
    | "PARTY_CONTROL_BALANCE_OF_POWER_2026_TRI_READY_BUT_PAIR_FIRST"
    | "PARTY_CONTROL_BALANCE_OF_POWER_2026_TRI_REVIEW_REQUIRED"
    | "PARTY_CONTROL_BALANCE_OF_POWER_2026_TRI_NOT_JUSTIFIED_PAIR_ONLY"
    | "PARTY_CONTROL_BALANCE_OF_POWER_2026_MATCHER_NOT_READY";
  bestPair: "OPINION|POLYMARKET" | "OPINION|PREDICT" | "POLYMARKET|PREDICT" | null;
  bestTriIfAny: "OPINION|POLYMARKET|PREDICT" | null;
  pairMatcherReady: boolean;
  triMatcherReady: boolean;
  pairStillPreferred: true;
  exactSafePairCandidateCount: number;
  exactSafeTriCandidateCount: number;
  ruleStatus: PoliticsNomineeRuleCompatibilityClass;
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export const politicsOfficeExitNetanyahu2026PairRouteabilityDecisionValues = [
  "PAIR_EXACT_AUTO_ROUTEABLE",
  "PAIR_REVIEW_REQUIRED",
  "PAIR_REJECTED"
] as const;
export type PoliticsOfficeExitNetanyahu2026PairRouteabilityDecision =
  typeof politicsOfficeExitNetanyahu2026PairRouteabilityDecisionValues[number];

export const politicsOfficeExitNetanyahu2026TriRouteabilityDecisionValues = [
  "TRI_EXACT_AUTO_ROUTEABLE",
  "TRI_REVIEW_REQUIRED",
  "TRI_REJECTED"
] as const;
export type PoliticsOfficeExitNetanyahu2026TriRouteabilityDecision =
  typeof politicsOfficeExitNetanyahu2026TriRouteabilityDecisionValues[number];

export const politicsOfficeExitNetanyahu2026MatcherRejectionReasonValues = [
  "RULE_MISMATCH",
  "PAIR_EDGE_MISSING",
  "TRI_EDGE_MISSING",
  "OUT_OF_SCOPE_TOPIC",
  "VENUE_NOT_PRESENT_FOR_TOPIC",
  "THIN_LANE"
] as const;
export type PoliticsOfficeExitNetanyahu2026MatcherRejectionReason =
  typeof politicsOfficeExitNetanyahu2026MatcherRejectionReasonValues[number];

export interface PoliticsOfficeExitNetanyahu2026PairLane {
  canonicalTopicKey: "OFFICE_EXIT_BY_DATE|ISRAEL|PRIME_MINISTER|BENJAMIN_NETANYAHU|2026-12-31";
  venuePair: "LIMITLESS|POLYMARKET" | "LIMITLESS|PREDICT" | "POLYMARKET|PREDICT";
  propositionIdentityKey: "NETANYAHU_OUT_BEFORE_2027";
  normalizedPropositionName: "netanyahu_out_before_2027";
  routeabilityDecision: PoliticsOfficeExitNetanyahu2026PairRouteabilityDecision;
  rulesDecision: PoliticsNomineeRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: Extract<PoliticsTargetVenue, "POLYMARKET" | "LIMITLESS" | "PREDICT">;
    venueMarketId: string;
    title: string;
  }[];
  notes: readonly string[];
}

export interface PoliticsOfficeExitNetanyahu2026TriLane {
  canonicalTopicKey: "OFFICE_EXIT_BY_DATE|ISRAEL|PRIME_MINISTER|BENJAMIN_NETANYAHU|2026-12-31";
  canonicalTriVenueSet: "LIMITLESS|POLYMARKET|PREDICT";
  propositionIdentityKey: "NETANYAHU_OUT_BEFORE_2027";
  normalizedPropositionName: "netanyahu_out_before_2027";
  routeabilityDecision: PoliticsOfficeExitNetanyahu2026TriRouteabilityDecision;
  rulesDecision: PoliticsNomineeRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: Extract<PoliticsTargetVenue, "POLYMARKET" | "LIMITLESS" | "PREDICT">;
    venueMarketId: string;
    title: string;
  }[];
  notes: readonly string[];
}

export interface PoliticsOfficeExitNetanyahu2026MatcherRejection {
  scope: "pair_lane" | "tri_lane" | "venue";
  venuePair?: "LIMITLESS|POLYMARKET" | "LIMITLESS|PREDICT" | "POLYMARKET|PREDICT" | null;
  venueSet?: "LIMITLESS|POLYMARKET|PREDICT" | null;
  venue?: "OPINION" | "MYRIAD" | null;
  reason: PoliticsOfficeExitNetanyahu2026MatcherRejectionReason;
  notes: string;
}

export interface PoliticsOfficeExitNetanyahu2026MatcherFinalDecision {
  overallDecision:
    | "OFFICE_EXIT_NETANYAHU_2026_PAIR_MATCHER_READY"
    | "OFFICE_EXIT_NETANYAHU_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
    | "OFFICE_EXIT_NETANYAHU_2026_TRI_READY_BUT_PAIR_FIRST"
    | "OFFICE_EXIT_NETANYAHU_2026_TRI_REVIEW_REQUIRED"
    | "OFFICE_EXIT_NETANYAHU_2026_TRI_NOT_JUSTIFIED_PAIR_ONLY"
    | "OFFICE_EXIT_NETANYAHU_2026_MATCHER_NOT_READY";
  bestPair: "LIMITLESS|POLYMARKET" | "LIMITLESS|PREDICT" | "POLYMARKET|PREDICT" | null;
  bestTriIfAny: "LIMITLESS|POLYMARKET|PREDICT" | null;
  pairMatcherReady: boolean;
  triMatcherReady: boolean;
  pairStillPreferred: boolean;
  exactSafePairCandidateCount: number;
  exactSafeTriCandidateCount: number;
  ruleStatus: PoliticsNomineeRuleCompatibilityClass;
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export const politicsOfficeExitTrump2026PairRouteabilityDecisionValues = [
  "PAIR_EXACT_AUTO_ROUTEABLE",
  "PAIR_REVIEW_REQUIRED",
  "PAIR_REJECTED"
] as const;
export type PoliticsOfficeExitTrump2026PairRouteabilityDecision =
  typeof politicsOfficeExitTrump2026PairRouteabilityDecisionValues[number];

export const politicsOfficeExitTrump2026TriRouteabilityDecisionValues = [
  "TRI_EXACT_AUTO_ROUTEABLE",
  "TRI_REVIEW_REQUIRED",
  "TRI_REJECTED"
] as const;
export type PoliticsOfficeExitTrump2026TriRouteabilityDecision =
  typeof politicsOfficeExitTrump2026TriRouteabilityDecisionValues[number];

export const politicsOfficeExitTrump2026MatcherRejectionReasonValues = [
  "RULE_MISMATCH",
  "PAIR_EDGE_MISSING",
  "TRI_EDGE_MISSING",
  "OUT_OF_SCOPE_TOPIC",
  "VENUE_NOT_PRESENT_FOR_TOPIC",
  "THIN_LANE"
] as const;
export type PoliticsOfficeExitTrump2026MatcherRejectionReason =
  typeof politicsOfficeExitTrump2026MatcherRejectionReasonValues[number];

export interface PoliticsOfficeExitTrump2026PairLane {
  canonicalTopicKey: "OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31";
  venuePair:
    | "LIMITLESS|OPINION"
    | "LIMITLESS|POLYMARKET"
    | "LIMITLESS|PREDICT"
    | "OPINION|POLYMARKET"
    | "OPINION|PREDICT"
    | "POLYMARKET|PREDICT";
  propositionIdentityKey: "TRUMP_OUT_BEFORE_2027";
  normalizedPropositionName: "trump_out_before_2027";
  routeabilityDecision: PoliticsOfficeExitTrump2026PairRouteabilityDecision;
  rulesDecision: PoliticsNomineeRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: Extract<PoliticsTargetVenue, "POLYMARKET" | "LIMITLESS" | "OPINION" | "PREDICT">;
    venueMarketId: string;
    title: string;
  }[];
  notes: readonly string[];
}

export interface PoliticsOfficeExitTrump2026TriLane {
  canonicalTopicKey: "OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31";
  canonicalTriVenueSet: "LIMITLESS|OPINION|POLYMARKET";
  propositionIdentityKey: "TRUMP_OUT_BEFORE_2027";
  normalizedPropositionName: "trump_out_before_2027";
  routeabilityDecision: PoliticsOfficeExitTrump2026TriRouteabilityDecision;
  rulesDecision: PoliticsNomineeRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: Extract<PoliticsTargetVenue, "POLYMARKET" | "LIMITLESS" | "OPINION">;
    venueMarketId: string;
    title: string;
  }[];
  notes: readonly string[];
}

export interface PoliticsOfficeExitTrump2026MatcherRejection {
  scope: "pair_lane" | "tri_lane" | "venue";
  venuePair?:
    | "LIMITLESS|OPINION"
    | "LIMITLESS|POLYMARKET"
    | "LIMITLESS|PREDICT"
    | "OPINION|POLYMARKET"
    | "OPINION|PREDICT"
    | "POLYMARKET|PREDICT"
    | null;
  venueSet?: "LIMITLESS|OPINION|POLYMARKET" | null;
  venue?: "MYRIAD" | null;
  reason: PoliticsOfficeExitTrump2026MatcherRejectionReason;
  notes: string;
}

export interface PoliticsOfficeExitTrump2026MatcherFinalDecision {
  overallDecision:
    | "OFFICE_EXIT_TRUMP_2026_PAIR_MATCHER_READY"
    | "OFFICE_EXIT_TRUMP_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
    | "OFFICE_EXIT_TRUMP_2026_TRI_READY_BUT_PAIR_FIRST"
    | "OFFICE_EXIT_TRUMP_2026_TRI_REVIEW_REQUIRED"
    | "OFFICE_EXIT_TRUMP_2026_TRI_NOT_JUSTIFIED_PAIR_ONLY"
    | "OFFICE_EXIT_TRUMP_2026_MATCHER_NOT_READY";
  bestPair:
    | "LIMITLESS|OPINION"
    | "LIMITLESS|POLYMARKET"
    | "LIMITLESS|PREDICT"
    | "OPINION|POLYMARKET"
    | "OPINION|PREDICT"
    | "POLYMARKET|PREDICT"
    | null;
  bestTriIfAny: "LIMITLESS|OPINION|POLYMARKET" | null;
  pairMatcherReady: boolean;
  triMatcherReady: boolean;
  pairStillPreferred: boolean;
  exactSafePairCandidateCount: number;
  exactSafeTriCandidateCount: number;
  ruleStatus: PoliticsNomineeRuleCompatibilityClass;
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export const politicsGeopoliticalTrumpVisitChina20260430PairRouteabilityDecisionValues = [
  "PAIR_EXACT_AUTO_ROUTEABLE",
  "PAIR_REVIEW_REQUIRED",
  "PAIR_REJECTED"
] as const;
export type PoliticsGeopoliticalTrumpVisitChina20260430PairRouteabilityDecision =
  typeof politicsGeopoliticalTrumpVisitChina20260430PairRouteabilityDecisionValues[number];

export const politicsGeopoliticalTrumpVisitChina20260430TriRouteabilityDecisionValues = [
  "TRI_EXACT_AUTO_ROUTEABLE",
  "TRI_REVIEW_REQUIRED",
  "TRI_REJECTED"
] as const;
export type PoliticsGeopoliticalTrumpVisitChina20260430TriRouteabilityDecision =
  typeof politicsGeopoliticalTrumpVisitChina20260430TriRouteabilityDecisionValues[number];

export const politicsGeopoliticalTrumpVisitChina20260430MatcherRejectionReasonValues = [
  "RULE_MISMATCH",
  "PAIR_EDGE_MISSING",
  "TRI_EDGE_MISSING",
  "OUT_OF_SCOPE_TOPIC",
  "VENUE_NOT_PRESENT_FOR_TOPIC",
  "THIN_LANE"
] as const;
export type PoliticsGeopoliticalTrumpVisitChina20260430MatcherRejectionReason =
  typeof politicsGeopoliticalTrumpVisitChina20260430MatcherRejectionReasonValues[number];

export interface PoliticsGeopoliticalTrumpVisitChina20260430PairLane {
  canonicalTopicKey: "GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-04-30";
  venuePair: "OPINION|POLYMARKET" | "OPINION|PREDICT" | "POLYMARKET|PREDICT";
  propositionIdentityKey: "TRUMP_VISIT_CHINA_BY_2026_04_30";
  normalizedPropositionName: "trump_visit_china_by_2026_04_30";
  routeabilityDecision: PoliticsGeopoliticalTrumpVisitChina20260430PairRouteabilityDecision;
  rulesDecision: PoliticsNomineeRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: Extract<PoliticsTargetVenue, "POLYMARKET" | "OPINION" | "PREDICT">;
    venueMarketId: string;
    title: string;
  }[];
  notes: readonly string[];
}

export interface PoliticsGeopoliticalTrumpVisitChina20260430TriLane {
  canonicalTopicKey: "GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-04-30";
  canonicalTriVenueSet: "OPINION|POLYMARKET|PREDICT";
  propositionIdentityKey: "TRUMP_VISIT_CHINA_BY_2026_04_30";
  normalizedPropositionName: "trump_visit_china_by_2026_04_30";
  routeabilityDecision: PoliticsGeopoliticalTrumpVisitChina20260430TriRouteabilityDecision;
  rulesDecision: PoliticsNomineeRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: Extract<PoliticsTargetVenue, "POLYMARKET" | "OPINION" | "PREDICT">;
    venueMarketId: string;
    title: string;
  }[];
  notes: readonly string[];
}

export interface PoliticsGeopoliticalTrumpVisitChina20260430MatcherRejection {
  scope: "pair_lane" | "tri_lane" | "venue";
  venuePair?: "OPINION|POLYMARKET" | "OPINION|PREDICT" | "POLYMARKET|PREDICT" | null;
  venueSet?: "OPINION|POLYMARKET|PREDICT" | null;
  venue?: "LIMITLESS" | "MYRIAD" | null;
  reason: PoliticsGeopoliticalTrumpVisitChina20260430MatcherRejectionReason;
  notes: string;
}

export interface PoliticsGeopoliticalTrumpVisitChina20260430MatcherFinalDecision {
  overallDecision:
    | "GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_PAIR_MATCHER_READY"
    | "GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
    | "GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_TRI_READY_BUT_PAIR_FIRST"
    | "GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_TRI_REVIEW_REQUIRED"
    | "GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_TRI_NOT_JUSTIFIED_PAIR_ONLY"
    | "GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_MATCHER_NOT_READY";
  bestPair: "OPINION|POLYMARKET" | "OPINION|PREDICT" | "POLYMARKET|PREDICT" | null;
  bestTriIfAny: "OPINION|POLYMARKET|PREDICT" | null;
  pairMatcherReady: boolean;
  triMatcherReady: boolean;
  pairStillPreferred: boolean;
  exactSafePairCandidateCount: number;
  exactSafeTriCandidateCount: number;
  ruleStatus: PoliticsNomineeRuleCompatibilityClass;
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export const politicsGeopoliticalTrumpAcquireGreenland20261231PairRouteabilityDecisionValues = [
  "PAIR_EXACT_AUTO_ROUTEABLE",
  "PAIR_REVIEW_REQUIRED",
  "PAIR_REJECTED"
] as const;
export type PoliticsGeopoliticalTrumpAcquireGreenland20261231PairRouteabilityDecision =
  typeof politicsGeopoliticalTrumpAcquireGreenland20261231PairRouteabilityDecisionValues[number];

export const politicsGeopoliticalTrumpAcquireGreenland20261231TriRouteabilityDecisionValues = [
  "TRI_EXACT_AUTO_ROUTEABLE",
  "TRI_REVIEW_REQUIRED",
  "TRI_REJECTED"
] as const;
export type PoliticsGeopoliticalTrumpAcquireGreenland20261231TriRouteabilityDecision =
  typeof politicsGeopoliticalTrumpAcquireGreenland20261231TriRouteabilityDecisionValues[number];

export const politicsGeopoliticalTrumpAcquireGreenland20261231MatcherRejectionReasonValues = [
  "RULE_MISMATCH",
  "PAIR_EDGE_MISSING",
  "TRI_EDGE_MISSING",
  "OUT_OF_SCOPE_TOPIC",
  "VENUE_NOT_PRESENT_FOR_TOPIC",
  "THIN_LANE"
] as const;
export type PoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherRejectionReason =
  typeof politicsGeopoliticalTrumpAcquireGreenland20261231MatcherRejectionReasonValues[number];

export interface PoliticsGeopoliticalTrumpAcquireGreenland20261231PairLane {
  canonicalTopicKey: "GEOPOLITICAL_EVENT_BY_DATE|USA_GREENLAND|TRUMP_ACQUIRE_GREENLAND|2026-12-31";
  venuePair:
    | "LIMITLESS|POLYMARKET"
    | "LIMITLESS|OPINION"
    | "LIMITLESS|PREDICT"
    | "OPINION|POLYMARKET"
    | "OPINION|PREDICT"
    | "POLYMARKET|PREDICT";
  propositionIdentityKey: "TRUMP_ACQUIRE_GREENLAND_BY_2026_12_31";
  normalizedPropositionName: "trump_acquire_greenland_by_2026_12_31";
  routeabilityDecision: PoliticsGeopoliticalTrumpAcquireGreenland20261231PairRouteabilityDecision;
  rulesDecision: PoliticsNomineeRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: Extract<PoliticsTargetVenue, "LIMITLESS" | "POLYMARKET" | "OPINION" | "PREDICT">;
    venueMarketId: string;
    title: string;
  }[];
  notes: readonly string[];
}

export interface PoliticsGeopoliticalTrumpAcquireGreenland20261231TriLane {
  canonicalTopicKey: "GEOPOLITICAL_EVENT_BY_DATE|USA_GREENLAND|TRUMP_ACQUIRE_GREENLAND|2026-12-31";
  canonicalTriVenueSet: "LIMITLESS|OPINION|POLYMARKET|PREDICT";
  propositionIdentityKey: "TRUMP_ACQUIRE_GREENLAND_BY_2026_12_31";
  normalizedPropositionName: "trump_acquire_greenland_by_2026_12_31";
  routeabilityDecision: PoliticsGeopoliticalTrumpAcquireGreenland20261231TriRouteabilityDecision;
  rulesDecision: PoliticsNomineeRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: Extract<PoliticsTargetVenue, "LIMITLESS" | "POLYMARKET" | "OPINION" | "PREDICT">;
    venueMarketId: string;
    title: string;
  }[];
  notes: readonly string[];
}

export interface PoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherRejection {
  scope: "pair_lane" | "tri_lane" | "venue";
  venuePair?:
    | "LIMITLESS|POLYMARKET"
    | "LIMITLESS|OPINION"
    | "LIMITLESS|PREDICT"
    | "OPINION|POLYMARKET"
    | "OPINION|PREDICT"
    | "POLYMARKET|PREDICT"
    | null;
  venueSet?: "LIMITLESS|OPINION|POLYMARKET|PREDICT" | null;
  venue?: "MYRIAD" | null;
  reason: PoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherRejectionReason;
  notes: string;
}

export interface PoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherFinalDecision {
  overallDecision:
    | "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_PAIR_MATCHER_READY"
    | "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
    | "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_TRI_READY_BUT_PAIR_FIRST"
    | "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_TRI_REVIEW_REQUIRED"
    | "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_TRI_NOT_JUSTIFIED_PAIR_ONLY"
    | "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_MATCHER_NOT_READY";
  bestPair:
    | "LIMITLESS|POLYMARKET"
    | "LIMITLESS|OPINION"
    | "LIMITLESS|PREDICT"
    | "OPINION|POLYMARKET"
    | "OPINION|PREDICT"
    | "POLYMARKET|PREDICT"
    | null;
  bestTriIfAny: "LIMITLESS|OPINION|POLYMARKET|PREDICT" | null;
  pairMatcherReady: boolean;
  triMatcherReady: boolean;
  pairStillPreferred: boolean;
  exactSafePairCandidateCount: number;
  exactSafeTriCandidateCount: number;
  ruleStatus: PoliticsNomineeRuleCompatibilityClass;
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export interface PoliticsManualNormalizedRow {
  interpretedContractId: string;
  canonicalFamily: Extract<
    PoliticsManualFamilyClassification,
    "NOMINEE_WINNER" | "OFFICE_EXIT_BY_DATE" | "OFFICE_WINNER" | "GEOPOLITICAL_EVENT_BY_DATE" | "GEOPOLITICAL_EVENT"
  >;
  venue: PoliticsTargetVenue | "MYRIAD";
  venueMarketId: string;
  title: string;
  canonicalSubject: string | null;
  canonicalJurisdiction: string | null;
  canonicalCycle: string | null;
  canonicalOffice: string | null;
  canonicalOfficeLevel: string | null;
  canonicalElectionType: string | null;
  canonicalEventActors: readonly string[];
  canonicalOutcomeBasis: string | null;
  canonicalTemporalBasis: string | null;
  interpretationConfidence: PoliticsExtractedRow["extractionConfidence"] | "UNKNOWN";
  interpretationNotes: readonly string[];
  rejectionReason: string | null;
  party?: string | null;
  candidateSet?: readonly string[];
  candidateSetType?: "SINGLE_CANDIDATE" | "FIELD" | "CANDIDATE_SET" | null;
  exitConditionType?: "REMOVED" | "RESIGNS" | "NO_LONGER_HOLDS_OFFICE" | "OUT_OF_OFFICE" | null;
  deadlineDate?: string | null;
  deadlineBoundaryType?: "INCLUSIVE" | "EXCLUSIVE" | null;
  conditionScope?: "NARROW" | "COMPOSITE" | null;
  electionRound?: string | null;
  eventType?: string | null;
  dateBounded?: boolean | null;
}

export interface PoliticsExtractedRow {
  interpretedContractId: string;
  venue: PoliticsTargetVenue;
  venueMarketId: string;
  sourceMarketSlug: string | null;
  canonicalEventId: string;
  title: string;
  rulesText: string | null;
  category: MatchingMarketRecord["category"];
  marketClass: MatchingMarketRecord["marketClass"];
  tags: readonly string[];
  outcomeCount: number;
  outcomeLabels: readonly string[];
  publishedAt: string | null;
  expiresAt: string | null;
  resolvesAt: string | null;
  jurisdiction: string | null;
  office: string | null;
  institution: string | null;
  chamber: string | null;
  branch: string | null;
  cycleYear: string | null;
  contestStage: string | null;
  candidateNames: readonly string[];
  candidateSetFingerprint: string | null;
  partyTerms: readonly string[];
  partyStructureFingerprint: string | null;
  thresholdSemantics: string | null;
  dateBoundarySemantics: string | null;
  eventType: string | null;
  outcomeStructureType: "YES_NO" | "BINARY_NAMED" | "MULTI_CANDIDATE" | "MULTI_OTHER";
  resolutionBasisHints: readonly string[];
  family: PoliticsDerivedFamily;
  extractionConfidence: "HIGH" | "MEDIUM" | "LOW";
  parseFailures: readonly string[];
  inventoryTemporalBasis: MatchingMarketRecord["inventoryTemporalBasis"];
}

export interface PoliticsDerivedFamilyDefinition {
  family: PoliticsDerivedFamily;
  familyLabel: string;
  familyDefinition: string;
  requiredStructuralFields: readonly string[];
  excludedPatterns: readonly string[];
  venueCounts: Record<string, number>;
  totalRows: number;
  representativeExamples: readonly {
    venue: string;
    title: string;
    interpretedContractId: string;
  }[];
  confidenceScore: string;
  eligibility: PoliticsFamilyEligibility;
  eligibilityReason: string;
}

export interface PoliticsStructuralFingerprintRecord {
  interpretedContractId: string;
  family: PoliticsDerivedFamily;
  jurisdiction: string | null;
  office: string | null;
  institution: string | null;
  chamber: string | null;
  branch: string | null;
  cycleYear: string | null;
  contestStage: string | null;
  candidateSetFingerprint: string | null;
  partyStructureFingerprint: string | null;
  thresholdSemantics: string | null;
  dateBoundarySemantics: string | null;
  outcomeStructureType: PoliticsExtractedRow["outcomeStructureType"];
  resolutionBasisFingerprint: string | null;
  eventType: string | null;
  sourceConfidence: PoliticsExtractedRow["extractionConfidence"];
  missingCriticalComponents: readonly string[];
}
