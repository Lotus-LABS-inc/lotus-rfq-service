import type { Pool } from "pg";

import {
  admitNominee2028Row,
  buildNominee2028ClusterSummary,
  buildNominee2028FinalDecision,
  isNominee2028CandidateRow,
  normalizeNominee2028Row,
  type PoliticsNominee2028ClusterSummary,
  type PoliticsNominee2028SubgroupKey
} from "../matching/politics/politics-nominee-2028-cluster.js";
import { writeArtifact, writeMarkdownArtifact, readArtifact } from "../operations/semantic-expansion/shared.js";
import { listRefreshedPoliticsMarkets, runPoliticsCurrentStateRefresh, type PoliticsCurrentStateRefreshRunResult } from "./politics-current-state-refresh.js";
import { mergeRefreshedRowsWithOpinionLimitlessLiveCensus, runPoliticsOpinionLimitlessLiveCensusPass } from "./politics-opinion-limitless-live-census.js";

const ARTIFACT_DIR = "artifacts/politics/nominee-2028-cluster";
const SUBGROUP_KEYS: readonly PoliticsNominee2028SubgroupKey[] = [
  "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
  "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC"
];
const IN_SCOPE_VENUES = ["POLYMARKET", "OPINION", "LIMITLESS"] as const;

const toVenueCounts = <T extends { venue: string }>(rows: readonly T[]): Record<string, number> =>
  rows.reduce<Record<string, number>>((accumulator, row) => {
    accumulator[row.venue] = (accumulator[row.venue] ?? 0) + 1;
    return accumulator;
  }, {});

export interface PoliticsNominee2028ClusterRunResult {
  refresh: PoliticsCurrentStateRefreshRunResult;
  fetchSummary: Record<string, unknown>;
  admissionSummary: Record<string, unknown>;
  rowCensus: Record<string, unknown>;
  normalizationSummary: Record<string, unknown>;
  republicanCluster: PoliticsNominee2028ClusterSummary;
  democraticCluster: PoliticsNominee2028ClusterSummary;
  basisFragmentationSummary: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  operatorSummary: string;
}

