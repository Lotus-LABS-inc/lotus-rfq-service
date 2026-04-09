import { createHash } from "node:crypto";

import type {
  PoliticsNomineeRuleCompatibilityClass,
  PoliticsOfficeWinnerLimitedProdReadinessDecision,
  PoliticsOfficeWinnerUsPresident2028LimitedProdReadinessLabel,
  PoliticsOfficeWinnerUsPresident2028MatcherFinalDecision
} from "../../matching/politics/politics-types.js";
import { readArtifact, writeArtifact, writeMarkdownArtifact } from "./shared.js";
import { officeWinnerUsPresident2028PairLaneId } from "./politics-office-winner-limited-prod-shared.js";

const TOPIC_KEY = "OFFICE_WINNER|USA|US_PRESIDENT|2028" as const;
const VENUE_PAIR = "LIMITLESS|POLYMARKET" as const;
const matcherInputSummaryPath =
  "artifacts/politics/office-winner-us-president-2028-matcher/politics-office-winner-us-president-2028-matcher-input-summary.json";
const matcherLanesPath =
  "artifacts/politics/office-winner-us-president-2028-matcher/politics-office-winner-us-president-2028-matcher-lanes.json";
const matcherRejectionsPath =
  "artifacts/politics/office-winner-us-president-2028-matcher/politics-office-winner-us-president-2028-matcher-rejections.json";
const matcherFinalDecisionPath =
  "artifacts/politics/office-winner-us-president-2028-matcher/politics-office-winner-us-president-2028-matcher-final-decision.json";
const matcherOperatorSummaryPath =
  "artifacts/politics/office-winner-us-president-2028-matcher/politics-office-winner-us-president-2028-operator-summary.md";

interface OfficeWinnerMatcherInputSummaryArtifact {
  exactTopic: string;
  refreshedRowsUsed: unknown;
  familyComparabilitySourceArtifacts: Record<string, string>;
  admittedVenues: string[];
  admittedCandidates: string[];
}

