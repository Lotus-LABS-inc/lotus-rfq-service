import { createHash } from "node:crypto";

import { readArtifact, writeArtifact, writeMarkdownArtifact } from "./shared.js";
import {
  sportsNhlStanleyCupChampion20252026PairLimitlessPolymarketLaneId,
  sportsNhlStanleyCupChampion20252026TriLaneId
} from "./sports-nhl-stanley-cup-champion-2025-2026-limited-prod-shared.js";

const TOPIC_KEY = "SPORTS|TOURNAMENT_WINNER|NHL_STANLEY_CUP|2025_2026" as const;
const TRI_VENUE_SET = "LIMITLESS|OPINION|POLYMARKET" as const;
const PRIMARY_PAIR_ROUTE = "LIMITLESS|POLYMARKET" as const;

const matcherInputSummaryPath =
  "artifacts/sports/nhl-stanley-cup-champion-2025-2026-matcher/sports-nhl-stanley-cup-champion-2025-2026-matcher-input-summary.json";
const matcherPairLanesPath =
  "artifacts/sports/nhl-stanley-cup-champion-2025-2026-matcher/sports-nhl-stanley-cup-champion-2025-2026-pair-lanes.json";
const matcherTriLanesPath =
  "artifacts/sports/nhl-stanley-cup-champion-2025-2026-matcher/sports-nhl-stanley-cup-champion-2025-2026-tri-lanes.json";
const matcherRejectionsPath =
  "artifacts/sports/nhl-stanley-cup-champion-2025-2026-matcher/sports-nhl-stanley-cup-champion-2025-2026-rejections.json";
const matcherFinalDecisionPath =
  "artifacts/sports/nhl-stanley-cup-champion-2025-2026-matcher/sports-nhl-stanley-cup-champion-2025-2026-final-decision.json";
const matcherOperatorSummaryPath =
  "artifacts/sports/nhl-stanley-cup-champion-2025-2026-matcher/sports-nhl-stanley-cup-champion-2025-2026-operator-summary.md";

type SportsLimitedProdReadinessDecision =
  | "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
  | "READY_BUT_MISSING_OPERATOR_REVIEW"
  | "NOT_READY_FOR_LIMITED_PROD";

type SportsNhlStanleyCupChampion20252026LimitedProdReadinessLabel =
  | "SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
  | "SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_LIMITED_PROD_READY_FOR_REVIEW"
  | "SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_LIMITED_PROD_NOT_APPROVED";

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

interface MatcherTriLanesArtifact {
  canonicalTopicKey: string;
  matcherLanes: {
    venueSet: string;
    clubs: string[];
  }[];
}

