import { createHash } from "node:crypto";

import type { PoliticsNomineeRuleCompatibilityClass } from "../../matching/politics/politics-types.js";
import { readArtifact, writeArtifact, writeMarkdownArtifact } from "./shared.js";
import {
  officeExitNetanyahu2026PairFallbackLaneId,
  officeExitNetanyahu2026TriLaneId
} from "./politics-office-exit-netanyahu-2026-limited-prod-shared.js";

const TOPIC_KEY = "OFFICE_EXIT_BY_DATE|ISRAEL|PRIME_MINISTER|BENJAMIN_NETANYAHU|2026-12-31" as const;
const TRI_VENUE_SET = "LIMITLESS|POLYMARKET|PREDICT" as const;
const PAIR_FALLBACK = "LIMITLESS|POLYMARKET" as const;
const matcherInputSummaryPath =
  "artifacts/politics/office-exit-netanyahu-2026-matcher/politics-office-exit-netanyahu-2026-matcher-input-summary.json";
const matcherPairLanesPath =
  "artifacts/politics/office-exit-netanyahu-2026-matcher/politics-office-exit-netanyahu-2026-pair-lanes.json";
const matcherTriLanesPath =
  "artifacts/politics/office-exit-netanyahu-2026-matcher/politics-office-exit-netanyahu-2026-tri-lanes.json";
const matcherRejectionsPath =
  "artifacts/politics/office-exit-netanyahu-2026-matcher/politics-office-exit-netanyahu-2026-rejections.json";
const matcherFinalDecisionPath =
  "artifacts/politics/office-exit-netanyahu-2026-matcher/politics-office-exit-netanyahu-2026-final-decision.json";
const matcherOperatorSummaryPath =
  "artifacts/politics/office-exit-netanyahu-2026-matcher/politics-office-exit-netanyahu-2026-operator-summary.md";

type OfficeExitLimitedProdReadinessDecision =
  | "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
  | "READY_BUT_MISSING_OPERATOR_REVIEW"
  | "NOT_READY_FOR_LIMITED_PROD";

type OfficeExitNetanyahu2026LimitedProdReadinessLabel =
  | "OFFICE_EXIT_NETANYAHU_2026_LIMITED_PROD_READY_FOR_REVIEW"
  | "OFFICE_EXIT_NETANYAHU_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
  | "OFFICE_EXIT_NETANYAHU_2026_LIMITED_PROD_HELD"
  | "OFFICE_EXIT_NETANYAHU_2026_LIMITED_PROD_NOT_APPROVED";

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
    venuePair: string;
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

export interface OfficeExitNetanyahu2026LimitedProdReadinessArtifact {
  observedAt: string;
  laneId: typeof officeExitNetanyahu2026TriLaneId;
  topicKey: typeof TOPIC_KEY;
  triVenueSet: typeof TRI_VENUE_SET;
  exactSafeTriPropositions: readonly string[];
  saferPairFallback: {
    laneId: typeof officeExitNetanyahu2026PairFallbackLaneId;
    venuePair: typeof PAIR_FALLBACK;
    exactSafePropositions: readonly string[];
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
    fallbackLaneId: typeof officeExitNetanyahu2026PairFallbackLaneId;
    operatorSteps: readonly string[];
  };
  exclusionsStillMandatory: readonly string[];
  finalReadinessLabel: OfficeExitNetanyahu2026LimitedProdReadinessLabel;
}

export interface OfficeExitNetanyahu2026PairLimitedProdReadinessArtifact {
  observedAt: string;
  laneId: typeof officeExitNetanyahu2026PairFallbackLaneId;
  topicKey: typeof TOPIC_KEY;
  venuePair: typeof PAIR_FALLBACK;
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
  finalReadinessLabel: OfficeExitNetanyahu2026LimitedProdReadinessLabel;
}

