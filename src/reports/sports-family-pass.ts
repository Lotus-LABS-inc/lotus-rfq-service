import { pairLabelRouteEligibility } from "../matching/match-labels.js";
import { SportsMatchingPipeline, type SportsMatchingPipelineResult } from "../matching/sports/sports-matching-pipeline.js";
import { PairEdgeRepository } from "../repositories/pair-edge.repository.js";
import type { Pool } from "pg";

import type {
  CryptoMultiAssetGraphSummary,
  CryptoMultiAssetPairRouteabilitySummary
} from "./crypto-multi-asset-expansion.js";

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

const incrementNested = (target: Record<string, Record<string, number>>, key: string, nestedKey: string): void => {
  target[key] ??= {};
  increment(target[key]!, nestedKey);
};

const sortRecord = (value: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(value).sort((a, b) => a[0].localeCompare(b[0])));

const buildVenuePairKey = (value: string): string => value.replace("|", "_");

export interface SportsFamilyTaxonomySummary {
  observedAt: string;
  admittedCountsByDomainFamily: Record<string, Record<string, number>>;
  rejectedCountsByReason: Record<string, number>;
  ambiguityFlags: Record<string, number>;
}

export interface SportsCompetitionContextSummary {
  observedAt: string;
  normalizedCountsByDomainCompetition: Record<string, Record<string, number>>;
  blockerCounts: Record<string, number>;
}

export interface SportsSubjectEntitySummary {
  observedAt: string;
  normalizedEntityCounts: Record<string, number>;
  unresolvedAliasCount: number;
  blockerCounts: Record<string, number>;
}

export interface SportsStructuralFingerprintSummary {
  observedAt: string;
  coverageByFamily: Record<string, Record<string, number>>;
}

export interface SportsPrefilterSummary {
  observedAt: string;
  candidatePairsConsidered: number;
  acceptedPairs: number;
  blockerReasons: Record<string, number>;
  blockerReasonsByFamily: Record<string, Record<string, number>>;
}

export interface SportsFamilyEdgeSummary {
  observedAt: string;
  perFamily: Record<string, {
    sourceRows: number;
    structurallyEligibleRows: number;
    candidatePairsConsidered: number;
    exactSafeEdgesPersisted: number;
    exactSafeEdgesApproved: number;
    labels: Record<string, number>;
    dominantBlockers: Record<string, number>;
  }>;
  perVenuePair: Record<string, {
    exactSafeEdgesApproved: number;
    labels: Record<string, number>;
  }>;
}

export interface SportsFamilyPairRouteabilitySummary {
  observedAt: string;
  exactSafePairsByDomain: Record<string, number>;
  exactSafePairsByFamily: Record<string, number>;
  exactSafePairsByVenuePair: Record<string, number>;
  routeablePairOpportunitiesByFamily: Record<string, number>;
  triCapableFamilies: readonly string[];
  triBlockersByFamily: Record<string, string>;
  exactSafeApprovedCount: number;
}

export interface SportsFamilyGraphSummary {
  observedAt: string;
  sourceMarketCount: number;
  structurallyEligibleMarketCount: number;
  pairEdgeCount: number;
  labelDistribution: Record<string, number>;
  blockerReasons: Record<string, number>;
}

export interface SportsFamilyDeltaVsCrypto {
  observedAt: string;
  before: {
    exactSafeApprovedEdges: number;
    pairEdges: number;
    pairRouteableOpportunities: number;
    blockerReasons: Record<string, number>;
  };
  after: {
    exactSafeApprovedEdges: number;
    pairEdges: number;
    pairRouteableOpportunities: number;
    blockerReasons: Record<string, number>;
  };
  delta: {
    exactSafeApprovedEdges: number;
    pairEdges: number;
    pairRouteableOpportunities: number;
    blockerReasons: Record<string, number>;
  };
}

export type SportsFamilyDecisionLabel =
  | "SPORTS_FAMILY_PASS_SUCCESS__STAY_ON_SPORTS"
  | "SPORTS_FAMILY_PASS_MODEST__ONE_MORE_TARGETED_PASS"
  | "SPORTS_FAMILY_PASS_NOISY__TIGHTEN_FAMILIES"
  | "SPORTS_FAMILY_PASS_FLAT__REASSESS_FRONTIER";

