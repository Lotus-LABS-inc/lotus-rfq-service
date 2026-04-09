import { createHash } from "node:crypto";

import type {
  PoliticsNomineeDemocraticPairMatcherFinalDecision,
  PoliticsNomineeLimitedProdReadinessDecision,
  PoliticsNomineeRuleCompatibilityClass
} from "../../matching/politics/politics-types.js";
import { writeArtifact, writeMarkdownArtifact } from "./shared.js";
import { democraticPairLaneId } from "./politics-nominee-limited-prod-shared.js";

interface DemocraticPairMatcherLanesArtifact {
  topicKey: string;
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

interface DemocraticPairMatcherInputSummaryArtifact {
  topicKey: string;
  refreshedRowsUsed: unknown;
  admittedVenues: string[];
  admittedCandidates: string[];
}

interface DemocraticPairMatcherRejectionsArtifact {
  rejections: {
    scope: "candidate" | "lane";
    candidateIdentityKey?: string | null;
    normalizedCandidateName?: string | null;
    venuePair?: string | null;
    reason: string;
    notes: string;
  }[];
}

const DEMOCRATIC_TOPIC = "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC" as const;
const DEMOCRATIC_PAIR = "LIMITLESS|POLYMARKET" as const;

const matcherInputSummaryPath =
  "artifacts/politics/nominee-2028-democratic-pair-matcher/politics-nominee-2028-democratic-pair-matcher-input-summary.json";
const matcherLanesPath =
  "artifacts/politics/nominee-2028-democratic-pair-matcher/politics-nominee-2028-democratic-pair-matcher-lanes.json";
const matcherRejectionsPath =
  "artifacts/politics/nominee-2028-democratic-pair-matcher/politics-nominee-2028-democratic-pair-matcher-rejections.json";
const matcherFinalDecisionPath =
  "artifacts/politics/nominee-2028-democratic-pair-matcher/politics-nominee-2028-democratic-pair-matcher-final-decision.json";
const matcherOperatorSummaryPath =
  "artifacts/politics/nominee-2028-democratic-pair-matcher/politics-nominee-2028-democratic-pair-matcher-operator-summary.md";

export interface DemocraticLimitedProdReadinessArtifact {
  observedAt: string;
  laneId: typeof democraticPairLaneId;
  topicKey: typeof DEMOCRATIC_TOPIC;
  venuePair: typeof DEMOCRATIC_PAIR;
  exactSafeCandidates: readonly string[];
  ruleStatus: PoliticsNomineeRuleCompatibilityClass;
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
  finalReadinessLabel:
    | "DEMOCRATIC_PAIR_LIMITED_PROD_READY_FOR_REVIEW"
    | "DEMOCRATIC_PAIR_LIMITED_PROD_READY_PENDING_OPERATOR_PROMOTION"
    | "DEMOCRATIC_PAIR_LIMITED_PROD_HELD"
    | "DEMOCRATIC_PAIR_LIMITED_PROD_NOT_APPROVED";
}

export interface DemocraticAdminSurfaceSummaryArtifact {
  observedAt: string;
  laneId: typeof democraticPairLaneId;
  topicKey: typeof DEMOCRATIC_TOPIC;
  venuePair: typeof DEMOCRATIC_PAIR;
  candidateScopeHash: string;
  exactSafeCandidates: readonly string[];
  currentReadinessDecision: PoliticsNomineeLimitedProdReadinessDecision;
  supportedActions: readonly ["inspect", "hold", "promote", "rollback"];
  userConsentCanWidenScope: false;
  narrowestEnforceableUnit: "LANE_SCOPE_LOCK";
  sourceArtifactRefs: readonly string[];
}

export interface DemocraticReadinessVsMatcherDeltaArtifact {
  observedAt: string;
  laneId: typeof democraticPairLaneId;
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
    finalReadinessLabel: DemocraticLimitedProdReadinessArtifact["finalReadinessLabel"];
    readinessReviewJustified: boolean;
    rolloutRecommended: false;
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY";
    exactLaneScopeLocked: true;
  };
  intentionallyUnchanged: readonly string[];
  stillBlocked: readonly string[];
}