export interface OfficeExitNetanyahu2026AdminSurfaceSummaryArtifact {
  observedAt: string;
  laneId: typeof officeExitNetanyahu2026TriLaneId;
  topicKey: typeof TOPIC_KEY;
  triVenueSet: typeof TRI_VENUE_SET;
  propositionScopeHash: string;
  exactSafeTriPropositions: readonly string[];
  saferPairFallbackLaneId: typeof officeExitNetanyahu2026PairFallbackLaneId;
  saferPairFallbackVenuePair: typeof PAIR_FALLBACK;
  currentReadinessDecision: OfficeExitLimitedProdReadinessDecision;
  supportedActions: readonly ["inspect", "hold", "promote", "rollback"];
  userConsentCanWidenScope: false;
  narrowestEnforceableUnit: "LANE_SCOPE_LOCK";
  sourceArtifactRefs: readonly string[];
}

export interface OfficeExitNetanyahu2026PairAdminSurfaceSummaryArtifact {
  observedAt: string;
  laneId: typeof officeExitNetanyahu2026PairFallbackLaneId;
  topicKey: typeof TOPIC_KEY;
  venuePair: typeof PAIR_FALLBACK;
  propositionScopeHash: string;
  exactSafePropositions: readonly string[];
  currentReadinessDecision: OfficeExitLimitedProdReadinessDecision;
  supportedActions: readonly ["inspect", "hold", "promote", "rollback"];
  userConsentCanWidenScope: false;
  narrowestEnforceableUnit: "LANE_SCOPE_LOCK";
  sourceArtifactRefs: readonly string[];
}

