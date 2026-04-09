import { createHash } from "node:crypto";

import { readArtifact, writeArtifact, writeMarkdownArtifact } from "./shared.js";
import {
  sportsNbaChampion20252026AllVenueLaneId,
  sportsNbaChampion20252026PairPolymarketPredictLaneId
} from "./sports-nba-champion-2025-2026-limited-prod-shared.js";

const TOPIC_KEY = "SPORTS|TOURNAMENT_WINNER|NBA|2025_2026" as const;
const ALL_VENUE_SET = "LIMITLESS|OPINION|POLYMARKET|PREDICT" as const;
const PRIMARY_PAIR_ROUTE = "POLYMARKET|PREDICT" as const;

const matcherInputSummaryPath =
  "artifacts/sports/nba-champion-2025-2026-matcher/sports-nba-champion-2025-2026-matcher-input-summary.json";
const matcherPairLanesPath =
  "artifacts/sports/nba-champion-2025-2026-matcher/sports-nba-champion-2025-2026-pair-lanes.json";
const matcherAllVenueLanesPath =
  "artifacts/sports/nba-champion-2025-2026-matcher/sports-nba-champion-2025-2026-all-venue-lanes.json";
const matcherRejectionsPath =
  "artifacts/sports/nba-champion-2025-2026-matcher/sports-nba-champion-2025-2026-rejections.json";
const matcherFinalDecisionPath =
  "artifacts/sports/nba-champion-2025-2026-matcher/sports-nba-champion-2025-2026-final-decision.json";
const matcherOperatorSummaryPath =
  "artifacts/sports/nba-champion-2025-2026-matcher/sports-nba-champion-2025-2026-operator-summary.md";

type SportsLimitedProdReadinessDecision =
  | "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
  | "READY_BUT_MISSING_OPERATOR_REVIEW"
  | "NOT_READY_FOR_LIMITED_PROD";

type SportsNbaChampion20252026LimitedProdReadinessLabel =
  | "SPORTS_NBA_CHAMPION_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
  | "SPORTS_NBA_CHAMPION_2025_2026_LIMITED_PROD_READY_FOR_REVIEW"
  | "SPORTS_NBA_CHAMPION_2025_2026_LIMITED_PROD_NOT_APPROVED";

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

export interface SportsNbaChampion20252026LimitedProdReadinessArtifact {
  observedAt: string;
  laneId: typeof sportsNbaChampion20252026AllVenueLaneId;
  topicKey: typeof TOPIC_KEY;
  allVenueSet: typeof ALL_VENUE_SET;
  exactSafeAllVenueTeams: readonly string[];
  peerPairRoute: {
    laneId: typeof sportsNbaChampion20252026PairPolymarketPredictLaneId;
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
    fallbackLaneId: typeof sportsNbaChampion20252026PairPolymarketPredictLaneId;
    operatorSteps: readonly string[];
  };
  exclusionsStillMandatory: readonly string[];
  finalReadinessLabel: SportsNbaChampion20252026LimitedProdReadinessLabel;
}

export interface SportsNbaChampion20252026PairLimitedProdReadinessArtifact {
  observedAt: string;
  laneId: typeof sportsNbaChampion20252026PairPolymarketPredictLaneId;
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
  finalReadinessLabel: SportsNbaChampion20252026LimitedProdReadinessLabel;
}

export interface SportsNbaChampion20252026AdminSurfaceSummaryArtifact {
  observedAt: string;
  laneId: typeof sportsNbaChampion20252026AllVenueLaneId;
  topicKey: typeof TOPIC_KEY;
  allVenueSet: typeof ALL_VENUE_SET;
  teamScopeHash: string;
  exactSafeAllVenueTeams: readonly string[];
  peerPairLaneId: typeof sportsNbaChampion20252026PairPolymarketPredictLaneId;
  peerPairVenuePair: typeof PRIMARY_PAIR_ROUTE;
  currentReadinessDecision: SportsLimitedProdReadinessDecision;
  supportedActions: readonly ["inspect", "hold", "promote", "rollback"];
  userConsentCanWidenScope: false;
  narrowestEnforceableUnit: "LANE_SCOPE_LOCK";
  sourceArtifactRefs: readonly string[];
}

