import { createHash } from "node:crypto";

import type { PoliticsNomineeRuleCompatibilityClass } from "../../matching/politics/politics-types.js";
import { readArtifact, writeArtifact, writeMarkdownArtifact } from "./shared.js";
import {
  geopoliticalTrumpAcquireGreenland20261231LimitlessOpinionPairLaneId,
  geopoliticalTrumpAcquireGreenland20261231LimitlessPolymarketPairLaneId,
  geopoliticalTrumpAcquireGreenland20261231LimitlessPredictPairLaneId,
  geopoliticalTrumpAcquireGreenland20261231OpinionPolymarketPairLaneId,
  geopoliticalTrumpAcquireGreenland20261231OpinionPredictPairLaneId,
  geopoliticalTrumpAcquireGreenland20261231PolymarketPredictPairLaneId,
  geopoliticalTrumpAcquireGreenland20261231TriLaneId
} from "./politics-geopolitical-trump-acquire-greenland-2026-12-31-limited-prod-shared.js";

const TOPIC_KEY = "GEOPOLITICAL_EVENT_BY_DATE|USA_GREENLAND|TRUMP_ACQUIRE_GREENLAND|2026-12-31" as const;
const TRI_VENUE_SET = "LIMITLESS|OPINION|POLYMARKET|PREDICT" as const;
const TRI_LANE_ID = geopoliticalTrumpAcquireGreenland20261231TriLaneId;
const PAIR_LANE_IDS = {
  "LIMITLESS|POLYMARKET": geopoliticalTrumpAcquireGreenland20261231LimitlessPolymarketPairLaneId,
  "LIMITLESS|OPINION": geopoliticalTrumpAcquireGreenland20261231LimitlessOpinionPairLaneId,
  "LIMITLESS|PREDICT": geopoliticalTrumpAcquireGreenland20261231LimitlessPredictPairLaneId,
  "OPINION|POLYMARKET": geopoliticalTrumpAcquireGreenland20261231OpinionPolymarketPairLaneId,
  "OPINION|PREDICT": geopoliticalTrumpAcquireGreenland20261231OpinionPredictPairLaneId,
  "POLYMARKET|PREDICT": geopoliticalTrumpAcquireGreenland20261231PolymarketPredictPairLaneId
} as const;

const matcherInputSummaryPath =
  "artifacts/politics/geopolitical-trump-acquire-greenland-2026-12-31-matcher/politics-geopolitical-trump-acquire-greenland-2026-12-31-matcher-input-summary.json";
const matcherPairLanesPath =
  "artifacts/politics/geopolitical-trump-acquire-greenland-2026-12-31-matcher/politics-geopolitical-trump-acquire-greenland-2026-12-31-pair-lanes.json";
const matcherTriLanesPath =
  "artifacts/politics/geopolitical-trump-acquire-greenland-2026-12-31-matcher/politics-geopolitical-trump-acquire-greenland-2026-12-31-tri-lanes.json";
const matcherRejectionsPath =
  "artifacts/politics/geopolitical-trump-acquire-greenland-2026-12-31-matcher/politics-geopolitical-trump-acquire-greenland-2026-12-31-rejections.json";
const matcherFinalDecisionPath =
  "artifacts/politics/geopolitical-trump-acquire-greenland-2026-12-31-matcher/politics-geopolitical-trump-acquire-greenland-2026-12-31-final-decision.json";
const matcherOperatorSummaryPath =
  "artifacts/politics/geopolitical-trump-acquire-greenland-2026-12-31-matcher/politics-geopolitical-trump-acquire-greenland-2026-12-31-operator-summary.md";

type LimitedProdReadinessDecision =
  | "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
  | "READY_BUT_MISSING_OPERATOR_REVIEW"
  | "NOT_READY_FOR_LIMITED_PROD";

type ReadinessLabel =
  | "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_LIMITED_PROD_READY_FOR_REVIEW"
  | "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
  | "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_LIMITED_PROD_HELD"
  | "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_LIMITED_PROD_NOT_APPROVED";

type PairVenueSet = keyof typeof PAIR_LANE_IDS;
type PairLaneId = (typeof PAIR_LANE_IDS)[PairVenueSet];

