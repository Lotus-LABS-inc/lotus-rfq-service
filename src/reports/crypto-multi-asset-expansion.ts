import { pairLabelRouteEligibility } from "../matching/match-labels.js";
import { CryptoMatchingPipeline, type CryptoMatchingPipelineResult } from "../matching/crypto/crypto-matching-pipeline.js";
import { cryptoScopedAssetValues, type CryptoTrackedAsset } from "../matching/crypto/crypto-match-labels.js";
import { PairEdgeRepository } from "../repositories/pair-edge.repository.js";
import type { Pool } from "pg";

import type { CryptoMatchingQualitySummary } from "./crypto-matching-quality-summary.js";
import type { CryptoPairRouteabilitySummary } from "./crypto-pair-routeability-summary.js";

const TARGET_FAMILIES = ["SAME_DAY_DIRECTIONAL", "ATH_BY_DATE", "THRESHOLD_BY_DATE"] as const;
type TargetFamily = typeof TARGET_FAMILIES[number];

interface BtcBaselineArtifacts {
  matchingQuality: CryptoMatchingQualitySummary;
  routeability: CryptoPairRouteabilitySummary;
}

interface AssetFamilyCounter {
  asset: string;
  family: string;
  count: number;
}

export interface CryptoScopeActivationSummary {
  observedAt: string;
  totalCryptoRowsSeen: number;
  admittedCountsByAsset: Record<string, number>;
  excludedCountsByReason: Record<string, number>;
  assetRejectionReasons: Record<string, number>;
}

export interface CryptoMultiAssetFamilySummary {
  observedAt: string;
  countsByAssetFamily: Record<string, Record<string, number>>;
  ambiguityFlags: Record<string, number>;
  rejectedCountsByStatus: Record<string, number>;
}

export interface CryptoMultiAssetFingerprintSummary {
  observedAt: string;
  coverageByAssetFamily: Record<string, Record<string, Record<string, number>>>;
}

export interface CryptoMultiAssetPrefilterSummary {
  observedAt: string;
  candidatePairsConsidered: number;
  acceptedPairs: number;
  blockerReasons: Record<string, number>;
  blockerReasonsByAsset: Record<string, Record<string, number>>;
  blockerReasonsByVenuePair: Record<string, Record<string, number>>;
}

export interface CryptoMultiAssetEdgeSummary {
  observedAt: string;
  perAsset: Record<string, {
    candidatePairsConsidered: number;
    exactSafeEdgesPersisted: number;
    exactSafeEdgesApproved: number;
    labels: Record<string, number>;
    dominantRejectionReasons: Record<string, number>;
  }>;
  perFamily: Record<string, {
    candidatePairsConsidered: number;
    exactSafeEdgesApproved: number;
    labels: Record<string, number>;
  }>;
}

export interface CryptoMultiAssetPairRouteabilitySummary {
  observedAt: string;
  exactSafePairsByAsset: Record<string, number>;
  exactSafePairsByFamily: Record<string, number>;
  exactSafePairsByAssetFamily: Record<string, number>;
  exactSafePairsByVenuePair: Record<string, number>;
  pairRouteableOpportunitiesByAssetFamily: Record<string, number>;
  triCapableAssetFamilies: readonly string[];
  triBlockersByAssetFamily: Record<string, string>;
  exactSafeApprovedCount: number;
}

export interface CryptoMultiAssetGraphSummary {
  observedAt: string;
  sourceCryptoMarketCount: number;
  structurallyEligibleMarketCount: number;
  pairEdgeCount: number;
  labelDistribution: Record<string, number>;
  blockerReasons: Record<string, number>;
}

export interface CryptoMultiAssetDeltaVsBtc {
  observedAt: string;
  before: {
    sourceCryptoMarkets: number;
    structurallyEligibleMarkets: number;
    pairEdges: number;
    exactSafeApprovedEdges: number;
    exactSafeEdgesByFamily: Record<string, number>;
    exactSafeEdgesByVenuePair: Record<string, number>;
    pairRouteableOpportunities: number;
    blockerReasons: Record<string, number>;
  };
  after: {
    sourceCryptoMarkets: number;
    structurallyEligibleMarkets: number;
    pairEdges: number;
    exactSafeApprovedEdges: number;
    exactSafeEdgesByFamily: Record<string, number>;
    exactSafeEdgesByVenuePair: Record<string, number>;
    pairRouteableOpportunities: number;
    blockerReasons: Record<string, number>;
  };
  delta: {
    sourceCryptoMarkets: number;
    structurallyEligibleMarkets: number;
    pairEdges: number;
    exactSafeApprovedEdges: number;
    pairRouteableOpportunities: number;
    exactSafeEdgesByFamily: Record<string, number>;
    exactSafeEdgesByVenuePair: Record<string, number>;
    blockerReasons: Record<string, number>;
  };
}