interface MatcherRejectionsArtifact {
  rejections: {
    scope: "team" | "pair_lane" | "tri_lane";
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
  bestTriIfAny: string | null;
  pairMatcherReady: boolean;
  triMatcherReady: boolean;
  pairStillPreferred: boolean;
  exactSafePairCandidateCount: number;
  exactSafeTriCandidateCount: number;
  ruleStatus: "EXACT_RULE_COMPATIBLE" | "SEMANTICALLY_COMPATIBLE_REWORDING";
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export interface SportsNhlStanleyCupChampion20252026LimitedProdReadinessArtifact {
  observedAt: string;
  laneId: typeof sportsNhlStanleyCupChampion20252026TriLaneId;
  topicKey: typeof TOPIC_KEY;
  triVenueSet: typeof TRI_VENUE_SET;
  exactSafeTriTeams: readonly string[];
  peerPairRoute: {
    laneId: typeof sportsNhlStanleyCupChampion20252026PairLimitlessPolymarketLaneId;
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
    fallbackLaneId: typeof sportsNhlStanleyCupChampion20252026PairLimitlessPolymarketLaneId;
    operatorSteps: readonly string[];
  };
  exclusionsStillMandatory: readonly string[];
  finalReadinessLabel: SportsNhlStanleyCupChampion20252026LimitedProdReadinessLabel;
}

export interface SportsNhlStanleyCupChampion20252026PairLimitedProdReadinessArtifact {
  observedAt: string;
  laneId: typeof sportsNhlStanleyCupChampion20252026PairLimitlessPolymarketLaneId;
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
  finalReadinessLabel: SportsNhlStanleyCupChampion20252026LimitedProdReadinessLabel;
}

export interface SportsNhlStanleyCupChampion20252026AdminSurfaceSummaryArtifact {
  observedAt: string;
  laneId: typeof sportsNhlStanleyCupChampion20252026TriLaneId;
  topicKey: typeof TOPIC_KEY;
  triVenueSet: typeof TRI_VENUE_SET;
  teamScopeHash: string;
  exactSafeTriTeams: readonly string[];
  peerPairLaneId: typeof sportsNhlStanleyCupChampion20252026PairLimitlessPolymarketLaneId;
  peerPairVenuePair: typeof PRIMARY_PAIR_ROUTE;
  currentReadinessDecision: SportsLimitedProdReadinessDecision;
  supportedActions: readonly ["inspect", "hold", "promote", "rollback"];
  userConsentCanWidenScope: false;
  narrowestEnforceableUnit: "LANE_SCOPE_LOCK";
  sourceArtifactRefs: readonly string[];
}

export interface SportsNhlStanleyCupChampion20252026PairAdminSurfaceSummaryArtifact {
  observedAt: string;
  laneId: typeof sportsNhlStanleyCupChampion20252026PairLimitlessPolymarketLaneId;
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

export interface SportsNhlStanleyCupChampion20252026ReadinessVsMatcherDeltaArtifact {
  observedAt: string;
  laneId: typeof sportsNhlStanleyCupChampion20252026TriLaneId;
  matcherTruthConsumed: {
    topicKey: string;
    bestPair: string | null;
    bestTriIfAny: string | null;
    exactSafeTriTeams: readonly string[];
    exactSafePairTeams: readonly string[];
    overallDecision: string;
    triMatcherReady: boolean;
    pairMatcherReady: boolean;
    operatorCredible: boolean;
    ruleStatus: MatcherFinalDecisionArtifact["ruleStatus"];
  };
  readinessConclusionsDerived: {
    finalReadinessLabel: SportsNhlStanleyCupChampion20252026LimitedProdReadinessLabel;
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

export interface SportsNhlStanleyCupChampion20252026PairReadinessVsMatcherDeltaArtifact {
  observedAt: string;
  laneId: typeof sportsNhlStanleyCupChampion20252026PairLimitlessPolymarketLaneId;
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
    finalReadinessLabel: SportsNhlStanleyCupChampion20252026LimitedProdReadinessLabel;
    readinessReviewJustified: boolean;
    operatorRuleReviewRequired: boolean;
    rolloutRecommended: false;
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY";
    exactLaneScopeLocked: true;
  };
  intentionallyUnchanged: readonly string[];
  stillBlocked: readonly string[];
}

export interface SportsNhlStanleyCupChampion20252026LimitedProdReadinessArtifacts {
  readiness: SportsNhlStanleyCupChampion20252026LimitedProdReadinessArtifact;
  pairReadiness: SportsNhlStanleyCupChampion20252026PairLimitedProdReadinessArtifact;
  adminSurfaceSummary: SportsNhlStanleyCupChampion20252026AdminSurfaceSummaryArtifact;
  pairAdminSurfaceSummary: SportsNhlStanleyCupChampion20252026PairAdminSurfaceSummaryArtifact;
  readinessVsMatcherDelta: SportsNhlStanleyCupChampion20252026ReadinessVsMatcherDeltaArtifact;
  pairReadinessVsMatcherDelta: SportsNhlStanleyCupChampion20252026PairReadinessVsMatcherDeltaArtifact;
  operatorSummary: string;
  pairOperatorSummary: string;
}

const buildTeamScopeHash = (teams: readonly string[]): string =>
  createHash("sha256")
    .update([...teams].sort((left, right) => left.localeCompare(right)).join("|"))
    .digest("hex")
    .slice(0, 16);

export const loadSportsNhlStanleyCupChampion20252026MatcherArtifacts = (repoRoot: string) => ({
  inputSummary: readArtifact<MatcherInputSummaryArtifact>(repoRoot, matcherInputSummaryPath),
  pairLanes: readArtifact<MatcherPairLanesArtifact>(repoRoot, matcherPairLanesPath),
  triLanes: readArtifact<MatcherTriLanesArtifact>(repoRoot, matcherTriLanesPath),
  rejections: readArtifact<MatcherRejectionsArtifact>(repoRoot, matcherRejectionsPath),
  finalDecision: readArtifact<MatcherFinalDecisionArtifact>(repoRoot, matcherFinalDecisionPath)
});

export const buildSportsNhlStanleyCupChampion20252026LimitedProdReadinessArtifacts = (input: {
  inputSummary: MatcherInputSummaryArtifact;
  pairLanes: MatcherPairLanesArtifact;
  triLanes: MatcherTriLanesArtifact;
  rejections: MatcherRejectionsArtifact;
  finalDecision: MatcherFinalDecisionArtifact;
}): SportsNhlStanleyCupChampion20252026LimitedProdReadinessArtifacts => {
  const exactSafePairTeams = [
    ...new Set(
      input.pairLanes.matcherLanes
        .filter((lane) => lane.venuePair === PRIMARY_PAIR_ROUTE)
        .map((lane) => lane.club)
    )
  ].sort((left, right) => left.localeCompare(right));

  const exactSafeTriTeams = [
    ...new Set(
      input.triLanes.matcherLanes
        .filter((lane) => lane.venueSet === TRI_VENUE_SET)
        .flatMap((lane) => lane.clubs)
    )
  ].sort((left, right) => left.localeCompare(right));

  const triMatcherReady =
    input.finalDecision.triMatcherReady &&
    input.finalDecision.bestTriIfAny === TRI_VENUE_SET &&
    exactSafeTriTeams.length > 0;
  const pairMatcherReady =
    input.finalDecision.pairMatcherReady &&
    input.finalDecision.bestPair === PRIMARY_PAIR_ROUTE &&
    exactSafePairTeams.length > 0;

  const triOperatorRuleReviewRequired = input.finalDecision.ruleStatus !== "EXACT_RULE_COMPATIBLE";
  const pairOperatorRuleReviewRequired = input.finalDecision.ruleStatus !== "EXACT_RULE_COMPATIBLE";
  const triReadinessReviewJustified = triMatcherReady && input.finalDecision.operatorCredible;
  const pairReadinessReviewJustified = pairMatcherReady && input.finalDecision.operatorCredible;

  const triFinalReadinessLabel: SportsNhlStanleyCupChampion20252026LimitedProdReadinessLabel =
    !triMatcherReady || !input.finalDecision.operatorCredible
      ? "SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_LIMITED_PROD_NOT_APPROVED"
      : triOperatorRuleReviewRequired
        ? "SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
        : "SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_LIMITED_PROD_READY_FOR_REVIEW";

  const pairFinalReadinessLabel: SportsNhlStanleyCupChampion20252026LimitedProdReadinessLabel =
    !pairMatcherReady || !input.finalDecision.operatorCredible
      ? "SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_LIMITED_PROD_NOT_APPROVED"
      : pairOperatorRuleReviewRequired
        ? "SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
        : "SPORTS_NHL_STANLEY_CUP_CHAMPION_2025_2026_LIMITED_PROD_READY_FOR_REVIEW";

  const sourceArtifactRefs = [
    matcherInputSummaryPath,
    matcherPairLanesPath,
    matcherTriLanesPath,
    matcherRejectionsPath,
    matcherFinalDecisionPath,
    matcherOperatorSummaryPath
  ] as const;

  const commonExclusions = [
    "NO_SCOPE_WIDENING_BEYOND_NHL_STANLEY_CUP_2025_2026",
    "VENUE_ONLY_TAILS_EXCLUDED",
    "NO_STRICT_ALL_LANE_FOR_THIS_TOPIC"
  ] as const;

  const readiness: SportsNhlStanleyCupChampion20252026LimitedProdReadinessArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsNhlStanleyCupChampion20252026TriLaneId,
    topicKey: TOPIC_KEY,
    triVenueSet: TRI_VENUE_SET,
    exactSafeTriTeams,
    peerPairRoute: {
      laneId: sportsNhlStanleyCupChampion20252026PairLimitlessPolymarketLaneId,
      venuePair: PRIMARY_PAIR_ROUTE,
      exactSafeTeams: exactSafePairTeams
    },
    ruleStatus: input.finalDecision.ruleStatus,
    operatorRuleReviewRequired: triOperatorRuleReviewRequired,
    matcherReady: triMatcherReady,
    operatorCredible: input.finalDecision.operatorCredible,
    readinessReviewJustified: triReadinessReviewJustified,
    rolloutRecommended: false,
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY",
    holdPolicy: {
      scope: "LANE_ONLY",
      holdConditions: [
        "Any drift in the LIMITLESS|OPINION|POLYMARKET shared NHL core",
        "Any venue withdrawal from the strict tri lane",
        "Any rule-compatibility downgrade beyond semantically compatible rewording"
      ],
      userConsentCanWidenScope: false
    },
    rollbackPolicy: {
      scope: "LANE_ONLY",
      targetMode: "PAIR_ROUTE_INTERNAL_REVIEW_ONLY",
      fallbackLaneId: sportsNhlStanleyCupChampion20252026PairLimitlessPolymarketLaneId,
      operatorSteps: [
        "Hold the strict tri lane only.",
        "Keep the explicit LIMITLESS|POLYMARKET pair route available.",
        "Do not widen beyond the exact NHL 2025_2026 topic."
      ]
    },
    exclusionsStillMandatory: commonExclusions,
    finalReadinessLabel: triFinalReadinessLabel
  };

  const pairReadiness: SportsNhlStanleyCupChampion20252026PairLimitedProdReadinessArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsNhlStanleyCupChampion20252026PairLimitlessPolymarketLaneId,
    topicKey: TOPIC_KEY,
    venuePair: PRIMARY_PAIR_ROUTE,
    exactSafeTeams: exactSafePairTeams,
    ruleStatus: input.finalDecision.ruleStatus,
    operatorRuleReviewRequired: pairOperatorRuleReviewRequired,
    matcherReady: pairMatcherReady,
    operatorCredible: input.finalDecision.operatorCredible,
    readinessReviewJustified: pairReadinessReviewJustified,
    rolloutRecommended: false,
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY",
    holdPolicy: {
      scope: "LANE_ONLY",
      holdConditions: [
        "Any drift in the LIMITLESS|POLYMARKET shared NHL core",
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
        "Do not widen beyond the exact LIMITLESS|POLYMARKET 16-team scope."
      ]
    },
    exclusionsStillMandatory: commonExclusions,
    finalReadinessLabel: pairFinalReadinessLabel
  };

  const triDecision: SportsLimitedProdReadinessDecision =
    !triMatcherReady || !input.finalDecision.operatorCredible
      ? "NOT_READY_FOR_LIMITED_PROD"
      : triOperatorRuleReviewRequired
        ? "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
        : "READY_BUT_MISSING_OPERATOR_REVIEW";

  const pairDecision: SportsLimitedProdReadinessDecision =
    !pairMatcherReady || !input.finalDecision.operatorCredible
      ? "NOT_READY_FOR_LIMITED_PROD"
      : pairOperatorRuleReviewRequired
        ? "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
        : "READY_BUT_MISSING_OPERATOR_REVIEW";

  const adminSurfaceSummary: SportsNhlStanleyCupChampion20252026AdminSurfaceSummaryArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsNhlStanleyCupChampion20252026TriLaneId,
    topicKey: TOPIC_KEY,
    triVenueSet: TRI_VENUE_SET,
    teamScopeHash: buildTeamScopeHash(exactSafeTriTeams),
    exactSafeTriTeams,
    peerPairLaneId: sportsNhlStanleyCupChampion20252026PairLimitlessPolymarketLaneId,
    peerPairVenuePair: PRIMARY_PAIR_ROUTE,
    currentReadinessDecision: triDecision,
    supportedActions: ["inspect", "hold", "promote", "rollback"],
    userConsentCanWidenScope: false,
    narrowestEnforceableUnit: "LANE_SCOPE_LOCK",
    sourceArtifactRefs
  };

  const pairAdminSurfaceSummary: SportsNhlStanleyCupChampion20252026PairAdminSurfaceSummaryArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsNhlStanleyCupChampion20252026PairLimitlessPolymarketLaneId,
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

  const readinessVsMatcherDelta: SportsNhlStanleyCupChampion20252026ReadinessVsMatcherDeltaArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsNhlStanleyCupChampion20252026TriLaneId,
    matcherTruthConsumed: {
      topicKey: TOPIC_KEY,
      bestPair: input.finalDecision.bestPair,
      bestTriIfAny: input.finalDecision.bestTriIfAny,
      exactSafeTriTeams,
      exactSafePairTeams,
      overallDecision: input.finalDecision.overallDecision,
      triMatcherReady,
      pairMatcherReady: input.finalDecision.pairMatcherReady,
      operatorCredible: input.finalDecision.operatorCredible,
      ruleStatus: input.finalDecision.ruleStatus
    },
    readinessConclusionsDerived: {
      finalReadinessLabel: triFinalReadinessLabel,
      readinessReviewJustified: triReadinessReviewJustified,
      operatorRuleReviewRequired: triOperatorRuleReviewRequired,
      rolloutRecommended: false,
      recommendedMode: "LIMITED_PROD_REVIEW_ONLY",
      exactLaneScopeLocked: true,
      peerPairRouteStillExplicit: true
    },
    intentionallyUnchanged: [
      "No widening beyond NHL Stanley Cup 2025_2026",
      "No venue-only tails admitted into strict tri lane",
      "No automatic promotion implied"
    ],
    stillBlocked: triOperatorRuleReviewRequired
      ? ["Operator rule review still required before production promotion."]
      : []
  };

