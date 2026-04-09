import { createHash } from "node:crypto";

import { readArtifact, writeArtifact, writeMarkdownArtifact } from "./shared.js";
import {
  sportsEplWinner20252026AllVenueLaneId,
  sportsEplWinner20252026PairLimitlessPolymarketLaneId
} from "./sports-epl-winner-2025-2026-limited-prod-shared.js";

const TOPIC_KEY = "SPORTS|LEAGUE_WINNER|EPL|2025_2026" as const;
const ALL_VENUE_SET = "LIMITLESS|OPINION|POLYMARKET|PREDICT" as const;
const PRIMARY_PAIR_ROUTE = "LIMITLESS|POLYMARKET" as const;

const matcherInputSummaryPath =
  "artifacts/sports/epl-winner-2025-2026-matcher/sports-epl-winner-2025-2026-matcher-input-summary.json";
const matcherPairLanesPath =
  "artifacts/sports/epl-winner-2025-2026-matcher/sports-epl-winner-2025-2026-pair-lanes.json";
const matcherAllVenueLanesPath =
  "artifacts/sports/epl-winner-2025-2026-matcher/sports-epl-winner-2025-2026-all-venue-lanes.json";
const matcherRejectionsPath =
  "artifacts/sports/epl-winner-2025-2026-matcher/sports-epl-winner-2025-2026-rejections.json";
const matcherFinalDecisionPath =
  "artifacts/sports/epl-winner-2025-2026-matcher/sports-epl-winner-2025-2026-final-decision.json";
const matcherOperatorSummaryPath =
  "artifacts/sports/epl-winner-2025-2026-matcher/sports-epl-winner-2025-2026-operator-summary.md";

type SportsLimitedProdReadinessDecision =
  | "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
  | "READY_BUT_MISSING_OPERATOR_REVIEW"
  | "NOT_READY_FOR_LIMITED_PROD";

type SportsEplWinner20252026LimitedProdReadinessLabel =
  | "SPORTS_EPL_WINNER_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
  | "SPORTS_EPL_WINNER_2025_2026_LIMITED_PROD_READY_FOR_REVIEW"
  | "SPORTS_EPL_WINNER_2025_2026_LIMITED_PROD_NOT_APPROVED";

interface MatcherInputSummaryArtifact {
  exactTopic: string;
  refreshedRowsUsed: unknown;
  familyComparabilitySourceArtifacts: Record<string, string>;
  admittedVenues: string[];
  admittedClubs: string[];
}

interface MatcherPairLanesArtifact {
  canonicalTopicKey: string;
  matcherLanes: {
    venuePair: string;
    club: string;
    canonicalTopic: string;
    routeabilityDecision: string;
    rulesDecision: "EXACT_RULE_COMPATIBLE" | "SEMANTICALLY_COMPATIBLE_REWORDING";
    evidenceNotes: string[];
  }[];
}

interface MatcherAllVenueLanesArtifact {
  canonicalTopicKey: string;
  canonicalVenueSet: string;
  matcherLanes: {
    venueSet: string;
    club: string;
    canonicalTopic: string;
    routeabilityDecision: string;
    rulesDecision: "EXACT_RULE_COMPATIBLE" | "SEMANTICALLY_COMPATIBLE_REWORDING";
    evidenceNotes: string[];
  }[];
}

interface MatcherRejectionsArtifact {
  rejections: {
    scope: "club" | "pair_lane" | "all_venue_lane";
    clubIdentityKey?: string | null;
    normalizedClubName?: string | null;
    venuePair?: string | null;
    venueSet?: string | null;
    reason: string;
    notes: string;
  }[];
}

