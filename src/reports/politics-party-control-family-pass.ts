import type { Pool } from "pg";

import { extractPoliticsInventoryRow } from "../matching/politics/politics-inventory-extractor.js";
import {
  buildPoliticsPartyControlFamilyArtifacts,
  type PoliticsPartyControlFoundationArtifacts
} from "../matching/politics/politics-party-control-family-pass.js";
import { readArtifact, writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import { freshPoliticsRowToMatchingMarketRecord } from "./politics-opinion-limitless-live-census.js";
import {
  parseOpinionPartyControlDirectPage,
  parsePolymarketPartyControlDirectPage,
  parsePredictPartyControlDirectPage,
  listRefreshedPoliticsMarkets,
  runPoliticsCurrentStateRefresh,
  type PoliticsCurrentStateRefreshRunResult
} from "./politics-current-state-refresh.js";

const ARTIFACT_DIR = "artifacts/politics/party-control-family-pass";
const TARGETED_PARTY_CONTROL_URLS = [
  {
    venue: "OPINION",
    url: "https://app.opinion.trade/market/balance-of-power-2026-midterms"
  },
  {
    venue: "POLYMARKET",
    url: "https://polymarket.com/event/balance-of-power-2026-midterms"
  },
  {
    venue: "PREDICT",
    url: "https://predict.fun/market/balance-of-power-2026-midterm-elections"
  }
] as const;

export interface PoliticsPartyControlFamilyPassRunResult {
  refresh: PoliticsCurrentStateRefreshRunResult;
  fetchSummary: Record<string, unknown>;
  admissionSummary: Record<string, unknown>;
  normalizedTopics: readonly unknown[];
  comparabilitySummary: readonly unknown[];
  basisFragmentationSummary: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

const fetchTargetedPartyControlRows = async () => {
  const rows = [];

  for (const target of TARGETED_PARTY_CONTROL_URLS) {
    try {
      const requestInit =
        target.venue === "PREDICT"
          ? {
              signal: AbortSignal.timeout(10_000),
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
              }
            }
          : {
              signal: AbortSignal.timeout(10_000)
            };
      const response = await fetch(target.url, {
        ...requestInit
      });
      if (!response.ok) {
        continue;
      }
      const html = await response.text();
      const parsed =
        target.venue === "OPINION" ? parseOpinionPartyControlDirectPage({ url: target.url, html })
        : target.venue === "POLYMARKET" ? parsePolymarketPartyControlDirectPage({ url: target.url, html })
        : parsePredictPartyControlDirectPage({ url: target.url, html });
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
  artifacts: PoliticsPartyControlFoundationArtifacts;
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
    fetchStatusByVenue: input.refresh.fetchStatus,
    familySupplyChangedMaterially:
      JSON.stringify(priorAdmittedByVenue) !== JSON.stringify(currentAdmittedByVenue)
      || JSON.stringify(priorTopics) !== JSON.stringify(currentTopics),
    admittedTopicCandidates: currentTopics
  };
};

const buildOperatorSummary = (input: {
  fetchSummary: Record<string, unknown>;
  comparabilitySummary: PoliticsPartyControlFoundationArtifacts["comparabilitySummary"];
  finalDecision: PoliticsPartyControlFoundationArtifacts["finalDecision"];
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
    "# Politics Party Control Family Pass",
    "",
    `- family supply by venue: ${JSON.stringify(input.fetchSummary["rowsAdmittedByVenue"] ?? {})}`,
    `- strongest candidate topics: ${strongestTopics}`,
    `- fragmented topics: ${fragmentedTopics}`,
    `- best next matcher candidate: ${input.finalDecision.bestCandidateTopicKey ?? "none"}`,
    `- matcher follow-up justified: ${input.finalDecision.matcherFollowUpJustified ? "yes" : "no"}`,
    `- single best next action: ${input.finalDecision.singleBestNextAction}`
  ].join("\n");
};

export const runPoliticsPartyControlFamilyPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsPartyControlFamilyPassRunResult> => {
  const priorFetchSummary = (() => {
    try {
      return readArtifact<Record<string, unknown>>(input.repoRoot, `${ARTIFACT_DIR}/politics-party-control-fetch-summary.json`);
    } catch {
      return null;
    }
  })();

  const refresh = await runPoliticsCurrentStateRefresh(input);
  const refreshedRows = await listRefreshedPoliticsMarkets(input.pool);
  const targetedTruthRows = await fetchTargetedPartyControlRows();
  const freshRefreshRows = refresh.admittedRows.map((row) =>
    extractPoliticsInventoryRow(
      freshPoliticsRowToMatchingMarketRecord(row, "politics-party-control-family-pass-refresh-v1")
    )
  );
  const targetedExtractedRows = targetedTruthRows.map((row) =>
    extractPoliticsInventoryRow(
      freshPoliticsRowToMatchingMarketRecord(row, "politics-party-control-family-pass-targeted-v1")
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

  const artifacts = buildPoliticsPartyControlFamilyArtifacts([...mergedRefreshedRows.values()]);
  const fetchSummary = buildFetchSummary({
    refresh,
    artifacts,
    priorSummary: priorFetchSummary
  });

  const admissionSummary = {
    observedAt: new Date().toISOString(),
    totalAdmittedPartyControlRows: artifacts.admissionSummary.totalAdmittedPartyControlRows,
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

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-party-control-fetch-summary.json`, fetchSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-party-control-admission-summary.json`, admissionSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-party-control-normalized-topics.json`, artifacts.normalizedTopicRows);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-party-control-comparability-summary.json`, artifacts.comparabilitySummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-party-control-basis-fragmentation-summary.json`, basisFragmentationSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-party-control-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-party-control-operator-summary.md`, `${operatorSummary}\n`);

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
