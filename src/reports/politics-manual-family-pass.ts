import { buildStableUuid } from "../canonical/canonicalization-types.js";
import type { Pool } from "pg";

import { buildPoliticsManualFamilyPassArtifacts, type PoliticsManualInScopeFamily } from "../matching/politics/politics-manual-family-pass.js";
import { extractPoliticsInventoryRow } from "../matching/politics/politics-inventory-extractor.js";
import type { MatchingMarketRecord } from "../matching/matching-types.js";
import { writeArtifact, writeMarkdownArtifact, readArtifact } from "../operations/semantic-expansion/shared.js";
import { listRefreshedPoliticsMarkets, runPoliticsCurrentStateRefresh, type PoliticsCurrentStateRefreshRunResult } from "./politics-current-state-refresh.js";
import { MyriadClient } from "../integrations/myriad/myriad-client.js";
import { classifyMyriadPreviewCategory } from "../integrations/myriad/myriad-topic-normalizer.js";
import type { MyriadMarketSummary } from "../integrations/myriad/myriad-schemas.js";

const ARTIFACT_DIR = "artifacts/politics/manual-family-pass";

const FAMILY_ARTIFACT_PATHS: Record<PoliticsManualInScopeFamily, string> = {
  NOMINEE_WINNER: `${ARTIFACT_DIR}/politics-nominee-family-summary.json`,
  OFFICE_EXIT_BY_DATE: `${ARTIFACT_DIR}/politics-office-exit-by-date-summary.json`,
  OFFICE_WINNER: `${ARTIFACT_DIR}/politics-office-winner-summary.json`,
  GEOPOLITICAL_EVENT_BY_DATE: `${ARTIFACT_DIR}/politics-geopolitical-event-by-date-summary.json`,
  GEOPOLITICAL_EVENT: `${ARTIFACT_DIR}/politics-geopolitical-event-summary.json`
};

const toVenueCounts = <T extends { venue: string }>(rows: readonly T[]): Record<string, number> =>
  rows.reduce<Record<string, number>>((accumulator, row) => {
    accumulator[row.venue] = (accumulator[row.venue] ?? 0) + 1;
    return accumulator;
  }, {});

export interface PoliticsManualFamilyPassRunResult {
  refresh: PoliticsCurrentStateRefreshRunResult;
  fetchSummary: Record<string, unknown>;
  admissionSummary: Record<string, unknown>;
  classificationSummary: Record<string, unknown>;
  normalizationSummary: Record<string, unknown>;
  comparabilitySummary: Record<string, unknown>;
  basisFragmentationSummary: Record<string, unknown>;
  decisionSummary: Record<string, unknown>;
  deltaVsPostRefresh: Record<string, unknown>;
  operatorSummary: string;
}

const MYRIAD_METADATA_VERSION = "myriad-current-politics-manual-family-v1";

export const loadMyriadCurrentPoliticsRows = async (): Promise<readonly ReturnType<typeof extractPoliticsInventoryRow>[]> => {
  const baseUrl = process.env.MYRIAD_BASE_URL ?? "https://api-v2.myriadprotocol.com/";
  const client = new MyriadClient({
    baseUrl,
    ...(process.env.MYRIAD_API_KEY ? { apiKey: process.env.MYRIAD_API_KEY } : {})
  });

  const fetched: MyriadMarketSummary[] = [];
  for (let page = 1; page <= 3; page += 1) {
    const response = await client.listMarkets({
      state: "open",
      topics: "Politics",
      sort: "volume",
      order: "desc",
      limit: 100,
      page
    });
    const politicsRows = response.data.filter((market) => classifyMyriadPreviewCategory(market) === "POLITICS");
    fetched.push(...politicsRows);
    if (response.pagination.hasNext !== true || response.data.length < 100) {
      break;
    }
  }

  return fetched.map((market): MatchingMarketRecord => ({
    interpretedContractId: buildStableUuid(`myriad-manual-family:${market.networkId}:${market.id}`),
    venueMarketProfileId: `myriad:${market.networkId}:${market.id}`,
    canonicalEventId: buildStableUuid(`myriad-question:${market.slug}`),
    venue: "MYRIAD",
    venueMarketId: `${market.networkId}:${market.id}`,
    title: market.title,
    description: market.description ?? null,
    rulesText: market.description ?? null,
    category: "POLITICS",
    marketClass: market.outcomes.length === 2 ? "BINARY" : "MULTI_OUTCOME",
    sourceMetadataVersion: MYRIAD_METADATA_VERSION,
    confidenceScore: "0.8",
    propositionSemantics: {},
    outcomeSemantics: {},
    timingSemantics: {},
    resolutionSemantics: {},
    settlementSemantics: {},
    ambiguityFlags: {},
    rawLineageReferences: {
      slug: market.slug,
      state: market.state,
      sourceUrl: `https://myriad.markets/markets/${market.slug}`
    },
    publishedAt: market.publishedAt ? new Date(market.publishedAt) : null,
    expiresAt: market.expiresAt ? new Date(market.expiresAt) : null,
    resolvesAt: market.resolvesAt ? new Date(market.resolvesAt) : null,
    outcomes: market.outcomes.map((outcome) => ({
      id: String(outcome.id),
      label: outcome.title
    })),
    outcomeSchema: {
      marketShape: market.outcomes.length === 2 ? "binary" : "categorical",
      outcomeLabels: market.outcomes.map((outcome) => outcome.title)
    },
    historicalRowCount: 0,
    inventoryTemporalBasis: "LIVE_CURRENT_STATE"
  })).map((market) => extractPoliticsInventoryRow(market));
};

export const runPoliticsManualFamilyPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsManualFamilyPassRunResult> => {
  const priorPostRefreshDecision = (() => {
    try {
      return readArtifact<Record<string, unknown>>(input.repoRoot, `${ARTIFACT_DIR}/politics-manual-family-decision-summary.json`);
    } catch {
      return null;
    }
  })();

  const refresh = await runPoliticsCurrentStateRefresh(input);
  const refreshedRows = await listRefreshedPoliticsMarkets(input.pool);
  let myriadRows: readonly ReturnType<typeof extractPoliticsInventoryRow>[] = [];
  let myriadStatus = "MYRIAD_NOT_YET_WIRED";
  try {
    myriadRows = await loadMyriadCurrentPoliticsRows();
    myriadStatus = myriadRows.length > 0 ? "MYRIAD_WIRED_SUCCESS" : "MYRIAD_WIRED_EMPTY";
  } catch (error) {
    myriadStatus = `MYRIAD_WIRED_UNAVAILABLE:${error instanceof Error ? error.message : String(error)}`;
  }
  const built = buildPoliticsManualFamilyPassArtifacts([...refreshedRows, ...myriadRows]);

  const fetchSummary = {
    observedAt: new Date().toISOString(),
    freshRowsByVenue: refresh.fetchSummary["rowsByVenue"] ?? {},
    refreshedPoliticsRowsByVenue: toVenueCounts([...refreshedRows, ...myriadRows]),
    fetchStatuses: refresh.fetchStatus,
    myriadStatus,
    myriadRowsFetched: myriadRows.length
  };

  const admissionSummary = {
    observedAt: new Date().toISOString(),
    admittedByFamily: Object.fromEntries(
      Object.entries(built.familySummaries).map(([family, summary]) => [family, summary.totalRows])
    ),
    outOfScopeRows: built.classifiedRows.filter((row) => row.family === "OUT_OF_SCOPE").length,
    unknownRows: built.classifiedRows.filter((row) => row.family === "UNKNOWN_POLITICS_FAMILY" || row.family === "INSUFFICIENT_EVIDENCE").length
  };

  const classificationSummary = {
    observedAt: new Date().toISOString(),
    labels: built.classifiedRows.reduce<Record<string, number>>((accumulator, row) => {
      accumulator[row.family] = (accumulator[row.family] ?? 0) + 1;
      return accumulator;
    }, {}),
    admittedSamples: built.classifiedRows
      .filter((row) => !["OUT_OF_SCOPE", "UNKNOWN_POLITICS_FAMILY", "INSUFFICIENT_EVIDENCE"].includes(row.family))
      .slice(0, 12)
      .map((row) => ({
        venue: row.venue,
        venueMarketId: row.venueMarketId,
        title: row.title,
        family: row.family
      }))
  };

  const normalizationSummary = {
    observedAt: new Date().toISOString(),
    byFamily: built.normalizationSummary,
    normalizedRowsByFamily: Object.fromEntries(
      Object.entries(built.familySummaries).map(([family, summary]) => [family, summary.normalizedRows.length])
    )
  };

  const comparabilitySummary = {
    observedAt: new Date().toISOString(),
    byFamily: Object.fromEntries(
      Object.entries(built.familySummaries).map(([family, summary]) => [family, {
        comparableClusters: summary.comparableClusters.length,
        exactClusters: summary.comparableClusters.filter((cluster) => cluster.comparability === "EXACT_COMPARABLE").length,
        narrowClusters: summary.comparableClusters.filter((cluster) => cluster.comparability === "NARROW_COMPARABLE").length,
        comparabilityBreakdown: summary.comparabilityBreakdown
      }])
    )
  };

  const basisFragmentationSummary = {
    observedAt: new Date().toISOString(),
    dominantByFamily: Object.fromEntries(
      Object.entries(built.familySummaries).map(([family, summary]) => [family, summary.dominantBlocker])
    ),
    fragmentedFamilies: Object.entries(built.familySummaries)
      .filter(([, summary]) => !summary.matcherReady)
      .map(([family, summary]) => ({ family, reason: summary.dominantBlocker ?? summary.decision }))
  };

  const readyFamilies = Object.values(built.familySummaries).filter((summary) => summary.matcherReady);
  const decisionSummary = {
    observedAt: new Date().toISOString(),
    familyDecisions: Object.fromEntries(
      Object.entries(built.familySummaries).map(([family, summary]) => [family, {
        decision: summary.decision,
        matcherReady: summary.matcherReady,
        venues: summary.venues,
        dominantBlocker: summary.dominantBlocker
      }])
    ),
    overallDecisionLabels: [
      "POLITICS_MANUAL_EVIDENCE_STRUCTURED",
      "POLITICS_FAMILY_NORMALIZATION_SUCCEEDED",
      readyFamilies.length === 1 && readyFamilies[0]?.family === "NOMINEE_WINNER" ? "POLITICS_ONLY_NOMINEE_READY"
        : readyFamilies.length > 1 ? "POLITICS_MULTIPLE_FAMILIES_NOW_COMPARABLE"
        : "POLITICS_STILL_FRAGMENTED_BUT_FAIRLY_JUDGED",
      readyFamilies.length > 0 ? "POLITICS_NARROW_MATCHER_EVAL_NEXT" : "POLITICS_STILL_FRAGMENTED_BUT_FAIRLY_JUDGED"
    ],
    myriadDecision: myriadStatus.startsWith("MYRIAD_WIRED_") ? myriadStatus : "MYRIAD_EVIDENCE_ONLY",
    bestNextFamily: readyFamilies.find((summary) => summary.family === "NOMINEE_WINNER")?.family
      ?? readyFamilies[0]?.family
      ?? null
  };

  const deltaVsPostRefresh = {
    observedAt: new Date().toISOString(),
    priorNomineeEligibility: refresh.postRefreshFinalDecision["nomineeEligibility"] ?? null,
    currentNomineeDecision: built.familySummaries.NOMINEE_WINNER.decision,
    priorNomineeMatcherFollowUpJustified: refresh.postRefreshFinalDecision["matcherFollowUpJustified"] ?? false,
    currentReadyFamilies: readyFamilies.map((summary) => summary.family),
    previousManualDecision: priorPostRefreshDecision?.["overallDecisionLabels"] ?? []
  };

  const operatorSummary = [
    "# Politics Manual Family Pass",
    "",
    `- refreshed rows by venue: ${JSON.stringify(fetchSummary.refreshedPoliticsRowsByVenue)}`,
    `- admitted families: ${JSON.stringify(admissionSummary.admittedByFamily)}`,
    `- ready families: ${readyFamilies.map((summary) => summary.family).join(", ") || "none"}`,
    `- fragmented families: ${basisFragmentationSummary.fragmentedFamilies.map((entry) => `${entry.family}:${entry.reason}`).join(", ") || "none"}`,
    `- myriad: ${myriadStatus}`,
    `- best next family: ${decisionSummary.bestNextFamily ?? "none"}`
  ].join("\n");

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-manual-family-fetch-summary.json`, fetchSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-manual-family-admission-summary.json`, admissionSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-manual-family-classification-summary.json`, classificationSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-manual-family-normalization-summary.json`, normalizationSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-manual-family-comparability-summary.json`, comparabilitySummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-manual-family-basis-fragmentation-summary.json`, basisFragmentationSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-manual-family-decision-summary.json`, decisionSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-manual-family-delta-vs-post-refresh.json`, deltaVsPostRefresh);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-manual-family-operator-summary.md`, `${operatorSummary}\n`);

  for (const [family, summary] of Object.entries(built.familySummaries) as [PoliticsManualInScopeFamily, typeof built.familySummaries[PoliticsManualInScopeFamily]][]) {
    writeArtifact(input.repoRoot, FAMILY_ARTIFACT_PATHS[family], {
      observedAt: new Date().toISOString(),
      family,
      totalRows: summary.totalRows,
      venues: summary.venues,
      normalizedRows: summary.normalizedRows,
      comparableClusters: summary.comparableClusters,
      comparabilityBreakdown: summary.comparabilityBreakdown,
      decision: summary.decision,
      matcherReady: summary.matcherReady,
      dominantBlocker: summary.dominantBlocker
    });
  }

  return {
    refresh,
    fetchSummary,
    admissionSummary,
    classificationSummary,
    normalizationSummary,
    comparabilitySummary,
    basisFragmentationSummary,
    decisionSummary,
    deltaVsPostRefresh,
    operatorSummary
  };
};
