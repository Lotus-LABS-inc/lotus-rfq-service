import type { Pool } from "pg";

import {
  admitNominee2028SharedCoreRow,
  buildNominee2028FetchSummary,
  buildNominee2028RuleCompatibility,
  buildNominee2028SharedCoreFinalDecision,
  buildNominee2028SharedOutcomeCore,
  buildNominee2028TopicDecision,
  extractNominee2028SharedCoreOutcomes,
  nominee2028SharedCoreTopicKeys,
  normalizeNominee2028SharedCoreMarket,
  type PoliticsNomineeSharedCoreRejectedMarket
} from "../matching/politics/politics-nominee-2028-shared-core.js";
import type {
  PoliticsNomineeSharedCoreMarketRow,
  PoliticsNomineeSharedCoreOutcomeRow,
  PoliticsNomineeTopicKey
} from "../matching/politics/politics-types.js";
import { writeArtifact, writeMarkdownArtifact, readArtifact } from "../operations/semantic-expansion/shared.js";
import {
  listRefreshedPoliticsMarkets,
  runPoliticsCurrentStateRefresh,
  type PoliticsCurrentStateRefreshRunResult
} from "./politics-current-state-refresh.js";
import { mergeRefreshedRowsWithOpinionLimitlessLiveCensus, runPoliticsOpinionLimitlessLiveCensusPass } from "./politics-opinion-limitless-live-census.js";

const ARTIFACT_DIR = "artifacts/politics/nominee-2028-shared-core";
const IN_SCOPE_VENUES = ["POLYMARKET", "OPINION", "LIMITLESS"] as const;

const toCounts = <T extends { venue: string }>(rows: readonly T[]): Record<string, number> =>
  rows.reduce<Record<string, number>>((accumulator, row) => {
    accumulator[row.venue] = (accumulator[row.venue] ?? 0) + 1;
    return accumulator;
  }, {});

const groupByTopic = <T extends { topicKey: PoliticsNomineeTopicKey }>(rows: readonly T[]): Map<PoliticsNomineeTopicKey, readonly T[]> => {
  const grouped = new Map<PoliticsNomineeTopicKey, T[]>();
  for (const topicKey of nominee2028SharedCoreTopicKeys) {
    grouped.set(topicKey, []);
  }
  for (const row of rows) {
    grouped.get(row.topicKey)?.push(row);
  }
  return grouped;
};

