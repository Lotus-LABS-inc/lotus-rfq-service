import { createHash } from "node:crypto";

import { readArtifact, writeArtifact, writeMarkdownArtifact } from "./shared.js";
import {
  sportsWorldCupWinner2026AllVenueLaneId,
  sportsWorldCupWinner2026PairLimitlessPolymarketLaneId
} from "./sports-world-cup-winner-2026-limited-prod-shared.js";

const TOPIC_KEY = "SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026" as const;
const ALL_VENUE_SET = "LIMITLESS|OPINION|POLYMARKET|PREDICT" as const;
const PRIMARY_PAIR_ROUTE = "LIMITLESS|POLYMARKET" as const;

const matcherInputSummaryPath =
  "artifacts/sports/world-cup-winner-2026-matcher/sports-world-cup-winner-2026-matcher-input-summary.json";
const matcherPairLanesPath =
  "artifacts/sports/world-cup-winner-2026-matcher/sports-world-cup-winner-2026-pair-lanes.json";
const matcherAllVenueLanesPath =
  "artifacts/sports/world-cup-winner-2026-matcher/sports-world-cup-winner-2026-all-venue-lanes.json";
const matcherRejectionsPath =
  "artifacts/sports/world-cup-winner-2026-matcher/sports-world-cup-winner-2026-rejections.json";
const matcherFinalDecisionPath =
  "artifacts/sports/world-cup-winner-2026-matcher/sports-world-cup-winner-2026-final-decision.json";
const matcherOperatorSummaryPath =
  "artifacts/sports/world-cup-winner-2026-matcher/sports-world-cup-winner-2026-operator-summary.md";

type SportsLimitedProdReadinessDecision =
  | "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
  | "READY_BUT_MISSING_OPERATOR_REVIEW"
  | "NOT_READY_FOR_LIMITED_PROD";

type SportsWorldCupWinner2026LimitedProdReadinessLabel =
  | "SPORTS_WORLD_CUP_WINNER_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
  | "SPORTS_WORLD_CUP_WINNER_2026_LIMITED_PROD_READY_FOR_REVIEW"
  | "SPORTS_WORLD_CUP_WINNER_2026_LIMITED_PROD_NOT_APPROVED";