export interface SportsNbaChampion20252026PairAdminSurfaceSummaryArtifact {
  observedAt: string;
  laneId: typeof sportsNbaChampion20252026PairPolymarketPredictLaneId;
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

export interface SportsNbaChampion20252026ReadinessVsMatcherDeltaArtifact {
  observedAt: string;
  laneId: typeof sportsNbaChampion20252026AllVenueLaneId;
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
    finalReadinessLabel: SportsNbaChampion20252026LimitedProdReadinessLabel;
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

export interface SportsNbaChampion20252026PairReadinessVsMatcherDeltaArtifact {
  observedAt: string;
  laneId: typeof sportsNbaChampion20252026PairPolymarketPredictLaneId;
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
    finalReadinessLabel: SportsNbaChampion20252026LimitedProdReadinessLabel;
    readinessReviewJustified: boolean;
    operatorRuleReviewRequired: boolean;
    rolloutRecommended: false;
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY";
    exactLaneScopeLocked: true;
  };
  intentionallyUnchanged: readonly string[];
  stillBlocked: readonly string[];
}

export interface SportsNbaChampion20252026LimitedProdReadinessArtifacts {
  readiness: SportsNbaChampion20252026LimitedProdReadinessArtifact;
  pairReadiness: SportsNbaChampion20252026PairLimitedProdReadinessArtifact;
  adminSurfaceSummary: SportsNbaChampion20252026AdminSurfaceSummaryArtifact;
  pairAdminSurfaceSummary: SportsNbaChampion20252026PairAdminSurfaceSummaryArtifact;
  readinessVsMatcherDelta: SportsNbaChampion20252026ReadinessVsMatcherDeltaArtifact;
  pairReadinessVsMatcherDelta: SportsNbaChampion20252026PairReadinessVsMatcherDeltaArtifact;
  operatorSummary: string;
  pairOperatorSummary: string;
}

const buildTeamScopeHash = (teams: readonly string[]): string =>
  createHash("sha256")
    .update([...teams].sort((left, right) => left.localeCompare(right)).join("|"))
    .digest("hex")
    .slice(0, 16);

export const loadSportsNbaChampion20252026MatcherArtifacts = (repoRoot: string) => ({
  inputSummary: readArtifact<MatcherInputSummaryArtifact>(repoRoot, matcherInputSummaryPath),
  pairLanes: readArtifact<MatcherPairLanesArtifact>(repoRoot, matcherPairLanesPath),
  allVenueLanes: readArtifact<MatcherAllVenueLanesArtifact>(repoRoot, matcherAllVenueLanesPath),
  rejections: readArtifact<MatcherRejectionsArtifact>(repoRoot, matcherRejectionsPath),
  finalDecision: readArtifact<MatcherFinalDecisionArtifact>(repoRoot, matcherFinalDecisionPath)
});

export const buildSportsNbaChampion20252026LimitedProdReadinessArtifacts = (input: {
  inputSummary: MatcherInputSummaryArtifact;
  pairLanes: MatcherPairLanesArtifact;
  allVenueLanes: MatcherAllVenueLanesArtifact;
  rejections: MatcherRejectionsArtifact;
  finalDecision: MatcherFinalDecisionArtifact;
}): SportsNbaChampion20252026LimitedProdReadinessArtifacts => {
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
    && exactSafePairTeams.length === 30;
  const exactPairScopeLocked =
    input.inputSummary.exactTopic === TOPIC_KEY
    && input.finalDecision.bestPair === PRIMARY_PAIR_ROUTE
    && exactSafePairTeams.length === 30;

  const allVenueReadinessReviewJustified =
    allVenueMatcherReady && input.finalDecision.operatorCredible && exactAllVenueScopeLocked;
  const pairReadinessReviewJustified =
    pairMatcherReady && input.finalDecision.operatorCredible && exactPairScopeLocked;

  const allVenueFinalReadinessLabel: SportsNbaChampion20252026LimitedProdReadinessLabel =
    !allVenueMatcherReady || !input.finalDecision.operatorCredible || !exactAllVenueScopeLocked
      ? "SPORTS_NBA_CHAMPION_2025_2026_LIMITED_PROD_NOT_APPROVED"
      : allVenueOperatorRuleReviewRequired
        ? "SPORTS_NBA_CHAMPION_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
        : "SPORTS_NBA_CHAMPION_2025_2026_LIMITED_PROD_READY_FOR_REVIEW";

  const pairFinalReadinessLabel: SportsNbaChampion20252026LimitedProdReadinessLabel =
    !pairMatcherReady || !input.finalDecision.operatorCredible || !exactPairScopeLocked
      ? "SPORTS_NBA_CHAMPION_2025_2026_LIMITED_PROD_NOT_APPROVED"
      : pairOperatorRuleReviewRequired
        ? "SPORTS_NBA_CHAMPION_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
        : "SPORTS_NBA_CHAMPION_2025_2026_LIMITED_PROD_READY_FOR_REVIEW";

  const commonExclusions = [
    "OTHERS_EXCLUDED",
    "VENUE_ONLY_TAILS_EXCLUDED",
    "NO_SCOPE_WIDENING_BEYOND_NBA_2025_2026",
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

  const readiness: SportsNbaChampion20252026LimitedProdReadinessArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsNbaChampion20252026AllVenueLaneId,
    topicKey: TOPIC_KEY,
    allVenueSet: ALL_VENUE_SET,
    exactSafeAllVenueTeams,
    peerPairRoute: {
      laneId: sportsNbaChampion20252026PairPolymarketPredictLaneId,
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
        "Any drift in the strict all-venue 4-team NBA core",
        "Any venue withdrawal from LIMITLESS|OPINION|POLYMARKET|PREDICT",
        "Any rule-compatibility downgrade beyond semantically compatible rewording"
      ],
      userConsentCanWidenScope: false
    },
    rollbackPolicy: {
      scope: "LANE_ONLY",
      targetMode: "PAIR_ROUTE_INTERNAL_REVIEW_ONLY",
      fallbackLaneId: sportsNbaChampion20252026PairPolymarketPredictLaneId,
      operatorSteps: [
        "Hold the strict all-venue lane only.",
        "Leave POLYMARKET|PREDICT explicit as the narrower NBA route.",
        "Do not widen beyond the exact 4-team strict all-venue core during rollback."
      ]
    },
    exclusionsStillMandatory: commonExclusions,
    finalReadinessLabel: allVenueFinalReadinessLabel
  };