export interface OfficeExitNetanyahu2026ReadinessVsMatcherDeltaArtifact {
  observedAt: string;
  laneId: typeof officeExitNetanyahu2026TriLaneId;
  matcherTruthConsumed: {
    topicKey: string;
    bestPair: string | null;
    bestTriIfAny: string | null;
    exactSafeTriPropositions: readonly string[];
    exactSafePairFallbackPropositions: readonly string[];
    overallDecision: string;
    triMatcherReady: boolean;
    pairMatcherReady: boolean;
    operatorCredible: boolean;
    ruleStatus: PoliticsNomineeRuleCompatibilityClass;
  };
  readinessConclusionsDerived: {
    finalReadinessLabel: OfficeExitNetanyahu2026LimitedProdReadinessLabel;
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

export interface OfficeExitNetanyahu2026PairReadinessVsMatcherDeltaArtifact {
  observedAt: string;
  laneId: typeof officeExitNetanyahu2026PairFallbackLaneId;
  matcherTruthConsumed: {
    topicKey: string;
    bestPair: string | null;
    exactSafePairPropositions: readonly string[];
    overallDecision: string;
    pairMatcherReady: boolean;
    operatorCredible: boolean;
    ruleStatus: PoliticsNomineeRuleCompatibilityClass;
  };
  readinessConclusionsDerived: {
    finalReadinessLabel: OfficeExitNetanyahu2026LimitedProdReadinessLabel;
    readinessReviewJustified: boolean;
    operatorRuleReviewRequired: boolean;
    rolloutRecommended: false;
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY";
    exactLaneScopeLocked: true;
  };
  intentionallyUnchanged: readonly string[];
  stillBlocked: readonly string[];
}

export interface OfficeExitNetanyahu2026TriReviewPackageArtifact {
  observedAt: string;
  reviewState: "READY_PENDING_OPERATOR_REVIEW" | "NOT_READY";
  laneId: typeof officeExitNetanyahu2026TriLaneId;
  topicKey: typeof TOPIC_KEY;
  approvedTriVenueSet: typeof TRI_VENUE_SET;
  approvedTriPropositions: readonly string[];
  saferPairFallback: {
    laneId: typeof officeExitNetanyahu2026PairFallbackLaneId;
    venuePair: typeof PAIR_FALLBACK;
    exactSafePropositions: readonly string[];
  };
  ruleCompatibilityState: PoliticsNomineeRuleCompatibilityClass;
  routeabilityState: string;
  exactSafeOnly: true;
  exclusionsLocked: readonly string[];
  sourceArtifacts: Record<string, string>;
  operatorChecks: readonly string[];
  holdBoundaries: readonly string[];
}

export interface OfficeExitNetanyahu2026PairReviewPackageArtifact {
  observedAt: string;
  reviewState: "READY_PENDING_OPERATOR_REVIEW" | "NOT_READY";
  laneId: typeof officeExitNetanyahu2026PairFallbackLaneId;
  topicKey: typeof TOPIC_KEY;
  approvedVenuePair: typeof PAIR_FALLBACK;
  approvedPropositions: readonly string[];
  ruleCompatibilityState: PoliticsNomineeRuleCompatibilityClass;
  routeabilityState: string;
  exactSafeOnly: true;
  exclusionsLocked: readonly string[];
  sourceArtifacts: Record<string, string>;
  operatorChecks: readonly string[];
  holdBoundaries: readonly string[];
}

export interface PoliticsOfficeExitNetanyahu2026LimitedProdReadinessArtifacts {
  readiness: OfficeExitNetanyahu2026LimitedProdReadinessArtifact;
  pairReadiness: OfficeExitNetanyahu2026PairLimitedProdReadinessArtifact;
  adminSurfaceSummary: OfficeExitNetanyahu2026AdminSurfaceSummaryArtifact;
  pairAdminSurfaceSummary: OfficeExitNetanyahu2026PairAdminSurfaceSummaryArtifact;
  readinessVsMatcherDelta: OfficeExitNetanyahu2026ReadinessVsMatcherDeltaArtifact;
  pairReadinessVsMatcherDelta: OfficeExitNetanyahu2026PairReadinessVsMatcherDeltaArtifact;
  reviewPackage: OfficeExitNetanyahu2026TriReviewPackageArtifact;
  pairReviewPackage: OfficeExitNetanyahu2026PairReviewPackageArtifact;
  operatorSummary: string;
  pairOperatorSummary: string;
}

const buildPropositionScopeHash = (propositions: readonly string[]): string =>
  createHash("sha256")
    .update([...propositions].sort((left, right) => left.localeCompare(right)).join("|"))
    .digest("hex")
    .slice(0, 16);

export const loadPoliticsOfficeExitNetanyahu2026MatcherArtifacts = (repoRoot: string) => ({
  inputSummary: readArtifact<MatcherInputSummaryArtifact>(repoRoot, matcherInputSummaryPath),
  pairLanes: readArtifact<MatcherPairLanesArtifact>(repoRoot, matcherPairLanesPath),
  triLanes: readArtifact<MatcherTriLanesArtifact>(repoRoot, matcherTriLanesPath),
  rejections: readArtifact<MatcherRejectionsArtifact>(repoRoot, matcherRejectionsPath),
  finalDecision: readArtifact<MatcherFinalDecisionArtifact>(repoRoot, matcherFinalDecisionPath)
});

export const buildPoliticsOfficeExitNetanyahu2026LimitedProdReadinessArtifacts = (input: {
  inputSummary: MatcherInputSummaryArtifact;
  pairLanes: MatcherPairLanesArtifact;
  triLanes: MatcherTriLanesArtifact;
  rejections: MatcherRejectionsArtifact;
  finalDecision: MatcherFinalDecisionArtifact;
}): PoliticsOfficeExitNetanyahu2026LimitedProdReadinessArtifacts => {
  const exactSafeTriPropositions = input.triLanes.matcherLanes.map((lane) => lane.proposition);
  const exactSafePairFallbackPropositions = input.pairLanes.matcherLanes
    .filter((lane) => lane.venuePair === PAIR_FALLBACK)
    .map((lane) => lane.proposition);
  const triRuleStatus = input.triLanes.matcherLanes[0]?.rulesDecision ?? input.finalDecision.ruleStatus;
  const pairRuleStatus = input.pairLanes.matcherLanes.find((lane) => lane.venuePair === PAIR_FALLBACK)?.rulesDecision ?? input.finalDecision.ruleStatus;
  const triOperatorRuleReviewRequired = triRuleStatus !== "EXACT_RULE_COMPATIBLE";
  const pairOperatorRuleReviewRequired = pairRuleStatus !== "EXACT_RULE_COMPATIBLE";
  const triMatcherReady =
    input.finalDecision.overallDecision === "OFFICE_EXIT_NETANYAHU_2026_TRI_READY_BUT_PAIR_FIRST"
    || input.finalDecision.overallDecision === "OFFICE_EXIT_NETANYAHU_2026_TRI_REVIEW_REQUIRED";
  const pairMatcherReady =
    input.finalDecision.pairMatcherReady
    && exactSafePairFallbackPropositions.length > 0;

  const exactTriScopeLocked =
    input.inputSummary.exactTopic === TOPIC_KEY
    && input.finalDecision.bestTriIfAny === TRI_VENUE_SET
    && exactSafeTriPropositions.length === 1
    && exactSafeTriPropositions[0] === "NETANYAHU_OUT_BEFORE_2027"
    && input.finalDecision.bestPair === PAIR_FALLBACK
    && exactSafePairFallbackPropositions.length === 1
    && exactSafePairFallbackPropositions[0] === "NETANYAHU_OUT_BEFORE_2027";
  const exactPairScopeLocked =
    input.inputSummary.exactTopic === TOPIC_KEY
    && input.finalDecision.bestPair === PAIR_FALLBACK
    && exactSafePairFallbackPropositions.length === 1
    && exactSafePairFallbackPropositions[0] === "NETANYAHU_OUT_BEFORE_2027";

  const triReadinessReviewJustified =
    triMatcherReady
    && input.finalDecision.operatorCredible
    && exactTriScopeLocked;
  const pairReadinessReviewJustified =
    pairMatcherReady
    && input.finalDecision.operatorCredible
    && exactPairScopeLocked;

  const triFinalReadinessLabel: OfficeExitNetanyahu2026LimitedProdReadinessLabel =
    !triMatcherReady || !input.finalDecision.operatorCredible || !exactTriScopeLocked
      ? "OFFICE_EXIT_NETANYAHU_2026_LIMITED_PROD_NOT_APPROVED"
      : triOperatorRuleReviewRequired
        ? "OFFICE_EXIT_NETANYAHU_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
        : "OFFICE_EXIT_NETANYAHU_2026_LIMITED_PROD_READY_FOR_REVIEW";
  const pairFinalReadinessLabel: OfficeExitNetanyahu2026LimitedProdReadinessLabel =
    !pairMatcherReady || !input.finalDecision.operatorCredible || !exactPairScopeLocked
      ? "OFFICE_EXIT_NETANYAHU_2026_LIMITED_PROD_NOT_APPROVED"
      : pairOperatorRuleReviewRequired
        ? "OFFICE_EXIT_NETANYAHU_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
        : "OFFICE_EXIT_NETANYAHU_2026_LIMITED_PROD_READY_FOR_REVIEW";

  const commonExclusions = [
    "NO_OPINION_FOR_THIS_TOPIC",
    "NO_MYRIAD_FOR_THIS_TOPIC",
    "NO_SCOPE_WIDENING_BEYOND_NETANYAHU_EXIT_PROPOSITION"
  ] as const;

  const readiness: OfficeExitNetanyahu2026LimitedProdReadinessArtifact = {
    observedAt: new Date().toISOString(),
    laneId: officeExitNetanyahu2026TriLaneId,
    topicKey: TOPIC_KEY,
    triVenueSet: TRI_VENUE_SET,
    exactSafeTriPropositions,
    saferPairFallback: {
      laneId: officeExitNetanyahu2026PairFallbackLaneId,
      venuePair: PAIR_FALLBACK,
      exactSafePropositions: exactSafePairFallbackPropositions
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
        "proposition_scope_drift",
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
      fallbackLaneId: officeExitNetanyahu2026PairFallbackLaneId,
      operatorSteps: [
        "Record a lane-scoped rollback or hold event for POLITICS_OFFICE_EXIT_NETANYAHU_2026_TRI_LIMITLESS_POLYMARKET_PREDICT.",
        "Revert this office-exit tri lane to the safer pair fallback LIMITLESS|POLYMARKET in internal-review-only posture.",
        "Do not widen to OPINION, MYRIAD, Trump, Starmer, or any other office-exit topic during rollback."
      ]
    },
    exclusionsStillMandatory: [
      ...commonExclusions,
      "PAIR_FALLBACK_MUST_REMAIN_EXPLICIT"
    ],
    finalReadinessLabel: triFinalReadinessLabel
  };

  const pairReadiness: OfficeExitNetanyahu2026PairLimitedProdReadinessArtifact = {
    observedAt: new Date().toISOString(),
    laneId: officeExitNetanyahu2026PairFallbackLaneId,
    topicKey: TOPIC_KEY,
    venuePair: PAIR_FALLBACK,
    exactSafePropositions: exactSafePairFallbackPropositions,
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
        "proposition_scope_drift",
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
        "Record a lane-scoped rollback or hold event for POLITICS_OFFICE_EXIT_NETANYAHU_2026_PAIR_LIMITLESS_POLYMARKET.",
        "Keep this office-exit pair lane disabled/internal-only until refreshed matcher and readiness artifacts are regenerated.",
        "Do not widen to PREDICT tri, OPINION, MYRIAD, Trump, Starmer, or any other office-exit topic during rollback."
      ]
    },
    exclusionsStillMandatory: commonExclusions,
    finalReadinessLabel: pairFinalReadinessLabel
  };

