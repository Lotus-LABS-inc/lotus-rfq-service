import { createHash } from "node:crypto";

import { readArtifact, writeArtifact, writeMarkdownArtifact } from "./shared.js";
import type { CryptoThresholdByDateAssetConfig } from "../../matching/crypto/crypto-threshold-by-date-assets.js";

type CryptoLimitedProdReadinessDecision =
  | "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
  | "READY_BUT_MISSING_OPERATOR_REVIEW"
  | "NOT_READY_FOR_LIMITED_PROD";

interface MatcherInputSummaryArtifact {
  exactFamily: string;
  targetPair: string;
  refreshedRowsUsed: unknown;
  familyComparabilitySourceArtifacts: Record<string, string>;
  admittedVenues: string[];
  admittedTopicKeys: string[];
}

interface MatcherPairLanesArtifact {
  matcherLanes: {
    venuePair: string;
    canonicalTopicKey: string;
    exactThresholdLabel: string;
    exactThresholdValue: string;
    comparator: "ABOVE" | "BELOW";
    routeabilityDecision: string;
    rulesDecision: "EXACT_RULE_COMPATIBLE" | "SEMANTICALLY_COMPATIBLE_REWORDING";
    evidenceNotes: string[];
  }[];
}

interface MatcherRejectionsArtifact {
  rejections: {
    scope: "threshold_bucket" | "pair_lane";
    canonicalTopicKey?: string | null;
    exactThresholdLabel?: string | null;
    venuePair?: string | null;
    reason: string;
    notes: string;
  }[];
}