export type CryptoMultiAssetDecisionLabel =
  | "CRYPTO_EXPANSION_SUCCESS__STAY_IN_CRYPTO"
  | "CRYPTO_EXPANSION_MODEST__ONE_MORE_TARGETED_PASS"
  | "CRYPTO_EXPANSION_FLAT__PIVOT_TO_SPORTS"
  | "CRYPTO_EXPANSION_NOISY__TIGHTEN_SCOPE";

export interface CryptoMultiAssetNextStepDecision {
  observedAt: string;
  decision: CryptoMultiAssetDecisionLabel;
  rationale: string;
  bestPerformingAsset: string | null;
  bestPerformingFamily: string | null;
  cryptoStillHasRoi: boolean;
}

export interface CryptoMultiAssetSourceHygieneSummary {
  observedAt: string;
  rejectedRows: number;
  reasons: Record<string, number>;
  examples: readonly {
    venue: string;
    venueMarketId: string;
    title: string;
    reasons: readonly string[];
  }[];
}

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

const incrementNested = (target: Record<string, Record<string, number>>, key: string, nestedKey: string): void => {
  target[key] ??= {};
  increment(target[key]!, nestedKey);
};

const byAssetFamilyKey = (asset: string, family: string): string => `${asset}|${family}`;
const routeableVenuePairKey = (value: string): string => value.replace("|", "_");

const sortRecord = (value: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(value).sort((left, right) => left[0].localeCompare(right[0])));

const routeablePairCount = (result: CryptoMatchingPipelineResult): number =>
  result.pairEvaluations.filter((entry) => pairLabelRouteEligibility(entry.finalLabel, entry.approvalState)).length;

const buildScopeActivationSummary = (result: CryptoMatchingPipelineResult): CryptoScopeActivationSummary => {
  const admittedCountsByAsset: Record<string, number> = {};
  const excludedCountsByReason: Record<string, number> = {};
  const assetRejectionReasons: Record<string, number> = {};

  for (const entry of result.scopeEvaluations) {
    if (entry.scopeStatus === "ADMITTED" && entry.normalizedAsset) {
      increment(admittedCountsByAsset, entry.normalizedAsset);
      continue;
    }
    for (const reason of entry.scopeReasons) {
      increment(excludedCountsByReason, reason);
      if (reason === "NON_TARGET_ASSET" || reason === "BAD_CRYPTO_ROW") {
        increment(assetRejectionReasons, reason);
      }
    }
  }

  return {
    observedAt: new Date().toISOString(),
    totalCryptoRowsSeen: result.classifiedMarkets.length,
    admittedCountsByAsset: sortRecord(admittedCountsByAsset),
    excludedCountsByReason: sortRecord(excludedCountsByReason),
    assetRejectionReasons: sortRecord(assetRejectionReasons)
  };
};

const buildFamilySummary = (result: CryptoMatchingPipelineResult): CryptoMultiAssetFamilySummary => {
  const countsByAssetFamily: Record<string, Record<string, number>> = {};
  const ambiguityFlags: Record<string, number> = {};
  const rejectedCountsByStatus: Record<string, number> = {};

  for (const entry of result.scopeEvaluations) {
    increment(rejectedCountsByStatus, entry.scopeStatus);
    if (entry.normalizedAsset && entry.scopeStatus === "ADMITTED") {
      incrementNested(countsByAssetFamily, entry.normalizedAsset, entry.classification.family);
    }
    for (const flag of entry.classification.ambiguityFlags) {
      increment(ambiguityFlags, flag);
    }
  }

  return {
    observedAt: new Date().toISOString(),
    countsByAssetFamily,
    ambiguityFlags: sortRecord(ambiguityFlags),
    rejectedCountsByStatus: sortRecord(rejectedCountsByStatus)
  };
};