interface MatcherInputSummaryArtifact {
  exactTopic: string;
  refreshedRowsUsed: unknown;
  familyComparabilitySourceArtifacts: Record<string, string>;
  admittedVenues: string[];
  admittedTeams: string[];
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
    scope: "team" | "pair_lane" | "all_venue_lane";
    teamIdentityKey?: string | null;
    normalizedTeamName?: string | null;
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

export interface SportsWorldCupWinner2026LimitedProdReadinessArtifact {
  observedAt: string;
  laneId: typeof sportsWorldCupWinner2026AllVenueLaneId;
  topicKey: typeof TOPIC_KEY;
  allVenueSet: typeof ALL_VENUE_SET;
  exactSafeAllVenueTeams: readonly string[];
  peerPairRoute: {
    laneId: typeof sportsWorldCupWinner2026PairLimitlessPolymarketLaneId;
    venuePair: typeof PRIMARY_PAIR_ROUTE;
    exactSafeTeams: readonly string[];
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
    fallbackLaneId: typeof sportsWorldCupWinner2026PairLimitlessPolymarketLaneId;
    operatorSteps: readonly string[];
  };
  exclusionsStillMandatory: readonly string[];
  finalReadinessLabel: SportsWorldCupWinner2026LimitedProdReadinessLabel;
}

export interface SportsWorldCupWinner2026PairLimitedProdReadinessArtifact {
  observedAt: string;
  laneId: typeof sportsWorldCupWinner2026PairLimitlessPolymarketLaneId;
  topicKey: typeof TOPIC_KEY;
  venuePair: typeof PRIMARY_PAIR_ROUTE;
  exactSafeTeams: readonly string[];
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
  finalReadinessLabel: SportsWorldCupWinner2026LimitedProdReadinessLabel;
}

export interface SportsWorldCupWinner2026AdminSurfaceSummaryArtifact {
  observedAt: string;
  laneId: typeof sportsWorldCupWinner2026AllVenueLaneId;
  topicKey: typeof TOPIC_KEY;
  allVenueSet: typeof ALL_VENUE_SET;
  teamScopeHash: string;
  exactSafeAllVenueTeams: readonly string[];
  peerPairLaneId: typeof sportsWorldCupWinner2026PairLimitlessPolymarketLaneId;
  peerPairVenuePair: typeof PRIMARY_PAIR_ROUTE;
  currentReadinessDecision: SportsLimitedProdReadinessDecision;
  supportedActions: readonly ["inspect", "hold", "promote", "rollback"];
  userConsentCanWidenScope: false;
  narrowestEnforceableUnit: "LANE_SCOPE_LOCK";
  sourceArtifactRefs: readonly string[];
}

export interface SportsWorldCupWinner2026PairAdminSurfaceSummaryArtifact {
  observedAt: string;
  laneId: typeof sportsWorldCupWinner2026PairLimitlessPolymarketLaneId;
  topicKey: typeof TOPIC_KEY;
  venuePair: typeof PRIMARY_PAIR_ROUTE;
  teamScopeHash: string;
  exactSafeTeams: readonly string[];
  currentReadinessDecision: SportsLimitedProdReadinessDecision;
  supportedActions: readonly ["inspect", "hold", "promote", "rollback"];
  userConsentCanWidenScope: false;
  narrowestEnforceableUnit: "LANE_SCOPE_LOCK";
  sourceArtifactRefs: readonly string[];
}

export interface SportsWorldCupWinner2026ReadinessVsMatcherDeltaArtifact {
  observedAt: string;
  laneId: typeof sportsWorldCupWinner2026AllVenueLaneId;
  matcherTruthConsumed: {
    topicKey: string;
    bestPair: string | null;
    bestAllVenueIfAny: string | null;
    exactSafeAllVenueTeams: readonly string[];
    exactSafePairTeams: readonly string[];
    overallDecision: string;
    allVenueMatcherReady: boolean;
    pairMatcherReady: boolean;
    operatorCredible: boolean;
    ruleStatus: MatcherFinalDecisionArtifact["ruleStatus"];
  };
  readinessConclusionsDerived: {
    finalReadinessLabel: SportsWorldCupWinner2026LimitedProdReadinessLabel;
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

export interface SportsWorldCupWinner2026PairReadinessVsMatcherDeltaArtifact {
  observedAt: string;
  laneId: typeof sportsWorldCupWinner2026PairLimitlessPolymarketLaneId;
  matcherTruthConsumed: {
    topicKey: string;
    bestPair: string | null;
    exactSafePairTeams: readonly string[];
    overallDecision: string;
    pairMatcherReady: boolean;
    operatorCredible: boolean;
    ruleStatus: MatcherFinalDecisionArtifact["ruleStatus"];
  };
  readinessConclusionsDerived: {
    finalReadinessLabel: SportsWorldCupWinner2026LimitedProdReadinessLabel;
    readinessReviewJustified: boolean;
    operatorRuleReviewRequired: boolean;
    rolloutRecommended: false;
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY";
    exactLaneScopeLocked: true;
  };
  intentionallyUnchanged: readonly string[];
  stillBlocked: readonly string[];
}

export interface SportsWorldCupWinner2026LimitedProdReadinessArtifacts {
  readiness: SportsWorldCupWinner2026LimitedProdReadinessArtifact;
  pairReadiness: SportsWorldCupWinner2026PairLimitedProdReadinessArtifact;
  adminSurfaceSummary: SportsWorldCupWinner2026AdminSurfaceSummaryArtifact;
  pairAdminSurfaceSummary: SportsWorldCupWinner2026PairAdminSurfaceSummaryArtifact;
  readinessVsMatcherDelta: SportsWorldCupWinner2026ReadinessVsMatcherDeltaArtifact;
  pairReadinessVsMatcherDelta: SportsWorldCupWinner2026PairReadinessVsMatcherDeltaArtifact;
  operatorSummary: string;
  pairOperatorSummary: string;
}

const buildTeamScopeHash = (teams: readonly string[]): string =>
  createHash("sha256")
    .update([...teams].sort((left, right) => left.localeCompare(right)).join("|"))
    .digest("hex")
    .slice(0, 16);

export const loadSportsWorldCupWinner2026MatcherArtifacts = (repoRoot: string) => ({
  inputSummary: readArtifact<MatcherInputSummaryArtifact>(repoRoot, matcherInputSummaryPath),
  pairLanes: readArtifact<MatcherPairLanesArtifact>(repoRoot, matcherPairLanesPath),
  allVenueLanes: readArtifact<MatcherAllVenueLanesArtifact>(repoRoot, matcherAllVenueLanesPath),
  rejections: readArtifact<MatcherRejectionsArtifact>(repoRoot, matcherRejectionsPath),
  finalDecision: readArtifact<MatcherFinalDecisionArtifact>(repoRoot, matcherFinalDecisionPath)
});

export const buildSportsWorldCupWinner2026LimitedProdReadinessArtifacts = (input: {
  inputSummary: MatcherInputSummaryArtifact;
  pairLanes: MatcherPairLanesArtifact;
  allVenueLanes: MatcherAllVenueLanesArtifact;
  rejections: MatcherRejectionsArtifact;
  finalDecision: MatcherFinalDecisionArtifact;
}): SportsWorldCupWinner2026LimitedProdReadinessArtifacts => {
  const exactSafeAllVenueTeams = input.allVenueLanes.matcherLanes.map((lane) => lane.club);
  const exactSafePairTeams = input.pairLanes.matcherLanes
    .filter((lane) => lane.venuePair === PRIMARY_PAIR_ROUTE)
    .map((lane) => lane.club);

  const allVenueRuleStatus = input.allVenueLanes.matcherLanes[0]?.rulesDecision ?? input.finalDecision.ruleStatus;
  const pairRuleStatus =
    input.pairLanes.matcherLanes.find((lane) => lane.venuePair === PRIMARY_PAIR_ROUTE)?.rulesDecision
    ?? input.finalDecision.ruleStatus;
  const allVenueOperatorRuleReviewRequired = allVenueRuleStatus !== "EXACT_RULE_COMPATIBLE";
  const pairOperatorRuleReviewRequired = pairRuleStatus !== "EXACT_RULE_COMPATIBLE";

  const allVenueMatcherReady = input.finalDecision.allVenueMatcherReady && exactSafeAllVenueTeams.length > 0;
  const pairMatcherReady = input.finalDecision.pairMatcherReady && exactSafePairTeams.length > 0;

  const exactAllVenueScopeLocked =
    input.inputSummary.exactTopic === TOPIC_KEY
    && input.finalDecision.bestAllVenueIfAny === ALL_VENUE_SET
    && exactSafeAllVenueTeams.length === 4
    && input.finalDecision.bestPair === PRIMARY_PAIR_ROUTE
    && exactSafePairTeams.length === 14;
  const exactPairScopeLocked =
    input.inputSummary.exactTopic === TOPIC_KEY
    && input.finalDecision.bestPair === PRIMARY_PAIR_ROUTE
    && exactSafePairTeams.length === 14;

  const allVenueReadinessReviewJustified =
    allVenueMatcherReady && input.finalDecision.operatorCredible && exactAllVenueScopeLocked;
  const pairReadinessReviewJustified =
    pairMatcherReady && input.finalDecision.operatorCredible && exactPairScopeLocked;

  const allVenueFinalReadinessLabel: SportsWorldCupWinner2026LimitedProdReadinessLabel =
    !allVenueMatcherReady || !input.finalDecision.operatorCredible || !exactAllVenueScopeLocked
      ? "SPORTS_WORLD_CUP_WINNER_2026_LIMITED_PROD_NOT_APPROVED"
      : allVenueOperatorRuleReviewRequired
        ? "SPORTS_WORLD_CUP_WINNER_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
        : "SPORTS_WORLD_CUP_WINNER_2026_LIMITED_PROD_READY_FOR_REVIEW";

  const pairFinalReadinessLabel: SportsWorldCupWinner2026LimitedProdReadinessLabel =
    !pairMatcherReady || !input.finalDecision.operatorCredible || !exactPairScopeLocked
      ? "SPORTS_WORLD_CUP_WINNER_2026_LIMITED_PROD_NOT_APPROVED"
      : pairOperatorRuleReviewRequired
        ? "SPORTS_WORLD_CUP_WINNER_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
        : "SPORTS_WORLD_CUP_WINNER_2026_LIMITED_PROD_READY_FOR_REVIEW";

  const commonExclusions = [
    "OTHERS_EXCLUDED",
    "VENUE_ONLY_TAILS_EXCLUDED",
    "NO_SCOPE_WIDENING_BEYOND_FIFA_WORLD_CUP_2026",
    "STRICT_ALL_VENUE_CORE_REMAINS_4_TEAMS"
  ] as const;

  const sourceArtifactRefs = [
    matcherInputSummaryPath,
    matcherPairLanesPath,
    matcherAllVenueLanesPath,
    matcherRejectionsPath,
    matcherFinalDecisionPath,
    matcherOperatorSummaryPath
  ] as const;

  const readiness: SportsWorldCupWinner2026LimitedProdReadinessArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsWorldCupWinner2026AllVenueLaneId,
    topicKey: TOPIC_KEY,
    allVenueSet: ALL_VENUE_SET,
    exactSafeAllVenueTeams,
    peerPairRoute: {
      laneId: sportsWorldCupWinner2026PairLimitlessPolymarketLaneId,
      venuePair: PRIMARY_PAIR_ROUTE,
      exactSafeTeams: exactSafePairTeams
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
        "Any drift in the strict all-venue 4-team World Cup core",
        "Any venue withdrawal from LIMITLESS|OPINION|POLYMARKET|PREDICT",
        "Any rule-compatibility downgrade beyond semantically compatible rewording"
      ],
      userConsentCanWidenScope: false
    },
    rollbackPolicy: {
      scope: "LANE_ONLY",
      targetMode: "PAIR_ROUTE_INTERNAL_REVIEW_ONLY",
      fallbackLaneId: sportsWorldCupWinner2026PairLimitlessPolymarketLaneId,
      operatorSteps: [
        "Hold the strict all-venue lane only.",
        "Leave LIMITLESS|POLYMARKET explicit as the narrower World Cup route.",
        "Do not widen beyond the exact 4-team strict all-venue core during rollback."
      ]
    },
    exclusionsStillMandatory: commonExclusions,
    finalReadinessLabel: allVenueFinalReadinessLabel
  };

