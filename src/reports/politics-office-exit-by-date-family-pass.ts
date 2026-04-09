import type { Pool } from "pg";

import { extractPoliticsInventoryRow } from "../matching/politics/politics-inventory-extractor.js";
import {
  buildPoliticsOfficeExitByDateFamilyArtifacts,
  type PoliticsOfficeExitByDateFoundationArtifacts
} from "../matching/politics/politics-office-exit-by-date-family-pass.js";
import { readArtifact, writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import { freshPoliticsRowToMatchingMarketRecord } from "./politics-opinion-limitless-live-census.js";
import {
  listRefreshedPoliticsMarkets,
  parseLimitlessOfficeExitDirectPage,
  parseOpinionOfficeExitDirectPage,
  parsePolymarketOfficeExitDirectPage,
  parsePredictOfficeExitDirectPage,
  runPoliticsCurrentStateRefresh,
  type PoliticsCurrentStateRefreshRunResult
} from "./politics-current-state-refresh.js";
import { loadMyriadCurrentPoliticsRows } from "./politics-manual-family-pass.js";

const ARTIFACT_DIR = "artifacts/politics/office-exit-by-date-family-pass";
const TARGETED_OFFICE_EXIT_URLS = [
  { venue: "OPINION", url: "https://app.opinion.trade/market/trump-out-as-president-before-2027" },
  { venue: "OPINION", url: "https://app.opinion.trade/market/netanyahu-out-by" },
  { venue: "OPINION", url: "https://app.opinion.trade/market/starmer-out-by" },
  { venue: "POLYMARKET", url: "https://polymarket.com/event/trump-out-as-president-before-2027" },
  { venue: "POLYMARKET", url: "https://polymarket.com/event/netanyahu-out-before-2027" },
  { venue: "POLYMARKET", url: "https://polymarket.com/event/starmer-out-in-2025" },
  { venue: "PREDICT", url: "https://predict.fun/market/trump-out-as-president-before-2027" },
  { venue: "PREDICT", url: "https://predict.fun/market/netanyahu-out-before-2027" },
  { venue: "PREDICT", url: "https://predict.fun/market/starmer-out-in-2026-1" },
  { venue: "LIMITLESS", url: "https://limitless.exchange/markets/trump-out-as-president-before-2027-1768933068297?rv=7Q4JYY4UXP" },
  { venue: "LIMITLESS", url: "https://limitless.exchange/markets/netanyahu-out-by-end-of-2026-1768997302182?rv=7Q4JYY4UXP" }
] as const;

export interface PoliticsOfficeExitByDateFamilyPassRunResult {
  refresh: PoliticsCurrentStateRefreshRunResult;
  fetchSummary: Record<string, unknown>;
  admissionSummary: Record<string, unknown>;
  normalizedTopics: readonly unknown[];
  comparabilitySummary: readonly unknown[];
  basisFragmentationSummary: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

const fetchTargetedOfficeExitRows = async () => {
  const rows = [];

  for (const target of TARGETED_OFFICE_EXIT_URLS) {
    try {
      const requestInit =
        target.venue === "PREDICT"
          ? {
              signal: AbortSignal.timeout(10_000),
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
              }
            }
          : { signal: AbortSignal.timeout(10_000) };
      const response = await fetch(target.url, requestInit);
      if (!response.ok) {
        continue;
      }
      const html = await response.text();
      const parsed =
        target.venue === "OPINION" ? parseOpinionOfficeExitDirectPage({ url: target.url, html })
        : target.venue === "POLYMARKET" ? parsePolymarketOfficeExitDirectPage({ url: target.url, html })
        : target.venue === "LIMITLESS" ? parseLimitlessOfficeExitDirectPage({ url: target.url, html })
        : parsePredictOfficeExitDirectPage({ url: target.url, html });
      if (parsed) {
        rows.push(parsed);
      }
    } catch {
      continue;
    }
  }

  return rows;
};

const toJsonCounts = (value: unknown): Record<string, number> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, number> : {};

const buildFetchSummary = (input: {
  refresh: PoliticsCurrentStateRefreshRunResult;
  artifacts: PoliticsOfficeExitByDateFoundationArtifacts;
  myriadStatus: string;
  priorSummary: Record<string, unknown> | null;
}) => {
  const priorAdmittedByVenue = toJsonCounts(input.priorSummary?.["rowsAdmittedByVenue"]);
  const currentAdmittedByVenue = input.artifacts.fetchSummaryInput.rowsAdmittedByVenue;
  const priorTopics = toJsonCounts(input.priorSummary?.["admittedTopicCandidates"]);
  const currentTopics = input.artifacts.admissionSummary.rowsAdmittedByTopicCandidate;

  return {
    observedAt: new Date().toISOString(),
    rowsFetchedByVenue: input.artifacts.fetchSummaryInput.rowsFetchedByVenue,
    rowsAdmittedByVenue: currentAdmittedByVenue,
    fetchStatusByVenue: {
      ...(input.refresh.fetchStatus as Record<string, unknown>),
      MYRIAD: {
        fetchStatus: input.myriadStatus
      }
    },
    familySupplyChangedMaterially:
      JSON.stringify(priorAdmittedByVenue) !== JSON.stringify(currentAdmittedByVenue)
      || JSON.stringify(priorTopics) !== JSON.stringify(currentTopics),
    admittedTopicCandidates: currentTopics
  };
};

const buildOperatorSummary = (input: {
  fetchSummary: Record<string, unknown>;
  comparabilitySummary: PoliticsOfficeExitByDateFoundationArtifacts["comparabilitySummary"];
  finalDecision: PoliticsOfficeExitByDateFoundationArtifacts["finalDecision"];
}) => {
  const strongestTopics = input.comparabilitySummary
    .filter((summary) => summary.matcherCandidate)
    .map((summary) => `${summary.canonicalTopicKey}(${summary.fragmentationLabel})`)
    .join(", ") || "none";

  const fragmentedTopics = input.comparabilitySummary
    .filter((summary) => !summary.matcherCandidate)
    .map((summary) => `${summary.canonicalTopicKey}:${summary.fragmentationLabel}`)
    .join(", ") || "none";

  return [
    "# Politics Office Exit By Date Family Pass",
    "",
    `- family supply by venue: ${JSON.stringify(input.fetchSummary["rowsAdmittedByVenue"] ?? {})}`,
    `- strongest candidate topics: ${strongestTopics}`,
    `- fragmented topics: ${fragmentedTopics}`,
    `- best next matcher candidate: ${input.finalDecision.bestCandidateTopicKey ?? "none"}`,
    `- matcher follow-up justified: ${input.finalDecision.matcherFollowUpJustified ? "yes" : "no"}`,
    `- single best next action: ${input.finalDecision.singleBestNextAction}`
  ].join("\n");
};

export const runPoliticsOfficeExitByDateFamilyPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsOfficeExitByDateFamilyPassRunResult> => {
  const priorFetchSummary = (() => {
    try {
      return readArtifact<Record<string, unknown>>(input.repoRoot, `${ARTIFACT_DIR}/politics-office-exit-by-date-fetch-summary.json`);
    } catch {
      return null;
    }
  })();

  const refresh = await runPoliticsCurrentStateRefresh(input);
  const refreshedRows = await listRefreshedPoliticsMarkets(input.pool);
  const targetedTruthRows = await fetchTargetedOfficeExitRows();
  const freshRefreshRows = refresh.admittedRows.map((row) =>
    extractPoliticsInventoryRow(
      freshPoliticsRowToMatchingMarketRecord(row, "politics-office-exit-by-date-family-pass-refresh-v1")
    )
  );
  const targetedExtractedRows = targetedTruthRows.map((row) =>
    extractPoliticsInventoryRow(
      freshPoliticsRowToMatchingMarketRecord(row, "politics-office-exit-by-date-family-pass-targeted-v1")
    )
  );
  const mergedRefreshedRows = new Map<string, (typeof refreshedRows)[number]>();
  for (const row of refreshedRows) {
    mergedRefreshedRows.set(`${row.venue}:${row.venueMarketId}`, row);
  }
  for (const row of freshRefreshRows) {
    mergedRefreshedRows.set(`${row.venue}:${row.venueMarketId}`, row);
  }
  for (const row of targetedExtractedRows) {
    mergedRefreshedRows.set(`${row.venue}:${row.venueMarketId}`, row);
  }

  let myriadRows: readonly (typeof refreshedRows)[number][] = [];
  let myriadStatus = "MYRIAD_NOT_YET_WIRED";
  try {
    myriadRows = await loadMyriadCurrentPoliticsRows();
    myriadStatus = myriadRows.length > 0 ? "MYRIAD_WIRED_SUCCESS" : "MYRIAD_WIRED_EMPTY";
  } catch (error) {
    myriadStatus = `MYRIAD_WIRED_UNAVAILABLE:${error instanceof Error ? error.message : String(error)}`;
  }

  const artifacts = buildPoliticsOfficeExitByDateFamilyArtifacts([...mergedRefreshedRows.values(), ...myriadRows]);
  const fetchSummary = buildFetchSummary({
    refresh,
    artifacts,
    myriadStatus,
    priorSummary: priorFetchSummary
  });

  const admissionSummary = {
    observedAt: new Date().toISOString(),
    totalAdmittedOfficeExitRows: artifacts.admissionSummary.totalAdmittedOfficeExitRows,
    rowsRejectedByReason: artifacts.admissionSummary.rowsRejectedByReason,
    rowsAdmittedByTopicCandidate: artifacts.admissionSummary.rowsAdmittedByTopicCandidate,
    venueBreakdown: artifacts.admissionSummary.venueBreakdown
  };

  const basisFragmentationSummary = {
    observedAt: new Date().toISOString(),
    blockerCounts: artifacts.basisFragmentationSummary.blockerCounts,
    topicBlockers: artifacts.basisFragmentationSummary.topicBlockers,
    unresolvedRows: artifacts.basisFragmentationSummary.unresolvedRows
  };

  const finalDecision = {
    observedAt: new Date().toISOString(),
    ...artifacts.finalDecision
  };

  const operatorSummary = buildOperatorSummary({
    fetchSummary,
    comparabilitySummary: artifacts.comparabilitySummary,
    finalDecision: artifacts.finalDecision
  });

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-exit-by-date-fetch-summary.json`, fetchSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-exit-by-date-admission-summary.json`, admissionSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-exit-by-date-normalized-topics.json`, artifacts.normalizedTopicRows);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-exit-by-date-comparability-summary.json`, artifacts.comparabilitySummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-exit-by-date-basis-fragmentation-summary.json`, basisFragmentationSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-exit-by-date-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-exit-by-date-operator-summary.md`, `${operatorSummary}\n`);

  return {
    refresh,
    fetchSummary,
    admissionSummary,
    normalizedTopics: artifacts.normalizedTopicRows,
    comparabilitySummary: artifacts.comparabilitySummary,
    basisFragmentationSummary,
    finalDecision,
    operatorSummary
  };
};
