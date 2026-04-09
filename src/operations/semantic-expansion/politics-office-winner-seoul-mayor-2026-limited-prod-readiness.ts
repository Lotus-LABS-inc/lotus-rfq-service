import { createHash } from "node:crypto";

import type {
  PoliticsNomineeRuleCompatibilityClass,
  PoliticsOfficeWinnerSeoulMayor2026LimitedProdReadinessLabel,
  PoliticsOfficeWinnerSeoulMayor2026MatcherFinalDecision
} from "../../matching/politics/politics-types.js";
import { readArtifact, writeArtifact, writeMarkdownArtifact } from "./shared.js";
import {
  officeWinnerSeoulMayor2026PairFallbackLaneId,
  officeWinnerSeoulMayor2026TriLaneId
} from "./politics-office-winner-limited-prod-shared.js";

const TOPIC_KEY = "OFFICE_WINNER|SEOUL|MAYOR|2026" as const;
const TRI_VENUE_SET = "LIMITLESS|OPINION|POLYMARKET" as const;
const PAIR_FALLBACK = "LIMITLESS|POLYMARKET" as const;
const matcherInputSummaryPath =
  "artifacts/politics/office-winner-seoul-mayor-2026-matcher/politics-office-winner-seoul-mayor-2026-matcher-input-summary.json";
const matcherPairLanesPath =
  "artifacts/politics/office-winner-seoul-mayor-2026-matcher/politics-office-winner-seoul-mayor-2026-pair-lanes.json";
const matcherTriLanesPath =
  "artifacts/politics/office-winner-seoul-mayor-2026-matcher/politics-office-winner-seoul-mayor-2026-tri-lanes.json";
const matcherRejectionsPath =
  "artifacts/politics/office-winner-seoul-mayor-2026-matcher/politics-office-winner-seoul-mayor-2026-rejections.json";
const matcherFinalDecisionPath =
  "artifacts/politics/office-winner-seoul-mayor-2026-matcher/politics-office-winner-seoul-mayor-2026-final-decision.json";
const matcherOperatorSummaryPath =
  "artifacts/politics/office-winner-seoul-mayor-2026-matcher/politics-office-winner-seoul-mayor-2026-operator-summary.md";

interface SeoulMatcherInputSummaryArtifact {
  exactTopic: string;
  refreshedRowsUsed: unknown;
  familyComparabilitySourceArtifacts: Record<string, string>;
  admittedVenues: string[];
  admittedCandidates: string[];
}

interface SeoulPairLanesArtifact {
  canonicalTopicKey: string;
  matcherLanes: {
    venuePair: string;
    candidate: string;
    canonicalTopic: string;
    routeabilityDecision: string;
    rulesDecision: PoliticsNomineeRuleCompatibilityClass;
    evidence: {
      venue: string;
      venueMarketId: string;
      rawOutcomeLabel: string;
    }[];
    evidenceNotes: string[];
  }[];
}

interface SeoulTriLanesArtifact {
  canonicalTopicKey: string;
  venueSet: string;
  matcherLanes: {
    venueSet: string;
    candidate: string;
    canonicalTopic: string;
    routeabilityDecision: string;
    rulesDecision: PoliticsNomineeRuleCompatibilityClass;
    evidence: {
      venue: string;
      venueMarketId: string;
      rawOutcomeLabel: string;
    }[];
    evidenceNotes: string[];
  }[];
}

interface SeoulRejectionsArtifact {
  rejections: {
    scope: "candidate" | "pair_lane" | "tri_lane" | "venue";
    candidateIdentityKey?: string | null;
    normalizedCandidateName?: string | null;
    venuePair?: string | null;
    venueSet?: string | null;
    venue?: string | null;
    reason: string;
    notes: string;
  }[];
}

export interface SeoulOfficeWinnerLimitedProdReadinessArtifact {
  observedAt: string;
  laneId: typeof officeWinnerSeoulMayor2026TriLaneId;
  topicKey: typeof TOPIC_KEY;
  triVenueSet: typeof TRI_VENUE_SET;
  exactSafeTriCandidates: readonly string[];
  saferPairFallback: {
    laneId: typeof officeWinnerSeoulMayor2026PairFallbackLaneId;
    venuePair: typeof PAIR_FALLBACK;
    exactSafeCandidates: readonly string[];
  };
  ruleStatus: PoliticsNomineeRuleCompatibilityClass;
  operatorRuleReviewRequired: boolean;
  matcherReady: boolean;
  operatorCredible: boolean;
  readinessReviewJustified: boolean;
  rolloutRecommended: false;
  recommendedMode: "LIMITED_PROD_REVIEW_ONLY";
  holdPolicy: {
    scope: "LANE_ONLY";
    holdConditions: readonly string[];
    userConsentCanWidenScope: false;
  };
  rollbackPolicy: {
    scope: "LANE_ONLY";
    targetMode: "PAIR_FALLBACK_INTERNAL_REVIEW_ONLY";
    fallbackLaneId: typeof officeWinnerSeoulMayor2026PairFallbackLaneId;
    operatorSteps: readonly string[];
  };
  exclusionsStillMandatory: readonly string[];
  finalReadinessLabel: PoliticsOfficeWinnerSeoulMayor2026LimitedProdReadinessLabel;
}