interface MatcherInputSummaryArtifact {
  exactTopic: string;
  refreshedRowsUsed: unknown;
  familyComparabilitySourceArtifacts: Record<string, string>;
  admittedVenues: string[];
  admittedProposition: string;
}

interface MatcherPairLanesArtifact {
  canonicalTopicKey: string;
  matcherLanes: {
    venuePair: PairVenueSet;
    proposition: string;
    canonicalTopic: string;
    routeabilityDecision: string;
    rulesDecision: PoliticsNomineeRuleCompatibilityClass;
    evidence: {
      venue: string;
      venueMarketId: string;
      title: string;
    }[];
    evidenceNotes: string[];
  }[];
}

interface MatcherTriLanesArtifact {
  canonicalTopicKey: string;
  venueSet: string;
  matcherLanes: {
    venueSet: string;
    proposition: string;
    canonicalTopic: string;
    routeabilityDecision: string;
    rulesDecision: PoliticsNomineeRuleCompatibilityClass;
    evidence: {
      venue: string;
      venueMarketId: string;
      title: string;
    }[];
    evidenceNotes: string[];
  }[];
}

interface MatcherRejectionsArtifact {
  rejections: {
    scope: "pair_lane" | "tri_lane" | "venue";
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

export interface GeopoliticalTrumpAcquireGreenland20261231TriLimitedProdReadinessArtifact {
  observedAt: string;
  laneId: typeof TRI_LANE_ID;
  topicKey: typeof TOPIC_KEY;
  triVenueSet: typeof TRI_VENUE_SET;
  exactSafeTriPropositions: readonly string[];
  peerPairRoutes: readonly {
    laneId: PairLaneId;
    venuePair: PairVenueSet;
    exactSafePropositions: readonly string[];
  }[];
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
    targetMode: "PAIR_ROUTE_INTERNAL_REVIEW_ONLY";
    fallbackLaneIds: readonly PairLaneId[];
    operatorSteps: readonly string[];
  };
  exclusionsStillMandatory: readonly string[];
  finalReadinessLabel: ReadinessLabel;
}

export interface GeopoliticalTrumpAcquireGreenland20261231PairLimitedProdReadinessArtifact {
  observedAt: string;
  laneId: PairLaneId;
  topicKey: typeof TOPIC_KEY;
  venuePair: PairVenueSet;
  exactSafePropositions: readonly string[];
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
  finalReadinessLabel: ReadinessLabel;
}

export interface GeopoliticalTrumpAcquireGreenland20261231AdminSurfaceSummaryArtifact {
  observedAt: string;
  laneId: typeof TRI_LANE_ID;
  topicKey: typeof TOPIC_KEY;
  triVenueSet: typeof TRI_VENUE_SET;
  propositionScopeHash: string;
  exactSafeTriPropositions: readonly string[];
  peerPairRouteLaneIds: readonly PairLaneId[];
  currentReadinessDecision: LimitedProdReadinessDecision;
  supportedActions: readonly ["inspect", "hold", "promote", "rollback"];
  userConsentCanWidenScope: false;
  narrowestEnforceableUnit: "LANE_SCOPE_LOCK";
  sourceArtifactRefs: readonly string[];
}

export interface GeopoliticalTrumpAcquireGreenland20261231PairAdminSurfaceSummaryArtifact {
  observedAt: string;
  laneId: PairLaneId;
  topicKey: typeof TOPIC_KEY;
  venuePair: PairVenueSet;
  propositionScopeHash: string;
  exactSafePropositions: readonly string[];
  currentReadinessDecision: LimitedProdReadinessDecision;
  supportedActions: readonly ["inspect", "hold", "promote", "rollback"];
  userConsentCanWidenScope: false;
  narrowestEnforceableUnit: "LANE_SCOPE_LOCK";
  sourceArtifactRefs: readonly string[];
}

export interface GeopoliticalTrumpAcquireGreenland20261231ReadinessVsMatcherDeltaArtifact {
  observedAt: string;
  laneId: typeof TRI_LANE_ID;
  matcherTruthConsumed: {
    topicKey: string;
    bestPair: string | null;
    bestTriIfAny: string | null;
    exactSafeTriPropositions: readonly string[];
    exactSafePairRoutes: readonly { venuePair: PairVenueSet; exactSafePropositions: readonly string[] }[];
    overallDecision: string;
    triMatcherReady: boolean;
    pairMatcherReady: boolean;
    operatorCredible: boolean;
    ruleStatus: PoliticsNomineeRuleCompatibilityClass;
  };
  readinessConclusionsDerived: {
    finalReadinessLabel: ReadinessLabel;
    readinessReviewJustified: boolean;
    operatorRuleReviewRequired: boolean;
    rolloutRecommended: false;
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY";
    exactLaneScopeLocked: true;
    peerPairRoutesStillExplicit: true;
  };
  intentionallyUnchanged: readonly string[];
  stillBlocked: readonly string[];
}

export interface GeopoliticalTrumpAcquireGreenland20261231PairReadinessVsMatcherDeltaArtifact {
  observedAt: string;
  laneId: PairLaneId;
  matcherTruthConsumed: {
    topicKey: string;
    venuePair: PairVenueSet;
    exactSafePropositions: readonly string[];
    overallDecision: string;
    pairMatcherReady: boolean;
    operatorCredible: boolean;
    ruleStatus: PoliticsNomineeRuleCompatibilityClass;
  };
  readinessConclusionsDerived: {
    finalReadinessLabel: ReadinessLabel;
    readinessReviewJustified: boolean;
    operatorRuleReviewRequired: boolean;
    rolloutRecommended: false;
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY";
    exactLaneScopeLocked: true;
  };
  intentionallyUnchanged: readonly string[];
  stillBlocked: readonly string[];
}

export interface PoliticsGeopoliticalTrumpAcquireGreenland20261231LimitedProdReadinessArtifacts {
  readiness: GeopoliticalTrumpAcquireGreenland20261231TriLimitedProdReadinessArtifact;
  pairReadinessByVenuePair: Record<PairVenueSet, GeopoliticalTrumpAcquireGreenland20261231PairLimitedProdReadinessArtifact>;
  adminSurfaceSummary: GeopoliticalTrumpAcquireGreenland20261231AdminSurfaceSummaryArtifact;
  pairAdminSurfaceSummaries: Record<PairVenueSet, GeopoliticalTrumpAcquireGreenland20261231PairAdminSurfaceSummaryArtifact>;
  readinessVsMatcherDelta: GeopoliticalTrumpAcquireGreenland20261231ReadinessVsMatcherDeltaArtifact;
  pairReadinessVsMatcherDeltas: Record<PairVenueSet, GeopoliticalTrumpAcquireGreenland20261231PairReadinessVsMatcherDeltaArtifact>;
  operatorSummary: string;
}

const buildPropositionScopeHash = (propositions: readonly string[]): string =>
  createHash("sha256")
    .update([...propositions].sort((left, right) => left.localeCompare(right)).join("|"))
    .digest("hex")
    .slice(0, 16);

export const loadPoliticsGeopoliticalTrumpAcquireGreenland20261231MatcherArtifacts = (repoRoot: string) => ({
  inputSummary: readArtifact<MatcherInputSummaryArtifact>(repoRoot, matcherInputSummaryPath),
  pairLanes: readArtifact<MatcherPairLanesArtifact>(repoRoot, matcherPairLanesPath),
  triLanes: readArtifact<MatcherTriLanesArtifact>(repoRoot, matcherTriLanesPath),
  rejections: readArtifact<MatcherRejectionsArtifact>(repoRoot, matcherRejectionsPath),
  finalDecision: readArtifact<MatcherFinalDecisionArtifact>(repoRoot, matcherFinalDecisionPath)
});

export const buildPoliticsGeopoliticalTrumpAcquireGreenland20261231LimitedProdReadinessArtifacts = (input: {
  inputSummary: MatcherInputSummaryArtifact;
  pairLanes: MatcherPairLanesArtifact;
  triLanes: MatcherTriLanesArtifact;
  rejections: MatcherRejectionsArtifact;
  finalDecision: MatcherFinalDecisionArtifact;
}): PoliticsGeopoliticalTrumpAcquireGreenland20261231LimitedProdReadinessArtifacts => {
  const exactSafeTriPropositions = input.triLanes.matcherLanes.map((lane) => lane.proposition);
  const pairRoutes = Object.keys(PAIR_LANE_IDS).map((venuePair) => {
    const exactSafePropositions = input.pairLanes.matcherLanes
      .filter((lane) => lane.venuePair === venuePair)
      .map((lane) => lane.proposition);
    return {
      venuePair: venuePair as PairVenueSet,
      laneId: PAIR_LANE_IDS[venuePair as PairVenueSet],
      exactSafePropositions
    };
  });

  const triRuleStatus = input.triLanes.matcherLanes[0]?.rulesDecision ?? input.finalDecision.ruleStatus;
  const triOperatorRuleReviewRequired = triRuleStatus !== "EXACT_RULE_COMPATIBLE";
  const triMatcherReady =
    input.finalDecision.overallDecision === "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_TRI_READY_BUT_PAIR_FIRST"
    || input.finalDecision.overallDecision === "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_TRI_REVIEW_REQUIRED";

  const exactTriScopeLocked =
    input.inputSummary.exactTopic === TOPIC_KEY
    && input.finalDecision.bestTriIfAny === TRI_VENUE_SET
    && exactSafeTriPropositions.length === 1
    && exactSafeTriPropositions[0] === "TRUMP_ACQUIRE_GREENLAND_BY_2026_12_31"
    && pairRoutes.every((route) => route.exactSafePropositions.length === 1 && route.exactSafePropositions[0] === "TRUMP_ACQUIRE_GREENLAND_BY_2026_12_31");

  const triReadinessReviewJustified = triMatcherReady && input.finalDecision.operatorCredible && exactTriScopeLocked;
  const triFinalReadinessLabel: ReadinessLabel =
    !triMatcherReady || !input.finalDecision.operatorCredible || !exactTriScopeLocked
      ? "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_LIMITED_PROD_NOT_APPROVED"
      : triOperatorRuleReviewRequired
        ? "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
        : "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_LIMITED_PROD_READY_FOR_REVIEW";

  const commonExclusions = [
    "NO_MYRIAD_FOR_THIS_TOPIC",
    "NO_SCOPE_WIDENING_BEYOND_TRUMP_ACQUIRE_GREENLAND_2026_12_31"
  ] as const;

  const readiness: GeopoliticalTrumpAcquireGreenland20261231TriLimitedProdReadinessArtifact = {
    observedAt: new Date().toISOString(),
    laneId: TRI_LANE_ID,
    topicKey: TOPIC_KEY,
    triVenueSet: TRI_VENUE_SET,
    exactSafeTriPropositions,
    peerPairRoutes: pairRoutes,
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
        "proposition_scope_drift",
        "tri_venue_set_drift",
        "rule_status_drift",
        "operator_confidence_lost"
      ],
      userConsentCanWidenScope: false
    },
    rollbackPolicy: {
      scope: "LANE_ONLY",
      targetMode: "PAIR_ROUTE_INTERNAL_REVIEW_ONLY",
      fallbackLaneIds: pairRoutes.map((route) => route.laneId),
      operatorSteps: [
        "Record a lane-scoped rollback or hold event for the exact Greenland-acquisition tri lane.",
        "Revert this tri lane to one or more separately approved pair routes in internal-review-only posture.",
        "Do not widen to MYRIAD or any broader Greenland territorial-acquisition topic during rollback."
      ]
    },
    exclusionsStillMandatory: [...commonExclusions, "PAIR_ROUTES_MUST_REMAIN_EXPLICIT"],
    finalReadinessLabel: triFinalReadinessLabel
  };

  const pairReadinessByVenuePair = Object.fromEntries(
    pairRoutes.map((route) => {
      const pairRuleStatus =
        input.pairLanes.matcherLanes.find((lane) => lane.venuePair === route.venuePair)?.rulesDecision
        ?? input.finalDecision.ruleStatus;
      const operatorRuleReviewRequired = pairRuleStatus !== "EXACT_RULE_COMPATIBLE";
      const matcherReady = input.finalDecision.pairMatcherReady && route.exactSafePropositions.length > 0;
      const exactLaneScopeLocked =
        input.inputSummary.exactTopic === TOPIC_KEY
        && route.exactSafePropositions.length === 1
        && route.exactSafePropositions[0] === "TRUMP_ACQUIRE_GREENLAND_BY_2026_12_31";
      const readinessReviewJustified = matcherReady && input.finalDecision.operatorCredible && exactLaneScopeLocked;
      const finalReadinessLabel: ReadinessLabel =
        !matcherReady || !input.finalDecision.operatorCredible || !exactLaneScopeLocked
          ? "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_LIMITED_PROD_NOT_APPROVED"
          : operatorRuleReviewRequired
            ? "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
            : "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_LIMITED_PROD_READY_FOR_REVIEW";

      const artifact: GeopoliticalTrumpAcquireGreenland20261231PairLimitedProdReadinessArtifact = {
        observedAt: new Date().toISOString(),
        laneId: route.laneId,
        topicKey: TOPIC_KEY,
        venuePair: route.venuePair,
        exactSafePropositions: route.exactSafePropositions,
        ruleStatus: pairRuleStatus,
        operatorRuleReviewRequired,
        matcherReady,
        operatorCredible: input.finalDecision.operatorCredible,
        readinessReviewJustified,
        rolloutRecommended: false,
        recommendedMode: "LIMITED_PROD_REVIEW_ONLY",
        holdPolicy: {
          scope: "LANE_ONLY",
          holdConditions: [
            "proposition_scope_drift",
            "pair_venue_set_drift",
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
            `Record a lane-scoped rollback or hold event for ${route.laneId}.`,
            "Keep this pair lane disabled/internal-only until refreshed matcher and readiness artifacts are regenerated.",
            "Do not widen this pair route into tri or MYRIAD during rollback."
          ]
        },
        exclusionsStillMandatory: commonExclusions,
        finalReadinessLabel
      };

      return [route.venuePair, artifact];
    })
  ) as Record<PairVenueSet, GeopoliticalTrumpAcquireGreenland20261231PairLimitedProdReadinessArtifact>;

  const adminSurfaceSummary: GeopoliticalTrumpAcquireGreenland20261231AdminSurfaceSummaryArtifact = {
    observedAt: new Date().toISOString(),
    laneId: TRI_LANE_ID,
    topicKey: TOPIC_KEY,
    triVenueSet: TRI_VENUE_SET,
    propositionScopeHash: buildPropositionScopeHash(exactSafeTriPropositions),
    exactSafeTriPropositions,
    peerPairRouteLaneIds: pairRoutes.map((route) => route.laneId),
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

  const pairAdminSurfaceSummaries = Object.fromEntries(
    pairRoutes.map((route) => {
      const pairArtifact = pairReadinessByVenuePair[route.venuePair];
      const summary: GeopoliticalTrumpAcquireGreenland20261231PairAdminSurfaceSummaryArtifact = {
        observedAt: new Date().toISOString(),
        laneId: route.laneId,
        topicKey: TOPIC_KEY,
        venuePair: route.venuePair,
        propositionScopeHash: buildPropositionScopeHash(route.exactSafePropositions),
        exactSafePropositions: route.exactSafePropositions,
        currentReadinessDecision: pairArtifact.readinessReviewJustified
          ? "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
          : pairArtifact.matcherReady
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
      return [route.venuePair, summary];
    })
  ) as Record<PairVenueSet, GeopoliticalTrumpAcquireGreenland20261231PairAdminSurfaceSummaryArtifact>;

  const readinessVsMatcherDelta: GeopoliticalTrumpAcquireGreenland20261231ReadinessVsMatcherDeltaArtifact = {
    observedAt: new Date().toISOString(),
    laneId: TRI_LANE_ID,
    matcherTruthConsumed: {
      topicKey: TOPIC_KEY,
      bestPair: input.finalDecision.bestPair,
      bestTriIfAny: input.finalDecision.bestTriIfAny,
      exactSafeTriPropositions,
      exactSafePairRoutes: pairRoutes.map((route) => ({
        venuePair: route.venuePair,
        exactSafePropositions: route.exactSafePropositions
      })),
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
      peerPairRoutesStillExplicit: true
    },
    intentionallyUnchanged: [
      "matcher logic unchanged",
      "exact proposition scope unchanged",
      "no rollout activation"
    ],
    stillBlocked: triOperatorRuleReviewRequired ? ["operator_rule_review_required"] : []
  };

  const pairReadinessVsMatcherDeltas = Object.fromEntries(
    pairRoutes.map((route) => {
      const pairArtifact = pairReadinessByVenuePair[route.venuePair];
      const delta: GeopoliticalTrumpAcquireGreenland20261231PairReadinessVsMatcherDeltaArtifact = {
        observedAt: new Date().toISOString(),
        laneId: route.laneId,
        matcherTruthConsumed: {
          topicKey: TOPIC_KEY,
          venuePair: route.venuePair,
          exactSafePropositions: route.exactSafePropositions,
          overallDecision: input.finalDecision.overallDecision,
          pairMatcherReady: input.finalDecision.pairMatcherReady,
          operatorCredible: input.finalDecision.operatorCredible,
          ruleStatus: pairArtifact.ruleStatus
        },
        readinessConclusionsDerived: {
          finalReadinessLabel: pairArtifact.finalReadinessLabel,
          readinessReviewJustified: pairArtifact.readinessReviewJustified,
          operatorRuleReviewRequired: pairArtifact.operatorRuleReviewRequired,
          rolloutRecommended: false,
          recommendedMode: "LIMITED_PROD_REVIEW_ONLY",
          exactLaneScopeLocked: true
        },
        intentionallyUnchanged: [
          "matcher logic unchanged",
          "exact proposition scope unchanged",
          "no rollout activation"
        ],
        stillBlocked: pairArtifact.operatorRuleReviewRequired ? ["operator_rule_review_required"] : []
      };
      return [route.venuePair, delta];
    })
  ) as Record<PairVenueSet, GeopoliticalTrumpAcquireGreenland20261231PairReadinessVsMatcherDeltaArtifact>;

  const operatorSummary = [
    "# Trump Acquire Greenland December 31 2026 Limited-Prod Readiness",
    "",
    `- exact topic: ${TOPIC_KEY}`,
    `- exact tri venue set: ${TRI_VENUE_SET}`,
    `- exact-safe tri proposition: ${exactSafeTriPropositions.join(", ") || "none"}`,
    `- first-class pair routes: ${pairRoutes.map((route) => `${route.venuePair} -> ${route.exactSafePropositions.join(", ") || "none"}`).join("; ")}`,
    `- exact rule state: ${triRuleStatus}`,
    `- operator rule review required: ${triOperatorRuleReviewRequired ? "yes" : "no"}`,
    `- matcher ready: ${triMatcherReady ? "yes" : "no"}`,
    `- operator credible: ${input.finalDecision.operatorCredible ? "yes" : "no"}`,
    `- readiness review justified: ${triReadinessReviewJustified ? "yes" : "no"}`,
    "- rollout recommended now: no",
    "- recommended operator action: keep the exact tri lane in limited-prod review only and keep all six pair lanes separately available for users who prefer pair.",
    "- exclusions still mandatory: MYRIAD and any scope widening beyond the exact Greenland-acquisition topic.",
    ""
  ].join("\n");

  return {
    readiness,
    pairReadinessByVenuePair,
    adminSurfaceSummary,
    pairAdminSurfaceSummaries,
    readinessVsMatcherDelta,
    pairReadinessVsMatcherDeltas,
    operatorSummary
  };
};

export const writePoliticsGeopoliticalTrumpAcquireGreenland20261231LimitedProdReadinessArtifacts = (input: {
  repoRoot: string;
  inputSummary: MatcherInputSummaryArtifact;
  pairLanes: MatcherPairLanesArtifact;
  triLanes: MatcherTriLanesArtifact;
  rejections: MatcherRejectionsArtifact;
  finalDecision: MatcherFinalDecisionArtifact;
}): PoliticsGeopoliticalTrumpAcquireGreenland20261231LimitedProdReadinessArtifacts => {
  const artifacts = buildPoliticsGeopoliticalTrumpAcquireGreenland20261231LimitedProdReadinessArtifacts(input);

  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-geopolitical-trump-acquire-greenland-2026-12-31-limited-prod-readiness.json", artifacts.readiness);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-geopolitical-trump-acquire-greenland-2026-12-31-admin-surface-summary.json", artifacts.adminSurfaceSummary);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-geopolitical-trump-acquire-greenland-2026-12-31-readiness-vs-matcher-delta.json", artifacts.readinessVsMatcherDelta);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-geopolitical-trump-acquire-greenland-2026-12-31-limitless-polymarket-pair-limited-prod-readiness.json", artifacts.pairReadinessByVenuePair["LIMITLESS|POLYMARKET"]);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-geopolitical-trump-acquire-greenland-2026-12-31-limitless-opinion-pair-limited-prod-readiness.json", artifacts.pairReadinessByVenuePair["LIMITLESS|OPINION"]);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-geopolitical-trump-acquire-greenland-2026-12-31-limitless-predict-pair-limited-prod-readiness.json", artifacts.pairReadinessByVenuePair["LIMITLESS|PREDICT"]);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-geopolitical-trump-acquire-greenland-2026-12-31-opinion-polymarket-pair-limited-prod-readiness.json", artifacts.pairReadinessByVenuePair["OPINION|POLYMARKET"]);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-geopolitical-trump-acquire-greenland-2026-12-31-opinion-predict-pair-limited-prod-readiness.json", artifacts.pairReadinessByVenuePair["OPINION|PREDICT"]);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-geopolitical-trump-acquire-greenland-2026-12-31-polymarket-predict-pair-limited-prod-readiness.json", artifacts.pairReadinessByVenuePair["POLYMARKET|PREDICT"]);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-geopolitical-trump-acquire-greenland-2026-12-31-limitless-polymarket-pair-admin-surface-summary.json", artifacts.pairAdminSurfaceSummaries["LIMITLESS|POLYMARKET"]);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-geopolitical-trump-acquire-greenland-2026-12-31-limitless-opinion-pair-admin-surface-summary.json", artifacts.pairAdminSurfaceSummaries["LIMITLESS|OPINION"]);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-geopolitical-trump-acquire-greenland-2026-12-31-limitless-predict-pair-admin-surface-summary.json", artifacts.pairAdminSurfaceSummaries["LIMITLESS|PREDICT"]);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-geopolitical-trump-acquire-greenland-2026-12-31-opinion-polymarket-pair-admin-surface-summary.json", artifacts.pairAdminSurfaceSummaries["OPINION|POLYMARKET"]);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-geopolitical-trump-acquire-greenland-2026-12-31-opinion-predict-pair-admin-surface-summary.json", artifacts.pairAdminSurfaceSummaries["OPINION|PREDICT"]);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-geopolitical-trump-acquire-greenland-2026-12-31-polymarket-predict-pair-admin-surface-summary.json", artifacts.pairAdminSurfaceSummaries["POLYMARKET|PREDICT"]);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-geopolitical-trump-acquire-greenland-2026-12-31-limitless-polymarket-pair-readiness-vs-matcher-delta.json", artifacts.pairReadinessVsMatcherDeltas["LIMITLESS|POLYMARKET"]);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-geopolitical-trump-acquire-greenland-2026-12-31-limitless-opinion-pair-readiness-vs-matcher-delta.json", artifacts.pairReadinessVsMatcherDeltas["LIMITLESS|OPINION"]);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-geopolitical-trump-acquire-greenland-2026-12-31-limitless-predict-pair-readiness-vs-matcher-delta.json", artifacts.pairReadinessVsMatcherDeltas["LIMITLESS|PREDICT"]);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-geopolitical-trump-acquire-greenland-2026-12-31-opinion-polymarket-pair-readiness-vs-matcher-delta.json", artifacts.pairReadinessVsMatcherDeltas["OPINION|POLYMARKET"]);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-geopolitical-trump-acquire-greenland-2026-12-31-opinion-predict-pair-readiness-vs-matcher-delta.json", artifacts.pairReadinessVsMatcherDeltas["OPINION|PREDICT"]);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-geopolitical-trump-acquire-greenland-2026-12-31-polymarket-predict-pair-readiness-vs-matcher-delta.json", artifacts.pairReadinessVsMatcherDeltas["POLYMARKET|PREDICT"]);
  writeMarkdownArtifact(input.repoRoot, "docs/generated/politics/politics-geopolitical-trump-acquire-greenland-2026-12-31-lane-operator-summary.md", `${artifacts.operatorSummary}\n`);

  return artifacts;
};
