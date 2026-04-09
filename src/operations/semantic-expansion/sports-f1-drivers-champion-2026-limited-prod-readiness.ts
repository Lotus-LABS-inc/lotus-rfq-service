import { createHash } from "node:crypto";

import { readArtifact, writeArtifact, writeMarkdownArtifact } from "./shared.js";
import {
  sportsF1DriversChampion2026AllVenueLaneId,
  sportsF1DriversChampion2026PairLimitlessPolymarketLaneId
} from "./sports-f1-drivers-champion-2026-limited-prod-shared.js";

const TOPIC_KEY = "SPORTS|TOURNAMENT_WINNER|F1_DRIVERS_CHAMPIONSHIP|2026" as const;
const ALL_VENUE_SET = "LIMITLESS|OPINION|POLYMARKET|PREDICT" as const;
const PRIMARY_PAIR_ROUTE = "LIMITLESS|POLYMARKET" as const;

const matcherInputSummaryPath =
  "artifacts/sports/f1-drivers-champion-2026-matcher/sports-f1-drivers-champion-2026-matcher-input-summary.json";
const matcherPairLanesPath =
  "artifacts/sports/f1-drivers-champion-2026-matcher/sports-f1-drivers-champion-2026-pair-lanes.json";
const matcherAllVenueLanesPath =
  "artifacts/sports/f1-drivers-champion-2026-matcher/sports-f1-drivers-champion-2026-all-venue-lanes.json";
const matcherRejectionsPath =
  "artifacts/sports/f1-drivers-champion-2026-matcher/sports-f1-drivers-champion-2026-rejections.json";
const matcherFinalDecisionPath =
  "artifacts/sports/f1-drivers-champion-2026-matcher/sports-f1-drivers-champion-2026-final-decision.json";

type SportsLimitedProdReadinessDecision =
  | "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
  | "READY_BUT_MISSING_OPERATOR_REVIEW"
  | "NOT_READY_FOR_LIMITED_PROD";

type SportsF1DriversChampion2026LimitedProdReadinessLabel =
  | "SPORTS_F1_DRIVERS_CHAMPION_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
  | "SPORTS_F1_DRIVERS_CHAMPION_2026_LIMITED_PROD_READY_FOR_REVIEW"
  | "SPORTS_F1_DRIVERS_CHAMPION_2026_LIMITED_PROD_NOT_APPROVED";