export interface SeoulOfficeWinnerPairLimitedProdReadinessArtifact {
  observedAt: string;
  laneId: typeof officeWinnerSeoulMayor2026PairFallbackLaneId;
  topicKey: typeof TOPIC_KEY;
  venuePair: typeof PAIR_FALLBACK;
  exactSafeCandidates: readonly string[];
  ruleStatus: PoliticsNomineeRuleCompatibilityClass;
  operatorRuleReviewRequired: boolean;
  matcherReady: boolean;
  operatorCredible: boolean;
  readinessReviewJustified: boolean;
  rolloutRecommended: false;
  recommendedMode: "LIMITED_PROD_REVIEW_ONLY";
  holdPolicy: {
    scope: "LANE_ONLY";
    holdConditions: readonly string[];
    userConsentCanWidenScope: false;
  };
  rollbackPolicy: {
    scope: "LANE_ONLY";
    targetMode: "DISABLED_INTERNAL_ONLY";
    fallbackLaneId: null;
    operatorSteps: readonly string[];
  };
  exclusionsStillMandatory: readonly string[];
  finalReadinessLabel: PoliticsOfficeWinnerSeoulMayor2026LimitedProdReadinessLabel;
}

export interface SeoulOfficeWinnerAdminSurfaceSummaryArtifact {
  observedAt: string;
  laneId: typeof officeWinnerSeoulMayor2026TriLaneId;
  topicKey: typeof TOPIC_KEY;
  triVenueSet: typeof TRI_VENUE_SET;
  candidateScopeHash: string;
  exactSafeTriCandidates: readonly string[];
  saferPairFallbackLaneId: typeof officeWinnerSeoulMayor2026PairFallbackLaneId;
  saferPairFallbackVenuePair: typeof PAIR_FALLBACK;
  currentReadinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION" | "READY_BUT_MISSING_OPERATOR_REVIEW" | "NOT_READY_FOR_LIMITED_PROD";
  supportedActions: readonly ["inspect", "hold", "promote", "rollback"];
  userConsentCanWidenScope: false;
  narrowestEnforceableUnit: "LANE_SCOPE_LOCK";
  sourceArtifactRefs: readonly string[];
}

export interface SeoulOfficeWinnerPairAdminSurfaceSummaryArtifact {
  observedAt: string;
  laneId: typeof officeWinnerSeoulMayor2026PairFallbackLaneId;
  topicKey: typeof TOPIC_KEY;
  venuePair: typeof PAIR_FALLBACK;
  candidateScopeHash: string;
  exactSafeCandidates: readonly string[];
  currentReadinessDecision: "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION" | "READY_BUT_MISSING_OPERATOR_REVIEW" | "NOT_READY_FOR_LIMITED_PROD";
  supportedActions: readonly ["inspect", "hold", "promote", "rollback"];
  userConsentCanWidenScope: false;
  narrowestEnforceableUnit: "LANE_SCOPE_LOCK";
  sourceArtifactRefs: readonly string[];
}

export interface SeoulOfficeWinnerReadinessVsMatcherDeltaArtifact {
  observedAt: string;
  laneId: typeof officeWinnerSeoulMayor2026TriLaneId;
  matcherTruthConsumed: {
    topicKey: string;
    bestPair: string | null;
    bestTriIfAny: string | null;
    exactSafeTriCandidates: readonly string[];
    exactSafePairFallbackCandidates: readonly string[];
    overallDecision: string;
    triMatcherReady: boolean;
    pairMatcherReady: boolean;
    operatorCredible: boolean;
    ruleStatus: PoliticsNomineeRuleCompatibilityClass;
  };
  readinessConclusionsDerived: {
    finalReadinessLabel: PoliticsOfficeWinnerSeoulMayor2026LimitedProdReadinessLabel;
    readinessReviewJustified: boolean;
    operatorRuleReviewRequired: boolean;
    rolloutRecommended: false;
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY";
    exactLaneScopeLocked: true;
    pairFallbackStillExplicit: true;
  };
  intentionallyUnchanged: readonly string[];
  stillBlocked: readonly string[];
  operatorRuleReviewDependency: "SEMANTICALLY_COMPATIBLE_REWORDING_REQUIRES_OPERATOR_REVIEW";
}

export interface SeoulOfficeWinnerPairReadinessVsMatcherDeltaArtifact {
  observedAt: string;
  laneId: typeof officeWinnerSeoulMayor2026PairFallbackLaneId;
  matcherTruthConsumed: {
    topicKey: string;
    bestPair: string | null;
    exactSafePairCandidates: readonly string[];
    overallDecision: string;
    pairMatcherReady: boolean;
    operatorCredible: boolean;
    ruleStatus: PoliticsNomineeRuleCompatibilityClass;
  };
  readinessConclusionsDerived: {
    finalReadinessLabel: PoliticsOfficeWinnerSeoulMayor2026LimitedProdReadinessLabel;
    readinessReviewJustified: boolean;
    operatorRuleReviewRequired: boolean;
    rolloutRecommended: false;
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY";
    exactLaneScopeLocked: true;
  };
  intentionallyUnchanged: readonly string[];
  stillBlocked: readonly string[];
  operatorRuleReviewDependency: "SEMANTICALLY_COMPATIBLE_REWORDING_REQUIRES_OPERATOR_REVIEW";
}

export interface SeoulOfficeWinnerTriReviewPackageArtifact {
  observedAt: string;
  reviewState: "READY_PENDING_OPERATOR_REVIEW" | "NOT_READY";
  laneId: typeof officeWinnerSeoulMayor2026TriLaneId;
  topicKey: typeof TOPIC_KEY;
  approvedTriVenueSet: typeof TRI_VENUE_SET;
  approvedTriCandidates: readonly string[];
  saferPairFallback: {
    laneId: typeof officeWinnerSeoulMayor2026PairFallbackLaneId;
    venuePair: typeof PAIR_FALLBACK;
    exactSafeCandidates: readonly string[];
  };
  ruleCompatibilityState: PoliticsNomineeRuleCompatibilityClass;
  routeabilityState: string;
  exactSafeOnly: true;
  exclusionsLocked: readonly string[];
  sourceArtifacts: Record<string, string>;
  operatorChecks: readonly string[];
  holdBoundaries: readonly string[];
}