const buildFingerprintSummary = (result: CryptoMatchingPipelineResult): CryptoMultiAssetFingerprintSummary => {
  const coverageByAssetFamily: Record<string, Record<string, Record<string, number>>> = {};
  const fields = [
    "dateKey",
    "timezoneNormalizedCutoffKey",
    "comparator",
    "threshold",
    "observationType",
    "bucketGranularity"
  ] as const;

  for (const entry of result.scopeEvaluations.filter((item) => item.scopeStatus === "ADMITTED" && item.normalizedAsset)) {
    const asset = entry.normalizedAsset!;
    const family = entry.classification.family;
    coverageByAssetFamily[asset] ??= {};
    coverageByAssetFamily[asset]![family] ??= {};
    for (const field of fields) {
      if (entry.fingerprint.fingerprint[field] !== null && entry.fingerprint.fingerprint[field] !== undefined) {
        increment(coverageByAssetFamily[asset]![family]!, field);
      }
    }
  }

  return {
    observedAt: new Date().toISOString(),
    coverageByAssetFamily
  };
};

const buildPrefilterSummary = (result: CryptoMatchingPipelineResult): CryptoMultiAssetPrefilterSummary => {
  const blockerReasons: Record<string, number> = {};
  const blockerReasonsByAsset: Record<string, Record<string, number>> = {};
  const blockerReasonsByVenuePair: Record<string, Record<string, number>> = {};

  for (const entry of result.prefilterEvaluations.filter((item) => !item.accepted)) {
    const asset = entry.asset ?? "UNKNOWN";
    for (const reason of entry.reasons) {
      increment(blockerReasons, reason);
      incrementNested(blockerReasonsByAsset, asset, reason);
      incrementNested(blockerReasonsByVenuePair, entry.venuePair, reason);
    }
  }

  return {
    observedAt: new Date().toISOString(),
    candidatePairsConsidered: result.prefilterEvaluations.length,
    acceptedPairs: result.prefilterEvaluations.filter((entry) => entry.accepted).length,
    blockerReasons: sortRecord(blockerReasons),
    blockerReasonsByAsset,
    blockerReasonsByVenuePair
  };
};

const buildEdgeSummary = (result: CryptoMatchingPipelineResult): CryptoMultiAssetEdgeSummary => {
  const perAsset: CryptoMultiAssetEdgeSummary["perAsset"] = {};
  const perFamily: CryptoMultiAssetEdgeSummary["perFamily"] = {};

  for (const evaluation of result.prefilterEvaluations.filter((entry) => entry.accepted)) {
    const asset = evaluation.asset ?? "UNKNOWN";
    perAsset[asset] ??= {
      candidatePairsConsidered: 0,
      exactSafeEdgesPersisted: 0,
      exactSafeEdgesApproved: 0,
      labels: {},
      dominantRejectionReasons: {}
    };
    perAsset[asset]!.candidatePairsConsidered += 1;
  }

  for (const evaluation of result.pairEvaluations) {
    const asset = evaluation.asset ?? "UNKNOWN";
    perAsset[asset] ??= {
      candidatePairsConsidered: 0,
      exactSafeEdgesPersisted: 0,
      exactSafeEdgesApproved: 0,
      labels: {},
      dominantRejectionReasons: {}
    };
    perFamily[evaluation.family] ??= {
      candidatePairsConsidered: 0,
      exactSafeEdgesApproved: 0,
      labels: {}
    };
    perAsset[asset]!.exactSafeEdgesPersisted += evaluation.finalLabel === "EXACT" ? 1 : 0;
    perAsset[asset]!.exactSafeEdgesApproved += pairLabelRouteEligibility(evaluation.finalLabel, evaluation.approvalState) ? 1 : 0;
    increment(perAsset[asset]!.labels, evaluation.finalLabel);
    perFamily[evaluation.family]!.candidatePairsConsidered += 1;
    perFamily[evaluation.family]!.exactSafeEdgesApproved += pairLabelRouteEligibility(evaluation.finalLabel, evaluation.approvalState) ? 1 : 0;
    increment(perFamily[evaluation.family]!.labels, evaluation.finalLabel);
    for (const reason of evaluation.rejectionReasons) {
      increment(perAsset[asset]!.dominantRejectionReasons, reason);
    }
  }

  for (const asset of Object.keys(perAsset)) {
    perAsset[asset]!.labels = sortRecord(perAsset[asset]!.labels);
    perAsset[asset]!.dominantRejectionReasons = sortRecord(perAsset[asset]!.dominantRejectionReasons);
  }

  return {
    observedAt: new Date().toISOString(),
    perAsset,
    perFamily
  };
};