interface MatcherFinalDecisionArtifact {
  overallDecision: string;
  bestPair: string | null;
  pairMatcherReady: boolean;
  exactSafePairCandidateCount: number;
  ruleStatus: "EXACT_RULE_COMPATIBLE" | "SEMANTICALLY_COMPATIBLE_REWORDING";
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

const buildScopeHash = (thresholds: readonly string[]): string =>
  createHash("sha256")
    .update([...thresholds].sort((left, right) => left.localeCompare(right)).join("|"))
    .digest("hex")
    .slice(0, 16);

const matcherPathsFor = (config: CryptoThresholdByDateAssetConfig) => {
  const stem = `crypto-${config.artifactKey}`;
  const dir = `artifacts/crypto/${config.artifactKey}-matcher`;
  return {
    inputSummary: `${dir}/${stem}-matcher-input-summary.json`,
    pairLanes: `${dir}/${stem}-pair-lanes.json`,
    rejections: `${dir}/${stem}-rejections.json`,
    finalDecision: `${dir}/${stem}-final-decision.json`,
    operatorSummary: `${dir}/${stem}-operator-summary.md`
  };
};

const corePathsFor = (config: CryptoThresholdByDateAssetConfig) => {
  const stem = `crypto-${config.artifactKey}`;
  return {
    readiness: `artifacts/crypto/core/${stem}-limited-prod-readiness.json`,
    adminSurfaceSummary: `artifacts/crypto/core/${stem}-admin-surface-summary.json`,
    delta: `artifacts/crypto/core/${stem}-readiness-vs-matcher-delta.json`,
    markdown: `artifacts/crypto/core/${stem}-limited-prod-readiness.md`
  };
};

export const loadCryptoThresholdByDateMatcherArtifacts = (repoRoot: string, config: CryptoThresholdByDateAssetConfig) => {
  const matcherPaths = matcherPathsFor(config);
  return {
    inputSummary: readArtifact<MatcherInputSummaryArtifact>(repoRoot, matcherPaths.inputSummary),
    pairLanes: readArtifact<MatcherPairLanesArtifact>(repoRoot, matcherPaths.pairLanes),
    rejections: readArtifact<MatcherRejectionsArtifact>(repoRoot, matcherPaths.rejections),
    finalDecision: readArtifact<MatcherFinalDecisionArtifact>(repoRoot, matcherPaths.finalDecision)
  };
};

export const buildCryptoThresholdByDateLimitedProdReadinessArtifacts = (input: {
  config: CryptoThresholdByDateAssetConfig;
  inputSummary: MatcherInputSummaryArtifact;
  pairLanes: MatcherPairLanesArtifact;
  rejections: MatcherRejectionsArtifact;
  finalDecision: MatcherFinalDecisionArtifact;
}) => {
  const { config } = input;
  const exactSafePairLanes = input.pairLanes.matcherLanes
    .filter((lane) => lane.venuePair === "POLYMARKET|PREDICT")
    .sort((left, right) => left.exactThresholdLabel.localeCompare(right.exactThresholdLabel));
  const exactSafeThresholds = exactSafePairLanes.map((lane) => lane.exactThresholdLabel);
  const exactSafeTopics = exactSafePairLanes.map((lane) => lane.canonicalTopicKey);
  const pairRuleStatus = exactSafePairLanes[0]?.rulesDecision ?? input.finalDecision.ruleStatus;
  const operatorRuleReviewRequired = pairRuleStatus !== "EXACT_RULE_COMPATIBLE";
  const pairMatcherReady = input.finalDecision.pairMatcherReady && exactSafeThresholds.length > 0;
  const exactPairScopeLocked =
    input.inputSummary.exactFamily === config.familyKey
    && input.inputSummary.targetPair === "POLYMARKET|PREDICT"
    && input.finalDecision.bestPair === "POLYMARKET|PREDICT"
    && exactSafeThresholds.length > 0;

  const finalReadinessLabel =
    !pairMatcherReady || !input.finalDecision.operatorCredible || !exactPairScopeLocked
      ? `${config.decisionPrefix}_LIMITED_PROD_NOT_APPROVED`
      : operatorRuleReviewRequired
        ? `${config.decisionPrefix}_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
        : `${config.decisionPrefix}_LIMITED_PROD_READY_FOR_REVIEW`;

  const matcherPaths = matcherPathsFor(config);
  const readiness = {
    observedAt: new Date().toISOString(),
    laneId: config.laneId,
    familyKey: config.familyKey,
    venuePair: "POLYMARKET|PREDICT" as const,
    exactSafeThresholdBuckets: exactSafeThresholds,
    exactSafeTopics,
    ruleStatus: pairRuleStatus,
    operatorRuleReviewRequired,
    matcherReady: pairMatcherReady,
    operatorCredible: input.finalDecision.operatorCredible,
    readinessReviewJustified: pairMatcherReady && input.finalDecision.operatorCredible && exactPairScopeLocked,
    rolloutRecommended: false,
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY" as const,
    holdPolicy: {
      scope: "LANE_ONLY" as const,
      holdConditions: [
        "If either venue loses the shared threshold ladder set.",
        "If any shared threshold drifts from threshold-by-date semantics.",
        "If operator review rejects semantically-compatible wording."
      ],
      userConsentCanWidenScope: false
    },
    rollbackPolicy: {
      scope: "LANE_ONLY" as const,
      targetMode: "DISABLED_INTERNAL_ONLY" as const,
      fallbackLaneId: null,
      operatorSteps: [
        `Disable the ${config.asset} threshold-by-date pair lane only.`,
        "Leave unrelated crypto routes unchanged.",
        "Keep non-shared venue-only thresholds excluded until a shared counterpart is proven again."
      ]
    },
    exclusionsStillMandatory: [
      "NO_SCOPE_WIDENING_BEYOND_SHARED_THRESHOLD_BY_DATE_BUCKETS",
      "PAIR_ONLY_POLYMARKET_PREDICT"
    ],
    finalReadinessLabel
  };

  const adminSurfaceSummary = {
    observedAt: new Date().toISOString(),
    laneId: config.laneId,
    familyKey: config.familyKey,
    venuePair: "POLYMARKET|PREDICT" as const,
    thresholdScopeHash: buildScopeHash(exactSafeThresholds),
    exactSafeThresholdBuckets: exactSafeThresholds,
    currentReadinessDecision:
      finalReadinessLabel.endsWith("_NOT_APPROVED")
        ? "NOT_READY_FOR_LIMITED_PROD"
        : operatorRuleReviewRequired
          ? "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
          : "READY_BUT_MISSING_OPERATOR_REVIEW" as CryptoLimitedProdReadinessDecision,
    supportedActions: ["inspect", "hold", "promote", "rollback"] as const,
    userConsentCanWidenScope: false,
    narrowestEnforceableUnit: "LANE_SCOPE_LOCK" as const,
    sourceArtifactRefs: [
      matcherPaths.inputSummary,
      matcherPaths.pairLanes,
      matcherPaths.rejections,
      matcherPaths.finalDecision,
      matcherPaths.operatorSummary
    ]
  };

  const readinessVsMatcherDelta = {
    observedAt: new Date().toISOString(),
    laneId: config.laneId,
    matcherTruthConsumed: {
      familyKey: config.familyKey,
      bestPair: input.finalDecision.bestPair,
      exactSafeThresholdBuckets: exactSafeThresholds,
      exactSafeTopics,
      overallDecision: input.finalDecision.overallDecision,
      pairMatcherReady: input.finalDecision.pairMatcherReady,
      operatorCredible: input.finalDecision.operatorCredible,
      ruleStatus: input.finalDecision.ruleStatus
    },
    readinessConclusionsDerived: {
      finalReadinessLabel,
      readinessReviewJustified: readiness.readinessReviewJustified,
      operatorRuleReviewRequired,
      rolloutRecommended: false,
      recommendedMode: "LIMITED_PROD_REVIEW_ONLY" as const,
      exactLaneScopeLocked: exactPairScopeLocked
    },
    intentionallyUnchanged: [
      "NO_TRI_LANE_INTRODUCED",
      "NO_VENUE_WIDENING"
    ],
    stillBlocked: input.rejections.rejections.map((entry) => entry.notes)
  };

  const operatorSummary = [
    `# Crypto ${config.asset} Threshold By Date April 2026 Limited Prod Readiness`,
    "",
    `- lane id: ${config.laneId}`,
    `- exact family: ${config.familyKey}`,
    `- exact-safe shared thresholds: ${exactSafeThresholds.join(", ") || "none"}`,
    `- final readiness label: ${finalReadinessLabel}`,
    `- admin decision: ${adminSurfaceSummary.currentReadinessDecision}`
  ].join("\n");

  return {
    readiness,
    adminSurfaceSummary,
    readinessVsMatcherDelta,
    operatorSummary
  };
};

export const runCryptoThresholdByDateLimitedProdReadiness = async (input: {
  repoRoot: string;
  config: CryptoThresholdByDateAssetConfig;
}) => {
  const matcherArtifacts = loadCryptoThresholdByDateMatcherArtifacts(input.repoRoot, input.config);
  const artifacts = buildCryptoThresholdByDateLimitedProdReadinessArtifacts({
    config: input.config,
    ...matcherArtifacts
  });
  const corePaths = corePathsFor(input.config);
  writeArtifact(input.repoRoot, corePaths.readiness, artifacts.readiness);
  writeArtifact(input.repoRoot, corePaths.adminSurfaceSummary, artifacts.adminSurfaceSummary);
  writeArtifact(input.repoRoot, corePaths.delta, artifacts.readinessVsMatcherDelta);
  writeMarkdownArtifact(input.repoRoot, corePaths.markdown, `${artifacts.operatorSummary}\n`);
  return artifacts;
};
