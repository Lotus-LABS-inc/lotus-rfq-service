import { createHash } from "node:crypto";

import type { PoliticsNomineeRuleCompatibilityClass } from "../../matching/politics/politics-types.js";
import { readArtifact, writeArtifact, writeMarkdownArtifact } from "./shared.js";

const TOPIC_KEY = "PARTY_CONTROL|USA|CONGRESS|2026|BALANCE_OF_POWER" as const;
const TRI_VENUE_SET = "OPINION|POLYMARKET|PREDICT" as const;
const PAIR_FALLBACK = "POLYMARKET|PREDICT" as const;
const TRI_LANE_ID = "POLITICS_PARTY_CONTROL_BALANCE_OF_POWER_2026_TRI_OPINION_POLYMARKET_PREDICT" as const;
const PAIR_LANE_ID = "POLITICS_PARTY_CONTROL_BALANCE_OF_POWER_2026_PAIR_POLYMARKET_PREDICT" as const;

const matcherInputSummaryPath =
  "artifacts/politics/party-control-balance-of-power-2026-matcher/politics-party-control-balance-of-power-2026-matcher-input-summary.json";
const matcherPairLanesPath =
  "artifacts/politics/party-control-balance-of-power-2026-matcher/politics-party-control-balance-of-power-2026-pair-lanes.json";
const matcherTriLanesPath =
  "artifacts/politics/party-control-balance-of-power-2026-matcher/politics-party-control-balance-of-power-2026-tri-lanes.json";
const matcherRejectionsPath =
  "artifacts/politics/party-control-balance-of-power-2026-matcher/politics-party-control-balance-of-power-2026-rejections.json";
const matcherFinalDecisionPath =
  "artifacts/politics/party-control-balance-of-power-2026-matcher/politics-party-control-balance-of-power-2026-final-decision.json";
const matcherOperatorSummaryPath =
  "artifacts/politics/party-control-balance-of-power-2026-matcher/politics-party-control-balance-of-power-2026-operator-summary.md";

type PartyControlLimitedProdReadinessDecision =
  | "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
  | "READY_BUT_MISSING_OPERATOR_REVIEW"
  | "NOT_READY_FOR_LIMITED_PROD";

type PartyControlBalanceOfPower2026LimitedProdReadinessLabel =
  | "PARTY_CONTROL_BALANCE_OF_POWER_2026_LIMITED_PROD_READY_FOR_REVIEW"
  | "PARTY_CONTROL_BALANCE_OF_POWER_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
  | "PARTY_CONTROL_BALANCE_OF_POWER_2026_LIMITED_PROD_HELD"
  | "PARTY_CONTROL_BALANCE_OF_POWER_2026_LIMITED_PROD_NOT_APPROVED";

interface MatcherInputSummaryArtifact {
  exactTopic: string;
  refreshedRowsUsed: unknown;
  familyComparabilitySourceArtifacts: Record<string, string>;
  admittedVenues: string[];
  admittedOutcomes: string[];
}