const buildMultiAssetPairRouteabilitySummary = (result: CryptoMatchingPipelineResult): CryptoMultiAssetPairRouteabilitySummary => {
  const exactSafePairsByAsset: Record<string, number> = {};
  const exactSafePairsByFamily: Record<string, number> = {};
  const exactSafePairsByAssetFamily: Record<string, number> = {};
  const exactSafePairsByVenuePair: Record<string, number> = {};
  const pairRouteableOpportunitiesByAssetFamily: Record<string, number> = {};
  const routeableVenuePairsByAssetFamily = new Map<string, Set<string>>();

  for (const evaluation of result.pairEvaluations.filter((entry) => pairLabelRouteEligibility(entry.finalLabel, entry.approvalState))) {
    const asset = evaluation.asset ?? "UNKNOWN";
    increment(exactSafePairsByAsset, asset);
    increment(exactSafePairsByFamily, evaluation.family);
    increment(exactSafePairsByAssetFamily, byAssetFamilyKey(asset, evaluation.family));
    increment(exactSafePairsByVenuePair, routeableVenuePairKey(evaluation.venuePair));
    increment(pairRouteableOpportunitiesByAssetFamily, byAssetFamilyKey(asset, evaluation.family));
    const set = routeableVenuePairsByAssetFamily.get(byAssetFamilyKey(asset, evaluation.family)) ?? new Set<string>();
    set.add(evaluation.venuePair);
    routeableVenuePairsByAssetFamily.set(byAssetFamilyKey(asset, evaluation.family), set);
  }

  const triCapableAssetFamilies = [...routeableVenuePairsByAssetFamily.entries()]
    .filter(([, venuePairs]) => venuePairs.size === 3)
    .map(([key]) => key)
    .sort();

  const triBlockersByAssetFamily: Record<string, string> = {};
  for (const [key, venuePairs] of routeableVenuePairsByAssetFamily.entries()) {
    if (venuePairs.size < 3) {
      triBlockersByAssetFamily[key] = venuePairs.size === 0 ? "MISSING_EDGE" : "PARTIAL_EDGE_SET";
    }
  }

  for (const entry of result.scopeEvaluations.filter((item) => item.scopeStatus === "ADMITTED" && item.normalizedAsset)) {
    const key = byAssetFamilyKey(entry.normalizedAsset!, entry.classification.family);
    triBlockersByAssetFamily[key] ??= "MISSING_EDGE";
  }

  return {
    observedAt: new Date().toISOString(),
    exactSafePairsByAsset: sortRecord(exactSafePairsByAsset),
    exactSafePairsByFamily: sortRecord(exactSafePairsByFamily),
    exactSafePairsByAssetFamily: sortRecord(exactSafePairsByAssetFamily),
    exactSafePairsByVenuePair: sortRecord(exactSafePairsByVenuePair),
    pairRouteableOpportunitiesByAssetFamily: sortRecord(pairRouteableOpportunitiesByAssetFamily),
    triCapableAssetFamilies,
    triBlockersByAssetFamily,
    exactSafeApprovedCount: routeablePairCount(result)
  };
};

const buildGraphSummary = (result: CryptoMatchingPipelineResult): CryptoMultiAssetGraphSummary => {
  const labelDistribution: Record<string, number> = {};
  const blockerReasons: Record<string, number> = {};

  for (const evaluation of result.pairEvaluations) {
    increment(labelDistribution, evaluation.finalLabel);
    for (const reason of evaluation.rejectionReasons) {
      increment(blockerReasons, reason);
    }
  }
  for (const reason of result.candidateRejectionReasons) {
    increment(blockerReasons, reason);
  }

  return {
    observedAt: new Date().toISOString(),
    sourceCryptoMarketCount: result.classifiedMarkets.length,
    structurallyEligibleMarketCount: result.eligibleMarkets.length,
    pairEdgeCount: result.pairEdges.length,
    labelDistribution: sortRecord(labelDistribution),
    blockerReasons: sortRecord(blockerReasons)
  };
};