export const runPoliticsNominee2028ClusterPass = async (input: {
  pool: Pool;
  repoRoot: string;
}): Promise<PoliticsNominee2028ClusterRunResult> => {
  const priorManualDecision = (() => {
    try {
      return readArtifact<Record<string, unknown>>(input.repoRoot, "artifacts/politics/manual-family-pass/politics-manual-family-decision-summary.json");
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

  const candidateRows = refreshedRows.filter((row) => isNominee2028CandidateRow(row));
  const admissions = refreshedRows.map((row) => ({
    row,
    admission: admitNominee2028Row(row)
  }));
  const admittedRows = admissions
    .filter((entry) => entry.admission.admitted)
    .map((entry) => normalizeNominee2028Row(entry.row))
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const rejectedRows = admissions
    .filter((entry) => !entry.admission.admitted)
    .map((entry) => ({
      venue: entry.row.venue,
      venueMarketId: entry.row.venueMarketId,
      title: entry.row.title,
      rejectionReason: entry.admission.reason
    }));

  const bySubgroup = new Map<PoliticsNominee2028SubgroupKey, typeof admittedRows>();
  for (const subgroupKey of SUBGROUP_KEYS) {
    bySubgroup.set(subgroupKey, admittedRows.filter((row) => row.subgroupKey === subgroupKey));
  }

  const republicanCluster = buildNominee2028ClusterSummary("NOMINEE|US_PRESIDENT|2028|REPUBLICAN", bySubgroup.get("NOMINEE|US_PRESIDENT|2028|REPUBLICAN") ?? []);
  const democraticCluster = buildNominee2028ClusterSummary("NOMINEE|US_PRESIDENT|2028|DEMOCRATIC", bySubgroup.get("NOMINEE|US_PRESIDENT|2028|DEMOCRATIC") ?? []);
  const overall = buildNominee2028FinalDecision({
    republican: republicanCluster,
    democratic: democraticCluster
  });

  const fetchSummary = {
    observedAt: new Date().toISOString(),
    rawInScopeCandidateRowsByVenue: toVenueCounts(candidateRows),
    liveCensusCandidateRowsByVenue: toVenueCounts(liveCensus.extractedRows.filter((row) => isNominee2028CandidateRow(row))),
    fetchStatuses: Object.fromEntries(
      IN_SCOPE_VENUES.map((venue) => [
        venue,
        venue === "OPINION" || venue === "LIMITLESS"
          ? {
              fetchStatus: liveCensus.venueStatuses[venue].fetchState,
              discoveryPath: liveCensus.venueStatuses[venue].discoveryPath,
              broadDiscoveryRowCount: liveCensus.venueStatuses[venue].broadDiscoveryRowCount,
              targetedDiscoveryRowCount: liveCensus.venueStatuses[venue].targetedDiscoveryRowCount,
              targetedDiscoveryPathUsed: liveCensus.venueStatuses[venue].targetedDiscoveryPathUsed,
              targetedQueryLabels: liveCensus.venueStatuses[venue].targetedQueryLabels,
              warnings: liveCensus.venueStatuses[venue].warnings
            }
          : refresh.fetchStatus[venue] ?? { fetchStatus: "UNSUPPORTED_PATH" }
      ])
    )
  };

  const admissionSummary = {
    observedAt: new Date().toISOString(),
    admittedRowsByVenue: toVenueCounts(admittedRows),
    admittedRowsBySubgroup: Object.fromEntries(
      SUBGROUP_KEYS.map((subgroupKey) => [subgroupKey, (bySubgroup.get(subgroupKey) ?? []).length])
    ),
    rejectedCount: rejectedRows.length
  };

  const rowCensus = {
    observedAt: new Date().toISOString(),
    rawCandidateRows: candidateRows.map((row) => ({
      venue: row.venue,
      venueMarketId: row.venueMarketId,
      title: row.title,
      cycleYear: row.cycleYear,
      office: row.office,
      jurisdiction: row.jurisdiction,
      partyTerms: row.partyTerms
    })),
    rejectedRows
  };

  const normalizationSummary = {
    observedAt: new Date().toISOString(),
    normalizedRowCount: admittedRows.length,
    candidateSetBasisBreakdown: admittedRows.reduce<Record<string, number>>((accumulator, row) => {
      accumulator[row.candidateSetType] = (accumulator[row.candidateSetType] ?? 0) + 1;
      return accumulator;
    }, {}),
    subgroupKeys: SUBGROUP_KEYS,
    normalizedSamples: admittedRows.slice(0, 12)
  };

  const basisFragmentationSummary = {
    observedAt: new Date().toISOString(),
    subgroupDecisions: {
      republican: republicanCluster.decision,
      democratic: democraticCluster.decision
    },
    blockers: {
      republican: republicanCluster.reasons,
      democratic: democraticCluster.reasons
    }
  };

  const finalDecision = {
    observedAt: new Date().toISOString(),
    finalLabel: overall.finalLabel,
    nomineeMatcherEvalJustified: overall.nomineeMatcherEvalJustified,
    republicanDecision: republicanCluster.decision,
    democraticDecision: democraticCluster.decision,
    deltaVsManualFamilyPass: {
      previousBestNextFamily: priorManualDecision?.["bestNextFamily"] ?? null,
      previousOverallDecisionLabels: priorManualDecision?.["overallDecisionLabels"] ?? []
    }
  };

  const operatorSummary = [
    "# Politics Nominee 2028 Cluster",
    "",
    `- raw in-scope candidate rows by venue: ${JSON.stringify(fetchSummary.rawInScopeCandidateRowsByVenue)}`,
    `- admitted rows by venue: ${JSON.stringify(admissionSummary.admittedRowsByVenue)}`,
    `- republican subgroup: ${republicanCluster.decision}`,
    `- democratic subgroup: ${democraticCluster.decision}`,
    `- nominee matcher eval justified: ${overall.nomineeMatcherEvalJustified ? "yes" : "no"}`,
    `- final label: ${overall.finalLabel}`
  ].join("\n");

  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-fetch-summary.json`, fetchSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-admission-summary.json`, admissionSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-row-census.json`, rowCensus);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-normalization-summary.json`, normalizationSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-republican-cluster.json`, republicanCluster);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-democratic-cluster.json`, democraticCluster);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-basis-fragmentation-summary.json`, basisFragmentationSummary);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-final-decision.json`, finalDecision);
  writeMarkdownArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-operator-summary.md`, `${operatorSummary}\n`);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-rejected-rows.json`, rejectedRows);
  writeArtifact(input.repoRoot, `${ARTIFACT_DIR}/politics-nominee-2028-delta-vs-manual-family-pass.json`, finalDecision.deltaVsManualFamilyPass);

  return {
    refresh,
    fetchSummary,
    admissionSummary,
    rowCensus,
    normalizationSummary,
    republicanCluster,
    democraticCluster,
    basisFragmentationSummary,
    finalDecision,
    operatorSummary
  };
};
