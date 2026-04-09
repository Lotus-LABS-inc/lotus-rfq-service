import type { Pool } from "pg";

import { extractPoliticsInventoryRow } from "../matching/politics/politics-inventory-extractor.js";
import {
  buildOfficeWinnerCanonicalTopicKey,
  buildPoliticsOfficeWinnerFamilyArtifacts,
  type PoliticsOfficeWinnerFoundationArtifacts
} from "../matching/politics/politics-office-winner-family-pass.js";
import {
  classifyPoliticsManualFamily,
  normalizePoliticsManualFamilyRow
} from "../matching/politics/politics-manual-family-pass.js";
import { writeArtifact, writeMarkdownArtifact, readArtifact } from "../operations/semantic-expansion/shared.js";
import { freshPoliticsRowToMatchingMarketRecord } from "./politics-opinion-limitless-live-census.js";
import {
  listRefreshedPoliticsMarkets,
  runPoliticsCurrentStateRefresh,
  type PoliticsCurrentStateRefreshRunResult
} from "./politics-current-state-refresh.js";
import { loadMyriadCurrentPoliticsRows } from "./politics-manual-family-pass.js";

const ARTIFACT_DIR = "artifacts/politics/office-winner-family-pass";

export interface PoliticsOfficeWinnerFamilyPassRunResult {
  refresh: PoliticsCurrentStateRefreshRunResult;
  fetchSummary: Record<string, unknown>;
  admissionSummary: Record<string, unknown>;
  normalizedTopics: readonly unknown[];
  comparabilitySummary: readonly unknown[];
  basisFragmentationSummary: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

const toJsonCounts = (value: unknown): Record<string, number> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, number> : {};

const deriveOfficeWinnerTopicKey = (
  row: ReturnType<typeof extractPoliticsInventoryRow>
): string | null => {
  const classified = classifyPoliticsManualFamily(row);
  if (classified.family !== "OFFICE_WINNER") {
    return null;
  }

  const normalized = normalizePoliticsManualFamilyRow(classified);
  if (!normalized) {
    return null;
  }

  return buildOfficeWinnerCanonicalTopicKey(normalized);
};

export const filterSupplementalMyriadOfficeWinnerRows = (
  freshRows: readonly ReturnType<typeof extractPoliticsInventoryRow>[],
  myriadRows: readonly ReturnType<typeof extractPoliticsInventoryRow>[]
): readonly ReturnType<typeof extractPoliticsInventoryRow>[] => {
  const freshNonMyriadTopicKeys = new Set(
    freshRows
      .filter((row) => row.venue !== "MYRIAD")
      .map((row) => deriveOfficeWinnerTopicKey(row))
      .filter((topicKey): topicKey is string => topicKey !== null)
  );

  return myriadRows.filter((row) => {
    const topicKey = deriveOfficeWinnerTopicKey(row);
    return topicKey === null || !freshNonMyriadTopicKeys.has(topicKey);
  });
};

const buildFetchSummary = (input: {
  refresh: PoliticsCurrentStateRefreshRunResult;
  officeWinner: PoliticsOfficeWinnerFoundationArtifacts;
  myriadStatus: string;
  priorSummary: Record<string, unknown> | null;
}) => {
  const priorAdmittedByVenue = toJsonCounts(input.priorSummary?.["rowsAdmittedByVenue"]);
  const currentAdmittedByVenue = input.officeWinner.fetchSummaryInput.rowsAdmittedByVenue;
  const priorTopics = toJsonCounts(input.priorSummary?.["admittedTopicCandidates"]);
  const currentTopics = input.officeWinner.admissionSummary.rowsAdmittedByTopicCandidate;

  return {
    observedAt: new Date().toISOString(),
    rowsFetchedByVenue: input.officeWinner.fetchSummaryInput.rowsFetchedByVenue,
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
  comparabilitySummary: PoliticsOfficeWinnerFoundationArtifacts["comparabilitySummary"];
  finalDecision: PoliticsOfficeWinnerFoundationArtifacts["finalDecision"];
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
    "# Politics Office Winner Family Pass",
    "",
    `- family supply by venue: ${JSON.stringify(input.fetchSummary["rowsAdmittedByVenue"] ?? {})}`,
    `- strongest candidate topics: ${strongestTopics}`,
    `- fragmented topics: ${fragmentedTopics}`,
    `- best next matcher candidate: ${input.finalDecision.bestCandidateTopicKey ?? "none"}`,
    `- matcher follow-up justified: ${input.finalDecision.matcherFollowUpJustified ? "yes" : "no"}`,
    `- single best next action: ${input.finalDecision.singleBestNextAction}`
  ].join("\n");
};

export const runPoliticsOfficeWinnerFamilyPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsOfficeWinnerFamilyPassRunResult> => {
  const priorFetchSummary = (() => {
    try {
      return readArtifact<Record<string, unknown>>(input.repoRoot, `${ARTIFACT_DIR}/politics-office-winner-fetch-summary.json`);
    } catch {
      return null;
    }
  })();

  const refresh = await runPoliticsCurrentStateRefresh(input);
  const refreshedRows = await listRefreshedPoliticsMarkets(input.pool);
  const freshRefreshRows = refresh.admittedRows.map((row) =>
    extractPoliticsInventoryRow(
      freshPoliticsRowToMatchingMarketRecord(row, "politics-office-winner-family-pass-refresh-v1")
    )
  );
  const mergedRefreshedRows = new Map<string, (typeof refreshedRows)[number]>();
  for (const row of refreshedRows) {
    mergedRefreshedRows.set(`${row.venue}:${row.venueMarketId}`, row);
  }
  for (const row of freshRefreshRows) {
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

  const filteredMyriadRows = filterSupplementalMyriadOfficeWinnerRows(
    [...mergedRefreshedRows.values()],
    myriadRows
  );

  const officeWinner = buildPoliticsOfficeWinnerFamilyArtifacts([...mergedRefreshedRows.values(), ...filteredMyriadRows]);
  const fetchSummary = buildFetchSummary({
    refresh,
    officeWinner,
    myriadStatus,
    priorSummary: priorFetchSummary
  });

  const admissionSummary = {
    observedAt: new Date().toISOString(),
    totalAdmittedOfficeWinnerRows: officeWinner.admissionSummary.totalAdmittedOfficeWinnerRows,
    rowsRejectedByReason: officeWinner.admissionSummary.rowsRejectedByReason,
    rowsAdmittedByTopicCandidate: officeWinner.admissionSummary.rowsAdmittedByTopicCandidate,
    venueBreakdown: officeWinner.admissionSummary.venueBreakdown
  };

  const comparabilitySummary = officeWinner.comparabilitySummary.map((summary) => ({
    canonicalTopicKey: summary.canonicalTopicKey,
    venuesPresent: summary.venuesPresent,
    pairSharedNamedOutcomesCount: summary.pairSharedNamedOutcomesCount,
    triSharedNamedOutcomesCount: summary.triSharedNamedOutcomesCount,
    excludedOutcomesCount: summary.excludedOutcomesCount,
    ruleCompatibilityClassification: summary.ruleCompatibilityClassification,
    fragmentationLabel: summary.fragmentationLabel,
    matcherCandidate: summary.matcherCandidate,
    sharedNamedCandidates: summary.sharedNamedCandidates,
    excludedOutcomes: summary.excludedOutcomes,
    notes: summary.notes
  }));

  const basisFragmentationSummary = {
    observedAt: new Date().toISOString(),
    blockerCounts: officeWinner.basisFragmentationSummary.blockerCounts,
    topicBlockers: officeWinner.basisFragmentationSummary.topicBlockers,
    unresolvedRows: officeWinner.basisFragmentationSummary.unresolvedRows
  };

  const finalDecision = {
    observedAt: new Date().toISOString(),
    ...officeWinner.finalDecision
  };

  const operatorSummary = buildOperatorSummary({
    fetchSummary,
    comparabilitySummary: officeWinner.comparabilitySummary,
    finalDecision: officeWinner.finalDecision
  });

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-winner-fetch-summary.json`, fetchSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-winner-admission-summary.json`, admissionSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-winner-normalized-topics.json`, officeWinner.normalizedTopicRows);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-winner-comparability-summary.json`, comparabilitySummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-winner-basis-fragmentation-summary.json`, basisFragmentationSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-winner-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-office-winner-operator-summary.md`, `${operatorSummary}\n`);

  return {
    refresh,
    fetchSummary,
    admissionSummary,
    normalizedTopics: officeWinner.normalizedTopicRows,
    comparabilitySummary,
    basisFragmentationSummary,
    finalDecision,
    operatorSummary
  };
};