interface OfficeWinnerMatcherLanesArtifact {
  canonicalTopicKey: string;
  bestPair: string | null;
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

interface OfficeWinnerMatcherRejectionsArtifact {
  rejections: {
    scope: "candidate" | "lane" | "venue";
    candidateIdentityKey?: string | null;
    normalizedCandidateName?: string | null;
    venuePair?: string | null;
    venue?: string | null;
    reason: string;
    notes: string;
  }[];
}

export interface OfficeWinnerUsPresident2028LimitedProdReadinessArtifact {
  observedAt: string;
  laneId: typeof officeWinnerUsPresident2028PairLaneId;
  topicKey: typeof TOPIC_KEY;
  venuePair: typeof VENUE_PAIR;
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
  finalReadinessLabel: PoliticsOfficeWinnerUsPresident2028LimitedProdReadinessLabel;
}

export interface OfficeWinnerUsPresident2028AdminSurfaceSummaryArtifact {
  observedAt: string;
  laneId: typeof officeWinnerUsPresident2028PairLaneId;
  topicKey: typeof TOPIC_KEY;
  venuePair: typeof VENUE_PAIR;
  candidateScopeHash: string;
  exactSafeCandidates: readonly string[];
  currentReadinessDecision: PoliticsOfficeWinnerLimitedProdReadinessDecision;
  supportedActions: readonly ["inspect", "hold", "promote", "rollback"];
  userConsentCanWidenScope: false;
  narrowestEnforceableUnit: "LANE_SCOPE_LOCK";
  sourceArtifactRefs: readonly string[];
}

export interface OfficeWinnerUsPresident2028ReadinessVsMatcherDeltaArtifact {
  observedAt: string;
  laneId: typeof officeWinnerUsPresident2028PairLaneId;
  matcherTruthConsumed: {
    topicKey: string;
    bestPair: string | null;
    exactSafeCandidates: readonly string[];
    overallDecision: string;
    pairMatcherReady: boolean;
    operatorCredible: boolean;
    ruleStatus: PoliticsNomineeRuleCompatibilityClass;
  };
  readinessConclusionsDerived: {
    finalReadinessLabel: PoliticsOfficeWinnerUsPresident2028LimitedProdReadinessLabel;
    readinessReviewJustified: boolean;
    operatorRuleReviewRequired: boolean;
    rolloutRecommended: false;
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY";
    exactLaneScopeLocked: true;
  };
  intentionallyUnchanged: readonly string[];
  stillBlocked: readonly string[];
}

export interface PoliticsOfficeWinnerUsPresident2028LimitedProdReadinessArtifacts {
  readiness: OfficeWinnerUsPresident2028LimitedProdReadinessArtifact;
  adminSurfaceSummary: OfficeWinnerUsPresident2028AdminSurfaceSummaryArtifact;
  readinessVsMatcherDelta: OfficeWinnerUsPresident2028ReadinessVsMatcherDeltaArtifact;
  operatorSummary: string;
}

const buildCandidateScopeHash = (candidates: readonly string[]): string =>
  createHash("sha256")
    .update([...candidates].sort((left, right) => left.localeCompare(right)).join("|"))
    .digest("hex")
    .slice(0, 16);

export const loadPoliticsOfficeWinnerUsPresident2028MatcherArtifacts = (repoRoot: string) => ({
  inputSummary: readArtifact<OfficeWinnerMatcherInputSummaryArtifact>(repoRoot, matcherInputSummaryPath),
  lanes: readArtifact<OfficeWinnerMatcherLanesArtifact>(repoRoot, matcherLanesPath),
  rejections: readArtifact<OfficeWinnerMatcherRejectionsArtifact>(repoRoot, matcherRejectionsPath),
  finalDecision: readArtifact<PoliticsOfficeWinnerUsPresident2028MatcherFinalDecision>(repoRoot, matcherFinalDecisionPath)
});

export const buildPoliticsOfficeWinnerUsPresident2028LimitedProdReadinessArtifacts = (input: {
  inputSummary: OfficeWinnerMatcherInputSummaryArtifact;
  lanes: OfficeWinnerMatcherLanesArtifact;
  rejections: OfficeWinnerMatcherRejectionsArtifact;
  finalDecision: PoliticsOfficeWinnerUsPresident2028MatcherFinalDecision;
}): PoliticsOfficeWinnerUsPresident2028LimitedProdReadinessArtifacts => {
  const exactSafeCandidates = [...input.finalDecision.bestStartingCandidates];
  const bestPairLanes = input.lanes.matcherLanes.filter((lane) => lane.venuePair === VENUE_PAIR);
  const ruleStatus = bestPairLanes[0]?.rulesDecision ?? input.finalDecision.ruleStatus;
  const operatorRuleReviewRequired = ruleStatus === "SEMANTICALLY_COMPATIBLE_REWORDING";
  const matcherReady =
    input.finalDecision.overallDecision === "OFFICE_WINNER_US_PRESIDENT_2028_PAIR_MATCHER_READY"
    || input.finalDecision.overallDecision === "OFFICE_WINNER_US_PRESIDENT_2028_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW"
    || input.finalDecision.overallDecision === "OFFICE_WINNER_US_PRESIDENT_2028_PAIR_MATCHER_THIN_BUT_VALID";
  const exactLaneScopeLocked =
    input.finalDecision.bestPair === VENUE_PAIR
    && input.inputSummary.exactTopic === TOPIC_KEY
    && exactSafeCandidates.length === 7;
  const readinessReviewJustified =
    matcherReady
    && input.finalDecision.operatorCredible
    && exactLaneScopeLocked;

  const finalReadinessLabel: PoliticsOfficeWinnerUsPresident2028LimitedProdReadinessLabel =
    !matcherReady || !input.finalDecision.operatorCredible || !exactLaneScopeLocked
      ? "OFFICE_WINNER_US_PRESIDENT_2028_LIMITED_PROD_NOT_APPROVED"
      : operatorRuleReviewRequired
        ? "OFFICE_WINNER_US_PRESIDENT_2028_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
        : "OFFICE_WINNER_US_PRESIDENT_2028_LIMITED_PROD_READY_FOR_REVIEW";

  const readiness: OfficeWinnerUsPresident2028LimitedProdReadinessArtifact = {
    observedAt: new Date().toISOString(),
    laneId: officeWinnerUsPresident2028PairLaneId,
    topicKey: TOPIC_KEY,
    venuePair: VENUE_PAIR,
    exactSafeCandidates,
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
        "candidate_set_drift",
        "venue_pair_drift",
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
        "Record a lane-scoped rollback or hold event for POLITICS_OFFICE_WINNER_US_PRESIDENT_2028_PAIR_LIMITLESS_POLYMARKET.",
        "Keep the office-winner lane disabled/internal-only until refreshed matcher and readiness artifacts are regenerated.",
        "Do not widen to MYRIAD, OPINION, PREDICT, tri, or other office-winner topics during rollback."
      ]
    },
    exclusionsStillMandatory: [
      "OTHERS_EXCLUDED",
      "VENUE_ONLY_TAILS_EXCLUDED",
      "UNKNOWN_COMPOSITE_EXCLUDED",
      "NO_MYRIAD_FOR_THIS_TOPIC",
      "NO_OPINION_FOR_THIS_TOPIC",
      "NO_PREDICT_FOR_THIS_TOPIC",
      "NO_TRI_IMPLICATION"
    ],
    finalReadinessLabel
  };

  const adminSurfaceSummary: OfficeWinnerUsPresident2028AdminSurfaceSummaryArtifact = {
    observedAt: new Date().toISOString(),
    laneId: officeWinnerUsPresident2028PairLaneId,
    topicKey: TOPIC_KEY,
    venuePair: VENUE_PAIR,
    candidateScopeHash: buildCandidateScopeHash(exactSafeCandidates),
    exactSafeCandidates,
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
      matcherLanesPath,
      matcherRejectionsPath,
      matcherFinalDecisionPath,
      matcherOperatorSummaryPath
    ]
  };

  const readinessVsMatcherDelta: OfficeWinnerUsPresident2028ReadinessVsMatcherDeltaArtifact = {
    observedAt: new Date().toISOString(),
    laneId: officeWinnerUsPresident2028PairLaneId,
    matcherTruthConsumed: {
      topicKey: TOPIC_KEY,
      bestPair: input.finalDecision.bestPair,
      exactSafeCandidates,
      overallDecision: input.finalDecision.overallDecision,
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
      exactLaneScopeLocked: true
    },
    intentionallyUnchanged: [
      "no_tri_allowed",
      "no_venue_widening_beyond_limitless_polymarket",
      "no_matcher_logic_changes",
      "no_broad_politics_activation"
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
    ]
  };

  const operatorSummary = [
    "# Office Winner USA President 2028 Limited-Prod Readiness",
    "",
    `- exact topic: ${TOPIC_KEY}`,
    `- exact pair: ${VENUE_PAIR}`,
    `- exact-safe candidates: ${exactSafeCandidates.join(", ") || "none"}`,
    `- exact rule state: ${ruleStatus}`,
    `- operator rule review required: ${operatorRuleReviewRequired ? "yes" : "no"}`,
    `- matcher ready: ${matcherReady ? "yes" : "no"}`,
    `- operator credible: ${input.finalDecision.operatorCredible ? "yes" : "no"}`,
    `- readiness review justified: ${readinessReviewJustified ? "yes" : "no"}`,
    "- rollout recommended now: no",
    "- recommended operator action: keep this lane in limited-prod review only, complete operator rule review, and do not widen beyond LIMITLESS|POLYMARKET or the exact seven-candidate shared core.",
    `- rollback boundary: lane-scoped hold/internal-only for ${officeWinnerUsPresident2028PairLaneId}`,
    "- exclusions still mandatory: Others, venue-only tails, unknown/composite outcomes, MYRIAD, OPINION, PREDICT, and all tri implications.",
    "- why this is narrow and safe: matcher-backed pair only, exact topic and venue scope only, exact seven-candidate scope lock only, operator-authoritative admin controls only.",
    ""
  ].join("\n");

  return {
    readiness,
    adminSurfaceSummary,
    readinessVsMatcherDelta,
    operatorSummary
  };
};