export interface SportsFamilyNextStepDecision {
  observedAt: string;
  decision: SportsFamilyDecisionLabel;
  rationale: string;
  bestPerformingFamily: string | null;
  bestPerformingVenuePair: string | null;
  sportsClearlyBeatCrypto: boolean;
}

export interface SportsFamilySourceHygieneSummary {
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

export interface SportsFamilyPassArtifacts {
  taxonomySummary: SportsFamilyTaxonomySummary;
  competitionSummary: SportsCompetitionContextSummary;
  subjectSummary: SportsSubjectEntitySummary;
  fingerprintSummary: SportsStructuralFingerprintSummary;
  prefilterSummary: SportsPrefilterSummary;
  edgeSummary: SportsFamilyEdgeSummary;
  pairRouteabilitySummary: SportsFamilyPairRouteabilitySummary;
  graphSummary: SportsFamilyGraphSummary;
  deltaVsCrypto: SportsFamilyDeltaVsCrypto;
  decision: SportsFamilyNextStepDecision;
  sourceHygiene: SportsFamilySourceHygieneSummary;
  operatorSummary: string;
}

const subtractRecord = (after: Record<string, number>, before: Record<string, number>): Record<string, number> => {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return Object.fromEntries([...keys].sort().map((key) => [key, (after[key] ?? 0) - (before[key] ?? 0)]));
};

const buildTaxonomySummary = (result: SportsMatchingPipelineResult): SportsFamilyTaxonomySummary => {
  const admittedCountsByDomainFamily: Record<string, Record<string, number>> = {};
  const rejectedCountsByReason: Record<string, number> = {};
  const ambiguityFlags: Record<string, number> = {};

  for (const entry of result.taxonomyEvaluations) {
    if (entry.taxonomyStatus === "ADMITTED" && entry.domain) {
      incrementNested(admittedCountsByDomainFamily, entry.domain, entry.classification.family);
    } else {
      for (const reason of entry.scopeReasons) {
        increment(rejectedCountsByReason, reason);
      }
    }
    for (const flag of entry.classification.ambiguityFlags) {
      increment(ambiguityFlags, flag);
    }
  }

  return {
    observedAt: new Date().toISOString(),
    admittedCountsByDomainFamily,
    rejectedCountsByReason: sortRecord(rejectedCountsByReason),
    ambiguityFlags: sortRecord(ambiguityFlags)
  };
};

const buildCompetitionSummary = (result: SportsMatchingPipelineResult): SportsCompetitionContextSummary => {
  const normalizedCountsByDomainCompetition: Record<string, Record<string, number>> = {};
  const blockerCounts: Record<string, number> = {};

  for (const entry of result.competitionEvaluations) {
    if (entry.accepted && entry.context) {
      incrementNested(
        normalizedCountsByDomainCompetition,
        entry.context.domain,
        entry.context.competitionKey ?? "UNKNOWN"
      );
      continue;
    }
    for (const blocker of entry.blockers) {
      increment(blockerCounts, blocker);
    }
  }

  return {
    observedAt: new Date().toISOString(),
    normalizedCountsByDomainCompetition,
    blockerCounts: sortRecord(blockerCounts)
  };
};

const buildSubjectSummary = (result: SportsMatchingPipelineResult): SportsSubjectEntitySummary => {
  const normalizedEntityCounts: Record<string, number> = {};
  const blockerCounts: Record<string, number> = {};
  let unresolvedAliasCount = 0;

  for (const entry of result.subjectEvaluations) {
    if (entry.accepted && entry.normalization?.normalizedSubjectEntity) {
      increment(normalizedEntityCounts, entry.normalization.normalizedSubjectEntity);
      continue;
    }
    for (const blocker of entry.blockers) {
      increment(blockerCounts, blocker);
      if (blocker === "UNRESOLVED_ALIAS") {
        unresolvedAliasCount += 1;
      }
    }
  }

  return {
    observedAt: new Date().toISOString(),
    normalizedEntityCounts: sortRecord(normalizedEntityCounts),
    unresolvedAliasCount,
    blockerCounts: sortRecord(blockerCounts)
  };
};

const buildFingerprintSummary = (result: SportsMatchingPipelineResult): SportsStructuralFingerprintSummary => {
  const coverageByFamily: Record<string, Record<string, number>> = {};
  const fields = [
    "competitionKey",
    "competitionScope",
    "subjectEntity",
    "opponentEntity",
    "matchupKey",
    "dateKey",
    "scheduledBoundaryKey",
    "outcomeMappingBasis"
  ] as const;

  result.fingerprints.forEach((fingerprint, index) => {
    const family = result.classifications[index]!.family;
    coverageByFamily[family] ??= {};
    for (const field of fields) {
      if (fingerprint.fingerprint[field] !== null && fingerprint.fingerprint[field] !== undefined) {
        increment(coverageByFamily[family]!, field);
      }
    }
  });

  return {
    observedAt: new Date().toISOString(),
    coverageByFamily
  };
};

const buildPrefilterSummary = (result: SportsMatchingPipelineResult): SportsPrefilterSummary => {
  const blockerReasons: Record<string, number> = {};
  const blockerReasonsByFamily: Record<string, Record<string, number>> = {};

  for (const entry of result.prefilterEvaluations.filter((item) => !item.accepted)) {
    for (const reason of entry.reasons) {
      increment(blockerReasons, reason);
      incrementNested(blockerReasonsByFamily, entry.family, reason);
    }
  }

  return {
    observedAt: new Date().toISOString(),
    candidatePairsConsidered: result.prefilterEvaluations.length,
    acceptedPairs: result.prefilterEvaluations.filter((entry) => entry.accepted).length,
    blockerReasons: sortRecord(blockerReasons),
    blockerReasonsByFamily
  };
};

const buildEdgeSummary = (result: SportsMatchingPipelineResult): SportsFamilyEdgeSummary => {
  const perFamily: SportsFamilyEdgeSummary["perFamily"] = {};
  const perVenuePair: SportsFamilyEdgeSummary["perVenuePair"] = {};

  for (const classification of result.classifications) {
    perFamily[classification.family] ??= {
      sourceRows: 0,
      structurallyEligibleRows: 0,
      candidatePairsConsidered: 0,
      exactSafeEdgesPersisted: 0,
      exactSafeEdgesApproved: 0,
      labels: {},
      dominantBlockers: {}
    };
    perFamily[classification.family]!.sourceRows += 1;
  }

  for (const entry of result.taxonomyEvaluations.filter((item) => item.taxonomyStatus === "ADMITTED")) {
    perFamily[entry.classification.family]!.structurallyEligibleRows += 1;
  }

  for (const entry of result.prefilterEvaluations.filter((item) => item.accepted)) {
    perFamily[entry.family]!.candidatePairsConsidered += 1;
  }

  for (const entry of result.pairEvaluations) {
    perVenuePair[entry.venuePair] ??= {
      exactSafeEdgesApproved: 0,
      labels: {}
    };
    increment(perFamily[entry.family]!.labels, entry.finalLabel);
    increment(perVenuePair[entry.venuePair]!.labels, entry.finalLabel);
    if (entry.finalLabel === "EXACT") {
      perFamily[entry.family]!.exactSafeEdgesPersisted += 1;
    }
    if (pairLabelRouteEligibility(entry.finalLabel, entry.approvalState)) {
      perFamily[entry.family]!.exactSafeEdgesApproved += 1;
      perVenuePair[entry.venuePair]!.exactSafeEdgesApproved += 1;
    }
    for (const reason of entry.rejectionReasons) {
      increment(perFamily[entry.family]!.dominantBlockers, reason);
    }
  }

  for (const family of Object.keys(perFamily)) {
    perFamily[family]!.labels = sortRecord(perFamily[family]!.labels);
    perFamily[family]!.dominantBlockers = sortRecord(perFamily[family]!.dominantBlockers);
  }

  for (const venuePair of Object.keys(perVenuePair)) {
    perVenuePair[venuePair]!.labels = sortRecord(perVenuePair[venuePair]!.labels);
  }

  return {
    observedAt: new Date().toISOString(),
    perFamily,
    perVenuePair
  };
};

const buildPairRouteabilitySummary = (result: SportsMatchingPipelineResult): SportsFamilyPairRouteabilitySummary => {
  const exactSafePairsByDomain: Record<string, number> = {};
  const exactSafePairsByFamily: Record<string, number> = {};
  const exactSafePairsByVenuePair: Record<string, number> = {};
  const routeablePairOpportunitiesByFamily: Record<string, number> = {};
  const routeableVenuePairsByFamily = new Map<string, Set<string>>();

  for (const evaluation of result.pairEvaluations.filter((entry) => pairLabelRouteEligibility(entry.finalLabel, entry.approvalState))) {
    increment(exactSafePairsByDomain, evaluation.domain);
    increment(exactSafePairsByFamily, evaluation.family);
    increment(exactSafePairsByVenuePair, buildVenuePairKey(evaluation.venuePair));
    increment(routeablePairOpportunitiesByFamily, evaluation.family);
    const set = routeableVenuePairsByFamily.get(evaluation.family) ?? new Set<string>();
    set.add(evaluation.venuePair);
    routeableVenuePairsByFamily.set(evaluation.family, set);
  }

  const triCapableFamilies = [...routeableVenuePairsByFamily.entries()]
    .filter(([, venuePairs]) => venuePairs.size >= 3)
    .map(([family]) => family)
    .sort();

  const triBlockersByFamily: Record<string, string> = {};
  for (const family of Object.keys(routeablePairOpportunitiesByFamily)) {
    triBlockersByFamily[family] =
      routeableVenuePairsByFamily.get(family)?.size === 3 ? "NONE"
      : routeableVenuePairsByFamily.get(family)?.size ? "PARTIAL_EDGE_SET"
      : "MISSING_EDGE";
  }
  for (const entry of result.taxonomyEvaluations.filter((item) => item.taxonomyStatus === "ADMITTED")) {
    triBlockersByFamily[entry.classification.family] ??= "MISSING_EDGE";
  }

  return {
    observedAt: new Date().toISOString(),
    exactSafePairsByDomain: sortRecord(exactSafePairsByDomain),
    exactSafePairsByFamily: sortRecord(exactSafePairsByFamily),
    exactSafePairsByVenuePair: sortRecord(exactSafePairsByVenuePair),
    routeablePairOpportunitiesByFamily: sortRecord(routeablePairOpportunitiesByFamily),
    triCapableFamilies,
    triBlockersByFamily,
    exactSafeApprovedCount: result.pairEvaluations.filter((entry) => pairLabelRouteEligibility(entry.finalLabel, entry.approvalState)).length
  };
};

const buildGraphSummary = (result: SportsMatchingPipelineResult): SportsFamilyGraphSummary => {
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
  for (const reason of result.structuralLaneRejections) {
    increment(blockerReasons, reason);
  }

  return {
    observedAt: new Date().toISOString(),
    sourceMarketCount: result.classifiedMarkets.length,
    structurallyEligibleMarketCount: result.eligibleMarkets.length,
    pairEdgeCount: result.pairEdges.length,
    labelDistribution: sortRecord(labelDistribution),
    blockerReasons: sortRecord(blockerReasons)
  };
};

const buildDeltaVsCrypto = (
  cryptoGraph: CryptoMultiAssetGraphSummary,
  cryptoRouteability: CryptoMultiAssetPairRouteabilitySummary,
  sportsGraph: SportsFamilyGraphSummary,
  sportsRouteability: SportsFamilyPairRouteabilitySummary
): SportsFamilyDeltaVsCrypto => ({
  observedAt: new Date().toISOString(),
  before: {
    exactSafeApprovedEdges: cryptoRouteability.exactSafeApprovedCount,
    pairEdges: cryptoGraph.pairEdgeCount,
    pairRouteableOpportunities: cryptoRouteability.exactSafeApprovedCount,
    blockerReasons: cryptoGraph.blockerReasons
  },
  after: {
    exactSafeApprovedEdges: sportsRouteability.exactSafeApprovedCount,
    pairEdges: sportsGraph.pairEdgeCount,
    pairRouteableOpportunities: sportsRouteability.exactSafeApprovedCount,
    blockerReasons: sportsGraph.blockerReasons
  },
  delta: {
    exactSafeApprovedEdges: sportsRouteability.exactSafeApprovedCount - cryptoRouteability.exactSafeApprovedCount,
    pairEdges: sportsGraph.pairEdgeCount - cryptoGraph.pairEdgeCount,
    pairRouteableOpportunities: sportsRouteability.exactSafeApprovedCount - cryptoRouteability.exactSafeApprovedCount,
    blockerReasons: subtractRecord(sportsGraph.blockerReasons, cryptoGraph.blockerReasons)
  }
});

const bestRecordKey = (value: Record<string, number>): string | null =>
  Object.entries(value).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;

const fallbackBestFamily = (result: SportsMatchingPipelineResult): string | null => {
  const counts: Record<string, number> = {};
  for (const entry of result.taxonomyEvaluations.filter((item) => item.taxonomyStatus === "ADMITTED")) {
    increment(counts, entry.classification.family);
  }
  return bestRecordKey(counts);
};

const fallbackBestVenuePair = (result: SportsMatchingPipelineResult): string | null => {
  const counts: Record<string, number> = {};
  for (const entry of result.prefilterEvaluations) {
    increment(counts, buildVenuePairKey(entry.venuePair));
  }
  return bestRecordKey(counts);
};

const buildDecision = (
  delta: SportsFamilyDeltaVsCrypto,
  routeability: SportsFamilyPairRouteabilitySummary,
  prefilter: SportsPrefilterSummary,
  result: SportsMatchingPipelineResult
): SportsFamilyNextStepDecision => {
  const exactDelta = delta.delta.exactSafeApprovedEdges;
  const baselineExact = Math.max(1, delta.before.exactSafeApprovedEdges);
  const relativeGrowth = exactDelta / baselineExact;
  const blockerGrowth = Object.values(delta.delta.blockerReasons).reduce((sum, value) => sum + Math.max(0, value), 0);
  const noisyGrowth = prefilter.candidatePairsConsidered > prefilter.acceptedPairs && exactDelta <= 0 && blockerGrowth > 0;
  const familyContributors = Object.values(routeability.exactSafePairsByFamily).filter((value) => value > 0).length;

  const decision =
    !noisyGrowth && familyContributors > 0 && (relativeGrowth >= 1 || exactDelta >= 3)
      ? "SPORTS_FAMILY_PASS_SUCCESS__STAY_ON_SPORTS"
      : !noisyGrowth && (exactDelta === 1 || exactDelta === 2 || familyContributors === 1)
        ? "SPORTS_FAMILY_PASS_MODEST__ONE_MORE_TARGETED_PASS"
        : noisyGrowth
          ? "SPORTS_FAMILY_PASS_NOISY__TIGHTEN_FAMILIES"
          : "SPORTS_FAMILY_PASS_FLAT__REASSESS_FRONTIER";

  const bestPerformingFamily = bestRecordKey(routeability.exactSafePairsByFamily) ?? fallbackBestFamily(result);
  const bestPerformingVenuePair = bestRecordKey(routeability.exactSafePairsByVenuePair) ?? fallbackBestVenuePair(result);
  const rationale =
    decision === "SPORTS_FAMILY_PASS_SUCCESS__STAY_ON_SPORTS"
      ? "Sports/esports family-first matching materially improved exact-safe pair density relative to the current crypto frontier."
      : decision === "SPORTS_FAMILY_PASS_MODEST__ONE_MORE_TARGETED_PASS"
        ? "Sports/esports produced some exact-safe gains, but the improvement is still narrow and concentrated in one family lane."
        : decision === "SPORTS_FAMILY_PASS_NOISY__TIGHTEN_FAMILIES"
          ? "The sports/esports family pass still converted most eligible-row growth into blockers and review noise."
          : "Sports/esports did not materially beat the current crypto frontier on exact-safe approved edges.";

  return {
    observedAt: new Date().toISOString(),
    decision,
    rationale,
    bestPerformingFamily,
    bestPerformingVenuePair,
    sportsClearlyBeatCrypto: decision === "SPORTS_FAMILY_PASS_SUCCESS__STAY_ON_SPORTS"
  };
};

const buildSourceHygieneSummary = (result: SportsMatchingPipelineResult): SportsFamilySourceHygieneSummary => {
  const reasons: Record<string, number> = {};
  const rejectedRows = result.taxonomyEvaluations.filter((entry) => entry.taxonomyStatus !== "ADMITTED");
  for (const row of rejectedRows) {
    for (const reason of row.scopeReasons) {
      increment(reasons, reason);
    }
  }
  for (const row of result.competitionEvaluations.filter((entry) => !entry.accepted)) {
    for (const reason of row.blockers) {
      increment(reasons, reason);
    }
  }
  for (const row of result.subjectEvaluations.filter((entry) => !entry.accepted)) {
    for (const reason of row.blockers) {
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

export const buildSportsFamilyTaxonomyMarkdown = (artifact: SportsFamilyTaxonomySummary): string => [
  "# Sports Family Taxonomy Summary",
  "",
  ...Object.entries(artifact.admittedCountsByDomainFamily).map(([domain, families]) =>
    `- ${domain}: ${Object.entries(families).map(([family, count]) => `${family}=${count}`).join(", ")}`
  ),
  "",
  `- rejected reasons: ${Object.entries(artifact.rejectedCountsByReason).map(([reason, count]) => `${reason}=${count}`).join(", ") || "none"}`,
  ""
].join("\n");

export const buildSportsCompetitionContextMarkdown = (artifact: SportsCompetitionContextSummary): string => [
  "# Sports Competition Context Summary",
  "",
  ...Object.entries(artifact.normalizedCountsByDomainCompetition).map(([domain, competitions]) =>
    `- ${domain}: ${Object.entries(competitions).map(([competition, count]) => `${competition}=${count}`).join(", ")}`
  ),
  "",
  `- blockers: ${Object.entries(artifact.blockerCounts).map(([reason, count]) => `${reason}=${count}`).join(", ") || "none"}`,
  ""
].join("\n");

export const buildSportsSubjectEntityMarkdown = (artifact: SportsSubjectEntitySummary): string => [
  "# Sports Subject Entity Summary",
  "",
  `- unresolved aliases: ${artifact.unresolvedAliasCount}`,
  `- blockers: ${Object.entries(artifact.blockerCounts).map(([reason, count]) => `${reason}=${count}`).join(", ") || "none"}`,
  ""
].join("\n");

export const buildSportsPrefilterMarkdown = (artifact: SportsPrefilterSummary): string => [
  "# Sports Prefilter Summary",
  "",
  `- candidate pairs considered: ${artifact.candidatePairsConsidered}`,
  `- accepted pairs: ${artifact.acceptedPairs}`,
  `- blockers: ${Object.entries(artifact.blockerReasons).map(([reason, count]) => `${reason}=${count}`).join(", ") || "none"}`,
  ""
].join("\n");

export const buildSportsFamilyEdgeMarkdown = (artifact: SportsFamilyEdgeSummary): string => [
  "# Sports Family Edge Summary",
  "",
  ...Object.entries(artifact.perFamily).map(([family, summary]) =>
    `- ${family}: source=${summary.sourceRows}, eligible=${summary.structurallyEligibleRows}, candidates=${summary.candidatePairsConsidered}, approved=${summary.exactSafeEdgesApproved}`
  ),
  ""
].join("\n");

export const buildSportsFamilyDeltaVsCryptoMarkdown = (artifact: SportsFamilyDeltaVsCrypto): string => [
  "# Sports Family Delta vs Crypto",
  "",
  `- exact-safe approved edges: ${artifact.before.exactSafeApprovedEdges} -> ${artifact.after.exactSafeApprovedEdges} (${artifact.delta.exactSafeApprovedEdges >= 0 ? "+" : ""}${artifact.delta.exactSafeApprovedEdges})`,
  `- pair edges: ${artifact.before.pairEdges} -> ${artifact.after.pairEdges} (${artifact.delta.pairEdges >= 0 ? "+" : ""}${artifact.delta.pairEdges})`,
  ""
].join("\n");

export const buildSportsFamilyNextStepDecisionMarkdown = (artifact: SportsFamilyNextStepDecision): string => [
  "# Sports Family Next-Step Decision",
  "",
  `- decision: \`${artifact.decision}\``,
  `- best-performing family: ${artifact.bestPerformingFamily ?? "none"}`,
  `- best-performing venue pair: ${artifact.bestPerformingVenuePair ?? "none"}`,
  `- sports clearly beat crypto: ${artifact.sportsClearlyBeatCrypto ? "yes" : "no"}`,
  "",
  artifact.rationale,
  ""
].join("\n");

export const buildSportsFamilyOperatorSummary = (input: {
  decision: SportsFamilyNextStepDecision;
  routeability: SportsFamilyPairRouteabilitySummary;
}): string => [
  "# Sports Family Operator Summary",
  "",
  `1. Sports/esports family-first matching materially improved exact-safe pair edges: ${input.decision.decision === "SPORTS_FAMILY_PASS_SUCCESS__STAY_ON_SPORTS" ? "yes" : input.decision.decision === "SPORTS_FAMILY_PASS_MODEST__ONE_MORE_TARGETED_PASS" ? "partially" : "no"}.`,
  `2. Best-performing family: ${input.decision.bestPerformingFamily ?? "none"}.`,
  `3. Best-performing venue pair: ${input.decision.bestPerformingVenuePair ?? "none"}.`,
  `4. Sports vs esports leader: ${bestRecordKey(input.routeability.exactSafePairsByDomain) ?? "none"}.`,
  `5. Sports/esports remains the next ROI-positive frontier: ${input.decision.decision === "SPORTS_FAMILY_PASS_SUCCESS__STAY_ON_SPORTS" || input.decision.decision === "SPORTS_FAMILY_PASS_MODEST__ONE_MORE_TARGETED_PASS" ? "yes" : "no"}.`,
  `6. Smallest correct next action: ${input.decision.decision}.`,
  ""
].join("\n");

export const buildSportsFamilyPassArtifactsFromResult = (input: {
  result: SportsMatchingPipelineResult;
  cryptoGraph: CryptoMultiAssetGraphSummary;
  cryptoRouteability: CryptoMultiAssetPairRouteabilitySummary;
}): SportsFamilyPassArtifacts => {
  const taxonomySummary = buildTaxonomySummary(input.result);
  const competitionSummary = buildCompetitionSummary(input.result);
  const subjectSummary = buildSubjectSummary(input.result);
  const fingerprintSummary = buildFingerprintSummary(input.result);
  const prefilterSummary = buildPrefilterSummary(input.result);
  const edgeSummary = buildEdgeSummary(input.result);
  const pairRouteabilitySummary = buildPairRouteabilitySummary(input.result);
  const graphSummary = buildGraphSummary(input.result);
  const deltaVsCrypto = buildDeltaVsCrypto(input.cryptoGraph, input.cryptoRouteability, graphSummary, pairRouteabilitySummary);
  const decision = buildDecision(deltaVsCrypto, pairRouteabilitySummary, prefilterSummary, input.result);
  const sourceHygiene = buildSourceHygieneSummary(input.result);

  return {
    taxonomySummary,
    competitionSummary,
    subjectSummary,
    fingerprintSummary,
    prefilterSummary,
    edgeSummary,
    pairRouteabilitySummary,
    graphSummary,
    deltaVsCrypto,
    decision,
    sourceHygiene,
    operatorSummary: buildSportsFamilyOperatorSummary({
      decision,
      routeability: pairRouteabilitySummary
    })
  };
};

export const buildSportsFamilyPassArtifacts = async (input: {
  pool: Pool;
  cryptoGraph: CryptoMultiAssetGraphSummary;
  cryptoRouteability: CryptoMultiAssetPairRouteabilitySummary;
}): Promise<SportsFamilyPassArtifacts> => {
  const pipeline = new SportsMatchingPipeline(new PairEdgeRepository(input.pool));
  const result = await pipeline.run();
  return buildSportsFamilyPassArtifactsFromResult({
    result,
    cryptoGraph: input.cryptoGraph,
    cryptoRouteability: input.cryptoRouteability
  });
};