interface MatcherFinalDecisionArtifact {
  overallDecision: string;
  bestPair: string | null;
  bestAllVenueIfAny: string | null;
  pairMatcherReady: boolean;
  allVenueMatcherReady: boolean;
  pairStillPreferred: boolean;
  exactSafePairCandidateCount: number;
  exactSafeAllVenueCandidateCount: number;
  ruleStatus: "EXACT_RULE_COMPATIBLE" | "SEMANTICALLY_COMPATIBLE_REWORDING";
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export interface SportsEplWinner20252026LimitedProdReadinessArtifact {
  observedAt: string;
  laneId: typeof sportsEplWinner20252026AllVenueLaneId;
  topicKey: typeof TOPIC_KEY;
  allVenueSet: typeof ALL_VENUE_SET;
  exactSafeAllVenueClubs: readonly string[];
  peerPairRoute: {
    laneId: typeof sportsEplWinner20252026PairLimitlessPolymarketLaneId;
    venuePair: typeof PRIMARY_PAIR_ROUTE;
    exactSafeClubs: readonly string[];
  };
  ruleStatus: MatcherFinalDecisionArtifact["ruleStatus"];
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
    targetMode: "PAIR_ROUTE_INTERNAL_REVIEW_ONLY";
    fallbackLaneId: typeof sportsEplWinner20252026PairLimitlessPolymarketLaneId;
    operatorSteps: readonly string[];
  };
  exclusionsStillMandatory: readonly string[];
  finalReadinessLabel: SportsEplWinner20252026LimitedProdReadinessLabel;
}

export interface SportsEplWinner20252026PairLimitedProdReadinessArtifact {
  observedAt: string;
  laneId: typeof sportsEplWinner20252026PairLimitlessPolymarketLaneId;
  topicKey: typeof TOPIC_KEY;
  venuePair: typeof PRIMARY_PAIR_ROUTE;
  exactSafeClubs: readonly string[];
  ruleStatus: MatcherFinalDecisionArtifact["ruleStatus"];
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
  finalReadinessLabel: SportsEplWinner20252026LimitedProdReadinessLabel;
}

export interface SportsEplWinner20252026AdminSurfaceSummaryArtifact {
  observedAt: string;
  laneId: typeof sportsEplWinner20252026AllVenueLaneId;
  topicKey: typeof TOPIC_KEY;
  allVenueSet: typeof ALL_VENUE_SET;
  clubScopeHash: string;
  exactSafeAllVenueClubs: readonly string[];
  peerPairLaneId: typeof sportsEplWinner20252026PairLimitlessPolymarketLaneId;
  peerPairVenuePair: typeof PRIMARY_PAIR_ROUTE;
  currentReadinessDecision: SportsLimitedProdReadinessDecision;
  supportedActions: readonly ["inspect", "hold", "promote", "rollback"];
  userConsentCanWidenScope: false;
  narrowestEnforceableUnit: "LANE_SCOPE_LOCK";
  sourceArtifactRefs: readonly string[];
}

export interface SportsEplWinner20252026PairAdminSurfaceSummaryArtifact {
  observedAt: string;
  laneId: typeof sportsEplWinner20252026PairLimitlessPolymarketLaneId;
  topicKey: typeof TOPIC_KEY;
  venuePair: typeof PRIMARY_PAIR_ROUTE;
  clubScopeHash: string;
  exactSafeClubs: readonly string[];
  currentReadinessDecision: SportsLimitedProdReadinessDecision;
  supportedActions: readonly ["inspect", "hold", "promote", "rollback"];
  userConsentCanWidenScope: false;
  narrowestEnforceableUnit: "LANE_SCOPE_LOCK";
  sourceArtifactRefs: readonly string[];
}

export interface SportsEplWinner20252026ReadinessVsMatcherDeltaArtifact {
  observedAt: string;
  laneId: typeof sportsEplWinner20252026AllVenueLaneId;
  matcherTruthConsumed: {
    topicKey: string;
    bestPair: string | null;
    bestAllVenueIfAny: string | null;
    exactSafeAllVenueClubs: readonly string[];
    exactSafePairClubs: readonly string[];
    overallDecision: string;
    allVenueMatcherReady: boolean;
    pairMatcherReady: boolean;
    operatorCredible: boolean;
    ruleStatus: MatcherFinalDecisionArtifact["ruleStatus"];
  };
  readinessConclusionsDerived: {
    finalReadinessLabel: SportsEplWinner20252026LimitedProdReadinessLabel;
    readinessReviewJustified: boolean;
    operatorRuleReviewRequired: boolean;
    rolloutRecommended: false;
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY";
    exactLaneScopeLocked: true;
    peerPairRouteStillExplicit: true;
  };
  intentionallyUnchanged: readonly string[];
  stillBlocked: readonly string[];
}