interface MatcherPairLanesArtifact {
  canonicalTopicKey: string;
  matcherLanes: {
    venuePair: string;
    outcome: string;
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

interface MatcherTriLanesArtifact {
  canonicalTopicKey: string;
  venueSet: string;
  matcherLanes: {
    venueSet: string;
    outcome: string;
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

interface MatcherRejectionsArtifact {
  rejections: {
    scope: "outcome" | "pair_lane" | "tri_lane" | "venue";
    outcomeIdentityKey?: string | null;
    normalizedOutcomeName?: string | null;
    venuePair?: string | null;
    venueSet?: string | null;
    venue?: string | null;
    reason: string;
    notes: string;
  }[];
}

interface MatcherFinalDecisionArtifact {
  overallDecision: string;
  bestPair: string | null;
  bestTriIfAny: string | null;
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

export interface PartyControlBalanceOfPower2026LimitedProdReadinessArtifact {
  observedAt: string;
  laneId: typeof TRI_LANE_ID;
  topicKey: typeof TOPIC_KEY;
  triVenueSet: typeof TRI_VENUE_SET;
  exactSafeTriOutcomes: readonly string[];
  saferPairFallback: {
    laneId: typeof PAIR_LANE_ID;
    venuePair: typeof PAIR_FALLBACK;
    exactSafeOutcomes: readonly string[];
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
    fallbackLaneId: typeof PAIR_LANE_ID;
    operatorSteps: readonly string[];
  };
  exclusionsStillMandatory: readonly string[];
  finalReadinessLabel: PartyControlBalanceOfPower2026LimitedProdReadinessLabel;
}

export interface PartyControlBalanceOfPower2026PairLimitedProdReadinessArtifact {
  observedAt: string;
  laneId: typeof PAIR_LANE_ID;
  topicKey: typeof TOPIC_KEY;
  venuePair: typeof PAIR_FALLBACK;
  exactSafeOutcomes: readonly string[];
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
  finalReadinessLabel: PartyControlBalanceOfPower2026LimitedProdReadinessLabel;
}

export interface PartyControlBalanceOfPower2026AdminSurfaceSummaryArtifact {
  observedAt: string;
  laneId: typeof TRI_LANE_ID;
  topicKey: typeof TOPIC_KEY;
  triVenueSet: typeof TRI_VENUE_SET;
  outcomeScopeHash: string;
  exactSafeTriOutcomes: readonly string[];
  saferPairFallbackLaneId: typeof PAIR_LANE_ID;
  saferPairFallbackVenuePair: typeof PAIR_FALLBACK;
  currentReadinessDecision: PartyControlLimitedProdReadinessDecision;
  supportedActions: readonly ["inspect", "hold", "promote", "rollback"];
  userConsentCanWidenScope: false;
  narrowestEnforceableUnit: "LANE_SCOPE_LOCK";
  sourceArtifactRefs: readonly string[];
}

export interface PartyControlBalanceOfPower2026PairAdminSurfaceSummaryArtifact {
  observedAt: string;
  laneId: typeof PAIR_LANE_ID;
  topicKey: typeof TOPIC_KEY;
  venuePair: typeof PAIR_FALLBACK;
  outcomeScopeHash: string;
  exactSafeOutcomes: readonly string[];
  currentReadinessDecision: PartyControlLimitedProdReadinessDecision;
  supportedActions: readonly ["inspect", "hold", "promote", "rollback"];
  userConsentCanWidenScope: false;
  narrowestEnforceableUnit: "LANE_SCOPE_LOCK";
  sourceArtifactRefs: readonly string[];
}

export interface PartyControlBalanceOfPower2026ReadinessVsMatcherDeltaArtifact {
  observedAt: string;
  laneId: typeof TRI_LANE_ID;
  matcherTruthConsumed: {
    topicKey: string;
    bestPair: string | null;
    bestTriIfAny: string | null;
    exactSafeTriOutcomes: readonly string[];
    exactSafePairFallbackOutcomes: readonly string[];
    overallDecision: string;
    triMatcherReady: boolean;
    pairMatcherReady: boolean;
    operatorCredible: boolean;
    ruleStatus: PoliticsNomineeRuleCompatibilityClass;
  };
  readinessConclusionsDerived: {
    finalReadinessLabel: PartyControlBalanceOfPower2026LimitedProdReadinessLabel;
    readinessReviewJustified: boolean;
    operatorRuleReviewRequired: boolean;
    rolloutRecommended: false;
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY";
    exactLaneScopeLocked: true;
    pairFallbackStillExplicit: true;
  };
  intentionallyUnchanged: readonly string[];
  stillBlocked: readonly string[];
}

export interface PartyControlBalanceOfPower2026PairReadinessVsMatcherDeltaArtifact {
  observedAt: string;
  laneId: typeof PAIR_LANE_ID;
  matcherTruthConsumed: {
    topicKey: string;
    bestPair: string | null;
    exactSafePairOutcomes: readonly string[];
    overallDecision: string;
    pairMatcherReady: boolean;
    operatorCredible: boolean;
    ruleStatus: PoliticsNomineeRuleCompatibilityClass;
  };
  readinessConclusionsDerived: {
    finalReadinessLabel: PartyControlBalanceOfPower2026LimitedProdReadinessLabel;
    readinessReviewJustified: boolean;
    operatorRuleReviewRequired: boolean;
    rolloutRecommended: false;
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY";
    exactLaneScopeLocked: true;
  };
  intentionallyUnchanged: readonly string[];
  stillBlocked: readonly string[];
}

export interface PoliticsPartyControlBalanceOfPower2026LimitedProdReadinessArtifacts {
  readiness: PartyControlBalanceOfPower2026LimitedProdReadinessArtifact;
  pairReadiness: PartyControlBalanceOfPower2026PairLimitedProdReadinessArtifact;
  adminSurfaceSummary: PartyControlBalanceOfPower2026AdminSurfaceSummaryArtifact;
  pairAdminSurfaceSummary: PartyControlBalanceOfPower2026PairAdminSurfaceSummaryArtifact;
  readinessVsMatcherDelta: PartyControlBalanceOfPower2026ReadinessVsMatcherDeltaArtifact;
  pairReadinessVsMatcherDelta: PartyControlBalanceOfPower2026PairReadinessVsMatcherDeltaArtifact;
  operatorSummary: string;
  pairOperatorSummary: string;
}

const buildOutcomeScopeHash = (outcomes: readonly string[]): string =>
  createHash("sha256")
    .update([...outcomes].sort((left, right) => left.localeCompare(right)).join("|"))
    .digest("hex")
    .slice(0, 16);

export const loadPoliticsPartyControlBalanceOfPower2026MatcherArtifacts = (repoRoot: string) => ({
  inputSummary: readArtifact<MatcherInputSummaryArtifact>(repoRoot, matcherInputSummaryPath),
  pairLanes: readArtifact<MatcherPairLanesArtifact>(repoRoot, matcherPairLanesPath),
  triLanes: readArtifact<MatcherTriLanesArtifact>(repoRoot, matcherTriLanesPath),
  rejections: readArtifact<MatcherRejectionsArtifact>(repoRoot, matcherRejectionsPath),
  finalDecision: readArtifact<MatcherFinalDecisionArtifact>(repoRoot, matcherFinalDecisionPath)
});

export const buildPoliticsPartyControlBalanceOfPower2026LimitedProdReadinessArtifacts = (input: {
  inputSummary: MatcherInputSummaryArtifact;
  pairLanes: MatcherPairLanesArtifact;
  triLanes: MatcherTriLanesArtifact;
  rejections: MatcherRejectionsArtifact;
  finalDecision: MatcherFinalDecisionArtifact;
}): PoliticsPartyControlBalanceOfPower2026LimitedProdReadinessArtifacts => {
  const exactSafeTriOutcomes = input.triLanes.matcherLanes.map((lane) => lane.outcome);
  const exactSafePairFallbackOutcomes = input.pairLanes.matcherLanes
    .filter((lane) => lane.venuePair === PAIR_FALLBACK)
    .map((lane) => lane.outcome);
  const triRuleStatus = input.triLanes.matcherLanes[0]?.rulesDecision ?? input.finalDecision.ruleStatus;
  const pairRuleStatus = input.pairLanes.matcherLanes.find((lane) => lane.venuePair === PAIR_FALLBACK)?.rulesDecision ?? input.finalDecision.ruleStatus;
  const triOperatorRuleReviewRequired = triRuleStatus !== "EXACT_RULE_COMPATIBLE";
  const pairOperatorRuleReviewRequired = pairRuleStatus !== "EXACT_RULE_COMPATIBLE";

  const triMatcherReady =
    input.finalDecision.overallDecision === "PARTY_CONTROL_BALANCE_OF_POWER_2026_TRI_READY_BUT_PAIR_FIRST"
    || input.finalDecision.overallDecision === "PARTY_CONTROL_BALANCE_OF_POWER_2026_TRI_REVIEW_REQUIRED";
  const pairMatcherReady =
    input.finalDecision.pairMatcherReady
    && exactSafePairFallbackOutcomes.length > 0;

  const exactTriScopeLocked =
    input.inputSummary.exactTopic === TOPIC_KEY
    && input.finalDecision.bestTriIfAny === TRI_VENUE_SET
    && exactSafeTriOutcomes.length === 3
    && input.finalDecision.bestPair === PAIR_FALLBACK
    && exactSafePairFallbackOutcomes.length === 4;
  const exactPairScopeLocked =
    input.inputSummary.exactTopic === TOPIC_KEY
    && input.finalDecision.bestPair === PAIR_FALLBACK
    && exactSafePairFallbackOutcomes.length === 4;

  const triReadinessReviewJustified =
    triMatcherReady
    && input.finalDecision.operatorCredible
    && exactTriScopeLocked;
  const pairReadinessReviewJustified =
    pairMatcherReady
    && input.finalDecision.operatorCredible
    && exactPairScopeLocked;

  const triFinalReadinessLabel: PartyControlBalanceOfPower2026LimitedProdReadinessLabel =
    !triMatcherReady || !input.finalDecision.operatorCredible || !exactTriScopeLocked
      ? "PARTY_CONTROL_BALANCE_OF_POWER_2026_LIMITED_PROD_NOT_APPROVED"
      : triOperatorRuleReviewRequired
        ? "PARTY_CONTROL_BALANCE_OF_POWER_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
        : "PARTY_CONTROL_BALANCE_OF_POWER_2026_LIMITED_PROD_READY_FOR_REVIEW";
  const pairFinalReadinessLabel: PartyControlBalanceOfPower2026LimitedProdReadinessLabel =
    !pairMatcherReady || !input.finalDecision.operatorCredible || !exactPairScopeLocked
      ? "PARTY_CONTROL_BALANCE_OF_POWER_2026_LIMITED_PROD_NOT_APPROVED"
      : pairOperatorRuleReviewRequired
        ? "PARTY_CONTROL_BALANCE_OF_POWER_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
        : "PARTY_CONTROL_BALANCE_OF_POWER_2026_LIMITED_PROD_READY_FOR_REVIEW";

  const commonExclusions = [
    "OTHERS_EXCLUDED",
    "VENUE_ONLY_TAILS_EXCLUDED",
    "UNKNOWN_COMPOSITE_EXCLUDED",
    "NO_LIMITLESS_FOR_THIS_TOPIC",
    "NO_MYRIAD_FOR_THIS_TOPIC"
  ] as const;

  const readiness: PartyControlBalanceOfPower2026LimitedProdReadinessArtifact = {
    observedAt: new Date().toISOString(),
    laneId: TRI_LANE_ID,
    topicKey: TOPIC_KEY,
    triVenueSet: TRI_VENUE_SET,
    exactSafeTriOutcomes,
    saferPairFallback: {
      laneId: PAIR_LANE_ID,
      venuePair: PAIR_FALLBACK,
      exactSafeOutcomes: exactSafePairFallbackOutcomes
    },
    ruleStatus: triRuleStatus,
    operatorRuleReviewRequired: triOperatorRuleReviewRequired,
    matcherReady: triMatcherReady,
    operatorCredible: input.finalDecision.operatorCredible,
    readinessReviewJustified: triReadinessReviewJustified,
    rolloutRecommended: false,
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY",
    holdPolicy: {
      scope: "LANE_ONLY",
      holdConditions: [
        "outcome_scope_drift",
        "venue_set_drift",
        "rule_status_drift",
        "operator_rule_review_not_completed",
        "operator_confidence_lost"
      ],
      userConsentCanWidenScope: false
    },
    rollbackPolicy: {
      scope: "LANE_ONLY",
      targetMode: "PAIR_FALLBACK_INTERNAL_REVIEW_ONLY",
      fallbackLaneId: PAIR_LANE_ID,
      operatorSteps: [
        "Record a lane-scoped rollback or hold event for POLITICS_PARTY_CONTROL_BALANCE_OF_POWER_2026_TRI_OPINION_POLYMARKET_PREDICT.",
        "Revert this party-control tri lane to the safer pair fallback POLYMARKET|PREDICT in internal-review-only posture.",
        "Do not widen to LIMITLESS, MYRIAD, or any other PARTY_CONTROL topic during rollback."
      ]
    },
    exclusionsStillMandatory: [
      ...commonExclusions,
      "PAIR_FALLBACK_REMAINS_EXPLICIT"
    ],
    finalReadinessLabel: triFinalReadinessLabel
  };

  const pairReadiness: PartyControlBalanceOfPower2026PairLimitedProdReadinessArtifact = {
    observedAt: new Date().toISOString(),
    laneId: PAIR_LANE_ID,
    topicKey: TOPIC_KEY,
    venuePair: PAIR_FALLBACK,
    exactSafeOutcomes: exactSafePairFallbackOutcomes,
    ruleStatus: pairRuleStatus,
    operatorRuleReviewRequired: pairOperatorRuleReviewRequired,
    matcherReady: pairMatcherReady,
    operatorCredible: input.finalDecision.operatorCredible,
    readinessReviewJustified: pairReadinessReviewJustified,
    rolloutRecommended: false,
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY",
    holdPolicy: {
      scope: "LANE_ONLY",
      holdConditions: [
        "outcome_scope_drift",
        "venue_pair_drift",
        "rule_status_drift",
        "operator_confidence_lost"
      ],
      userConsentCanWidenScope: false
    },
    rollbackPolicy: {
      scope: "LANE_ONLY",
      targetMode: "DISABLED_INTERNAL_ONLY",
      fallbackLaneId: null,
      operatorSteps: [
        "Record a lane-scoped rollback or hold event for POLITICS_PARTY_CONTROL_BALANCE_OF_POWER_2026_PAIR_POLYMARKET_PREDICT.",
        "Keep the pair lane disabled/internal-only until refreshed matcher and readiness artifacts are regenerated.",
        "Do not widen to OPINION tri, LIMITLESS, or any other PARTY_CONTROL topic during rollback."
      ]
    },
    exclusionsStillMandatory: commonExclusions,
    finalReadinessLabel: pairFinalReadinessLabel
  };

  const adminSurfaceSummary: PartyControlBalanceOfPower2026AdminSurfaceSummaryArtifact = {
    observedAt: new Date().toISOString(),
    laneId: TRI_LANE_ID,
    topicKey: TOPIC_KEY,
    triVenueSet: TRI_VENUE_SET,
    outcomeScopeHash: buildOutcomeScopeHash(exactSafeTriOutcomes),
    exactSafeTriOutcomes,
    saferPairFallbackLaneId: PAIR_LANE_ID,
    saferPairFallbackVenuePair: PAIR_FALLBACK,
    currentReadinessDecision: triReadinessReviewJustified
      ? "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
      : triMatcherReady
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

  const pairAdminSurfaceSummary: PartyControlBalanceOfPower2026PairAdminSurfaceSummaryArtifact = {
    observedAt: new Date().toISOString(),
    laneId: PAIR_LANE_ID,
    topicKey: TOPIC_KEY,
    venuePair: PAIR_FALLBACK,
    outcomeScopeHash: buildOutcomeScopeHash(exactSafePairFallbackOutcomes),
    exactSafeOutcomes: exactSafePairFallbackOutcomes,
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

  const readinessVsMatcherDelta: PartyControlBalanceOfPower2026ReadinessVsMatcherDeltaArtifact = {
    observedAt: new Date().toISOString(),
    laneId: TRI_LANE_ID,
    matcherTruthConsumed: {
      topicKey: TOPIC_KEY,
      bestPair: input.finalDecision.bestPair,
      bestTriIfAny: input.finalDecision.bestTriIfAny,
      exactSafeTriOutcomes,
      exactSafePairFallbackOutcomes,
      overallDecision: input.finalDecision.overallDecision,
      triMatcherReady: input.finalDecision.triMatcherReady,
      pairMatcherReady: input.finalDecision.pairMatcherReady,
      operatorCredible: input.finalDecision.operatorCredible,
      ruleStatus: triRuleStatus
    },
    readinessConclusionsDerived: {
      finalReadinessLabel: triFinalReadinessLabel,
      readinessReviewJustified: triReadinessReviewJustified,
      operatorRuleReviewRequired: triOperatorRuleReviewRequired,
      rolloutRecommended: false,
      recommendedMode: "LIMITED_PROD_REVIEW_ONLY",
      exactLaneScopeLocked: true,
      pairFallbackStillExplicit: true
    },
    intentionallyUnchanged: [
      "matcher logic unchanged",
      "exact tri/shared-core exclusions unchanged",
      "no rollout activation"
    ],
    stillBlocked: triOperatorRuleReviewRequired ? ["operator_rule_review_required"] : []
  };

  const pairReadinessVsMatcherDelta: PartyControlBalanceOfPower2026PairReadinessVsMatcherDeltaArtifact = {
    observedAt: new Date().toISOString(),
    laneId: PAIR_LANE_ID,
    matcherTruthConsumed: {
      topicKey: TOPIC_KEY,
      bestPair: input.finalDecision.bestPair,
      exactSafePairOutcomes: exactSafePairFallbackOutcomes,
      overallDecision: input.finalDecision.overallDecision,
      pairMatcherReady: input.finalDecision.pairMatcherReady,
      operatorCredible: input.finalDecision.operatorCredible,
      ruleStatus: pairRuleStatus
    },
    readinessConclusionsDerived: {
      finalReadinessLabel: pairFinalReadinessLabel,
      readinessReviewJustified: pairReadinessReviewJustified,
      operatorRuleReviewRequired: pairOperatorRuleReviewRequired,
      rolloutRecommended: false,
      recommendedMode: "LIMITED_PROD_REVIEW_ONLY",
      exactLaneScopeLocked: true
    },
    intentionallyUnchanged: [
      "matcher logic unchanged",
      "exact pair/shared-core exclusions unchanged",
      "no rollout activation"
    ],
    stillBlocked: pairOperatorRuleReviewRequired ? ["operator_rule_review_required"] : []
  };

  const operatorSummary = [
    "# Party Control Balance Of Power 2026 Limited Prod Readiness",
    "",
    `- exact topic: ${TOPIC_KEY}`,
    `- tri venue set: ${TRI_VENUE_SET}`,
    `- exact-safe tri outcomes: ${exactSafeTriOutcomes.join(", ") || "none"}`,
    `- safer pair fallback: ${PAIR_FALLBACK} -> ${exactSafePairFallbackOutcomes.join(", ") || "none"}`,
    `- rule status: ${triRuleStatus}`,
    `- operator rule review required: ${triOperatorRuleReviewRequired ? "yes" : "no"}`,
    `- readiness label: ${triFinalReadinessLabel}`,
    "- recommended operator action: keep the tri lane in limited-prod review only and preserve the exact pair fallback as a separate lane.",
    `- rollback boundary: lane-scoped rollback to pair fallback ${PAIR_LANE_ID}`,
    "- why this is narrow and safe: exact topic only, exact venue set only, exact 3-outcome tri core only, explicit pair fallback preserved."
  ].join("\n");

  const pairOperatorSummary = [
    "# Party Control Balance Of Power 2026 Pair Limited Prod Readiness",
    "",
    `- exact topic: ${TOPIC_KEY}`,
    `- pair venue set: ${PAIR_FALLBACK}`,
    `- exact-safe pair outcomes: ${exactSafePairFallbackOutcomes.join(", ") || "none"}`,
    `- rule status: ${pairRuleStatus}`,
    `- operator rule review required: ${pairOperatorRuleReviewRequired ? "yes" : "no"}`,
    `- readiness label: ${pairFinalReadinessLabel}`,
    "- recommended operator action: preserve this pair lane as the narrower user-facing fallback if tri is not preferred.",
    "- rollback boundary: lane-scoped hold/disable only."
  ].join("\n");

  return {
    readiness,
    pairReadiness,
    adminSurfaceSummary,
    pairAdminSurfaceSummary,
    readinessVsMatcherDelta,
    pairReadinessVsMatcherDelta,
    operatorSummary,
    pairOperatorSummary
  };
};

export const writePoliticsPartyControlBalanceOfPower2026LimitedProdReadinessArtifacts = (input: {
  repoRoot: string;
  inputSummary: MatcherInputSummaryArtifact;
  pairLanes: MatcherPairLanesArtifact;
  triLanes: MatcherTriLanesArtifact;
  rejections: MatcherRejectionsArtifact;
  finalDecision: MatcherFinalDecisionArtifact;
}): PoliticsPartyControlBalanceOfPower2026LimitedProdReadinessArtifacts => {
  const artifacts = buildPoliticsPartyControlBalanceOfPower2026LimitedProdReadinessArtifacts(input);

  writeArtifact(
    input.repoRoot,
    "artifacts/politics/core/politics-party-control-balance-of-power-2026-limited-prod-readiness.json",
    artifacts.readiness
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/politics/core/politics-party-control-balance-of-power-2026-admin-surface-summary.json",
    artifacts.adminSurfaceSummary
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/politics/core/politics-party-control-balance-of-power-2026-pair-limited-prod-readiness.json",
    artifacts.pairReadiness
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/politics/core/politics-party-control-balance-of-power-2026-pair-admin-surface-summary.json",
    artifacts.pairAdminSurfaceSummary
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/politics/core/politics-party-control-balance-of-power-2026-readiness-vs-matcher-delta.json",
    artifacts.readinessVsMatcherDelta
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/politics/core/politics-party-control-balance-of-power-2026-pair-readiness-vs-matcher-delta.json",
    artifacts.pairReadinessVsMatcherDelta
  );
  writeMarkdownArtifact(
    input.repoRoot,
    "docs/generated/politics/politics-party-control-balance-of-power-2026-lane-operator-summary.md",
    `${artifacts.operatorSummary}\n\n${artifacts.pairOperatorSummary}\n`
  );

  return artifacts;
};