const subtractRecord = (after: Record<string, number>, before: Record<string, number>): Record<string, number> => {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return Object.fromEntries([...keys].sort().map((key) => [key, (after[key] ?? 0) - (before[key] ?? 0)]));
};

const buildDeltaVsBtc = (
  baseline: BtcBaselineArtifacts,
  graph: CryptoMultiAssetGraphSummary,
  routeability: CryptoMultiAssetPairRouteabilitySummary
): CryptoMultiAssetDeltaVsBtc => ({
  observedAt: new Date().toISOString(),
  before: {
    sourceCryptoMarkets: baseline.matchingQuality.sourceCryptoMarketCount,
    structurallyEligibleMarkets: baseline.matchingQuality.btcMarketCount,
    pairEdges: baseline.matchingQuality.pairEdgeCount,
    exactSafeApprovedEdges: baseline.routeability.exactSafeApprovedCount,
    exactSafeEdgesByFamily: baseline.routeability.routeablePairsByFamily,
    exactSafeEdgesByVenuePair: baseline.routeability.routeablePairsByVenuePair,
    pairRouteableOpportunities: baseline.routeability.exactSafeApprovedCount,
    blockerReasons: baseline.routeability.blockerReasons
  },
  after: {
    sourceCryptoMarkets: graph.sourceCryptoMarketCount,
    structurallyEligibleMarkets: graph.structurallyEligibleMarketCount,
    pairEdges: graph.pairEdgeCount,
    exactSafeApprovedEdges: routeability.exactSafeApprovedCount,
    exactSafeEdgesByFamily: routeability.exactSafePairsByFamily,
    exactSafeEdgesByVenuePair: routeability.exactSafePairsByVenuePair,
    pairRouteableOpportunities: routeability.exactSafeApprovedCount,
    blockerReasons: graph.blockerReasons
  },
  delta: {
    sourceCryptoMarkets: graph.sourceCryptoMarketCount - baseline.matchingQuality.sourceCryptoMarketCount,
    structurallyEligibleMarkets: graph.structurallyEligibleMarketCount - baseline.matchingQuality.btcMarketCount,
    pairEdges: graph.pairEdgeCount - baseline.matchingQuality.pairEdgeCount,
    exactSafeApprovedEdges: routeability.exactSafeApprovedCount - baseline.routeability.exactSafeApprovedCount,
    pairRouteableOpportunities: routeability.exactSafeApprovedCount - baseline.routeability.exactSafeApprovedCount,
    exactSafeEdgesByFamily: subtractRecord(routeability.exactSafePairsByFamily, baseline.routeability.routeablePairsByFamily),
    exactSafeEdgesByVenuePair: subtractRecord(routeability.exactSafePairsByVenuePair, baseline.routeability.routeablePairsByVenuePair),
    blockerReasons: subtractRecord(graph.blockerReasons, baseline.routeability.blockerReasons)
  }
});

const bestRecordKey = (value: Record<string, number>): string | null =>
  Object.entries(value).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;

