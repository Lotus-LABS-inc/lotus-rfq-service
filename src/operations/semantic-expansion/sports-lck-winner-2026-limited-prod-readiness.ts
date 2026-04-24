import { createHash } from "node:crypto";

import { readArtifact, writeArtifact, writeMarkdownArtifact } from "./shared.js";
import {
  sportsLckWinner2026PairLimitlessPolymarketLaneId,
  sportsLckWinner2026TriLaneId
} from "./sports-lck-winner-2026-limited-prod-shared.js";

const TOPIC_KEY = "SPORTS|LEAGUE_WINNER|LCK|2026" as const;
const TRI_VENUE_SET = "LIMITLESS|OPINION|POLYMARKET" as const;
const PRIMARY_PAIR_ROUTE = "LIMITLESS|POLYMARKET" as const;

const matcherInputSummaryPath =
  "artifacts/sports/lck-winner-2026-matcher/sports-lck-winner-2026-matcher-input-summary.json";
const matcherPairLanesPath =
  "artifacts/sports/lck-winner-2026-matcher/sports-lck-winner-2026-pair-lanes.json";
const matcherTriLanesPath =
  "artifacts/sports/lck-winner-2026-matcher/sports-lck-winner-2026-tri-lanes.json";
const matcherRejectionsPath =
  "artifacts/sports/lck-winner-2026-matcher/sports-lck-winner-2026-rejections.json";
const matcherFinalDecisionPath =
  "artifacts/sports/lck-winner-2026-matcher/sports-lck-winner-2026-final-decision.json";
const matcherOperatorSummaryPath =
  "artifacts/sports/lck-winner-2026-matcher/sports-lck-winner-2026-operator-summary.md";

type SportsLimitedProdReadinessDecision =
  | "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
  | "READY_BUT_MISSING_OPERATOR_REVIEW"
  | "NOT_READY_FOR_LIMITED_PROD";

type SportsLckWinner2026LimitedProdReadinessLabel =
  | "SPORTS_LCK_WINNER_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
  | "SPORTS_LCK_WINNER_2026_LIMITED_PROD_READY_FOR_REVIEW"
  | "SPORTS_LCK_WINNER_2026_LIMITED_PROD_NOT_APPROVED";

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

export interface SportsLckWinner2026LimitedProdReadinessArtifact {
  observedAt: string;
  laneId: typeof sportsLckWinner2026TriLaneId;
  topicKey: typeof TOPIC_KEY;
  triVenueSet: typeof TRI_VENUE_SET;
  exactSafeTriTeams: readonly string[];
  peerPairRoute: {
    laneId: typeof sportsLckWinner2026PairLimitlessPolymarketLaneId;
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
    fallbackLaneId: typeof sportsLckWinner2026PairLimitlessPolymarketLaneId;
    operatorSteps: readonly string[];
  };
  exclusionsStillMandatory: readonly string[];
  finalReadinessLabel: SportsLckWinner2026LimitedProdReadinessLabel;
}

export interface SportsLckWinner2026PairLimitedProdReadinessArtifact {
  observedAt: string;
  laneId: typeof sportsLckWinner2026PairLimitlessPolymarketLaneId;
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
  finalReadinessLabel: SportsLckWinner2026LimitedProdReadinessLabel;
}

export interface SportsLckWinner2026AdminSurfaceSummaryArtifact {
  observedAt: string;
  laneId: typeof sportsLckWinner2026TriLaneId;
  topicKey: typeof TOPIC_KEY;
  triVenueSet: typeof TRI_VENUE_SET;
  teamScopeHash: string;
  exactSafeTriTeams: readonly string[];
  peerPairLaneId: typeof sportsLckWinner2026PairLimitlessPolymarketLaneId;
  peerPairVenuePair: typeof PRIMARY_PAIR_ROUTE;
  currentReadinessDecision: SportsLimitedProdReadinessDecision;
  supportedActions: readonly ["inspect", "hold", "promote", "rollback"];
  userConsentCanWidenScope: false;
  narrowestEnforceableUnit: "LANE_SCOPE_LOCK";
  sourceArtifactRefs: readonly string[];
}