export interface SeoulOfficeWinnerPairReviewPackageArtifact {
  observedAt: string;
  reviewState: "READY_PENDING_OPERATOR_REVIEW" | "NOT_READY";
  laneId: typeof officeWinnerSeoulMayor2026PairFallbackLaneId;
  topicKey: typeof TOPIC_KEY;
  approvedVenuePair: typeof PAIR_FALLBACK;
  approvedCandidates: readonly string[];
  ruleCompatibilityState: PoliticsNomineeRuleCompatibilityClass;
  routeabilityState: string;
  exactSafeOnly: true;
  exclusionsLocked: readonly string[];
  sourceArtifacts: Record<string, string>;
  operatorChecks: readonly string[];
  holdBoundaries: readonly string[];
}

export interface PoliticsOfficeWinnerSeoulMayor2026LimitedProdReadinessArtifacts {
  readiness: SeoulOfficeWinnerLimitedProdReadinessArtifact;
  pairReadiness: SeoulOfficeWinnerPairLimitedProdReadinessArtifact;
  adminSurfaceSummary: SeoulOfficeWinnerAdminSurfaceSummaryArtifact;
  pairAdminSurfaceSummary: SeoulOfficeWinnerPairAdminSurfaceSummaryArtifact;
  readinessVsMatcherDelta: SeoulOfficeWinnerReadinessVsMatcherDeltaArtifact;
  pairReadinessVsMatcherDelta: SeoulOfficeWinnerPairReadinessVsMatcherDeltaArtifact;
  reviewPackage: SeoulOfficeWinnerTriReviewPackageArtifact;
  pairReviewPackage: SeoulOfficeWinnerPairReviewPackageArtifact;
  reviewChecklist: string;
  reviewSummary: string;
  operatorSummary: string;
  pairReviewChecklist: string;
  pairReviewSummary: string;
  pairOperatorSummary: string;
}

const buildCandidateScopeHash = (candidates: readonly string[]): string =>
  createHash("sha256")
    .update([...candidates].sort((left, right) => left.localeCompare(right)).join("|"))
    .digest("hex")
    .slice(0, 16);

export const loadPoliticsOfficeWinnerSeoulMayor2026MatcherArtifacts = (repoRoot: string) => ({
  inputSummary: readArtifact<SeoulMatcherInputSummaryArtifact>(repoRoot, matcherInputSummaryPath),
  pairLanes: readArtifact<SeoulPairLanesArtifact>(repoRoot, matcherPairLanesPath),
  triLanes: readArtifact<SeoulTriLanesArtifact>(repoRoot, matcherTriLanesPath),
  rejections: readArtifact<SeoulRejectionsArtifact>(repoRoot, matcherRejectionsPath),
  finalDecision: readArtifact<PoliticsOfficeWinnerSeoulMayor2026MatcherFinalDecision>(repoRoot, matcherFinalDecisionPath)
});