  const adminSurfaceSummary: OfficeExitNetanyahu2026AdminSurfaceSummaryArtifact = {
    observedAt: new Date().toISOString(),
    laneId: officeExitNetanyahu2026TriLaneId,
    topicKey: TOPIC_KEY,
    triVenueSet: TRI_VENUE_SET,
    propositionScopeHash: buildPropositionScopeHash(exactSafeTriPropositions),
    exactSafeTriPropositions,
    saferPairFallbackLaneId: officeExitNetanyahu2026PairFallbackLaneId,
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

  const pairAdminSurfaceSummary: OfficeExitNetanyahu2026PairAdminSurfaceSummaryArtifact = {
    observedAt: new Date().toISOString(),
    laneId: officeExitNetanyahu2026PairFallbackLaneId,
    topicKey: TOPIC_KEY,
    venuePair: PAIR_FALLBACK,
    propositionScopeHash: buildPropositionScopeHash(exactSafePairFallbackPropositions),
    exactSafePropositions: exactSafePairFallbackPropositions,
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

  const readinessVsMatcherDelta: OfficeExitNetanyahu2026ReadinessVsMatcherDeltaArtifact = {
    observedAt: new Date().toISOString(),
    laneId: officeExitNetanyahu2026TriLaneId,
    matcherTruthConsumed: {
      topicKey: TOPIC_KEY,
      bestPair: input.finalDecision.bestPair,
      bestTriIfAny: input.finalDecision.bestTriIfAny,
      exactSafeTriPropositions,
      exactSafePairFallbackPropositions,
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
      "exact proposition scope unchanged",
      "no rollout activation"
    ],
    stillBlocked: triOperatorRuleReviewRequired ? ["operator_rule_review_required"] : []
  };

  const pairReadinessVsMatcherDelta: OfficeExitNetanyahu2026PairReadinessVsMatcherDeltaArtifact = {
    observedAt: new Date().toISOString(),
    laneId: officeExitNetanyahu2026PairFallbackLaneId,
    matcherTruthConsumed: {
      topicKey: TOPIC_KEY,
      bestPair: input.finalDecision.bestPair,
      exactSafePairPropositions: exactSafePairFallbackPropositions,
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
      "exact proposition scope unchanged",
      "no rollout activation"
    ],
    stillBlocked: pairOperatorRuleReviewRequired ? ["operator_rule_review_required"] : []
  };

  const reviewPackage: OfficeExitNetanyahu2026TriReviewPackageArtifact = {
    observedAt: new Date().toISOString(),
    reviewState: triReadinessReviewJustified ? "READY_PENDING_OPERATOR_REVIEW" : "NOT_READY",
    laneId: officeExitNetanyahu2026TriLaneId,
    topicKey: TOPIC_KEY,
    approvedTriVenueSet: TRI_VENUE_SET,
    approvedTriPropositions: exactSafeTriPropositions,
    saferPairFallback: {
      laneId: officeExitNetanyahu2026PairFallbackLaneId,
      venuePair: PAIR_FALLBACK,
      exactSafePropositions: exactSafePairFallbackPropositions
    },
    ruleCompatibilityState: triRuleStatus,
    routeabilityState: input.triLanes.matcherLanes[0]?.routeabilityDecision ?? "TRI_REJECTED",
    exactSafeOnly: true,
    exclusionsLocked: [
      ...commonExclusions,
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
      "Confirm the scope is exactly OFFICE_EXIT_BY_DATE|ISRAEL|PRIME_MINISTER|BENJAMIN_NETANYAHU|2026-12-31.",
      "Confirm the only approved tri venue set is LIMITLESS|POLYMARKET|PREDICT.",
      "Confirm the approved proposition remains exactly NETANYAHU_OUT_BEFORE_2027.",
      "Confirm the safer pair fallback remains LIMITLESS|POLYMARKET and is not discarded.",
      "Confirm rule state remains SEMANTICALLY_COMPATIBLE_REWORDING and operator rule review is completed before any promotion.",
      "Confirm OPINION and MYRIAD remain excluded."
    ],
    holdBoundaries: [
      "Do not widen beyond the exact Netanyahu office-exit topic.",
      "Do not widen to Trump, Starmer, or Netanyahu variants with different deadlines.",
      "Do not discard the explicit LIMITLESS|POLYMARKET pair fallback.",
      "Do not treat this review package as activation authority."
    ]
  };

  const pairReviewPackage: OfficeExitNetanyahu2026PairReviewPackageArtifact = {
    observedAt: new Date().toISOString(),
    reviewState: pairReadinessReviewJustified ? "READY_PENDING_OPERATOR_REVIEW" : "NOT_READY",
    laneId: officeExitNetanyahu2026PairFallbackLaneId,
    topicKey: TOPIC_KEY,
    approvedVenuePair: PAIR_FALLBACK,
    approvedPropositions: exactSafePairFallbackPropositions,
    ruleCompatibilityState: pairRuleStatus,
    routeabilityState: input.pairLanes.matcherLanes.find((lane) => lane.venuePair === PAIR_FALLBACK)?.routeabilityDecision ?? "PAIR_REJECTED",
    exactSafeOnly: true,
    exclusionsLocked: commonExclusions,
    sourceArtifacts: {
      matcherInputSummary: matcherInputSummaryPath,
      pairLanes: matcherPairLanesPath,
      rejections: matcherRejectionsPath,
      finalDecision: matcherFinalDecisionPath
    },
    operatorChecks: [
      "Confirm the scope is exactly OFFICE_EXIT_BY_DATE|ISRAEL|PRIME_MINISTER|BENJAMIN_NETANYAHU|2026-12-31.",
      "Confirm the approved pair venue set is exactly LIMITLESS|POLYMARKET.",
      "Confirm the approved proposition remains exactly NETANYAHU_OUT_BEFORE_2027.",
      "Confirm rule state remains SEMANTICALLY_COMPATIBLE_REWORDING and operator rule review is completed before any promotion.",
      "Confirm OPINION and MYRIAD remain excluded."
    ],
    holdBoundaries: [
      "Do not widen beyond the exact Netanyahu office-exit topic.",
      "Do not widen to PREDICT tri, OPINION, MYRIAD, Trump, Starmer, or any other office-exit topic.",
      "Do not treat this review package as activation authority."
    ]
  };

  const operatorSummary = [
    "# Netanyahu Office Exit 2026 Limited-Prod Readiness",
    "",
    `- exact topic: ${TOPIC_KEY}`,
    `- exact tri venue set: ${TRI_VENUE_SET}`,
    `- exact-safe tri proposition: ${exactSafeTriPropositions.join(", ") || "none"}`,
    `- safer pair fallback: ${PAIR_FALLBACK} -> ${exactSafePairFallbackPropositions.join(", ") || "none"}`,
    `- exact rule state: ${triRuleStatus}`,
    `- operator rule review required: ${triOperatorRuleReviewRequired ? "yes" : "no"}`,
    `- matcher ready: ${triMatcherReady ? "yes" : "no"}`,
    `- operator credible: ${input.finalDecision.operatorCredible ? "yes" : "no"}`,
    `- readiness review justified: ${triReadinessReviewJustified ? "yes" : "no"}`,
    "- rollout recommended now: no",
    "- recommended operator action: keep the Netanyahu tri lane in limited-prod review only, complete operator rule review, and keep LIMITLESS|POLYMARKET explicit as the safer pair fallback.",
    `- rollback boundary: lane-scoped rollback to pair fallback ${officeExitNetanyahu2026PairFallbackLaneId}`,
    "- exclusions still mandatory: OPINION, MYRIAD, and any scope widening beyond the exact Netanyahu exit proposition.",
    "- why this is narrow and safe: exact topic only, exact tri venue set only, exact proposition only, explicit pair fallback preserved, operator-authoritative review only.",
    ""
  ].join("\n");

  const pairOperatorSummary = [
    "# Netanyahu Office Exit 2026 Pair Limited-Prod Readiness",
    "",
    `- exact topic: ${TOPIC_KEY}`,
    `- exact pair venue: ${PAIR_FALLBACK}`,
    `- exact-safe pair proposition: ${exactSafePairFallbackPropositions.join(", ") || "none"}`,
    `- exact rule state: ${pairRuleStatus}`,
    `- operator rule review required: ${pairOperatorRuleReviewRequired ? "yes" : "no"}`,
    `- matcher ready: ${pairMatcherReady ? "yes" : "no"}`,
    `- operator credible: ${input.finalDecision.operatorCredible ? "yes" : "no"}`,
    `- readiness review justified: ${pairReadinessReviewJustified ? "yes" : "no"}`,
    "- rollout recommended now: no",
    "- recommended operator action: keep the Netanyahu pair lane in limited-prod review only and complete operator rule review before any promotion.",
    "- rollback boundary: lane-scoped rollback to disabled/internal-only.",
    "- exclusions still mandatory: OPINION, MYRIAD, and any scope widening beyond the exact Netanyahu exit proposition.",
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
    operatorSummary,
    pairOperatorSummary
  };
};

export const writePoliticsOfficeExitNetanyahu2026LimitedProdReadinessArtifacts = (input: {
  repoRoot: string;
  inputSummary: MatcherInputSummaryArtifact;
  pairLanes: MatcherPairLanesArtifact;
  triLanes: MatcherTriLanesArtifact;
  rejections: MatcherRejectionsArtifact;
  finalDecision: MatcherFinalDecisionArtifact;
}): PoliticsOfficeExitNetanyahu2026LimitedProdReadinessArtifacts => {
  const artifacts = buildPoliticsOfficeExitNetanyahu2026LimitedProdReadinessArtifacts(input);

  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-office-exit-netanyahu-2026-limited-prod-readiness.json", artifacts.readiness);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-office-exit-netanyahu-2026-admin-surface-summary.json", artifacts.adminSurfaceSummary);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-office-exit-netanyahu-2026-pair-limited-prod-readiness.json", artifacts.pairReadiness);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-office-exit-netanyahu-2026-pair-admin-surface-summary.json", artifacts.pairAdminSurfaceSummary);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-office-exit-netanyahu-2026-readiness-vs-matcher-delta.json", artifacts.readinessVsMatcherDelta);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-office-exit-netanyahu-2026-pair-readiness-vs-matcher-delta.json", artifacts.pairReadinessVsMatcherDelta);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-office-exit-netanyahu-2026-tri-review-package.json", artifacts.reviewPackage);
  writeArtifact(input.repoRoot, "artifacts/politics/core/politics-office-exit-netanyahu-2026-pair-review-package.json", artifacts.pairReviewPackage);
  writeMarkdownArtifact(input.repoRoot, "docs/generated/politics/politics-office-exit-netanyahu-2026-lane-operator-summary.md", `${artifacts.operatorSummary}\n`);
  writeMarkdownArtifact(input.repoRoot, "docs/generated/politics/politics-office-exit-netanyahu-2026-pair-lane-operator-summary.md", `${artifacts.pairOperatorSummary}\n`);

  return artifacts;
};