export interface SportsLckWinner2026PairAdminSurfaceSummaryArtifact {
  observedAt: string;
  laneId: typeof sportsLckWinner2026PairLimitlessPolymarketLaneId;
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

export interface SportsLckWinner2026ReadinessVsMatcherDeltaArtifact {
  observedAt: string;
  laneId: typeof sportsLckWinner2026TriLaneId;
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
    finalReadinessLabel: SportsLckWinner2026LimitedProdReadinessLabel;
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

export interface SportsLckWinner2026PairReadinessVsMatcherDeltaArtifact {
  observedAt: string;
  laneId: typeof sportsLckWinner2026PairLimitlessPolymarketLaneId;
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
    finalReadinessLabel: SportsLckWinner2026LimitedProdReadinessLabel;
    readinessReviewJustified: boolean;
    operatorRuleReviewRequired: boolean;
    rolloutRecommended: false;
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY";
    exactLaneScopeLocked: true;
  };
  intentionallyUnchanged: readonly string[];
  stillBlocked: readonly string[];
}

export interface SportsLckWinner2026LimitedProdReadinessArtifacts {
  readiness: SportsLckWinner2026LimitedProdReadinessArtifact;
  pairReadiness: SportsLckWinner2026PairLimitedProdReadinessArtifact;
  adminSurfaceSummary: SportsLckWinner2026AdminSurfaceSummaryArtifact;
  pairAdminSurfaceSummary: SportsLckWinner2026PairAdminSurfaceSummaryArtifact;
  readinessVsMatcherDelta: SportsLckWinner2026ReadinessVsMatcherDeltaArtifact;
  pairReadinessVsMatcherDelta: SportsLckWinner2026PairReadinessVsMatcherDeltaArtifact;
  operatorSummary: string;
  pairOperatorSummary: string;
}

const buildTeamScopeHash = (teams: readonly string[]): string =>
  createHash("sha256")
    .update([...teams].sort((left, right) => left.localeCompare(right)).join("|"))
    .digest("hex")
    .slice(0, 16);

export const loadSportsLckWinner2026MatcherArtifacts = (repoRoot: string) => ({
  inputSummary: readArtifact<MatcherInputSummaryArtifact>(repoRoot, matcherInputSummaryPath),
  pairLanes: readArtifact<MatcherPairLanesArtifact>(repoRoot, matcherPairLanesPath),
  triLanes: readArtifact<MatcherTriLanesArtifact>(repoRoot, matcherTriLanesPath),
  rejections: readArtifact<MatcherRejectionsArtifact>(repoRoot, matcherRejectionsPath),
  finalDecision: readArtifact<MatcherFinalDecisionArtifact>(repoRoot, matcherFinalDecisionPath)
});

export const buildSportsLckWinner2026LimitedProdReadinessArtifacts = (input: {
  inputSummary: MatcherInputSummaryArtifact;
  pairLanes: MatcherPairLanesArtifact;
  triLanes: MatcherTriLanesArtifact;
  rejections: MatcherRejectionsArtifact;
  finalDecision: MatcherFinalDecisionArtifact;
}): SportsLckWinner2026LimitedProdReadinessArtifacts => {
  const exactSafeTriTeams = input.triLanes.matcherLanes
    .filter((lane) => lane.venueSet === TRI_VENUE_SET)
    .flatMap((lane) => lane.clubs)
    .sort();
  const exactSafePairTeams = input.pairLanes.matcherLanes
    .filter((lane) => lane.venuePair === PRIMARY_PAIR_ROUTE)
    .map((lane) => lane.club)
    .sort();

  const triRuleStatus =
    input.pairLanes.matcherLanes.find((lane) => lane.venuePair === PRIMARY_PAIR_ROUTE)?.rulesDecision
    ?? input.finalDecision.ruleStatus;
  const pairRuleStatus =
    input.pairLanes.matcherLanes.find((lane) => lane.venuePair === PRIMARY_PAIR_ROUTE)?.rulesDecision
    ?? input.finalDecision.ruleStatus;
  const triOperatorRuleReviewRequired = triRuleStatus !== "EXACT_RULE_COMPATIBLE";
  const pairOperatorRuleReviewRequired = pairRuleStatus !== "EXACT_RULE_COMPATIBLE";

  const triMatcherReady = input.finalDecision.triMatcherReady && exactSafeTriTeams.length > 0;
  const pairMatcherReady = input.finalDecision.pairMatcherReady && exactSafePairTeams.length > 0;

  const exactTriScopeLocked =
    input.inputSummary.exactTopic === TOPIC_KEY
    && exactSafeTriTeams.length === 3
    && input.finalDecision.bestPair === PRIMARY_PAIR_ROUTE
    && exactSafePairTeams.length === 5;
  const exactPairScopeLocked =
    input.inputSummary.exactTopic === TOPIC_KEY
    && input.finalDecision.bestPair === PRIMARY_PAIR_ROUTE
    && exactSafePairTeams.length === 5;

  const triReadinessReviewJustified =
    triMatcherReady && input.finalDecision.operatorCredible && exactTriScopeLocked;
  const pairReadinessReviewJustified =
    pairMatcherReady && input.finalDecision.operatorCredible && exactPairScopeLocked;

  const triFinalReadinessLabel: SportsLckWinner2026LimitedProdReadinessLabel =
    !triMatcherReady || !input.finalDecision.operatorCredible || !exactTriScopeLocked
      ? "SPORTS_LCK_WINNER_2026_LIMITED_PROD_NOT_APPROVED"
      : triOperatorRuleReviewRequired
        ? "SPORTS_LCK_WINNER_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
        : "SPORTS_LCK_WINNER_2026_LIMITED_PROD_READY_FOR_REVIEW";

  const pairFinalReadinessLabel: SportsLckWinner2026LimitedProdReadinessLabel =
    !pairMatcherReady || !input.finalDecision.operatorCredible || !exactPairScopeLocked
      ? "SPORTS_LCK_WINNER_2026_LIMITED_PROD_NOT_APPROVED"
      : pairOperatorRuleReviewRequired
        ? "SPORTS_LCK_WINNER_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
        : "SPORTS_LCK_WINNER_2026_LIMITED_PROD_READY_FOR_REVIEW";

  const commonExclusions = [
    "OTHERS_EXCLUDED",
    "VENUE_ONLY_TAILS_EXCLUDED",
    "NO_SCOPE_WIDENING_BEYOND_LCK_2026",
    "STRICT_TRI_CORE_REMAINS_3_TEAMS"
  ] as const;

  const sourceArtifactRefs = [
    matcherInputSummaryPath,
    matcherPairLanesPath,
    matcherTriLanesPath,
    matcherRejectionsPath,
    matcherFinalDecisionPath,
    matcherOperatorSummaryPath
  ] as const;

  const readiness: SportsLckWinner2026LimitedProdReadinessArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsLckWinner2026TriLaneId,
    topicKey: TOPIC_KEY,
    triVenueSet: TRI_VENUE_SET,
    exactSafeTriTeams,
    peerPairRoute: {
      laneId: sportsLckWinner2026PairLimitlessPolymarketLaneId,
      venuePair: PRIMARY_PAIR_ROUTE,
      exactSafeTeams: exactSafePairTeams
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
        "Any drift in the strict tri 3-team LCK core",
        "Any venue withdrawal from LIMITLESS|OPINION|POLYMARKET",
        "Any rule-compatibility downgrade beyond semantically compatible rewording"
      ],
      userConsentCanWidenScope: false
    },
    rollbackPolicy: {
      scope: "LANE_ONLY",
      targetMode: "PAIR_ROUTE_INTERNAL_REVIEW_ONLY",
      fallbackLaneId: sportsLckWinner2026PairLimitlessPolymarketLaneId,
      operatorSteps: [
        "Hold the strict tri lane only.",
        "Leave LIMITLESS|POLYMARKET explicit as the narrower LCK route.",
        "Do not widen beyond the exact 3-team strict tri core during rollback."
      ]
    },
    exclusionsStillMandatory: commonExclusions,
    finalReadinessLabel: triFinalReadinessLabel
  };

  const pairReadiness: SportsLckWinner2026PairLimitedProdReadinessArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsLckWinner2026PairLimitlessPolymarketLaneId,
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
        "Any drift in the LIMITLESS|POLYMARKET shared LCK core",
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
        "Do not widen beyond the exact LIMITLESS|POLYMARKET 5-team scope."
      ]
    },
    exclusionsStillMandatory: commonExclusions,
    finalReadinessLabel: pairFinalReadinessLabel
  };

  const triDecision: SportsLimitedProdReadinessDecision =
    !triMatcherReady || !input.finalDecision.operatorCredible || !exactTriScopeLocked
      ? "NOT_READY_FOR_LIMITED_PROD"
      : triOperatorRuleReviewRequired
        ? "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
        : "READY_BUT_MISSING_OPERATOR_REVIEW";

  const pairDecision: SportsLimitedProdReadinessDecision =
    !pairMatcherReady || !input.finalDecision.operatorCredible || !exactPairScopeLocked
      ? "NOT_READY_FOR_LIMITED_PROD"
      : pairOperatorRuleReviewRequired
        ? "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
        : "READY_BUT_MISSING_OPERATOR_REVIEW";

  const adminSurfaceSummary: SportsLckWinner2026AdminSurfaceSummaryArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsLckWinner2026TriLaneId,
    topicKey: TOPIC_KEY,
    triVenueSet: TRI_VENUE_SET,
    teamScopeHash: buildTeamScopeHash(exactSafeTriTeams),
    exactSafeTriTeams,
    peerPairLaneId: sportsLckWinner2026PairLimitlessPolymarketLaneId,
    peerPairVenuePair: PRIMARY_PAIR_ROUTE,
    currentReadinessDecision: triDecision,
    supportedActions: ["inspect", "hold", "promote", "rollback"],
    userConsentCanWidenScope: false,
    narrowestEnforceableUnit: "LANE_SCOPE_LOCK",
    sourceArtifactRefs
  };

  const pairAdminSurfaceSummary: SportsLckWinner2026PairAdminSurfaceSummaryArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsLckWinner2026PairLimitlessPolymarketLaneId,
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

  const readinessVsMatcherDelta: SportsLckWinner2026ReadinessVsMatcherDeltaArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsLckWinner2026TriLaneId,
    matcherTruthConsumed: {
      topicKey: TOPIC_KEY,
      bestPair: input.finalDecision.bestPair,
      bestTriIfAny: TRI_VENUE_SET,
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
      "No widening beyond LCK 2026",
      "No venue-only tails admitted into strict tri lane",
      "No automatic promotion implied"
    ],
    stillBlocked: triOperatorRuleReviewRequired
      ? ["Operator rule review still required before production promotion."]
      : []
  };

  const pairReadinessVsMatcherDelta: SportsLckWinner2026PairReadinessVsMatcherDeltaArtifact = {
    observedAt: new Date().toISOString(),
    laneId: sportsLckWinner2026PairLimitlessPolymarketLaneId,
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
    "# LCK Winner 2026 Limited-Prod Readiness",
    "",
    `- topic: ${TOPIC_KEY}`,
    `- strict tri lane id: ${sportsLckWinner2026TriLaneId}`,
    `- strict tri teams: ${exactSafeTriTeams.join(", ") || "none"}`,
    `- strict tri readiness label: ${triFinalReadinessLabel}`,
    `- peer pair lane id: ${sportsLckWinner2026PairLimitlessPolymarketLaneId}`,
    `- peer pair teams: ${exactSafePairTeams.join(", ") || "none"}`,
    "- pair route stays explicit: yes",
    `- rule status: ${input.finalDecision.ruleStatus}`,
    `- operator rule review required: ${triOperatorRuleReviewRequired ? "yes" : "no"}`,
    "- no widening beyond the exact LCK 2026 topic"
  ].join("\n");

  const pairOperatorSummary = [
    "# LCK Winner 2026 Pair Readiness",
    "",
    `- topic: ${TOPIC_KEY}`,
    `- pair lane id: ${sportsLckWinner2026PairLimitlessPolymarketLaneId}`,
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

export const writeSportsLckWinner2026LimitedProdReadinessArtifacts = (input: {
  repoRoot: string;
  inputSummary: MatcherInputSummaryArtifact;
  pairLanes: MatcherPairLanesArtifact;
  triLanes: MatcherTriLanesArtifact;
  rejections: MatcherRejectionsArtifact;
  finalDecision: MatcherFinalDecisionArtifact;
}): SportsLckWinner2026LimitedProdReadinessArtifacts => {
  const artifacts = buildSportsLckWinner2026LimitedProdReadinessArtifacts(input);

  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-lck-winner-2026-limited-prod-readiness.json",
    artifacts.readiness
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-lck-winner-2026-pair-limited-prod-readiness.json",
    artifacts.pairReadiness
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-lck-winner-2026-admin-surface-summary.json",
    artifacts.adminSurfaceSummary
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-lck-winner-2026-pair-admin-surface-summary.json",
    artifacts.pairAdminSurfaceSummary
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-lck-winner-2026-readiness-vs-matcher-delta.json",
    artifacts.readinessVsMatcherDelta
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/sports/core/sports-lck-winner-2026-pair-readiness-vs-matcher-delta.json",
    artifacts.pairReadinessVsMatcherDelta
  );
  writeMarkdownArtifact(
    input.repoRoot,
    "docs/generated/sports/sports-lck-winner-2026-lane-operator-summary.md",
    `${artifacts.operatorSummary}\n`
  );
  writeMarkdownArtifact(
    input.repoRoot,
    "docs/generated/sports/sports-lck-winner-2026-pair-lane-operator-summary.md",
    `${artifacts.pairOperatorSummary}\n`
  );

  return artifacts;
};