export const buildPoliticsOfficeWinnerSeoulMayor2026LimitedProdReadinessArtifacts = (input: {
  inputSummary: SeoulMatcherInputSummaryArtifact;
  pairLanes: SeoulPairLanesArtifact;
  triLanes: SeoulTriLanesArtifact;
  rejections: SeoulRejectionsArtifact;
  finalDecision: PoliticsOfficeWinnerSeoulMayor2026MatcherFinalDecision;
}): PoliticsOfficeWinnerSeoulMayor2026LimitedProdReadinessArtifacts => {
  const exactSafeTriCandidates = input.triLanes.matcherLanes.map((lane) => lane.candidate);
  const exactSafePairFallbackCandidates = input.pairLanes.matcherLanes
    .filter((lane) => lane.venuePair === PAIR_FALLBACK)
    .map((lane) => lane.candidate);
  const ruleStatus = input.triLanes.matcherLanes[0]?.rulesDecision ?? input.finalDecision.ruleStatus;
  const operatorRuleReviewRequired = ruleStatus === "SEMANTICALLY_COMPATIBLE_REWORDING";
  const matcherReady =
    input.finalDecision.overallDecision === "OFFICE_WINNER_SEOUL_MAYOR_2026_TRI_READY_BUT_PAIR_FIRST"
    || input.finalDecision.overallDecision === "OFFICE_WINNER_SEOUL_MAYOR_2026_TRI_REVIEW_REQUIRED";
  const exactLaneScopeLocked =
    input.inputSummary.exactTopic === TOPIC_KEY
    && input.finalDecision.bestTriIfAny === TRI_VENUE_SET
    && exactSafeTriCandidates.length === 4
    && input.finalDecision.bestPair === PAIR_FALLBACK
    && exactSafePairFallbackCandidates.length >= 4;
  const readinessReviewJustified =
    matcherReady
    && input.finalDecision.operatorCredible
    && exactLaneScopeLocked;

  const finalReadinessLabel: PoliticsOfficeWinnerSeoulMayor2026LimitedProdReadinessLabel =
    !matcherReady || !input.finalDecision.operatorCredible || !exactLaneScopeLocked
      ? "OFFICE_WINNER_SEOUL_MAYOR_2026_LIMITED_PROD_NOT_APPROVED"
      : operatorRuleReviewRequired
        ? "OFFICE_WINNER_SEOUL_MAYOR_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
        : "OFFICE_WINNER_SEOUL_MAYOR_2026_LIMITED_PROD_READY_FOR_REVIEW";

  const readiness: SeoulOfficeWinnerLimitedProdReadinessArtifact = {
    observedAt: new Date().toISOString(),
    laneId: officeWinnerSeoulMayor2026TriLaneId,
    topicKey: TOPIC_KEY,
    triVenueSet: TRI_VENUE_SET,
    exactSafeTriCandidates,
    saferPairFallback: {
      laneId: officeWinnerSeoulMayor2026PairFallbackLaneId,
      venuePair: PAIR_FALLBACK,
      exactSafeCandidates: exactSafePairFallbackCandidates
    },
    ruleStatus,
    operatorRuleReviewRequired,
    matcherReady,
    operatorCredible: input.finalDecision.operatorCredible,
    readinessReviewJustified,
    rolloutRecommended: false,
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY",
    holdPolicy: {
      scope: "LANE_ONLY",
      holdConditions: [
        "tri_candidate_set_drift",
        "tri_venue_set_drift",
        "rule_status_drift",
        "operator_rule_review_not_completed",
        "operator_confidence_lost"
      ],
      userConsentCanWidenScope: false
    },
    rollbackPolicy: {
      scope: "LANE_ONLY",
      targetMode: "PAIR_FALLBACK_INTERNAL_REVIEW_ONLY",
      fallbackLaneId: officeWinnerSeoulMayor2026PairFallbackLaneId,
      operatorSteps: [
        "Record a lane-scoped rollback or hold event for POLITICS_OFFICE_WINNER_SEOUL_MAYOR_2026_TRI_LIMITLESS_OPINION_POLYMARKET.",
        "Revert this Seoul tri lane to the safer pair fallback LIMITLESS|POLYMARKET in internal-review-only posture.",
        "Regenerate refreshed Seoul matcher and readiness artifacts before any new promotion attempt.",
        "Do not widen beyond the exact Seoul topic, tri venue set, or explicit LIMITLESS|POLYMARKET fallback."
      ]
    },
    exclusionsStillMandatory: [
      "OTHERS_EXCLUDED",
      "VENUE_ONLY_TAILS_EXCLUDED",
      "UNKNOWN_COMPOSITE_EXCLUDED",
      "NO_MYRIAD_FOR_THIS_TOPIC",
      "NO_PREDICT_FOR_THIS_TOPIC",
      "PAIR_FALLBACK_MUST_REMAIN_EXPLICIT"
    ],
    finalReadinessLabel
  };

  const pairMatcherReady = input.finalDecision.pairMatcherReady && input.finalDecision.bestPair === PAIR_FALLBACK;
  const exactPairLaneScopeLocked =
    input.inputSummary.exactTopic === TOPIC_KEY
    && input.finalDecision.bestPair === PAIR_FALLBACK
    && exactSafePairFallbackCandidates.length >= 4;
  const pairReadinessReviewJustified =
    pairMatcherReady
    && input.finalDecision.operatorCredible
    && exactPairLaneScopeLocked;

  const pairFinalReadinessLabel: PoliticsOfficeWinnerSeoulMayor2026LimitedProdReadinessLabel =
    !pairMatcherReady || !input.finalDecision.operatorCredible || !exactPairLaneScopeLocked
      ? "OFFICE_WINNER_SEOUL_MAYOR_2026_LIMITED_PROD_NOT_APPROVED"
      : operatorRuleReviewRequired
        ? "OFFICE_WINNER_SEOUL_MAYOR_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
        : "OFFICE_WINNER_SEOUL_MAYOR_2026_LIMITED_PROD_READY_FOR_REVIEW";

  const pairReadiness: SeoulOfficeWinnerPairLimitedProdReadinessArtifact = {
    observedAt: new Date().toISOString(),
    laneId: officeWinnerSeoulMayor2026PairFallbackLaneId,
    topicKey: TOPIC_KEY,
    venuePair: PAIR_FALLBACK,
    exactSafeCandidates: exactSafePairFallbackCandidates,
    ruleStatus,
    operatorRuleReviewRequired,
    matcherReady: pairMatcherReady,
    operatorCredible: input.finalDecision.operatorCredible,
    readinessReviewJustified: pairReadinessReviewJustified,
    rolloutRecommended: false,
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY",
    holdPolicy: {
      scope: "LANE_ONLY",
      holdConditions: [
        "pair_candidate_set_drift",
        "pair_venue_set_drift",
        "rule_status_drift",
        "operator_rule_review_not_completed",
        "operator_confidence_lost"
      ],
      userConsentCanWidenScope: false
    },
    rollbackPolicy: {
      scope: "LANE_ONLY",
      targetMode: "DISABLED_INTERNAL_ONLY",
      fallbackLaneId: null,
      operatorSteps: [
        "Record a lane-scoped rollback or hold event for POLITICS_OFFICE_WINNER_SEOUL_MAYOR_2026_PAIR_LIMITLESS_POLYMARKET.",
        "Keep this Seoul pair lane disabled/internal-only until refreshed matcher and readiness artifacts are regenerated.",
        "Do not widen beyond the exact Seoul topic, the exact pair LIMITLESS|POLYMARKET, or the exact candidate set."
      ]
    },
    exclusionsStillMandatory: [
      "OTHERS_EXCLUDED",
      "VENUE_ONLY_TAILS_EXCLUDED",
      "UNKNOWN_COMPOSITE_EXCLUDED",
      "NO_MYRIAD_FOR_THIS_TOPIC",
      "NO_PREDICT_FOR_THIS_TOPIC"
    ],
    finalReadinessLabel: pairFinalReadinessLabel
  };

  const adminSurfaceSummary: SeoulOfficeWinnerAdminSurfaceSummaryArtifact = {
    observedAt: new Date().toISOString(),
    laneId: officeWinnerSeoulMayor2026TriLaneId,
    topicKey: TOPIC_KEY,
    triVenueSet: TRI_VENUE_SET,
    candidateScopeHash: buildCandidateScopeHash(exactSafeTriCandidates),
    exactSafeTriCandidates,
    saferPairFallbackLaneId: officeWinnerSeoulMayor2026PairFallbackLaneId,
    saferPairFallbackVenuePair: PAIR_FALLBACK,
    currentReadinessDecision: readinessReviewJustified
      ? "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
      : matcherReady
        ? "READY_BUT_MISSING_OPERATOR_REVIEW"
        : "NOT_READY_FOR_LIMITED_PROD",
    supportedActions: ["inspect", "hold", "promote", "rollback"],
    userConsentCanWidenScope: false,
    narrowestEnforceableUnit: "LANE_SCOPE_LOCK",
    sourceArtifactRefs: [
      matcherInputSummaryPath,
      matcherPairLanesPath,
      matcherTriLanesPath,
      matcherRejectionsPath,
      matcherFinalDecisionPath,
      matcherOperatorSummaryPath
    ]
  };

  const pairAdminSurfaceSummary: SeoulOfficeWinnerPairAdminSurfaceSummaryArtifact = {
    observedAt: new Date().toISOString(),
    laneId: officeWinnerSeoulMayor2026PairFallbackLaneId,
    topicKey: TOPIC_KEY,
    venuePair: PAIR_FALLBACK,
    candidateScopeHash: buildCandidateScopeHash(exactSafePairFallbackCandidates),
    exactSafeCandidates: exactSafePairFallbackCandidates,
    currentReadinessDecision: pairReadinessReviewJustified
      ? "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
      : pairMatcherReady
        ? "READY_BUT_MISSING_OPERATOR_REVIEW"
        : "NOT_READY_FOR_LIMITED_PROD",
    supportedActions: ["inspect", "hold", "promote", "rollback"],
    userConsentCanWidenScope: false,
    narrowestEnforceableUnit: "LANE_SCOPE_LOCK",
    sourceArtifactRefs: [
      matcherInputSummaryPath,
      matcherPairLanesPath,
      matcherRejectionsPath,
      matcherFinalDecisionPath,
      matcherOperatorSummaryPath
    ]
  };

  const readinessVsMatcherDelta: SeoulOfficeWinnerReadinessVsMatcherDeltaArtifact = {
    observedAt: new Date().toISOString(),
    laneId: officeWinnerSeoulMayor2026TriLaneId,
    matcherTruthConsumed: {
      topicKey: TOPIC_KEY,
      bestPair: input.finalDecision.bestPair,
      bestTriIfAny: input.finalDecision.bestTriIfAny,
      exactSafeTriCandidates,
      exactSafePairFallbackCandidates,
      overallDecision: input.finalDecision.overallDecision,
      triMatcherReady: input.finalDecision.triMatcherReady,
      pairMatcherReady: input.finalDecision.pairMatcherReady,
      operatorCredible: input.finalDecision.operatorCredible,
      ruleStatus
    },
    readinessConclusionsDerived: {
      finalReadinessLabel,
      readinessReviewJustified,
      operatorRuleReviewRequired,
      rolloutRecommended: false,
      recommendedMode: "LIMITED_PROD_REVIEW_ONLY",
      exactLaneScopeLocked: true,
      pairFallbackStillExplicit: true
    },
    intentionallyUnchanged: [
      "no_broad_politics_activation",
      "no_topic_widening_beyond_office_winner_seoul_mayor_2026",
      "no_matcher_logic_changes",
      "no_silent_promotion"
    ],
    stillBlocked: [
      "live_promotion_remains_operator_controlled_only",
      "pair_fallback_must_remain_explicit",
      ...(operatorRuleReviewRequired ? ["operator_rule_review_not_completed"] : []),
      ...input.rejections.rejections
        .filter((rejection) => rejection.reason === "OTHERS_EXCLUDED")
        .map(() => "others_remains_excluded"),
      ...input.rejections.rejections
        .filter((rejection) => rejection.reason === "NOT_SHARED")
        .map(() => "venue_only_tails_remain_excluded"),
      ...input.rejections.rejections
        .filter((rejection) => rejection.reason === "VENUE_NOT_PRESENT_FOR_TOPIC")
        .map((rejection) => `venue_excluded_${String(rejection.venue ?? "unknown").toLowerCase()}`)
    ],
    operatorRuleReviewDependency: "SEMANTICALLY_COMPATIBLE_REWORDING_REQUIRES_OPERATOR_REVIEW"
  };

  const reviewPackage: SeoulOfficeWinnerTriReviewPackageArtifact = {
    observedAt: new Date().toISOString(),
    reviewState: readinessReviewJustified ? "READY_PENDING_OPERATOR_REVIEW" : "NOT_READY",
    laneId: officeWinnerSeoulMayor2026TriLaneId,
    topicKey: TOPIC_KEY,
    approvedTriVenueSet: TRI_VENUE_SET,
    approvedTriCandidates: exactSafeTriCandidates,
    saferPairFallback: {
      laneId: officeWinnerSeoulMayor2026PairFallbackLaneId,
      venuePair: PAIR_FALLBACK,
      exactSafeCandidates: exactSafePairFallbackCandidates
    },
    ruleCompatibilityState: ruleStatus,
    routeabilityState: input.triLanes.matcherLanes[0]?.routeabilityDecision ?? "TRI_REJECTED",
    exactSafeOnly: true,
    exclusionsLocked: [
      "OTHERS_EXCLUDED",
      "VENUE_ONLY_TAILS_EXCLUDED",
      "UNKNOWN_COMPOSITE_EXCLUDED",
      "NO_MYRIAD_FOR_THIS_TOPIC",
      "NO_PREDICT_FOR_THIS_TOPIC",
      "PAIR_FALLBACK_MUST_REMAIN_EXPLICIT"
    ],
    sourceArtifacts: {
      matcherInputSummary: matcherInputSummaryPath,
      pairLanes: matcherPairLanesPath,
      triLanes: matcherTriLanesPath,
      rejections: matcherRejectionsPath,
      finalDecision: matcherFinalDecisionPath
    },
    operatorChecks: [
      "Confirm the scope is exactly OFFICE_WINNER|SEOUL|MAYOR|2026.",
      "Confirm the only approved tri venue set is LIMITLESS|OPINION|POLYMARKET.",
      "Confirm the approved tri candidate set is exactly chong_won_oh, na_kyung_won, oh_se_hoon, and park_ju_min.",
      "Confirm the safer pair fallback remains LIMITLESS|POLYMARKET and is not discarded.",
      "Confirm rule state remains SEMANTICALLY_COMPATIBLE_REWORDING and operator rule review is completed before any promotion.",
      "Confirm Others, venue-only tails, unknown/composite outcomes, MYRIAD, and PREDICT remain excluded."
    ],
    holdBoundaries: [
      "Do not widen beyond OFFICE_WINNER|SEOUL|MAYOR|2026.",
      "Do not add non-tri Seoul candidates to the tri lane.",
      "Do not discard the explicit LIMITLESS|POLYMARKET pair fallback.",
      "Do not treat this review package as activation authority."
    ]
  };

  const pairReadinessVsMatcherDelta: SeoulOfficeWinnerPairReadinessVsMatcherDeltaArtifact = {
    observedAt: new Date().toISOString(),
    laneId: officeWinnerSeoulMayor2026PairFallbackLaneId,
    matcherTruthConsumed: {
      topicKey: TOPIC_KEY,
      bestPair: input.finalDecision.bestPair,
      exactSafePairCandidates: exactSafePairFallbackCandidates,
      overallDecision: input.finalDecision.overallDecision,
      pairMatcherReady: input.finalDecision.pairMatcherReady,
      operatorCredible: input.finalDecision.operatorCredible,
      ruleStatus
    },
    readinessConclusionsDerived: {
      finalReadinessLabel: pairFinalReadinessLabel,
      readinessReviewJustified: pairReadinessReviewJustified,
      operatorRuleReviewRequired,
      rolloutRecommended: false,
      recommendedMode: "LIMITED_PROD_REVIEW_ONLY",
      exactLaneScopeLocked: true
    },
    intentionallyUnchanged: [
      "no_broad_politics_activation",
      "no_topic_widening_beyond_office_winner_seoul_mayor_2026",
      "no_matcher_logic_changes",
      "no_silent_promotion"
    ],
    stillBlocked: [
      "live_promotion_remains_operator_controlled_only",
      ...(operatorRuleReviewRequired ? ["operator_rule_review_not_completed"] : []),
      ...input.rejections.rejections
        .filter((rejection) => rejection.reason === "OTHERS_EXCLUDED")
        .map(() => "others_remains_excluded"),
      ...input.rejections.rejections
        .filter((rejection) => rejection.reason === "NOT_SHARED")
        .map(() => "venue_only_tails_remain_excluded"),
      ...input.rejections.rejections
        .filter((rejection) => rejection.reason === "VENUE_NOT_PRESENT_FOR_TOPIC")
        .map((rejection) => `venue_excluded_${String(rejection.venue ?? "unknown").toLowerCase()}`)
    ],
    operatorRuleReviewDependency: "SEMANTICALLY_COMPATIBLE_REWORDING_REQUIRES_OPERATOR_REVIEW"
  };

  const pairReviewPackage: SeoulOfficeWinnerPairReviewPackageArtifact = {
    observedAt: new Date().toISOString(),
    reviewState: pairReadinessReviewJustified ? "READY_PENDING_OPERATOR_REVIEW" : "NOT_READY",
    laneId: officeWinnerSeoulMayor2026PairFallbackLaneId,
    topicKey: TOPIC_KEY,
    approvedVenuePair: PAIR_FALLBACK,
    approvedCandidates: exactSafePairFallbackCandidates,
    ruleCompatibilityState: ruleStatus,
    routeabilityState: input.pairLanes.matcherLanes.find((lane) => lane.venuePair === PAIR_FALLBACK)?.routeabilityDecision ?? "PAIR_REJECTED",
    exactSafeOnly: true,
    exclusionsLocked: [
      "OTHERS_EXCLUDED",
      "VENUE_ONLY_TAILS_EXCLUDED",
      "UNKNOWN_COMPOSITE_EXCLUDED",
      "NO_MYRIAD_FOR_THIS_TOPIC",
      "NO_PREDICT_FOR_THIS_TOPIC"
    ],
    sourceArtifacts: {
      matcherInputSummary: matcherInputSummaryPath,
      pairLanes: matcherPairLanesPath,
      rejections: matcherRejectionsPath,
      finalDecision: matcherFinalDecisionPath
    },
    operatorChecks: [
      "Confirm the scope is exactly OFFICE_WINNER|SEOUL|MAYOR|2026.",
      "Confirm the approved pair venue is exactly LIMITLESS|POLYMARKET.",
      `Confirm the approved pair candidate set remains exactly ${exactSafePairFallbackCandidates.join(", ")}.`,
      "Confirm rule state remains SEMANTICALLY_COMPATIBLE_REWORDING and operator rule review is completed before any promotion.",
      "Confirm Others, venue-only tails, unknown/composite outcomes, MYRIAD, and PREDICT remain excluded."
    ],
    holdBoundaries: [
      "Do not widen beyond OFFICE_WINNER|SEOUL|MAYOR|2026.",
      "Do not add non-shared Seoul candidates to the pair lane.",
      "Do not treat this review package as activation authority."
    ]
  };

  const reviewChecklist = [
    "# Office Winner Seoul Mayor 2026 Tri Limited-Prod Review Checklist",
    "",
    `- topic locked: ${TOPIC_KEY}`,
    `- approved tri venue set: ${TRI_VENUE_SET}`,
    `- approved tri candidates: ${exactSafeTriCandidates.join(", ") || "none"}`,
    `- safer pair fallback: ${PAIR_FALLBACK} -> ${exactSafePairFallbackCandidates.join(", ") || "none"}`,
    "",
    "## Required Checks",
    "",
    "- confirm the package is read-only and does not authorize promotion by itself",
    "- confirm every approved tri lane remains `TRI_REVIEW_REQUIRED` under `SEMANTICALLY_COMPATIBLE_REWORDING`",
    "- confirm the exact tri candidate set remains only the four strict shared-core names",
    "- confirm the safer pair fallback LIMITLESS|POLYMARKET remains explicit and unchanged",
    "- confirm Others, venue-only tails, unknown/composite outcomes, MYRIAD, and PREDICT remain excluded",
    "- confirm no broader local-office-winner or broad-politics scope is being introduced",
    ""
  ].join("\n");

  const pairReviewChecklist = [
    "# Office Winner Seoul Mayor 2026 Pair Limited-Prod Review Checklist",
    "",
    `- topic locked: ${TOPIC_KEY}`,
    `- approved pair venue: ${PAIR_FALLBACK}`,
    `- approved pair candidates: ${exactSafePairFallbackCandidates.join(", ") || "none"}`,
    "",
    "## Required Checks",
    "",
    "- confirm the package is read-only and does not authorize promotion by itself",
    "- confirm every approved pair lane remains `PAIR_REVIEW_REQUIRED` under `SEMANTICALLY_COMPATIBLE_REWORDING`",
    "- confirm the exact pair candidate set remains only the shared LIMITLESS|POLYMARKET names",
    "- confirm Others, venue-only tails, unknown/composite outcomes, MYRIAD, and PREDICT remain excluded",
    "- confirm no broader local-office-winner or broad-politics scope is being introduced",
    ""
  ].join("\n");

  const reviewSummary = [
    "# Office Winner Seoul Mayor 2026 Limited-Prod Review",
    "",
    `- current decision: ${input.finalDecision.overallDecision}`,
    `- final readiness label: ${finalReadinessLabel}`,
    `- exact topic: ${TOPIC_KEY}`,
    `- approved tri venue set: ${TRI_VENUE_SET}`,
    `- approved tri candidates: ${exactSafeTriCandidates.join(", ") || "none"}`,
    `- safer pair fallback: ${PAIR_FALLBACK} -> ${exactSafePairFallbackCandidates.join(", ") || "none"}`,
    `- rule status: ${ruleStatus}`,
    `- operator rule review required: ${operatorRuleReviewRequired ? "yes" : "no"}`,
    "- review posture: limited-prod operator review only; no activation is authorized here",
    ""
  ].join("\n");

  const pairReviewSummary = [
    "# Office Winner Seoul Mayor 2026 Pair Limited-Prod Review",
    "",
    `- current matcher best pair: ${input.finalDecision.bestPair}`,
    `- final readiness label: ${pairFinalReadinessLabel}`,
    `- exact topic: ${TOPIC_KEY}`,
    `- approved pair venue: ${PAIR_FALLBACK}`,
    `- approved pair candidates: ${exactSafePairFallbackCandidates.join(", ") || "none"}`,
    `- rule status: ${ruleStatus}`,
    `- operator rule review required: ${operatorRuleReviewRequired ? "yes" : "no"}`,
    "- review posture: limited-prod operator review only; no activation is authorized here",
    ""
  ].join("\n");

  const operatorSummary = [
    "# Office Winner Seoul Mayor 2026 Limited-Prod Readiness",
    "",
    `- exact topic: ${TOPIC_KEY}`,
    `- exact tri venue set: ${TRI_VENUE_SET}`,
    `- exact-safe tri candidates: ${exactSafeTriCandidates.join(", ") || "none"}`,
    `- safer pair fallback: ${PAIR_FALLBACK} -> ${exactSafePairFallbackCandidates.join(", ") || "none"}`,
    `- exact rule state: ${ruleStatus}`,
    `- operator rule review required: ${operatorRuleReviewRequired ? "yes" : "no"}`,
    `- matcher ready: ${matcherReady ? "yes" : "no"}`,
    `- operator credible: ${input.finalDecision.operatorCredible ? "yes" : "no"}`,
    `- readiness review justified: ${readinessReviewJustified ? "yes" : "no"}`,
    "- rollout recommended now: no",
    "- recommended operator action: keep the Seoul tri lane in limited-prod review only, complete operator rule review, and keep LIMITLESS|POLYMARKET explicit as the safer pair fallback.",
    `- rollback boundary: lane-scoped rollback to pair fallback ${officeWinnerSeoulMayor2026PairFallbackLaneId}`,
    "- exclusions still mandatory: Others, venue-only tails, unknown/composite outcomes, MYRIAD, and PREDICT.",
    "- why this is narrow and safe: exact topic only, exact tri venue set only, exact four-candidate tri core only, explicit pair fallback preserved, operator-authoritative review only.",
    ""
  ].join("\n");

  const pairOperatorSummary = [
    "# Office Winner Seoul Mayor 2026 Pair Limited-Prod Readiness",
    "",
    `- exact topic: ${TOPIC_KEY}`,
    `- exact pair venue: ${PAIR_FALLBACK}`,
    `- exact-safe pair candidates: ${exactSafePairFallbackCandidates.join(", ") || "none"}`,
    `- exact rule state: ${ruleStatus}`,
    `- operator rule review required: ${operatorRuleReviewRequired ? "yes" : "no"}`,
    `- matcher ready: ${pairMatcherReady ? "yes" : "no"}`,
    `- operator credible: ${input.finalDecision.operatorCredible ? "yes" : "no"}`,
    `- readiness review justified: ${pairReadinessReviewJustified ? "yes" : "no"}`,
    "- rollout recommended now: no",
    "- recommended operator action: keep the Seoul pair lane in limited-prod review only and complete operator rule review before any promotion.",
    "- rollback boundary: lane-scoped rollback to disabled/internal-only.",
    "- exclusions still mandatory: Others, venue-only tails, unknown/composite outcomes, MYRIAD, and PREDICT.",
    "- why this is narrow and safe: exact topic only, exact pair venue only, exact shared pair candidates only, operator-authoritative review only.",
    ""
  ].join("\n");

  return {
    readiness,
    pairReadiness,
    adminSurfaceSummary,
    pairAdminSurfaceSummary,
    readinessVsMatcherDelta,
    pairReadinessVsMatcherDelta,
    reviewPackage,
    pairReviewPackage,
    reviewChecklist,
    reviewSummary,
    operatorSummary,
    pairReviewChecklist,
    pairReviewSummary,
    pairOperatorSummary
  };
};