  const pairReadiness: SportsWorldCupWinner2026PairLimitedProdReadinessArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsWorldCupWinner2026PairLimitlessPolymarketLaneId,
    topicKey: TOPIC_KEY,
    venuePair: PRIMARY_PAIR_ROUTE,
    exactSafeTeams: exactSafePairTeams,
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
        "Any drift in the LIMITLESS|POLYMARKET World Cup shared team core",
        "Any venue withdrawal from the exact pair lane",
        "Any rule-compatibility downgrade beyond semantically compatible rewording"
      ],
      userConsentCanWidenScope: false
    },
    rollbackPolicy: {
      scope: "LANE_ONLY",
      targetMode: "DISABLED_INTERNAL_ONLY",
      fallbackLaneId: null,
      operatorSteps: [
        "Hold the pair lane only.",
        "Do not widen beyond the exact LIMITLESS|POLYMARKET 14-team scope."
      ]
    },
    exclusionsStillMandatory: commonExclusions,
    finalReadinessLabel: pairFinalReadinessLabel
  };

  const readinessDecision: SportsLimitedProdReadinessDecision =
    !allVenueMatcherReady || !input.finalDecision.operatorCredible || !exactAllVenueScopeLocked
      ? "NOT_READY_FOR_LIMITED_PROD"
      : allVenueOperatorRuleReviewRequired
        ? "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
        : "READY_BUT_MISSING_OPERATOR_REVIEW";

  const pairDecision: SportsLimitedProdReadinessDecision =
    !pairMatcherReady || !input.finalDecision.operatorCredible || !exactPairScopeLocked
      ? "NOT_READY_FOR_LIMITED_PROD"
      : pairOperatorRuleReviewRequired
        ? "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
        : "READY_BUT_MISSING_OPERATOR_REVIEW";

  const adminSurfaceSummary: SportsWorldCupWinner2026AdminSurfaceSummaryArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsWorldCupWinner2026AllVenueLaneId,
    topicKey: TOPIC_KEY,
    allVenueSet: ALL_VENUE_SET,
    teamScopeHash: buildTeamScopeHash(exactSafeAllVenueTeams),
    exactSafeAllVenueTeams,
    peerPairLaneId: sportsWorldCupWinner2026PairLimitlessPolymarketLaneId,
    peerPairVenuePair: PRIMARY_PAIR_ROUTE,
    currentReadinessDecision: readinessDecision,
    supportedActions: ["inspect", "hold", "promote", "rollback"],
    userConsentCanWidenScope: false,
    narrowestEnforceableUnit: "LANE_SCOPE_LOCK",
    sourceArtifactRefs
  };

  const pairAdminSurfaceSummary: SportsWorldCupWinner2026PairAdminSurfaceSummaryArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsWorldCupWinner2026PairLimitlessPolymarketLaneId,
    topicKey: TOPIC_KEY,
    venuePair: PRIMARY_PAIR_ROUTE,
    teamScopeHash: buildTeamScopeHash(exactSafePairTeams),
    exactSafeTeams: exactSafePairTeams,
    currentReadinessDecision: pairDecision,
    supportedActions: ["inspect", "hold", "promote", "rollback"],
    userConsentCanWidenScope: false,
    narrowestEnforceableUnit: "LANE_SCOPE_LOCK",
    sourceArtifactRefs
  };

  const readinessVsMatcherDelta: SportsWorldCupWinner2026ReadinessVsMatcherDeltaArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsWorldCupWinner2026AllVenueLaneId,
    matcherTruthConsumed: {
      topicKey: TOPIC_KEY,
      bestPair: input.finalDecision.bestPair,
      bestAllVenueIfAny: input.finalDecision.bestAllVenueIfAny,
      exactSafeAllVenueTeams,
      exactSafePairTeams,
      overallDecision: input.finalDecision.overallDecision,
      allVenueMatcherReady: input.finalDecision.allVenueMatcherReady,
      pairMatcherReady: input.finalDecision.pairMatcherReady,
      operatorCredible: input.finalDecision.operatorCredible,
      ruleStatus: input.finalDecision.ruleStatus
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
      "No widening beyond FIFA World Cup 2026",
      "No venue-only tails admitted into strict all-venue lane",
      "No automatic promotion implied"
    ],
    stillBlocked: allVenueOperatorRuleReviewRequired
      ? ["Operator rule review still required before production promotion."]
      : []
  };

  const pairReadinessVsMatcherDelta: SportsWorldCupWinner2026PairReadinessVsMatcherDeltaArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsWorldCupWinner2026PairLimitlessPolymarketLaneId,
    matcherTruthConsumed: {
      topicKey: TOPIC_KEY,
      bestPair: input.finalDecision.bestPair,
      exactSafePairTeams,
      overallDecision: input.finalDecision.overallDecision,
      pairMatcherReady: input.finalDecision.pairMatcherReady,
      operatorCredible: input.finalDecision.operatorCredible,
      ruleStatus: input.finalDecision.ruleStatus
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
      "No widening beyond LIMITLESS|POLYMARKET",
      "No venue-only tails admitted into pair lane",
      "No automatic promotion implied"
    ],
    stillBlocked: pairOperatorRuleReviewRequired
      ? ["Operator rule review still required before production promotion."]
      : []
  };

  const operatorSummary = [
    "# World Cup Winner 2026 Limited-Prod Readiness",
    "",
    `- topic: ${TOPIC_KEY}`,
    `- strict all-venue lane id: ${sportsWorldCupWinner2026AllVenueLaneId}`,
    `- strict all-venue teams: ${exactSafeAllVenueTeams.join(", ") || "none"}`,
    `- strict all-venue readiness label: ${allVenueFinalReadinessLabel}`,
    `- peer pair lane id: ${sportsWorldCupWinner2026PairLimitlessPolymarketLaneId}`,
    `- peer pair teams: ${exactSafePairTeams.join(", ") || "none"}`,
    `- pair route stays explicit: yes`,
    `- rule status: ${input.finalDecision.ruleStatus}`,
    `- operator rule review required: ${allVenueOperatorRuleReviewRequired ? "yes" : "no"}`,
    "- no widening beyond the exact World Cup 2026 topic"
  ].join("\n");

  const pairOperatorSummary = [
    "# World Cup Winner 2026 Pair Readiness",
    "",
    `- topic: ${TOPIC_KEY}`,
    `- pair lane id: ${sportsWorldCupWinner2026PairLimitlessPolymarketLaneId}`,
    `- pair teams: ${exactSafePairTeams.join(", ") || "none"}`,
    `- readiness label: ${pairFinalReadinessLabel}`,
    `- rule status: ${pairRuleStatus}`,
    `- operator rule review required: ${pairOperatorRuleReviewRequired ? "yes" : "no"}`,
    "- no widening beyond LIMITLESS|POLYMARKET"
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

export const writeSportsWorldCupWinner2026LimitedProdReadinessArtifacts = (input: {
  repoRoot: string;
  inputSummary: MatcherInputSummaryArtifact;
  pairLanes: MatcherPairLanesArtifact;
  allVenueLanes: MatcherAllVenueLanesArtifact;
  rejections: MatcherRejectionsArtifact;
  finalDecision: MatcherFinalDecisionArtifact;
}): SportsWorldCupWinner2026LimitedProdReadinessArtifacts => {
  const artifacts = buildSportsWorldCupWinner2026LimitedProdReadinessArtifacts(input);

  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-world-cup-winner-2026-limited-prod-readiness.json",
    artifacts.readiness
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-world-cup-winner-2026-pair-limited-prod-readiness.json",
    artifacts.pairReadiness
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-world-cup-winner-2026-admin-surface-summary.json",
    artifacts.adminSurfaceSummary
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-world-cup-winner-2026-pair-admin-surface-summary.json",
    artifacts.pairAdminSurfaceSummary
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-world-cup-winner-2026-readiness-vs-matcher-delta.json",
    artifacts.readinessVsMatcherDelta
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-world-cup-winner-2026-pair-readiness-vs-matcher-delta.json",
    artifacts.pairReadinessVsMatcherDelta
  );
  writeMarkdownArtifact(
    input.repoRoot,
    "docs/generated/sports/sports-world-cup-winner-2026-lane-operator-summary.md",
    `${artifacts.operatorSummary}\n`
  );
  writeMarkdownArtifact(
    input.repoRoot,
    "docs/generated/sports/sports-world-cup-winner-2026-pair-lane-operator-summary.md",
    `${artifacts.pairOperatorSummary}\n`
  );

  return artifacts;
};
