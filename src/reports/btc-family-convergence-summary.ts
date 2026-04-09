import type {
  BtcAuditData,
  BtcAuditVenue,
  BtcFamilyConvergenceFamilySummary,
  BtcFamilyConvergenceSummary,
  BtcInventoryAlignmentRow
} from "./btc-audit-types.js";
import { getExactApprovedEdges, listBtcEligibleRows } from "./btc-audit-shared.js";

const PRIORITY_ORDER = ["THRESHOLD_BY_DATE", "SAME_DAY_DIRECTIONAL", "ATH_BY_DATE", "PRICE_AT_CLOSE"] as const;

const buildVenuePairKey = (left: BtcAuditVenue, right: BtcAuditVenue): string =>
  left.localeCompare(right) <= 0 ? `${left}_${right}` : `${right}_${left}`;

const emptyVenueCounts = (): Record<BtcAuditVenue, number> => ({
  POLYMARKET: 0,
  LIMITLESS: 0,
  OPINION: 0
});

const countByVenue = (rows: readonly BtcInventoryAlignmentRow[]): Record<BtcAuditVenue, number> => {
  const counts = emptyVenueCounts();
  for (const row of rows) {
    counts[row.venue] += 1;
  }
  return counts;
};

const buildExactVenuePairCounts = (
  data: BtcAuditData,
  family: string
): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const edge of getExactApprovedEdges(data.pairEdges).filter((entry) => entry.family === family)) {
    const key = buildVenuePairKey(edge.leftVenue as BtcAuditVenue, edge.rightVenue as BtcAuditVenue);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};

const buildWindowVenueSets = (
  rows: readonly BtcInventoryAlignmentRow[],
  keyField: "exactWindowKey" | "familyDateKey"
): ReadonlyMap<string, ReadonlySet<BtcAuditVenue>> => {
  const groups = new Map<string, Set<BtcAuditVenue>>();
  for (const row of rows) {
    const key = row[keyField];
    if (!key) {
      continue;
    }
    const venues = groups.get(key) ?? new Set<BtcAuditVenue>();
    venues.add(row.venue);
    groups.set(key, venues);
  }
  return groups;
};

const collectFamilySummary = (
  data: BtcAuditData,
  family: string,
  priorityRank: number
): BtcFamilyConvergenceFamilySummary => {
  const localRows = listBtcEligibleRows(data.localMarkets.map((entry) => entry.row))
    .filter((row) => row.normalizedFamily === family);
  const remoteRows = listBtcEligibleRows(data.remoteMarkets)
    .filter((row) => row.normalizedFamily === family);
  const combinedRows = [...localRows, ...remoteRows];
  const exactWindowVenueSets = buildWindowVenueSets(combinedRows, "exactWindowKey");
  const familyDateVenueSets = buildWindowVenueSets(combinedRows, "familyDateKey");
  const exactCandidateWindows = [...exactWindowVenueSets.entries()]
    .filter(([, venues]) => venues.size >= 2)
    .map(([key]) => key)
    .sort();
  const nearExactWindows = [...familyDateVenueSets.entries()]
    .filter(([key, venues]) => venues.size >= 2 && !exactCandidateWindows.some((windowKey) => windowKey.startsWith(key)))
    .map(([key]) => key)
    .sort();
  const missingCounterpartWindows = [...familyDateVenueSets.entries()]
    .filter(([, venues]) => venues.size < 3)
    .map(([key]) => key)
    .sort();
  const exactSafeEdgesByVenuePair = buildExactVenuePairCounts(data, family);
  const exactPairCoverage = Object.keys(exactSafeEdgesByVenuePair).length;
  const remoteTriWindowPresent = exactCandidateWindows.some((windowKey) => (exactWindowVenueSets.get(windowKey)?.size ?? 0) === 3);
  const likelyTriViability =
    exactPairCoverage === 3 ? "TRI_CAPABLE_NOW"
    : remoteTriWindowPresent ? "REMOTE_TRI_WINDOW_PRESENT"
    : exactPairCoverage >= 1 && missingCounterpartWindows.length > 0 ? "PARTIAL_EXACT__MISSING_COUNTERPART"
    : nearExactWindows.length > 0 ? "NEAR_EXACT_ONLY"
    : "SPARSE_OR_ABSENT";

  return {
    family,
    priorityRank,
    countsByVenue: countByVenue(localRows),
    exactCandidateWindows,
    nearExactWindows,
    missingCounterpartWindows,
    exactSafeEdgesByVenuePair,
    likelyTriViability,
    localCountsByVenue: countByVenue(localRows),
    remoteCountsByVenue: countByVenue(remoteRows)
  };
};