const buildDecision = (
  delta: CryptoMultiAssetDeltaVsBtc,
  routeability: CryptoMultiAssetPairRouteabilitySummary,
  graph: CryptoMultiAssetGraphSummary
): CryptoMultiAssetNextStepDecision => {
  const exactDelta = delta.delta.exactSafeApprovedEdges;
  const baselineExact = Math.max(1, delta.before.exactSafeApprovedEdges);
  const relativeGrowth = exactDelta / baselineExact;
  const newAssetContributors = Object.entries(routeability.exactSafePairsByAsset)
    .filter(([asset, count]) => asset !== "BTC" && count > 0)
    .length;
  const blockerGrowth = Object.values(delta.delta.blockerReasons).reduce((sum, value) => sum + Math.max(0, value), 0);
  const noisyGrowth = graph.structurallyEligibleMarketCount > delta.before.structurallyEligibleMarkets
    && exactDelta <= 0
    && blockerGrowth > 0;

  const decision =
    !noisyGrowth && newAssetContributors > 0 && (relativeGrowth >= 1 || exactDelta >= 3)
      ? "CRYPTO_EXPANSION_SUCCESS__STAY_IN_CRYPTO"
      : !noisyGrowth && (exactDelta === 1 || exactDelta === 2 || newAssetContributors === 1)
        ? "CRYPTO_EXPANSION_MODEST__ONE_MORE_TARGETED_PASS"
        : noisyGrowth
          ? "CRYPTO_EXPANSION_NOISY__TIGHTEN_SCOPE"
          : "CRYPTO_EXPANSION_FLAT__PIVOT_TO_SPORTS";

  const bestPerformingAsset = bestRecordKey(routeability.exactSafePairsByAsset);
  const bestPerformingFamily = bestRecordKey(routeability.exactSafePairsByFamily);
  const rationale =
    decision === "CRYPTO_EXPANSION_SUCCESS__STAY_IN_CRYPTO"
      ? "The scoped ETH/SOL expansion materially increased exact-safe pair density without overwhelming blocker growth."
      : decision === "CRYPTO_EXPANSION_MODEST__ONE_MORE_TARGETED_PASS"
        ? "The multi-asset slice added some new exact-safe edges, but growth is still narrow and concentrated."
        : decision === "CRYPTO_EXPANSION_NOISY__TIGHTEN_SCOPE"
          ? "Eligible-row growth converted mostly into blocker/noise growth rather than usable exact-safe routeability."
          : "The BTC+ETH+SOL slice did not materially improve exact-safe pair density relative to the BTC-only baseline.";

  return {
    observedAt: new Date().toISOString(),
    decision,
    rationale,
    bestPerformingAsset,
    bestPerformingFamily,
    cryptoStillHasRoi: decision === "CRYPTO_EXPANSION_SUCCESS__STAY_IN_CRYPTO" || decision === "CRYPTO_EXPANSION_MODEST__ONE_MORE_TARGETED_PASS"
  };
};

const buildSourceHygieneSummary = (result: CryptoMatchingPipelineResult): CryptoMultiAssetSourceHygieneSummary => {
  const reasons: Record<string, number> = {};
  const rejectedRows = result.scopeEvaluations.filter((entry) => entry.scopeStatus !== "ADMITTED");
  for (const row of rejectedRows) {
    for (const reason of row.scopeReasons) {
      increment(reasons, reason);
    }
  }

  return {
    observedAt: new Date().toISOString(),
    rejectedRows: rejectedRows.length,
    reasons: sortRecord(reasons),
    examples: rejectedRows.slice(0, 10).map((entry) => ({
      venue: entry.market.venue,
      venueMarketId: entry.market.venueMarketId,
      title: entry.market.title,
      reasons: entry.scopeReasons
    }))
  };
};

export const buildCryptoMultiAssetDeltaVsBtcMarkdown = (artifact: CryptoMultiAssetDeltaVsBtc): string => [
  "# Crypto Multi-Asset Delta vs BTC",
  "",
  `- exact-safe approved edges: ${artifact.before.exactSafeApprovedEdges} -> ${artifact.after.exactSafeApprovedEdges} (${artifact.delta.exactSafeApprovedEdges >= 0 ? "+" : ""}${artifact.delta.exactSafeApprovedEdges})`,
  `- pair edges: ${artifact.before.pairEdges} -> ${artifact.after.pairEdges} (${artifact.delta.pairEdges >= 0 ? "+" : ""}${artifact.delta.pairEdges})`,
  `- structurally eligible markets: ${artifact.before.structurallyEligibleMarkets} -> ${artifact.after.structurallyEligibleMarkets} (${artifact.delta.structurallyEligibleMarkets >= 0 ? "+" : ""}${artifact.delta.structurallyEligibleMarkets})`,
  ""
].join("\n");

export const buildCryptoMultiAssetNextStepDecisionMarkdown = (artifact: CryptoMultiAssetNextStepDecision): string => [
  "# Crypto Multi-Asset Next-Step Decision",
  "",
  `- decision: \`${artifact.decision}\``,
  `- best-performing asset: ${artifact.bestPerformingAsset ?? "none"}`,
  `- best-performing family: ${artifact.bestPerformingFamily ?? "none"}`,
  `- crypto still has ROI: ${artifact.cryptoStillHasRoi ? "yes" : "no"}`,
  "",
  artifact.rationale,
  ""
].join("\n");