export const writePoliticsOfficeWinnerUsPresident2028LimitedProdReadinessArtifacts = (input: {
  repoRoot: string;
  inputSummary: OfficeWinnerMatcherInputSummaryArtifact;
  lanes: OfficeWinnerMatcherLanesArtifact;
  rejections: OfficeWinnerMatcherRejectionsArtifact;
  finalDecision: PoliticsOfficeWinnerUsPresident2028MatcherFinalDecision;
}): PoliticsOfficeWinnerUsPresident2028LimitedProdReadinessArtifacts => {
  const artifacts = buildPoliticsOfficeWinnerUsPresident2028LimitedProdReadinessArtifacts(input);
  writeArtifact(
    input.repoRoot,
    "artifacts/politics/core/politics-office-winner-us-president-2028-limited-prod-readiness.json",
    artifacts.readiness
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/politics/core/politics-office-winner-us-president-2028-admin-surface-summary.json",
    artifacts.adminSurfaceSummary
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/politics/core/politics-office-winner-us-president-2028-readiness-vs-matcher-delta.json",
    artifacts.readinessVsMatcherDelta
  );
  writeMarkdownArtifact(
    input.repoRoot,
    "docs/generated/politics/politics-office-winner-us-president-2028-lane-operator-summary.md",
    `${artifacts.operatorSummary}\n`
  );
  return artifacts;
};