export const writePoliticsOfficeWinnerSeoulMayor2026LimitedProdReadinessArtifacts = (input: {
  repoRoot: string;
  inputSummary: SeoulMatcherInputSummaryArtifact;
  pairLanes: SeoulPairLanesArtifact;
  triLanes: SeoulTriLanesArtifact;
  rejections: SeoulRejectionsArtifact;
  finalDecision: PoliticsOfficeWinnerSeoulMayor2026MatcherFinalDecision;
}): PoliticsOfficeWinnerSeoulMayor2026LimitedProdReadinessArtifacts => {
  const artifacts = buildPoliticsOfficeWinnerSeoulMayor2026LimitedProdReadinessArtifacts(input);
  writeArtifact(
    input.repoRoot,
    "artifacts/politics/core/politics-office-winner-seoul-mayor-2026-limited-prod-readiness.json",
    artifacts.readiness
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/politics/core/politics-office-winner-seoul-mayor-2026-admin-surface-summary.json",
    artifacts.adminSurfaceSummary
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/politics/core/politics-office-winner-seoul-mayor-2026-pair-limited-prod-readiness.json",
    artifacts.pairReadiness
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/politics/core/politics-office-winner-seoul-mayor-2026-pair-admin-surface-summary.json",
    artifacts.pairAdminSurfaceSummary
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/politics/core/politics-office-winner-seoul-mayor-2026-readiness-vs-matcher-delta.json",
    artifacts.readinessVsMatcherDelta
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/politics/core/politics-office-winner-seoul-mayor-2026-pair-readiness-vs-matcher-delta.json",
    artifacts.pairReadinessVsMatcherDelta
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/politics/core/politics-office-winner-seoul-mayor-2026-tri-review-package.json",
    artifacts.reviewPackage
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/politics/core/politics-office-winner-seoul-mayor-2026-pair-review-package.json",
    artifacts.pairReviewPackage
  );
  writeMarkdownArtifact(
    input.repoRoot,
    "docs/generated/politics/politics-office-winner-seoul-mayor-2026-lane-operator-summary.md",
    `${artifacts.operatorSummary}\n`
  );
  writeMarkdownArtifact(
    input.repoRoot,
    "docs/generated/politics/politics-office-winner-seoul-mayor-2026-pair-lane-operator-summary.md",
    `${artifacts.pairOperatorSummary}\n`
  );
  writeMarkdownArtifact(
    input.repoRoot,
    "docs/generated/politics/politics-office-winner-seoul-mayor-2026-tri-review-checklist.md",
    `${artifacts.reviewChecklist}\n`
  );
  writeMarkdownArtifact(
    input.repoRoot,
    "docs/generated/politics/politics-office-winner-seoul-mayor-2026-pair-review-checklist.md",
    `${artifacts.pairReviewChecklist}\n`
  );
  writeMarkdownArtifact(
    input.repoRoot,
    "docs/generated/politics/politics-office-winner-seoul-mayor-2026-limited-prod-review.md",
    `${artifacts.reviewSummary}\n`
  );
  writeMarkdownArtifact(
    input.repoRoot,
    "docs/generated/politics/politics-office-winner-seoul-mayor-2026-pair-limited-prod-review.md",
    `${artifacts.pairReviewSummary}\n`
  );
  return artifacts;
};
