import { createHash } from "node:crypto";

import { readArtifact, writeArtifact, writeMarkdownArtifact } from "./shared.js";
import type { CryptoTokenLaunchByDateProjectConfig } from "../../matching/crypto/crypto-token-launch-by-date-assets.js";

interface MatcherInputSummaryArtifact {
  exactFamily: string;
  targetPair: string;
  admittedVenues: string[];
  admittedTopicKeys: string[];
}

interface MatcherPairLanesArtifact {
  matcherLanes: {
    venuePair: string;
    canonicalTopicKey: string;
    exactLaunchDate: string;
    rulesDecision: "EXACT_RULE_COMPATIBLE" | "SEMANTICALLY_COMPATIBLE_REWORDING";
  }[];
}

interface MatcherRejectionsArtifact {
  rejections: { notes: string }[];
}

interface MatcherFinalDecisionArtifact {
  overallDecision: string;
  bestPair: string | null;
  pairMatcherReady: boolean;
  ruleStatus: "EXACT_RULE_COMPATIBLE" | "SEMANTICALLY_COMPATIBLE_REWORDING";
  operatorCredible: boolean;
}

const buildScopeHash = (values: readonly string[]): string =>
  createHash("sha256").update([...values].sort().join("|")).digest("hex").slice(0, 16);

const matcherPathsFor = (config: CryptoTokenLaunchByDateProjectConfig) => {
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

const corePathsFor = (config: CryptoTokenLaunchByDateProjectConfig) => {
  const stem = `crypto-${config.artifactKey}`;
  return {
    readiness: `artifacts/crypto/core/${stem}-limited-prod-readiness.json`,
    adminSurfaceSummary: `artifacts/crypto/core/${stem}-admin-surface-summary.json`,
    delta: `artifacts/crypto/core/${stem}-readiness-vs-matcher-delta.json`,
    markdown: `artifacts/crypto/core/${stem}-limited-prod-readiness.md`
  };
};

export const runCryptoTokenLaunchByDateLimitedProdReadiness = async (input: {
  repoRoot: string;
  config: CryptoTokenLaunchByDateProjectConfig;
}) => {
  const { config } = input;
  const matcherPaths = matcherPathsFor(config);
  const inputSummary = readArtifact<MatcherInputSummaryArtifact>(input.repoRoot, matcherPaths.inputSummary);
  const pairLanes = readArtifact<MatcherPairLanesArtifact>(input.repoRoot, matcherPaths.pairLanes);
  const rejections = readArtifact<MatcherRejectionsArtifact>(input.repoRoot, matcherPaths.rejections);
  const finalDecision = readArtifact<MatcherFinalDecisionArtifact>(input.repoRoot, matcherPaths.finalDecision);
  const exactSafePairLanes = pairLanes.matcherLanes
    .filter((lane) => lane.venuePair === "POLYMARKET|PREDICT")
    .sort((left, right) => left.exactLaunchDate.localeCompare(right.exactLaunchDate));
  const exactSafeLaunchDateBuckets = exactSafePairLanes.map((lane) => lane.exactLaunchDate);
  const exactSafeTopics = exactSafePairLanes.map((lane) => lane.canonicalTopicKey);
  const ruleStatus = exactSafePairLanes[0]?.rulesDecision ?? finalDecision.ruleStatus;
  const operatorRuleReviewRequired = ruleStatus !== "EXACT_RULE_COMPATIBLE";
  const matcherReady = finalDecision.pairMatcherReady && exactSafeLaunchDateBuckets.length > 0;
  const exactPairScopeLocked =
    inputSummary.exactFamily === config.familyKey
    && inputSummary.targetPair === "POLYMARKET|PREDICT"
    && finalDecision.bestPair === "POLYMARKET|PREDICT"
    && exactSafeLaunchDateBuckets.length > 0;
  const finalReadinessLabel =
    !matcherReady || !finalDecision.operatorCredible || !exactPairScopeLocked
      ? `${config.decisionPrefix}_LIMITED_PROD_NOT_APPROVED`
      : operatorRuleReviewRequired
        ? `${config.decisionPrefix}_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
        : `${config.decisionPrefix}_LIMITED_PROD_READY_FOR_REVIEW`;
  const currentReadinessDecision = finalReadinessLabel.endsWith("_NOT_APPROVED")
    ? "NOT_READY_FOR_LIMITED_PROD"
    : operatorRuleReviewRequired
      ? "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
      : "READY_BUT_MISSING_OPERATOR_REVIEW";

  const readiness = {
    observedAt: new Date().toISOString(),
    laneId: config.laneId,
    familyKey: config.familyKey,
    venuePair: "POLYMARKET|PREDICT",
    exactSafeLaunchDateBuckets,
    exactSafeTopics,
    ruleStatus,
    operatorRuleReviewRequired,
    matcherReady,
    operatorCredible: finalDecision.operatorCredible,
    readinessReviewJustified: matcherReady && finalDecision.operatorCredible && exactPairScopeLocked,
    rolloutRecommended: false,
    recommendedMode: "LIMITED_PROD_REVIEW_ONLY",
    finalReadinessLabel
  };
  const adminSurfaceSummary = {
    observedAt: new Date().toISOString(),
    laneId: config.laneId,
    familyKey: config.familyKey,
    venuePair: "POLYMARKET|PREDICT",
    dateScopeHash: buildScopeHash(exactSafeLaunchDateBuckets),
    exactSafeLaunchDateBuckets,
    currentReadinessDecision,
    supportedActions: ["inspect", "hold", "promote", "rollback"],
    userConsentCanWidenScope: false,
    narrowestEnforceableUnit: "LANE_SCOPE_LOCK",
    sourceArtifactRefs: Object.values(matcherPaths)
  };
  const readinessVsMatcherDelta = {
    observedAt: new Date().toISOString(),
    laneId: config.laneId,
    matcherTruthConsumed: {
      familyKey: config.familyKey,
      bestPair: finalDecision.bestPair,
      exactSafeLaunchDateBuckets,
      exactSafeTopics,
      overallDecision: finalDecision.overallDecision
    },
    readinessConclusionsDerived: {
      finalReadinessLabel,
      exactLaneScopeLocked: exactPairScopeLocked
    },
    intentionallyUnchanged: ["NO_TRI_LANE_INTRODUCED", "NO_VENUE_WIDENING"],
    stillBlocked: rejections.rejections.map((entry) => entry.notes)
  };
  const operatorSummary = [
    `# Crypto ${config.project} Token Launch By Date Limited Prod Readiness`,
    "",
    `- lane id: ${config.laneId}`,
    `- exact family: ${config.familyKey}`,
    `- exact-safe shared launch dates: ${exactSafeLaunchDateBuckets.join(", ") || "none"}`,
    `- final readiness label: ${finalReadinessLabel}`,
    `- admin decision: ${currentReadinessDecision}`
  ].join("\n");

  const corePaths = corePathsFor(config);
  writeArtifact(input.repoRoot, corePaths.readiness, readiness);
  writeArtifact(input.repoRoot, corePaths.adminSurfaceSummary, adminSurfaceSummary);
  writeArtifact(input.repoRoot, corePaths.delta, readinessVsMatcherDelta);
  writeMarkdownArtifact(input.repoRoot, corePaths.markdown, `${operatorSummary}\n`);
  return { readiness, adminSurfaceSummary, readinessVsMatcherDelta, operatorSummary };
};