  const pairReadinessVsMatcherDelta: SportsNhlStanleyCupChampion20252026PairReadinessVsMatcherDeltaArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsNhlStanleyCupChampion20252026PairLimitlessPolymarketLaneId,
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
    "# NHL Stanley Cup Champion 2025-2026 Limited-Prod Readiness",
    "",
    `- topic: ${TOPIC_KEY}`,
    `- strict tri lane id: ${sportsNhlStanleyCupChampion20252026TriLaneId}`,
    `- strict tri teams: ${exactSafeTriTeams.join(", ") || "none"}`,
    `- strict tri readiness label: ${triFinalReadinessLabel}`,
    `- peer pair lane id: ${sportsNhlStanleyCupChampion20252026PairLimitlessPolymarketLaneId}`,
    `- peer pair teams: ${exactSafePairTeams.join(", ") || "none"}`,
    "- pair route stays explicit: yes",
    `- rule status: ${input.finalDecision.ruleStatus}`,
    `- operator rule review required: ${triOperatorRuleReviewRequired ? "yes" : "no"}`,
    "- no widening beyond the exact NHL 2025_2026 topic"
  ].join("\n");

  const pairOperatorSummary = [
    "# NHL Stanley Cup Champion 2025-2026 Pair Readiness",
    "",
    `- topic: ${TOPIC_KEY}`,
    `- pair lane id: ${sportsNhlStanleyCupChampion20252026PairLimitlessPolymarketLaneId}`,
    `- pair teams: ${exactSafePairTeams.join(", ") || "none"}`,
    `- readiness label: ${pairFinalReadinessLabel}`,
    `- rule status: ${input.finalDecision.ruleStatus}`,
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

export const writeSportsNhlStanleyCupChampion20252026LimitedProdReadinessArtifacts = (input: {
  repoRoot: string;
  inputSummary: MatcherInputSummaryArtifact;
  pairLanes: MatcherPairLanesArtifact;
  triLanes: MatcherTriLanesArtifact;
  rejections: MatcherRejectionsArtifact;
  finalDecision: MatcherFinalDecisionArtifact;
}): SportsNhlStanleyCupChampion20252026LimitedProdReadinessArtifacts => {
  const artifacts = buildSportsNhlStanleyCupChampion20252026LimitedProdReadinessArtifacts(input);

  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-nhl-stanley-cup-champion-2025-2026-limited-prod-readiness.json",
    artifacts.readiness
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-nhl-stanley-cup-champion-2025-2026-pair-limited-prod-readiness.json",
    artifacts.pairReadiness
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-nhl-stanley-cup-champion-2025-2026-admin-surface-summary.json",
    artifacts.adminSurfaceSummary
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-nhl-stanley-cup-champion-2025-2026-pair-admin-surface-summary.json",
    artifacts.pairAdminSurfaceSummary
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-nhl-stanley-cup-champion-2025-2026-readiness-vs-matcher-delta.json",
    artifacts.readinessVsMatcherDelta
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-nhl-stanley-cup-champion-2025-2026-pair-readiness-vs-matcher-delta.json",
    artifacts.pairReadinessVsMatcherDelta
  );
  writeMarkdownArtifact(
    input.repoRoot,
    "docs/generated/sports/sports-nhl-stanley-cup-champion-2025-2026-lane-operator-summary.md",
    `${artifacts.operatorSummary}\n`
  );
  writeMarkdownArtifact(
    input.repoRoot,
    "docs/generated/sports/sports-nhl-stanley-cup-champion-2025-2026-pair-lane-operator-summary.md",
    `${artifacts.pairOperatorSummary}\n`
  );

  return artifacts;
};