export interface SportsEplWinner20252026PairReadinessVsMatcherDeltaArtifact {
  observedAt: string;
  laneId: typeof sportsEplWinner20252026PairLimitlessPolymarketLaneId;
  matcherTruthConsumed: {
    topicKey: string;
    bestPair: string | null;
    exactSafePairClubs: readonly string[];
    overallDecision: string;
    pairMatcherReady: boolean;
    operatorCredible: boolean;
    ruleStatus: MatcherFinalDecisionArtifact["ruleStatus"];
  };
  readinessConclusionsDerived: {
    finalReadinessLabel: SportsEplWinner20252026LimitedProdReadinessLabel;
    readinessReviewJustified: boolean;
    operatorRuleReviewRequired: boolean;
    rolloutRecommended: false;
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY";
    exactLaneScopeLocked: true;
  };
  intentionallyUnchanged: readonly string[];
  stillBlocked: readonly string[];
}

export interface SportsEplWinner20252026LimitedProdReadinessArtifacts {
  readiness: SportsEplWinner20252026LimitedProdReadinessArtifact;
  pairReadiness: SportsEplWinner20252026PairLimitedProdReadinessArtifact;
  adminSurfaceSummary: SportsEplWinner20252026AdminSurfaceSummaryArtifact;
  pairAdminSurfaceSummary: SportsEplWinner20252026PairAdminSurfaceSummaryArtifact;
  readinessVsMatcherDelta: SportsEplWinner20252026ReadinessVsMatcherDeltaArtifact;
  pairReadinessVsMatcherDelta: SportsEplWinner20252026PairReadinessVsMatcherDeltaArtifact;
  operatorSummary: string;
  pairOperatorSummary: string;
}

const buildClubScopeHash = (clubs: readonly string[]): string =>
  createHash("sha256")
    .update([...clubs].sort((left, right) => left.localeCompare(right)).join("|"))
    .digest("hex")
    .slice(0, 16);

export const loadSportsEplWinner20252026MatcherArtifacts = (repoRoot: string) => ({
  inputSummary: readArtifact<MatcherInputSummaryArtifact>(repoRoot, matcherInputSummaryPath),
  pairLanes: readArtifact<MatcherPairLanesArtifact>(repoRoot, matcherPairLanesPath),
  allVenueLanes: readArtifact<MatcherAllVenueLanesArtifact>(repoRoot, matcherAllVenueLanesPath),
  rejections: readArtifact<MatcherRejectionsArtifact>(repoRoot, matcherRejectionsPath),
  finalDecision: readArtifact<MatcherFinalDecisionArtifact>(repoRoot, matcherFinalDecisionPath)
});