export interface PoliticsNominee2028DemocraticLimitedProdReadinessArtifacts {
  readiness: DemocraticLimitedProdReadinessArtifact;
  adminSurfaceSummary: DemocraticAdminSurfaceSummaryArtifact;
  readinessVsMatcherDelta: DemocraticReadinessVsMatcherDeltaArtifact;
  operatorSummary: string;
}

const buildCandidateScopeHash = (candidates: readonly string[]): string =>
  createHash("sha256")
    .update([...candidates].sort((left, right) => left.localeCompare(right)).join("|"))
    .digest("hex")
    .slice(0, 16);

export const buildPoliticsNominee2028DemocraticLimitedProdReadinessArtifacts = (input: {
  finalDecision: PoliticsNomineeDemocraticPairMatcherFinalDecision;
  lanes: DemocraticPairMatcherLanesArtifact;
  inputSummary: DemocraticPairMatcherInputSummaryArtifact;
  rejections: DemocraticPairMatcherRejectionsArtifact;
}): PoliticsNominee2028DemocraticLimitedProdReadinessArtifacts => {
  const exactSafeCandidates = [...input.finalDecision.bestStartingCandidates];
  const bestPairLanes = input.lanes.matcherLanes.filter((lane) => lane.venuePair === DEMOCRATIC_PAIR);
  const uniqueRuleStatuses = [...new Set(bestPairLanes.map((lane) => lane.rulesDecision))];
  const ruleStatus = uniqueRuleStatuses[0] ?? "UNKNOWN_RULE_MEANING";
  const exactSafeRuleStatus =
    ruleStatus === "EXACT_RULE_COMPATIBLE" || ruleStatus === "SEMANTICALLY_COMPATIBLE_REWORDING";
  const readinessReviewJustified =
    input.finalDecision.pairMatcherReady
    && input.finalDecision.operatorCredible
    && exactSafeCandidates.length > 0
    && exactSafeRuleStatus;

  const finalReadinessLabel =
    readinessReviewJustified
      ? "DEMOCRATIC_PAIR_LIMITED_PROD_READY_FOR_REVIEW"
      : input.finalDecision.operatorCredible
        ? "DEMOCRATIC_PAIR_LIMITED_PROD_READY_PENDING_OPERATOR_PROMOTION"
        : input.finalDecision.pairMatcherReady
          ? "DEMOCRATIC_PAIR_LIMITED_PROD_HELD"
          : "DEMOCRATIC_PAIR_LIMITED_PROD_NOT_APPROVED";

  const readiness: DemocraticLimitedProdReadinessArtifact = {
    observedAt: new Date().toISOString(),
    laneId: democraticPairLaneId,
    topicKey: DEMOCRATIC_TOPIC,
    venuePair: DEMOCRATIC_PAIR,
    exactSafeCandidates,
    ruleStatus,
    matcherReady: input.finalDecision.pairMatcherReady,
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
        "operator_confidence_lost"
      ],
      userConsentCanWidenScope: false
    },
    rollbackPolicy: {
      scope: "LANE_ONLY",
      targetMode: "DISABLED_INTERNAL_ONLY",
      fallbackLaneId: null,
      operatorSteps: [
        "Record a lane-scoped rollback or hold event for POLITICS_NOMINEE_DEMOCRATIC_PAIR_LIMITLESS_POLYMARKET.",
        "Keep the Democratic pair lane disabled/internal-only until refreshed matcher and readiness artifacts are regenerated.",
        "Do not widen to Opinion, tri, or broad politics during rollback."
      ]
    },
    exclusionsStillMandatory: [
      "OTHERS_EXCLUDED",
      "VENUE_ONLY_TAILS_EXCLUDED",
      "UNKNOWN_COMPOSITE_EXCLUDED",
      "DEMOCRATIC_OPINION_PAIR_NOT_ADMITTED",
      "NO_DEMOCRATIC_TRI_IMPLICATION"
    ],
    finalReadinessLabel
  };

  const adminSurfaceSummary: DemocraticAdminSurfaceSummaryArtifact = {
    observedAt: new Date().toISOString(),
    laneId: democraticPairLaneId,
    topicKey: DEMOCRATIC_TOPIC,
    venuePair: DEMOCRATIC_PAIR,
    candidateScopeHash: buildCandidateScopeHash(exactSafeCandidates),
    exactSafeCandidates,
    currentReadinessDecision: readinessReviewJustified
      ? "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
      : "NOT_READY_FOR_LIMITED_PROD",
    supportedActions: ["inspect", "hold", "promote", "rollback"],
    userConsentCanWidenScope: false,
    narrowestEnforceableUnit: "LANE_SCOPE_LOCK",
    sourceArtifactRefs: [
      matcherInputSummaryPath,
      matcherLanesPath,
      matcherRejectionsPath,
      matcherFinalDecisionPath
    ]
  };

  const readinessVsMatcherDelta: DemocraticReadinessVsMatcherDeltaArtifact = {
    observedAt: new Date().toISOString(),
    laneId: democraticPairLaneId,
    matcherTruthConsumed: {
      topicKey: input.finalDecision.bestPair ? DEMOCRATIC_TOPIC : input.lanes.topicKey,
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
      rolloutRecommended: false,
      recommendedMode: "LIMITED_PROD_REVIEW_ONLY",
      exactLaneScopeLocked: true
    },
    intentionallyUnchanged: [
      "no_tri_allowed",
      "no_opinion_democratic_lane_promotion",
      "no_broad_politics_activation",
      "no_matcher_logic_changes"
    ],
    stillBlocked: [
      "operator_controlled_promotion_required",
      "no_user_scope_widening_allowed",
      ...input.rejections.rejections
        .filter((rejection) => rejection.reason === "OTHERS_EXCLUDED")
        .map(() => "others_remains_excluded"),
      ...input.rejections.rejections
        .filter((rejection) => rejection.reason === "NOT_SHARED")
        .map(() => "venue_only_tails_remain_excluded")
    ]
  };

  const operatorSummary = [
    "# Democratic Nominee 2028 Limited-Prod Readiness",
    "",
    `- topic: ${DEMOCRATIC_TOPIC}`,
    `- approved pair for review: ${DEMOCRATIC_PAIR}`,
    `- exact-safe candidates: ${exactSafeCandidates.join(", ") || "none"}`,
    `- exact rule state: ${ruleStatus}`,
    `- matcher ready: ${input.finalDecision.pairMatcherReady ? "yes" : "no"}`,
    `- operator credible: ${input.finalDecision.operatorCredible ? "yes" : "no"}`,
    `- readiness review justified: ${readinessReviewJustified ? "yes" : "no"}`,
    `- rollout recommended now: no`,
    `- recommended operator action: prepare narrow limited-prod review only; do not widen beyond LIMITLESS|POLYMARKET and the six-candidate shared core`,
    `- rollback boundary: lane-scoped hold/internal-only for ${democraticPairLaneId}`,
    `- exclusions still mandatory: Others, venue-only tails, unknown/composite outcomes, any Democratic Opinion lane, all tri implications`,
    `- why this is narrow and safe: matcher-backed exact pair only, exact candidate core only, lane-scoped admin controls only`,
    ""
  ].join("\n");

  return {
    readiness,
    adminSurfaceSummary,
    readinessVsMatcherDelta,
    operatorSummary
  };
};