export interface PoliticsNominee2028SharedCoreRunResult {
  refresh: PoliticsCurrentStateRefreshRunResult;
  fetchSummary: Record<string, unknown>;
  topicAdmissionSummary: Record<string, unknown>;
  ruleCompatibilitySummary: Record<string, unknown>;
  republicanOutcomeCore: unknown;
  democraticOutcomeCore: unknown;
  routeabilitySummary: Record<string, unknown>;
  tailExclusionSummary: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export const runPoliticsNominee2028SharedCorePass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsNominee2028SharedCoreRunResult> => {
  const priorClusterDecision = (() => {
    try {
      return readArtifact<Record<string, unknown>>(input.repoRoot, "artifacts/politics/nominee-2028-cluster/politics-nominee-2028-final-decision.json");
    } catch {
      return null;
    }
  })();

  const refresh = await runPoliticsCurrentStateRefresh(input);
  const liveCensus = await runPoliticsOpinionLimitlessLiveCensusPass({
    repoRoot: input.repoRoot
  });
  const refreshedRows = mergeRefreshedRowsWithOpinionLimitlessLiveCensus(
    (await listRefreshedPoliticsMarkets(input.pool))
      .filter((row) => IN_SCOPE_VENUES.includes(row.venue as (typeof IN_SCOPE_VENUES)[number])),
    liveCensus.extractedRows
  );

  const candidateRows = refreshedRows.filter((row) => admitNominee2028SharedCoreRow(row).admitted);
  const fetchSummary = buildNominee2028FetchSummary({
    candidateRowsByVenue: toCounts(candidateRows),
    fetchStatuses: {
      ...(refresh.fetchStatus as Record<string, { fetchStatus?: string }>),
      OPINION: {
        fetchStatus: liveCensus.venueStatuses.OPINION.fetchState,
        discoveryPath: liveCensus.venueStatuses.OPINION.discoveryPath,
        broadDiscoveryRowCount: liveCensus.venueStatuses.OPINION.broadDiscoveryRowCount,
        targetedDiscoveryRowCount: liveCensus.venueStatuses.OPINION.targetedDiscoveryRowCount,
        targetedDiscoveryPathUsed: liveCensus.venueStatuses.OPINION.targetedDiscoveryPathUsed,
        targetedQueryLabels: liveCensus.venueStatuses.OPINION.targetedQueryLabels
      },
      LIMITLESS: {
        fetchStatus: liveCensus.venueStatuses.LIMITLESS.fetchState,
        discoveryPath: liveCensus.venueStatuses.LIMITLESS.discoveryPath,
        broadDiscoveryRowCount: liveCensus.venueStatuses.LIMITLESS.broadDiscoveryRowCount,
        targetedDiscoveryRowCount: liveCensus.venueStatuses.LIMITLESS.targetedDiscoveryRowCount,
        targetedDiscoveryPathUsed: liveCensus.venueStatuses.LIMITLESS.targetedDiscoveryPathUsed,
        targetedQueryLabels: liveCensus.venueStatuses.LIMITLESS.targetedQueryLabels
      }
    }
  });

  const rejectedMarkets: PoliticsNomineeSharedCoreRejectedMarket[] = [];
  const normalizedMarketsBase: PoliticsNomineeSharedCoreMarketRow[] = [];
  const normalizedOutcomesBase: PoliticsNomineeSharedCoreOutcomeRow[] = [];

  for (const row of refreshedRows) {
    const admission = admitNominee2028SharedCoreRow(row);
    if (!admission.admitted) {
      rejectedMarkets.push({
        venue: row.venue,
        venueMarketId: row.venueMarketId,
        title: row.title,
        rejectionReason: admission.reason ?? "OUT_OF_SCOPE_FOR_NOMINEE_2028_SHARED_CORE_PASS"
      });
      continue;
    }
    const market = normalizeNominee2028SharedCoreMarket(row);
    if (!market) {
      rejectedMarkets.push({
        venue: row.venue,
        venueMarketId: row.venueMarketId,
        title: row.title,
        rejectionReason: "FAILED_TO_NORMALIZE_MARKET"
      });
      continue;
    }
    normalizedMarketsBase.push(market);
    normalizedOutcomesBase.push(...extractNominee2028SharedCoreOutcomes(row, market));
  }

  const compatibility = buildNominee2028RuleCompatibility(normalizedMarketsBase);
  const normalizedMarkets = compatibility.markets;

  const marketById = new Map(
    normalizedMarkets.map((market) => [`${market.venue}|${market.venueMarketId}`, market] as const)
  );
  const normalizedOutcomes = normalizedOutcomesBase.map((outcome) => {
    const market = marketById.get(`${outcome.venue}|${outcome.venueMarketId}`);
    if (!market) {
      return {
        ...outcome,
        routeabilityClass: "EXCLUDED_UNKNOWN" as const
      };
    }
    return outcome;
  });

  const topicMarkets = groupByTopic(normalizedMarkets);
  const topicOutcomes = groupByTopic(normalizedOutcomes);

  const republicanOutcomeCore = buildNominee2028SharedOutcomeCore({
    topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
    markets: topicMarkets.get("NOMINEE|US_PRESIDENT|2028|REPUBLICAN") ?? [],
    outcomes: topicOutcomes.get("NOMINEE|US_PRESIDENT|2028|REPUBLICAN") ?? []
  });
  const democraticOutcomeCore = buildNominee2028SharedOutcomeCore({
    topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
    markets: topicMarkets.get("NOMINEE|US_PRESIDENT|2028|DEMOCRATIC") ?? [],
    outcomes: topicOutcomes.get("NOMINEE|US_PRESIDENT|2028|DEMOCRATIC") ?? []
  });

  const republicanDecision = buildNominee2028TopicDecision({
    topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
    markets: topicMarkets.get("NOMINEE|US_PRESIDENT|2028|REPUBLICAN") ?? [],
    outcomeCore: republicanOutcomeCore
  });
  const democraticDecision = buildNominee2028TopicDecision({
    topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
    markets: topicMarkets.get("NOMINEE|US_PRESIDENT|2028|DEMOCRATIC") ?? [],
    outcomeCore: democraticOutcomeCore
  });
  const overallDecision = buildNominee2028SharedCoreFinalDecision({
    republican: republicanDecision,
    democratic: democraticDecision
  });

  const topicAdmissionSummary = {
    observedAt: new Date().toISOString(),
    admittedRowsByVenue: toCounts(normalizedMarkets),
    republicanTopicRows: (topicMarkets.get("NOMINEE|US_PRESIDENT|2028|REPUBLICAN") ?? []).length,
    democraticTopicRows: (topicMarkets.get("NOMINEE|US_PRESIDENT|2028|DEMOCRATIC") ?? []).length,
    rejectedMarketCount: rejectedMarkets.length,
    rejectedReasons: rejectedMarkets.reduce<Record<string, number>>((accumulator, row) => {
      accumulator[row.rejectionReason] = (accumulator[row.rejectionReason] ?? 0) + 1;
      return accumulator;
    }, {})
  };

  const ruleCompatibilitySummary = {
    observedAt: new Date().toISOString(),
    byTopicAndVenue: compatibility.profiles.map((profile) => {
      const matchingMarket = normalizedMarkets.find((market) => market.topicKey === profile.topicKey && market.venue === profile.venue);
      return {
        topicKey: profile.topicKey,
        venue: profile.venue,
        derivedMeaning: profile.derivedMeaning,
        ruleCompatibilityClass: matchingMarket?.ruleCompatibilityClass ?? "UNKNOWN_RULE_MEANING",
        sourceType: profile.sourceType,
        sampleTitles: profile.titles
      };
    })
  };

  const routeabilitySummary = {
    observedAt: new Date().toISOString(),
    republican: {
      triRoutingSupported: republicanDecision.topicDecision === "TOPIC_SHARED_CORE_TRI_READY",
      pairRoutingSupported:
        republicanDecision.topicDecision === "TOPIC_SHARED_CORE_TRI_READY"
        || republicanDecision.topicDecision === "TOPIC_SHARED_CORE_PAIR_ONLY"
        || republicanDecision.topicDecision === "TOPIC_SHARED_CORE_ROUTEABLE_WITH_REVIEW",
      routeableOutcomes: [...republicanOutcomeCore.triSharedNamedOutcomes, ...republicanOutcomeCore.pairSharedNamedOutcomes].map((outcome) => ({
        candidateIdentityKey: outcome.candidateIdentityKey,
        normalizedCandidateName: outcome.normalizedCandidateName,
        sharedAcrossWhichVenues: outcome.sharedAcrossWhichVenues,
        routeabilityClass: outcome.routeabilityClass
      })),
      routingRequiresRuleReview: republicanDecision.reviewRequiredRouteable
    },
    democratic: {
      triRoutingSupported: democraticDecision.topicDecision === "TOPIC_SHARED_CORE_TRI_READY",
      pairRoutingSupported:
        democraticDecision.topicDecision === "TOPIC_SHARED_CORE_TRI_READY"
        || democraticDecision.topicDecision === "TOPIC_SHARED_CORE_PAIR_ONLY"
        || democraticDecision.topicDecision === "TOPIC_SHARED_CORE_ROUTEABLE_WITH_REVIEW",
      routeableOutcomes: [...democraticOutcomeCore.triSharedNamedOutcomes, ...democraticOutcomeCore.pairSharedNamedOutcomes].map((outcome) => ({
        candidateIdentityKey: outcome.candidateIdentityKey,
        normalizedCandidateName: outcome.normalizedCandidateName,
        sharedAcrossWhichVenues: outcome.sharedAcrossWhichVenues,
        routeabilityClass: outcome.routeabilityClass
      })),
      routingRequiresRuleReview: democraticDecision.reviewRequiredRouteable
    }
  };

  const tailExclusionSummary = {
    observedAt: new Date().toISOString(),
    republican: republicanOutcomeCore.excludedOutcomes.map((outcome) => ({
      venue: outcome.venue,
      venueMarketId: outcome.venueMarketId,
      rawOutcomeLabel: outcome.rawOutcomeLabel,
      routeabilityClass: outcome.routeabilityClass
    })),
    democratic: democraticOutcomeCore.excludedOutcomes.map((outcome) => ({
      venue: outcome.venue,
      venueMarketId: outcome.venueMarketId,
      rawOutcomeLabel: outcome.rawOutcomeLabel,
      routeabilityClass: outcome.routeabilityClass
    }))
  };

  const finalDecision = {
    observedAt: new Date().toISOString(),
    republican: republicanDecision,
    democratic: democraticDecision,
    overallPoliticsNomineeDecision: overallDecision.overallPoliticsNomineeDecision,
    republicanDecision: overallDecision.republicanDecision,
    democraticDecision: overallDecision.democraticDecision,
    sharedCorePolicyImplemented: overallDecision.sharedCorePolicyImplemented,
    othersExcludedPolicyImplemented: overallDecision.othersExcludedPolicyImplemented,
    rulesCompatibilityPolicyImplemented: overallDecision.rulesCompatibilityPolicyImplemented,
    nomineeSharedCoreMatcherEvalJustified: republicanDecision.matcherEvalJustified || democraticDecision.matcherEvalJustified,
    nextBestAction: overallDecision.nextBestAction
  };

  const operatorSummary = [
    "# Politics Nominee 2028 Shared Core",
    "",
    `- fresh candidate markets by venue: ${JSON.stringify(fetchSummary.freshCandidateMarketsByVenue)}`,
    `- republican topic decision: ${republicanDecision.topicDecision}`,
    `- democratic topic decision: ${democraticDecision.topicDecision}`,
    `- nominee shared-core matcher eval justified: ${finalDecision.nomineeSharedCoreMatcherEvalJustified ? "yes" : "no"}`,
    `- next best action: ${overallDecision.nextBestAction}`
  ].join("\n");

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-fetch-summary.json`, fetchSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-topic-admission-summary.json`, topicAdmissionSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-rule-compatibility-summary.json`, ruleCompatibilitySummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-republican-outcome-core.json`, republicanOutcomeCore);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-democratic-outcome-core.json`, democraticOutcomeCore);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-routeability-summary.json`, routeabilitySummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-tail-exclusion-summary.json`, tailExclusionSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-operator-summary.md`, `${operatorSummary}\n`);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-rejected-markets.json`, rejectedMarkets);
  writeArtifact(
    input.repoRoot,
    `${ARTIFACT_DIR}/politics-nominee-2028-rejected-outcomes.json`,
    [...republicanOutcomeCore.excludedOutcomes, ...democraticOutcomeCore.excludedOutcomes]
  );
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-shared-core-delta-vs-prior.json`, {
    observedAt: new Date().toISOString(),
    priorClusterFinalLabel: priorClusterDecision?.["finalLabel"] ?? null,
    priorMatcherEvalJustified: priorClusterDecision?.["nomineeMatcherEvalJustified"] ?? false,
    currentMatcherEvalJustified: finalDecision.nomineeSharedCoreMatcherEvalJustified
  });

  return {
    refresh,
    fetchSummary,
    topicAdmissionSummary,
    ruleCompatibilitySummary,
    republicanOutcomeCore,
    democraticOutcomeCore,
    routeabilitySummary,
    tailExclusionSummary,
    finalDecision,
    operatorSummary
  };
};