const compareFamilySummary = (left: BtcFamilyConvergenceFamilySummary, right: BtcFamilyConvergenceFamilySummary): number => {
  const leftExactPairCoverage = Object.keys(left.exactSafeEdgesByVenuePair).length;
  const rightExactPairCoverage = Object.keys(right.exactSafeEdgesByVenuePair).length;
  const leftTriSignal = left.likelyTriViability === "REMOTE_TRI_WINDOW_PRESENT" ? 1 : 0;
  const rightTriSignal = right.likelyTriViability === "REMOTE_TRI_WINDOW_PRESENT" ? 1 : 0;
  const leftRemoteCoverage = Object.values(left.remoteCountsByVenue).filter((count) => count > 0).length;
  const rightRemoteCoverage = Object.values(right.remoteCountsByVenue).filter((count) => count > 0).length;

  return rightExactPairCoverage - leftExactPairCoverage
    || rightTriSignal - leftTriSignal
    || right.exactCandidateWindows.length - left.exactCandidateWindows.length
    || rightRemoteCoverage - leftRemoteCoverage
    || left.missingCounterpartWindows.length - right.missingCounterpartWindows.length
    || left.priorityRank - right.priorityRank;
};

export const selectBestConvergenceFamily = (
  families: readonly BtcFamilyConvergenceFamilySummary[]
): BtcFamilyConvergenceFamilySummary =>
  [...families].sort(compareFamilySummary)[0]!;

export const buildBtcFamilyConvergenceSummary = (data: BtcAuditData): BtcFamilyConvergenceSummary => {
  const eligibleLocalRows = listBtcEligibleRows(data.localMarkets.map((entry) => entry.row));
  const families = PRIORITY_ORDER.map((family, index) => collectFamilySummary(data, family, index + 1));
  const selected = selectBestConvergenceFamily(families);
  const remoteCoverageCount = Object.values(selected.remoteCountsByVenue).filter((count) => count > 0).length;

  return {
    observedAt: new Date().toISOString(),
    sourceCryptoMarketCount: data.localMarkets.length,
    btcEligibleMarketCount: eligibleLocalRows.length,
    selectedFamily: selected.family,
    selectionRationale:
      selected.likelyTriViability === "REMOTE_TRI_WINDOW_PRESENT"
        ? `This family already has a full three-venue remote exact window, but local exact-safe coverage is incomplete; it is the clearest convergence target.`
        : Object.keys(selected.exactSafeEdgesByVenuePair).length > 0
          ? `This family already has at least one approved exact-safe BTC pair edge and the best remaining counterpart shape across the three venues.`
          : `This family does not yet have an approved exact-safe BTC edge, but it has the strongest remaining cross-venue window density among the prioritized BTC families.`,
    families
  };
};

export const buildBtcFamilyConvergenceSummaryMarkdown = (
  artifact: BtcFamilyConvergenceSummary
): string => [
  "# BTC Family Convergence Summary",
  "",
  `- selected family: \`${artifact.selectedFamily}\``,
  `- rationale: ${artifact.selectionRationale}`,
  "",
  "| Family | Local PM | Local Limitless | Local Opinion | Remote PM | Remote Limitless | Remote Opinion | Exact Windows | Near-Exact Windows | Missing Counterpart Windows | Tri Viability |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...artifact.families.map((family) =>
    `| ${family.family} | ${family.localCountsByVenue.POLYMARKET} | ${family.localCountsByVenue.LIMITLESS} | ${family.localCountsByVenue.OPINION} | ${family.remoteCountsByVenue.POLYMARKET} | ${family.remoteCountsByVenue.LIMITLESS} | ${family.remoteCountsByVenue.OPINION} | ${family.exactCandidateWindows.length} | ${family.nearExactWindows.length} | ${family.missingCounterpartWindows.length} | ${family.likelyTriViability} |`
  ),
  ""
].join("\n");
