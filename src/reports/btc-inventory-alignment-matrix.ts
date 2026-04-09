import type { BtcAuditData, BtcInventoryAlignmentRow } from "./btc-audit-types.js";

export interface BtcInventoryAlignmentMatrixArtifact {
  observedAt: string;
  localRowCount: number;
  remoteRowCount: number;
  rowCount: number;
  eligibleRowCount: number;
  rows: readonly BtcInventoryAlignmentRow[];
}

const hasBtcSignal = (row: BtcInventoryAlignmentRow): boolean =>
  row.normalizedAsset === "BTC" || /\b(bitcoin|btc)\b/i.test(row.title);

const compareRows = (left: BtcInventoryAlignmentRow, right: BtcInventoryAlignmentRow): number =>
  left.venue.localeCompare(right.venue)
  || (left.normalizedFamily ?? "").localeCompare(right.normalizedFamily ?? "")
  || (left.date ?? "").localeCompare(right.date ?? "")
  || (left.timezoneNormalizedCutoff ?? "").localeCompare(right.timezoneNormalizedCutoff ?? "")
  || left.venueMarketId.localeCompare(right.venueMarketId);

const buildMarkdownRow = (row: BtcInventoryAlignmentRow): string =>
  `| ${row.source} | ${row.venue} | ${row.venueMarketId} | ${row.normalizedAsset ?? "n/a"} | ${row.normalizedFamily} | ${row.date ?? "n/a"} | ${row.timezoneNormalizedCutoff ?? "n/a"} | ${row.observationType ?? "n/a"} | ${row.structuralEligibilityStatus} | ${row.structuralRejectionReasons.join(", ") || row.sourceHygieneReasons.join(", ") || "none"} |`;

export const buildBtcInventoryAlignmentMatrix = (data: BtcAuditData): BtcInventoryAlignmentMatrixArtifact => ({
  observedAt: new Date().toISOString(),
  localRowCount: data.localMarkets.length,
  remoteRowCount: data.remoteMarkets.length,
  rowCount: [...data.localMarkets.map((entry) => entry.row), ...data.remoteMarkets].filter(hasBtcSignal).length,
  eligibleRowCount: [...data.localMarkets.map((entry) => entry.row), ...data.remoteMarkets]
    .filter((row) => hasBtcSignal(row) && row.structuralEligibilityStatus === "BTC_STRUCTURAL_ELIGIBLE")
    .length,
  rows: [...data.localMarkets.map((entry) => entry.row), ...data.remoteMarkets]
    .filter(hasBtcSignal)
    .sort(compareRows)
});

export const buildBtcInventoryAlignmentMatrixMarkdown = (
  artifact: BtcInventoryAlignmentMatrixArtifact
): string => [
  "# BTC Inventory Alignment Matrix",
  "",
  `- local rows: ${artifact.localRowCount}`,
  `- remote audit rows: ${artifact.remoteRowCount}`,
  `- matrix rows: ${artifact.rowCount}`,
  `- BTC structural eligible rows: ${artifact.eligibleRowCount}`,
  "",
  "| Source | Venue | Market ID | Asset | Family | Date | Cutoff | Observation | Eligibility | Rejection Reasons |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...artifact.rows.map(buildMarkdownRow),
  ""
].join("\n");