export const buildSportsEplWinner20252026LimitedProdReadinessArtifacts = (input: {
  inputSummary: MatcherInputSummaryArtifact;
  pairLanes: MatcherPairLanesArtifact;
  allVenueLanes: MatcherAllVenueLanesArtifact;
  rejections: MatcherRejectionsArtifact;
  finalDecision: MatcherFinalDecisionArtifact;
}): SportsEplWinner20252026LimitedProdReadinessArtifacts => {
  const exactSafeAllVenueClubs = input.allVenueLanes.matcherLanes.map((lane) => lane.club);
  const exactSafePairClubs = input.pairLanes.matcherLanes
    .filter((lane) => lane.venuePair === PRIMARY_PAIR_ROUTE)
    .map((lane) => lane.club);

  const allVenueRuleStatus = input.allVenueLanes.matcherLanes[0]?.rulesDecision ?? input.finalDecision.ruleStatus;
  const pairRuleStatus = input.pairLanes.matcherLanes.find((lane) => lane.venuePair === PRIMARY_PAIR_ROUTE)?.rulesDecision ?? input.finalDecision.ruleStatus;
  const allVenueOperatorRuleReviewRequired = allVenueRuleStatus !== "EXACT_RULE_COMPATIBLE";
  const pairOperatorRuleReviewRequired = pairRuleStatus !== "EXACT_RULE_COMPATIBLE";

  const allVenueMatcherReady = input.finalDecision.allVenueMatcherReady && exactSafeAllVenueClubs.length > 0;
  const pairMatcherReady = input.finalDecision.pairMatcherReady && exactSafePairClubs.length > 0;

  const exactAllVenueScopeLocked =
    input.inputSummary.exactTopic === TOPIC_KEY
    && input.finalDecision.bestAllVenueIfAny === ALL_VENUE_SET
    && exactSafeAllVenueClubs.length === 3
    && input.finalDecision.bestPair === PRIMARY_PAIR_ROUTE
    && exactSafePairClubs.length === 6;
  const exactPairScopeLocked =
    input.inputSummary.exactTopic === TOPIC_KEY
    && input.finalDecision.bestPair === PRIMARY_PAIR_ROUTE
    && exactSafePairClubs.length === 6;

  const allVenueReadinessReviewJustified = allVenueMatcherReady && input.finalDecision.operatorCredible && exactAllVenueScopeLocked;
  const pairReadinessReviewJustified = pairMatcherReady && input.finalDecision.operatorCredible && exactPairScopeLocked;

  const allVenueFinalReadinessLabel: SportsEplWinner20252026LimitedProdReadinessLabel =
    !allVenueMatcherReady || !input.finalDecision.operatorCredible || !exactAllVenueScopeLocked
      ? "SPORTS_EPL_WINNER_2025_2026_LIMITED_PROD_NOT_APPROVED"
      : allVenueOperatorRuleReviewRequired
        ? "SPORTS_EPL_WINNER_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
        : "SPORTS_EPL_WINNER_2025_2026_LIMITED_PROD_READY_FOR_REVIEW";
  const pairFinalReadinessLabel: SportsEplWinner20252026LimitedProdReadinessLabel =
    !pairMatcherReady || !input.finalDecision.operatorCredible || !exactPairScopeLocked
      ? "SPORTS_EPL_WINNER_2025_2026_LIMITED_PROD_NOT_APPROVED"
      : pairOperatorRuleReviewRequired
        ? "SPORTS_EPL_WINNER_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
        : "SPORTS_EPL_WINNER_2025_2026_LIMITED_PROD_READY_FOR_REVIEW";

  const commonExclusions = [
    "OTHERS_EXCLUDED",
    "VENUE_ONLY_TAILS_EXCLUDED",
    "NO_SCOPE_WIDENING_BEYOND_EPL_2025_2026",
    "STRICT_ALL_VENUE_CORE_REMAINS_3_CLUBS"
  ] as const;

  const readiness: SportsEplWinner20252026LimitedProdReadinessArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsEplWinner20252026AllVenueLaneId,
    topicKey: TOPIC_KEY,
    allVenueSet: ALL_VENUE_SET,
    exactSafeAllVenueClubs,
    peerPairRoute: {
      laneId: sportsEplWinner20252026PairLimitlessPolymarketLaneId,
      venuePair: PRIMARY_PAIR_ROUTE,
      exactSafeClubs: exactSafePairClubs
    },
    ruleStatus: allVenueRuleStatus,
    operatorRuleReviewRequired: allVenueOperatorRuleReviewRequired,
    matcherReady: allVenueMatcherReady,
    operatorCredible: input.finalDecision.operatorCredible,
    readinessReviewJustified: allVenueReadinessReviewJustified,
    rolloutRecommended: false,
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY",
    holdPolicy: {
      scope: "LANE_ONLY",
      holdConditions: [
        "club_scope_drift",
        "venue_set_drift",
        "rule_status_drift",
        "operator_confidence_lost"
      ],
      userConsentCanWidenScope: false
    },
    rollbackPolicy: {
      scope: "LANE_ONLY",
      targetMode: "PAIR_ROUTE_INTERNAL_REVIEW_ONLY",
      fallbackLaneId: sportsEplWinner20252026PairLimitlessPolymarketLaneId,
      operatorSteps: [
        "Record a lane-scoped rollback or hold event for SPORTS_EPL_WINNER_2025_2026_ALL_VENUE_LIMITLESS_OPINION_POLYMARKET_PREDICT.",
        "Revert this EPL all-venue lane to the peer pair route LIMITLESS|POLYMARKET in internal-review-only posture.",
        "Do not widen beyond the exact 2025_2026 EPL winner topic or beyond the 3-club strict all-venue core during rollback."
      ]
    },
    exclusionsStillMandatory: [
      ...commonExclusions,
      "PAIR_ROUTE_MUST_REMAIN_EXPLICIT"
    ],
    finalReadinessLabel: allVenueFinalReadinessLabel
  };

  const pairReadiness: SportsEplWinner20252026PairLimitedProdReadinessArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsEplWinner20252026PairLimitlessPolymarketLaneId,
    topicKey: TOPIC_KEY,
    venuePair: PRIMARY_PAIR_ROUTE,
    exactSafeClubs: exactSafePairClubs,
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
        "club_scope_drift",
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
        "Record a lane-scoped rollback or hold event for SPORTS_EPL_WINNER_2025_2026_PAIR_LIMITLESS_POLYMARKET.",
        "Keep this EPL pair lane disabled/internal-only until refreshed matcher and readiness artifacts are regenerated.",
        "Do not widen this pair route into the all-venue lane or venue-only club tails during rollback."
      ]
    },
    exclusionsStillMandatory: commonExclusions,
    finalReadinessLabel: pairFinalReadinessLabel
  };

  const sourceArtifactRefs = [
    matcherInputSummaryPath,
    matcherPairLanesPath,
    matcherAllVenueLanesPath,
    matcherRejectionsPath,
    matcherFinalDecisionPath,
    matcherOperatorSummaryPath
  ] as const;

  const adminSurfaceSummary: SportsEplWinner20252026AdminSurfaceSummaryArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsEplWinner20252026AllVenueLaneId,
    topicKey: TOPIC_KEY,
    allVenueSet: ALL_VENUE_SET,
    clubScopeHash: buildClubScopeHash(exactSafeAllVenueClubs),
    exactSafeAllVenueClubs,
    peerPairLaneId: sportsEplWinner20252026PairLimitlessPolymarketLaneId,
    peerPairVenuePair: PRIMARY_PAIR_ROUTE,
    currentReadinessDecision: allVenueReadinessReviewJustified
      ? "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
      : allVenueMatcherReady
        ? "READY_BUT_MISSING_OPERATOR_REVIEW"
        : "NOT_READY_FOR_LIMITED_PROD",
    supportedActions: ["inspect", "hold", "promote", "rollback"],
    userConsentCanWidenScope: false,
    narrowestEnforceableUnit: "LANE_SCOPE_LOCK",
    sourceArtifactRefs
  };

  const pairAdminSurfaceSummary: SportsEplWinner20252026PairAdminSurfaceSummaryArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsEplWinner20252026PairLimitlessPolymarketLaneId,
    topicKey: TOPIC_KEY,
    venuePair: PRIMARY_PAIR_ROUTE,
    clubScopeHash: buildClubScopeHash(exactSafePairClubs),
    exactSafeClubs: exactSafePairClubs,
    currentReadinessDecision: pairReadinessReviewJustified
      ? "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
      : pairMatcherReady
        ? "READY_BUT_MISSING_OPERATOR_REVIEW"
        : "NOT_READY_FOR_LIMITED_PROD",
    supportedActions: ["inspect", "hold", "promote", "rollback"],
    userConsentCanWidenScope: false,
    narrowestEnforceableUnit: "LANE_SCOPE_LOCK",
    sourceArtifactRefs
  };

  const readinessVsMatcherDelta: SportsEplWinner20252026ReadinessVsMatcherDeltaArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsEplWinner20252026AllVenueLaneId,
    matcherTruthConsumed: {
      topicKey: TOPIC_KEY,
      bestPair: input.finalDecision.bestPair,
      bestAllVenueIfAny: input.finalDecision.bestAllVenueIfAny,
      exactSafeAllVenueClubs,
      exactSafePairClubs,
      overallDecision: input.finalDecision.overallDecision,
      allVenueMatcherReady: input.finalDecision.allVenueMatcherReady,
      pairMatcherReady: input.finalDecision.pairMatcherReady,
      operatorCredible: input.finalDecision.operatorCredible,
      ruleStatus: allVenueRuleStatus
    },
    readinessConclusionsDerived: {
      finalReadinessLabel: allVenueFinalReadinessLabel,
      readinessReviewJustified: allVenueReadinessReviewJustified,
      operatorRuleReviewRequired: allVenueOperatorRuleReviewRequired,
      rolloutRecommended: false,
      recommendedMode: "LIMITED_PROD_REVIEW_ONLY",
      exactLaneScopeLocked: true,
      peerPairRouteStillExplicit: true
    },
    intentionallyUnchanged: [
      "matcher logic unchanged",
      "strict 3-club all-venue core unchanged",
      "no rollout activation"
    ],
    stillBlocked: allVenueOperatorRuleReviewRequired ? ["operator_rule_review_required"] : []
  };

  const pairReadinessVsMatcherDelta: SportsEplWinner20252026PairReadinessVsMatcherDeltaArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsEplWinner20252026PairLimitlessPolymarketLaneId,
    matcherTruthConsumed: {
      topicKey: TOPIC_KEY,
      bestPair: input.finalDecision.bestPair,
      exactSafePairClubs,
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
      "shared 6-club pair scope unchanged",
      "no rollout activation"
    ],
    stillBlocked: pairOperatorRuleReviewRequired ? ["operator_rule_review_required"] : []
  };

  const operatorSummary = [
    "# EPL Winner 2025-2026 Limited-Prod Readiness",
    "",
    `- exact topic: ${TOPIC_KEY}`,
    `- exact all-venue set: ${ALL_VENUE_SET}`,
    `- exact-safe all-venue clubs: ${exactSafeAllVenueClubs.join(", ") || "none"}`,
    `- peer pair route: ${PRIMARY_PAIR_ROUTE} -> ${exactSafePairClubs.join(", ") || "none"}`,
    `- rule state: ${allVenueRuleStatus}`,
    `- operator rule review required: ${allVenueOperatorRuleReviewRequired ? "yes" : "no"}`,
    `- readiness label: ${allVenueFinalReadinessLabel}`,
    "- recommended operator action: keep the all-venue lane review-gated and preserve LIMITLESS|POLYMARKET as a separate pair route.",
    `- rollback boundary: lane-scoped rollback to pair route ${sportsEplWinner20252026PairLimitlessPolymarketLaneId}`,
    "- exclusions still mandatory: Other, venue-only tails, and any widening beyond the strict 3-club all-venue core."
  ].join("\n");

  const pairOperatorSummary = [
    "# EPL Winner 2025-2026 Pair Limited-Prod Readiness",
    "",
    `- exact topic: ${TOPIC_KEY}`,
    `- exact pair venue: ${PRIMARY_PAIR_ROUTE}`,
    `- exact-safe pair clubs: ${exactSafePairClubs.join(", ") || "none"}`,
    `- rule state: ${pairRuleStatus}`,
    `- operator rule review required: ${pairOperatorRuleReviewRequired ? "yes" : "no"}`,
    `- readiness label: ${pairFinalReadinessLabel}`,
    "- recommended operator action: keep the pair lane separately available for users who do not want the all-venue route.",
    "- rollback boundary: lane-scoped rollback to disabled/internal-only."
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

export const writeSportsEplWinner20252026LimitedProdReadinessArtifacts = (input: {
  repoRoot: string;
  inputSummary: MatcherInputSummaryArtifact;
  pairLanes: MatcherPairLanesArtifact;
  allVenueLanes: MatcherAllVenueLanesArtifact;
  rejections: MatcherRejectionsArtifact;
  finalDecision: MatcherFinalDecisionArtifact;
}): SportsEplWinner20252026LimitedProdReadinessArtifacts => {
  const artifacts = buildSportsEplWinner20252026LimitedProdReadinessArtifacts(input);

  writeArtifact(input.repoRoot, "artifacts/sports/core/sports-epl-winner-2025-2026-limited-prod-readiness.json", artifacts.readiness);
  writeArtifact(input.repoRoot, "artifacts/sports/core/sports-epl-winner-2025-2026-admin-surface-summary.json", artifacts.adminSurfaceSummary);
  writeArtifact(input.repoRoot, "artifacts/sports/core/sports-epl-winner-2025-2026-pair-limited-prod-readiness.json", artifacts.pairReadiness);
  writeArtifact(input.repoRoot, "artifacts/sports/core/sports-epl-winner-2025-2026-pair-admin-surface-summary.json", artifacts.pairAdminSurfaceSummary);
  writeArtifact(input.repoRoot, "artifacts/sports/core/sports-epl-winner-2025-2026-readiness-vs-matcher-delta.json", artifacts.readinessVsMatcherDelta);
  writeArtifact(input.repoRoot, "artifacts/sports/core/sports-epl-winner-2025-2026-pair-readiness-vs-matcher-delta.json", artifacts.pairReadinessVsMatcherDelta);
  writeMarkdownArtifact(input.repoRoot, "docs/generated/sports/sports-epl-winner-2025-2026-lane-operator-summary.md", `${artifacts.operatorSummary}\n\n${artifacts.pairOperatorSummary}\n`);

  return artifacts;
};