export const writePoliticsNominee2028DemocraticLimitedProdReadinessArtifacts = (input: {
  repoRoot: string;
  finalDecision: PoliticsNomineeDemocraticPairMatcherFinalDecision;
  lanes: DemocraticPairMatcherLanesArtifact;
  inputSummary: DemocraticPairMatcherInputSummaryArtifact;
  rejections: DemocraticPairMatcherRejectionsArtifact;
}): PoliticsNominee2028DemocraticLimitedProdReadinessArtifacts => {
  const artifacts = buildPoliticsNominee2028DemocraticLimitedProdReadinessArtifacts(input);
  writeArtifact(
    input.repoRoot,
    "artifacts/politics/core/politics-nominee-2028-democratic-limited-prod-readiness.json",
    artifacts.readiness
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/politics/core/politics-nominee-2028-democratic-admin-surface-summary.json",
    artifacts.adminSurfaceSummary
  );
  writeArtifact(
    input.repoRoot,
    "artifacts/politics/core/politics-nominee-2028-democratic-readiness-vs-matcher-delta.json",
    artifacts.readinessVsMatcherDelta
  );
  writeMarkdownArtifact(
    input.repoRoot,
    "docs/generated/politics/politics-nominee-2028-democratic-lane-operator-summary.md",
    `${artifacts.operatorSummary}\n`
  );
  return artifacts;
};