interface MatcherInputSummaryArtifact {
  exactTopic: string;
  refreshedRowsUsed: unknown;
  familyComparabilitySourceArtifacts: Record<string, string>;
  admittedVenues: string[];
  admittedDrivers: string[];
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
    scope: "driver" | "pair_lane" | "all_venue_lane";
    driverIdentityKey?: string | null;
    normalizedDriverName?: string | null;
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

export interface SportsF1DriversChampion2026LimitedProdReadinessArtifact {
  observedAt: string;
  laneId: typeof sportsF1DriversChampion2026AllVenueLaneId;
  topicKey: typeof TOPIC_KEY;
  allVenueSet: typeof ALL_VENUE_SET;
  exactSafeAllVenueDrivers: readonly string[];
  peerPairRoute: {
    laneId: typeof sportsF1DriversChampion2026PairLimitlessPolymarketLaneId;
    venuePair: typeof PRIMARY_PAIR_ROUTE;
    exactSafeDrivers: readonly string[];
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
    fallbackLaneId: typeof sportsF1DriversChampion2026PairLimitlessPolymarketLaneId;
    operatorSteps: readonly string[];
  };
  exclusionsStillMandatory: readonly string[];
  finalReadinessLabel: SportsF1DriversChampion2026LimitedProdReadinessLabel;
}

export interface SportsF1DriversChampion2026PairLimitedProdReadinessArtifact {
  observedAt: string;
  laneId: typeof sportsF1DriversChampion2026PairLimitlessPolymarketLaneId;
  topicKey: typeof TOPIC_KEY;
  venuePair: typeof PRIMARY_PAIR_ROUTE;
  exactSafeDrivers: readonly string[];
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
  finalReadinessLabel: SportsF1DriversChampion2026LimitedProdReadinessLabel;
}

export interface SportsF1DriversChampion2026AdminSurfaceSummaryArtifact {
  observedAt: string;
  laneId: typeof sportsF1DriversChampion2026AllVenueLaneId;
  topicKey: typeof TOPIC_KEY;
  allVenueSet: typeof ALL_VENUE_SET;
  driverScopeHash: string;
  exactSafeAllVenueDrivers: readonly string[];
  peerPairLaneId: typeof sportsF1DriversChampion2026PairLimitlessPolymarketLaneId;
  peerPairVenuePair: typeof PRIMARY_PAIR_ROUTE;
  currentReadinessDecision: SportsLimitedProdReadinessDecision;
  supportedActions: readonly ["inspect", "hold", "promote", "rollback"];
  userConsentCanWidenScope: false;
  narrowestEnforceableUnit: "LANE_SCOPE_LOCK";
  sourceArtifactRefs: readonly string[];
}

export interface SportsF1DriversChampion2026PairAdminSurfaceSummaryArtifact {
  observedAt: string;
  laneId: typeof sportsF1DriversChampion2026PairLimitlessPolymarketLaneId;
  topicKey: typeof TOPIC_KEY;
  venuePair: typeof PRIMARY_PAIR_ROUTE;
  driverScopeHash: string;
  exactSafeDrivers: readonly string[];
  currentReadinessDecision: SportsLimitedProdReadinessDecision;
  supportedActions: readonly ["inspect", "hold", "promote", "rollback"];
  userConsentCanWidenScope: false;
  narrowestEnforceableUnit: "LANE_SCOPE_LOCK";
  sourceArtifactRefs: readonly string[];
}

export interface SportsF1DriversChampion2026ReadinessVsMatcherDeltaArtifact {
  observedAt: string;
  laneId: typeof sportsF1DriversChampion2026AllVenueLaneId;
  matcherTruthConsumed: {
    topicKey: string;
    bestPair: string | null;
    bestAllVenueIfAny: string | null;
    exactSafeAllVenueDrivers: readonly string[];
    exactSafePairDrivers: readonly string[];
    overallDecision: string;
    allVenueMatcherReady: boolean;
    pairMatcherReady: boolean;
    operatorCredible: boolean;
    ruleStatus: MatcherFinalDecisionArtifact["ruleStatus"];
  };
  readinessConclusionsDerived: {
    finalReadinessLabel: SportsF1DriversChampion2026LimitedProdReadinessLabel;
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

export interface SportsF1DriversChampion2026PairReadinessVsMatcherDeltaArtifact {
  observedAt: string;
  laneId: typeof sportsF1DriversChampion2026PairLimitlessPolymarketLaneId;
  matcherTruthConsumed: {
    topicKey: string;
    bestPair: string | null;
    exactSafePairDrivers: readonly string[];
    overallDecision: string;
    pairMatcherReady: boolean;
    operatorCredible: boolean;
    ruleStatus: MatcherFinalDecisionArtifact["ruleStatus"];
  };
  readinessConclusionsDerived: {
    finalReadinessLabel: SportsF1DriversChampion2026LimitedProdReadinessLabel;
    readinessReviewJustified: boolean;
    operatorRuleReviewRequired: boolean;
    rolloutRecommended: false;
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY";
    exactLaneScopeLocked: true;
  };
  intentionallyUnchanged: readonly string[];
  stillBlocked: readonly string[];
}

export interface SportsF1DriversChampion2026LimitedProdReadinessArtifacts {
  readiness: SportsF1DriversChampion2026LimitedProdReadinessArtifact;
  pairReadiness: SportsF1DriversChampion2026PairLimitedProdReadinessArtifact;
  adminSurfaceSummary: SportsF1DriversChampion2026AdminSurfaceSummaryArtifact;
  pairAdminSurfaceSummary: SportsF1DriversChampion2026PairAdminSurfaceSummaryArtifact;
  readinessVsMatcherDelta: SportsF1DriversChampion2026ReadinessVsMatcherDeltaArtifact;
  pairReadinessVsMatcherDelta: SportsF1DriversChampion2026PairReadinessVsMatcherDeltaArtifact;
  operatorSummary: string;
  pairOperatorSummary: string;
}

const buildDriverScopeHash = (drivers: readonly string[]): string =>
  createHash("sha256")
    .update([...drivers].sort((left, right) => left.localeCompare(right)).join("|"))
    .digest("hex")
    .slice(0, 16);

export const loadSportsF1DriversChampion2026MatcherArtifacts = (repoRoot: string) => ({
  inputSummary: readArtifact<MatcherInputSummaryArtifact>(repoRoot, matcherInputSummaryPath),
  pairLanes: readArtifact<MatcherPairLanesArtifact>(repoRoot, matcherPairLanesPath),
  allVenueLanes: readArtifact<MatcherAllVenueLanesArtifact>(repoRoot, matcherAllVenueLanesPath),
  rejections: readArtifact<MatcherRejectionsArtifact>(repoRoot, matcherRejectionsPath),
  finalDecision: readArtifact<MatcherFinalDecisionArtifact>(repoRoot, matcherFinalDecisionPath)
});

const toReadinessDecision = (matcherReady: boolean, operatorCredible: boolean): SportsLimitedProdReadinessDecision => {
  if (matcherReady && operatorCredible) {
    return "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION";
  }
  if (matcherReady) {
    return "READY_BUT_MISSING_OPERATOR_REVIEW";
  }
  return "NOT_READY_FOR_LIMITED_PROD";
};

const toFinalReadinessLabel = (
  matcherReady: boolean,
  operatorCredible: boolean,
  operatorRuleReviewRequired: boolean
): SportsF1DriversChampion2026LimitedProdReadinessLabel => {
  if (!matcherReady || !operatorCredible) {
    return "SPORTS_F1_DRIVERS_CHAMPION_2026_LIMITED_PROD_NOT_APPROVED";
  }
  if (operatorRuleReviewRequired) {
    return "SPORTS_F1_DRIVERS_CHAMPION_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW";
  }
  return "SPORTS_F1_DRIVERS_CHAMPION_2026_LIMITED_PROD_READY_FOR_REVIEW";
};

export const buildSportsF1DriversChampion2026LimitedProdReadinessArtifacts = (input: {
  inputSummary: MatcherInputSummaryArtifact;
  pairLanes: MatcherPairLanesArtifact;
  allVenueLanes: MatcherAllVenueLanesArtifact;
  rejections: MatcherRejectionsArtifact;
  finalDecision: MatcherFinalDecisionArtifact;
}): SportsF1DriversChampion2026LimitedProdReadinessArtifacts => {
  const exactSafePairDrivers = input.pairLanes.matcherLanes
    .filter((lane) => lane.venuePair === PRIMARY_PAIR_ROUTE)
    .map((lane) => lane.club)
    .sort((left, right) => left.localeCompare(right));
  const exactSafeAllVenueDrivers = input.allVenueLanes.matcherLanes
    .filter((lane) => lane.venueSet === ALL_VENUE_SET)
    .map((lane) => lane.club)
    .sort((left, right) => left.localeCompare(right));

  const operatorRuleReviewRequired = input.finalDecision.ruleStatus !== "EXACT_RULE_COMPATIBLE";
  const currentReadinessDecision = toReadinessDecision(
    input.finalDecision.allVenueMatcherReady,
    input.finalDecision.operatorCredible
  );
  const pairCurrentReadinessDecision = toReadinessDecision(
    input.finalDecision.pairMatcherReady,
    input.finalDecision.operatorCredible
  );

  const finalReadinessLabel = toFinalReadinessLabel(
    input.finalDecision.allVenueMatcherReady,
    input.finalDecision.operatorCredible,
    operatorRuleReviewRequired
  );
  const pairFinalReadinessLabel = toFinalReadinessLabel(
    input.finalDecision.pairMatcherReady,
    input.finalDecision.operatorCredible,
    operatorRuleReviewRequired
  );

  const readiness: SportsF1DriversChampion2026LimitedProdReadinessArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsF1DriversChampion2026AllVenueLaneId,
    topicKey: TOPIC_KEY,
    allVenueSet: ALL_VENUE_SET,
    exactSafeAllVenueDrivers,
    peerPairRoute: {
      laneId: sportsF1DriversChampion2026PairLimitlessPolymarketLaneId,
      venuePair: PRIMARY_PAIR_ROUTE,
      exactSafeDrivers: exactSafePairDrivers
    },
    ruleStatus: input.finalDecision.ruleStatus,
    operatorRuleReviewRequired,
    matcherReady: input.finalDecision.allVenueMatcherReady,
    operatorCredible: input.finalDecision.operatorCredible,
    readinessReviewJustified: input.finalDecision.matcherFollowUpJustified,
    rolloutRecommended: false,
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY",
    holdPolicy: {
      scope: "LANE_ONLY",
      holdConditions: [
        "shared driver set drifts outside the exact all-venue scope",
        "any venue removes or rewrites a driver leg inside the strict all-venue set",
        "operator review blocks semantically compatible wording from promotion"
      ],
      userConsentCanWidenScope: false
    },
    rollbackPolicy: {
      scope: "LANE_ONLY",
      targetMode: "PAIR_ROUTE_INTERNAL_REVIEW_ONLY",
      fallbackLaneId: sportsF1DriversChampion2026PairLimitlessPolymarketLaneId,
      operatorSteps: [
        `disable lane ${sportsF1DriversChampion2026AllVenueLaneId}`,
        `keep ${sportsF1DriversChampion2026PairLimitlessPolymarketLaneId} available for internal review only`,
        "re-run the F1 drivers champion matcher pass before any re-promotion"
      ]
    },
    exclusionsStillMandatory: [
      "VENUE_ONLY_TAILS_EXCLUDED",
      "NO_SCOPE_WIDENING_BEYOND_F1_DRIVERS_CHAMPIONSHIP_2026",
      "STRICT_ALL_CORE_REMAINS_4_DRIVERS"
    ],
    finalReadinessLabel
  };

  const pairReadiness: SportsF1DriversChampion2026PairLimitedProdReadinessArtifact = {
    observedAt: readiness.observedAt,
    laneId: sportsF1DriversChampion2026PairLimitlessPolymarketLaneId,
    topicKey: TOPIC_KEY,
    venuePair: PRIMARY_PAIR_ROUTE,
    exactSafeDrivers: exactSafePairDrivers,
    ruleStatus: input.finalDecision.ruleStatus,
    operatorRuleReviewRequired,
    matcherReady: input.finalDecision.pairMatcherReady,
    operatorCredible: input.finalDecision.operatorCredible,
    readinessReviewJustified: input.finalDecision.matcherFollowUpJustified,
    rolloutRecommended: false,
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY",
    holdPolicy: {
      scope: "LANE_ONLY",
      holdConditions: [
        "shared pair driver set drifts outside LIMITLESS|POLYMARKET",
        "either venue removes a driver leg inside the approved pair scope",
        "operator review blocks semantically compatible wording from promotion"
      ],
      userConsentCanWidenScope: false
    },
    rollbackPolicy: {
      scope: "LANE_ONLY",
      targetMode: "DISABLED_INTERNAL_ONLY",
      fallbackLaneId: null,
      operatorSteps: [
        `disable lane ${sportsF1DriversChampion2026PairLimitlessPolymarketLaneId}`,
        "re-run the F1 drivers champion matcher pass before any re-promotion"
      ]
    },
    exclusionsStillMandatory: [
      "VENUE_ONLY_TAILS_EXCLUDED",
      "NO_SCOPE_WIDENING_BEYOND_F1_DRIVERS_CHAMPIONSHIP_2026"
    ],
    finalReadinessLabel: pairFinalReadinessLabel
  };

  const adminSurfaceSummary: SportsF1DriversChampion2026AdminSurfaceSummaryArtifact = {
    observedAt: readiness.observedAt,
    laneId: sportsF1DriversChampion2026AllVenueLaneId,
    topicKey: TOPIC_KEY,
    allVenueSet: ALL_VENUE_SET,
    driverScopeHash: buildDriverScopeHash(exactSafeAllVenueDrivers),
    exactSafeAllVenueDrivers,
    peerPairLaneId: sportsF1DriversChampion2026PairLimitlessPolymarketLaneId,
    peerPairVenuePair: PRIMARY_PAIR_ROUTE,
    currentReadinessDecision,
    supportedActions: ["inspect", "hold", "promote", "rollback"],
    userConsentCanWidenScope: false,
    narrowestEnforceableUnit: "LANE_SCOPE_LOCK",
    sourceArtifactRefs: [
      matcherInputSummaryPath,
      matcherPairLanesPath,
      matcherAllVenueLanesPath,
      matcherRejectionsPath,
      matcherFinalDecisionPath
    ]
  };

  const pairAdminSurfaceSummary: SportsF1DriversChampion2026PairAdminSurfaceSummaryArtifact = {
    observedAt: readiness.observedAt,
    laneId: sportsF1DriversChampion2026PairLimitlessPolymarketLaneId,
    topicKey: TOPIC_KEY,
    venuePair: PRIMARY_PAIR_ROUTE,
    driverScopeHash: buildDriverScopeHash(exactSafePairDrivers),
    exactSafeDrivers: exactSafePairDrivers,
    currentReadinessDecision: pairCurrentReadinessDecision,
    supportedActions: ["inspect", "hold", "promote", "rollback"],
    userConsentCanWidenScope: false,
    narrowestEnforceableUnit: "LANE_SCOPE_LOCK",
    sourceArtifactRefs: [
      matcherInputSummaryPath,
      matcherPairLanesPath,
      matcherRejectionsPath,
      matcherFinalDecisionPath
    ]
  };

  const readinessVsMatcherDelta: SportsF1DriversChampion2026ReadinessVsMatcherDeltaArtifact = {
    observedAt: readiness.observedAt,
    laneId: sportsF1DriversChampion2026AllVenueLaneId,
    matcherTruthConsumed: {
      topicKey: input.inputSummary.exactTopic,
      bestPair: input.finalDecision.bestPair,
      bestAllVenueIfAny: input.finalDecision.bestAllVenueIfAny,
      exactSafeAllVenueDrivers,
      exactSafePairDrivers,
      overallDecision: input.finalDecision.overallDecision,
      allVenueMatcherReady: input.finalDecision.allVenueMatcherReady,
      pairMatcherReady: input.finalDecision.pairMatcherReady,
      operatorCredible: input.finalDecision.operatorCredible,
      ruleStatus: input.finalDecision.ruleStatus
    },
    readinessConclusionsDerived: {
      finalReadinessLabel,
      readinessReviewJustified: input.finalDecision.matcherFollowUpJustified,
      operatorRuleReviewRequired,
      rolloutRecommended: false,
      recommendedMode: "LIMITED_PROD_REVIEW_ONLY",
      exactLaneScopeLocked: true,
      peerPairRouteStillExplicit: true
    },
    intentionallyUnchanged: [
      "NO_AUTO_PROMOTION",
      "NO_SCOPE_WIDENING",
      "PAIR_ROUTE_REMAINS_EXPLICIT"
    ],
    stillBlocked: operatorRuleReviewRequired ? ["OPERATOR_RULE_REVIEW_REQUIRED"] : []
  };

  const pairReadinessVsMatcherDelta: SportsF1DriversChampion2026PairReadinessVsMatcherDeltaArtifact = {
    observedAt: readiness.observedAt,
    laneId: sportsF1DriversChampion2026PairLimitlessPolymarketLaneId,
    matcherTruthConsumed: {
      topicKey: input.inputSummary.exactTopic,
      bestPair: input.finalDecision.bestPair,
      exactSafePairDrivers,
      overallDecision: input.finalDecision.overallDecision,
      pairMatcherReady: input.finalDecision.pairMatcherReady,
      operatorCredible: input.finalDecision.operatorCredible,
      ruleStatus: input.finalDecision.ruleStatus
    },
    readinessConclusionsDerived: {
      finalReadinessLabel: pairFinalReadinessLabel,
      readinessReviewJustified: input.finalDecision.matcherFollowUpJustified,
      operatorRuleReviewRequired,
      rolloutRecommended: false,
      recommendedMode: "LIMITED_PROD_REVIEW_ONLY",
      exactLaneScopeLocked: true
    },
    intentionallyUnchanged: [
      "NO_AUTO_PROMOTION",
      "NO_SCOPE_WIDENING"
    ],
    stillBlocked: operatorRuleReviewRequired ? ["OPERATOR_RULE_REVIEW_REQUIRED"] : []
  };

  const operatorSummary = [
    "# F1 Drivers Champion 2026 Limited-Prod Readiness",
    "",
    `- exact topic: ${TOPIC_KEY}`,
    `- strict all-venue lane id: ${sportsF1DriversChampion2026AllVenueLaneId}`,
    `- peer pair lane id: ${sportsF1DriversChampion2026PairLimitlessPolymarketLaneId}`,
    `- strict all-venue drivers: ${exactSafeAllVenueDrivers.join(", ") || "none"}`,
    `- pair drivers on ${PRIMARY_PAIR_ROUTE}: ${exactSafePairDrivers.join(", ") || "none"}`,
    `- rule status: ${input.finalDecision.ruleStatus}`,
    `- operator rule review required: ${operatorRuleReviewRequired ? "yes" : "no"}`,
    `- readiness decision: ${currentReadinessDecision}`,
    `- final label: ${finalReadinessLabel}`,
    "- rollout recommendation: limited prod review only"
  ].join("\n");

  const pairOperatorSummary = [
    "# F1 Drivers Champion 2026 Pair Readiness",
    "",
    `- exact topic: ${TOPIC_KEY}`,
    `- pair lane id: ${sportsF1DriversChampion2026PairLimitlessPolymarketLaneId}`,
    `- pair venue set: ${PRIMARY_PAIR_ROUTE}`,
    `- exact-safe drivers: ${exactSafePairDrivers.join(", ") || "none"}`,
    `- rule status: ${input.finalDecision.ruleStatus}`,
    `- operator rule review required: ${operatorRuleReviewRequired ? "yes" : "no"}`,
    `- readiness decision: ${pairCurrentReadinessDecision}`,
    `- final label: ${pairFinalReadinessLabel}`,
    "- rollout recommendation: limited prod review only"
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

export const runSportsF1DriversChampion2026LimitedProdReadinessPass = async (input: {
  repoRoot: string;
}) => {
  const matcherArtifacts = loadSportsF1DriversChampion2026MatcherArtifacts(input.repoRoot);
  const artifacts = buildSportsF1DriversChampion2026LimitedProdReadinessArtifacts(matcherArtifacts);

  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-f1-drivers-champion-2026-limited-prod-readiness.json",
    artifacts.readiness
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-f1-drivers-champion-2026-pair-limited-prod-readiness.json",
    artifacts.pairReadiness
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-f1-drivers-champion-2026-admin-surface-summary.json",
    artifacts.adminSurfaceSummary
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-f1-drivers-champion-2026-pair-admin-surface-summary.json",
    artifacts.pairAdminSurfaceSummary
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-f1-drivers-champion-2026-readiness-vs-matcher-delta.json",
    artifacts.readinessVsMatcherDelta
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-f1-drivers-champion-2026-pair-readiness-vs-matcher-delta.json",
    artifacts.pairReadinessVsMatcherDelta
  );
  writeMarkdownArtifact(
    input.repoRoot,
    "docs/generated/sports/sports-f1-drivers-champion-2026-lane-operator-summary.md",
    `${artifacts.operatorSummary}\n\n${artifacts.pairOperatorSummary}\n`
  );

  return artifacts;
};