  const pairReadiness: SportsNbaChampion20252026PairLimitedProdReadinessArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsNbaChampion20252026PairPolymarketPredictLaneId,
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
        "Any drift in the POLYMARKET|PREDICT NBA shared team core",
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
        "Do not widen beyond the exact POLYMARKET|PREDICT 30-team scope."
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

  const adminSurfaceSummary: SportsNbaChampion20252026AdminSurfaceSummaryArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsNbaChampion20252026AllVenueLaneId,
    topicKey: TOPIC_KEY,
    allVenueSet: ALL_VENUE_SET,
    teamScopeHash: buildTeamScopeHash(exactSafeAllVenueTeams),
    exactSafeAllVenueTeams,
    peerPairLaneId: sportsNbaChampion20252026PairPolymarketPredictLaneId,
    peerPairVenuePair: PRIMARY_PAIR_ROUTE,
    currentReadinessDecision: readinessDecision,
    supportedActions: ["inspect", "hold", "promote", "rollback"],
    userConsentCanWidenScope: false,
    narrowestEnforceableUnit: "LANE_SCOPE_LOCK",
    sourceArtifactRefs
  };

  const pairAdminSurfaceSummary: SportsNbaChampion20252026PairAdminSurfaceSummaryArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsNbaChampion20252026PairPolymarketPredictLaneId,
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

  const readinessVsMatcherDelta: SportsNbaChampion20252026ReadinessVsMatcherDeltaArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsNbaChampion20252026AllVenueLaneId,
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
      "No widening beyond NBA 2025_2026",
      "No venue-only tails admitted into strict all-venue lane",
      "No automatic promotion implied"
    ],
    stillBlocked: allVenueOperatorRuleReviewRequired
      ? ["Operator rule review still required before production promotion."]
      : []
  };

  const pairReadinessVsMatcherDelta: SportsNbaChampion20252026PairReadinessVsMatcherDeltaArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsNbaChampion20252026PairPolymarketPredictLaneId,
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
      "No widening beyond POLYMARKET|PREDICT",
      "No venue-only tails admitted into pair lane",
      "No automatic promotion implied"
    ],
    stillBlocked: pairOperatorRuleReviewRequired
      ? ["Operator rule review still required before production promotion."]
      : []
  };

  const operatorSummary = [
    "# NBA Champion 2025-2026 Limited-Prod Readiness",
    "",
    `- topic: ${TOPIC_KEY}`,
    `- strict all-venue lane id: ${sportsNbaChampion20252026AllVenueLaneId}`,
    `- strict all-venue teams: ${exactSafeAllVenueTeams.join(", ") || "none"}`,
    `- strict all-venue readiness label: ${allVenueFinalReadinessLabel}`,
    `- peer pair lane id: ${sportsNbaChampion20252026PairPolymarketPredictLaneId}`,
    `- peer pair teams: ${exactSafePairTeams.join(", ") || "none"}`,
    "- pair route stays explicit: yes",
    `- rule status: ${input.finalDecision.ruleStatus}`,
    `- operator rule review required: ${allVenueOperatorRuleReviewRequired ? "yes" : "no"}`,
    "- no widening beyond the exact NBA 2025_2026 topic"
  ].join("\n");

  const pairOperatorSummary = [
    "# NBA Champion 2025-2026 Pair Readiness",
    "",
    `- topic: ${TOPIC_KEY}`,
    `- pair lane id: ${sportsNbaChampion20252026PairPolymarketPredictLaneId}`,
    `- pair teams: ${exactSafePairTeams.join(", ") || "none"}`,
    `- readiness label: ${pairFinalReadinessLabel}`,
    `- rule status: ${pairRuleStatus}`,
    `- operator rule review required: ${pairOperatorRuleReviewRequired ? "yes" : "no"}`,
    "- no widening beyond POLYMARKET|PREDICT"
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

export const writeSportsNbaChampion20252026LimitedProdReadinessArtifacts = (input: {
  repoRoot: string;
  inputSummary: MatcherInputSummaryArtifact;
  pairLanes: MatcherPairLanesArtifact;
  allVenueLanes: MatcherAllVenueLanesArtifact;
  rejections: MatcherRejectionsArtifact;
  finalDecision: MatcherFinalDecisionArtifact;
}): SportsNbaChampion20252026LimitedProdReadinessArtifacts => {
  const artifacts = buildSportsNbaChampion20252026LimitedProdReadinessArtifacts(input);

  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-nba-champion-2025-2026-limited-prod-readiness.json",
    artifacts.readiness
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-nba-champion-2025-2026-pair-limited-prod-readiness.json",
    artifacts.pairReadiness
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-nba-champion-2025-2026-admin-surface-summary.json",
    artifacts.adminSurfaceSummary
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-nba-champion-2025-2026-pair-admin-surface-summary.json",
    artifacts.pairAdminSurfaceSummary
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-nba-champion-2025-2026-readiness-vs-matcher-delta.json",
    artifacts.readinessVsMatcherDelta
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-nba-champion-2025-2026-pair-readiness-vs-matcher-delta.json",
    artifacts.pairReadinessVsMatcherDelta
  );
  writeMarkdownArtifact(
    input.repoRoot,
    "docs/generated/sports/sports-nba-champion-2025-2026-lane-operator-summary.md",
    `${artifacts.operatorSummary}\n`
  );
  writeMarkdownArtifact(
    input.repoRoot,
    "docs/generated/sports/sports-nba-champion-2025-2026-pair-lane-operator-summary.md",
    `${artifacts.pairOperatorSummary}\n`
  );

  return artifacts;
};