export const buildCryptoMultiAssetOperatorSummary = (input: {
  decision: CryptoMultiAssetNextStepDecision;
  routeability: CryptoMultiAssetPairRouteabilitySummary;
}): string => [
  "# Crypto Multi-Asset Operator Summary",
  "",
  `1. Narrow multi-asset crypto materially improved exact-safe pair edges: ${input.decision.decision === "CRYPTO_EXPANSION_SUCCESS__STAY_IN_CRYPTO" ? "yes" : input.decision.decision === "CRYPTO_EXPANSION_MODEST__ONE_MORE_TARGETED_PASS" ? "partially" : "no"}.`,
  `2. Best-performing asset: ${input.decision.bestPerformingAsset ?? "none"}.`,
  `3. Best-performing family: ${input.decision.bestPerformingFamily ?? "none"}.`,
  `4. New strongest venue-pair lanes: ${Object.keys(input.routeability.exactSafePairsByVenuePair).join(", ") || "none"}.`,
  `5. Crypto still justifies more matching work: ${input.decision.cryptoStillHasRoi ? "yes" : "no"}.`,
  `6. Recommended frontier choice: ${input.decision.decision}.`,
  ""
].join("\n");

export interface CryptoMultiAssetExpansionArtifacts {
  scopeActivation: CryptoScopeActivationSummary;
  familySummary: CryptoMultiAssetFamilySummary;
  fingerprintSummary: CryptoMultiAssetFingerprintSummary;
  prefilterSummary: CryptoMultiAssetPrefilterSummary;
  edgeSummary: CryptoMultiAssetEdgeSummary;
  pairRouteabilitySummary: CryptoMultiAssetPairRouteabilitySummary;
  graphSummary: CryptoMultiAssetGraphSummary;
  deltaVsBtc: CryptoMultiAssetDeltaVsBtc;
  decision: CryptoMultiAssetNextStepDecision;
  sourceHygiene: CryptoMultiAssetSourceHygieneSummary;
  operatorSummary: string;
}

export const buildCryptoMultiAssetExpansionArtifactsFromResult = (input: {
  result: CryptoMatchingPipelineResult;
  baseline: BtcBaselineArtifacts;
}): CryptoMultiAssetExpansionArtifacts => {
  const result = input.result;
  const scopeActivation = buildScopeActivationSummary(result);
  const familySummary = buildFamilySummary(result);
  const fingerprintSummary = buildFingerprintSummary(result);
  const prefilterSummary = buildPrefilterSummary(result);
  const edgeSummary = buildEdgeSummary(result);
  const pairRouteabilitySummary = buildMultiAssetPairRouteabilitySummary(result);
  const graphSummary = buildGraphSummary(result);
  const deltaVsBtc = buildDeltaVsBtc(input.baseline, graphSummary, pairRouteabilitySummary);
  const decision = buildDecision(deltaVsBtc, pairRouteabilitySummary, graphSummary);
  const sourceHygiene = buildSourceHygieneSummary(result);

  return {
    scopeActivation,
    familySummary,
    fingerprintSummary,
    prefilterSummary,
    edgeSummary,
    pairRouteabilitySummary,
    graphSummary,
    deltaVsBtc,
    decision,
    sourceHygiene,
    operatorSummary: buildCryptoMultiAssetOperatorSummary({
      decision,
      routeability: pairRouteabilitySummary
    })
  };
};

export const buildCryptoMultiAssetExpansionArtifacts = async (input: {
  pool: Pool;
  baseline: BtcBaselineArtifacts;
}): Promise<CryptoMultiAssetExpansionArtifacts> => {
  const pipeline = new CryptoMatchingPipeline(new PairEdgeRepository(input.pool), {
    allowedAssets: cryptoScopedAssetValues,
    allowedFamilies: TARGET_FAMILIES,
    scopeName: "major-assets-v1"
  });
  const result = await pipeline.run();
  return buildCryptoMultiAssetExpansionArtifactsFromResult({
    result,
    baseline: input.baseline
  });
};
