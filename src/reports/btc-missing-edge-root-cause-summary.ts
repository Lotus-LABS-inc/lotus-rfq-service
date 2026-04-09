import type {
  BtcAuditData,
  BtcAuditVenue,
  BtcInventoryAlignmentRow,
  BtcMissingEdgeRootCause,
  BtcMissingEdgeRootCauseEntry,
  BtcMissingEdgeRootCauseSummary
} from "./btc-audit-types.js";
import { getExactApprovedEdges, listBtcEligibleRows } from "./btc-audit-shared.js";

const TARGET_FAMILIES = ["THRESHOLD_BY_DATE", "SAME_DAY_DIRECTIONAL", "ATH_BY_DATE", "PRICE_AT_CLOSE"] as const;
const VENUE_PAIRS = [
  ["POLYMARKET", "LIMITLESS"],
  ["POLYMARKET", "OPINION"],
  ["LIMITLESS", "OPINION"]
] as const satisfies readonly [BtcAuditVenue, BtcAuditVenue][];

const buildVenuePairKey = (left: BtcAuditVenue, right: BtcAuditVenue): string =>
  left.localeCompare(right) <= 0 ? `${left}_${right}` : `${right}_${left}`;

const buildFamilyDateLabel = (family: string, familyDateKey: string | null): string =>
  familyDateKey ?? `${family}|unknown-date`;

const collectVenueRows = (
  rows: readonly BtcInventoryAlignmentRow[],
  family: string,
  familyDateKey: string | null,
  venue: BtcAuditVenue
): readonly BtcInventoryAlignmentRow[] =>
  rows.filter((row) =>
    row.venue === venue
    && row.normalizedFamily === family
    && row.familyDateKey === familyDateKey
  );

const intersects = (left: readonly string[], right: readonly string[]): boolean =>
  left.some((value) => right.includes(value));

const extractExactWindowKeys = (rows: readonly BtcInventoryAlignmentRow[]): readonly string[] =>
  [...new Set(rows.map((row) => row.exactWindowKey).filter((value): value is string => value !== null))];

const localMarketIdSet = (rows: readonly BtcInventoryAlignmentRow[]): ReadonlySet<string> =>
  new Set(rows.map((row) => `${row.venue}|${row.venueMarketId}`));

const findRootCause = (input: {
  family: string;
  familyDateKey: string | null;
  leftVenue: BtcAuditVenue;
  rightVenue: BtcAuditVenue;
  localEligibleRows: readonly BtcInventoryAlignmentRow[];
  remoteEligibleRows: readonly BtcInventoryAlignmentRow[];
  localAllRows: readonly BtcInventoryAlignmentRow[];
  exactApprovedPairs: ReadonlySet<string>;
}): BtcMissingEdgeRootCauseEntry | null => {
  const venuePair = buildVenuePairKey(input.leftVenue, input.rightVenue);
  if (input.exactApprovedPairs.has(`${input.family}|${venuePair}`)) {
    return null;
  }

  const localLeft = collectVenueRows(input.localEligibleRows, input.family, input.familyDateKey, input.leftVenue);
  const localRight = collectVenueRows(input.localEligibleRows, input.family, input.familyDateKey, input.rightVenue);
  const remoteLeft = collectVenueRows(input.remoteEligibleRows, input.family, input.familyDateKey, input.leftVenue);
  const remoteRight = collectVenueRows(input.remoteEligibleRows, input.family, input.familyDateKey, input.rightVenue);

  const localLeftExactKeys = extractExactWindowKeys(localLeft);
  const localRightExactKeys = extractExactWindowKeys(localRight);
  const remoteLeftExactKeys = extractExactWindowKeys(remoteLeft);
  const remoteRightExactKeys = extractExactWindowKeys(remoteRight);

  const localExactOverlap = intersects(localLeftExactKeys, localRightExactKeys);
  const remoteExactOverlap = intersects(remoteLeftExactKeys, remoteRightExactKeys);
  const localCandidateCount = localLeft.length + localRight.length;
  const remoteCandidateCount = remoteLeft.length + remoteRight.length;

  let rootCause: BtcMissingEdgeRootCause;
  let rationale: string;

  if ((remoteLeft.length === 0 && localLeft.length === 0) || (remoteRight.length === 0 && localRight.length === 0)) {
    rootCause = "UPSTREAM_INVENTORY_MISSING";
    rationale = "No counterpart market appears on at least one venue at this BTC family/date shape in either local inventory or the remote audit surface.";
  } else if (remoteExactOverlap && !localExactOverlap) {
    const localIds = localMarketIdSet(input.localAllRows);
    const remoteExactRows = [...remoteLeft, ...remoteRight].filter((row) =>
      row.exactWindowKey !== null
      && remoteLeftExactKeys.includes(row.exactWindowKey)
      && remoteRightExactKeys.includes(row.exactWindowKey)
    );
    const remoteIdsPresentLocally = remoteExactRows.filter((row) => localIds.has(`${row.venue}|${row.venueMarketId}`)).length;
    if (remoteIdsPresentLocally === remoteExactRows.length && remoteExactRows.length > 0) {
      rootCause = "NORMALIZATION_MISSING";
      rationale = "The exact remote BTC counterpart window is already present in local inventory by venue market id, but local normalization/classification is not aligning it into an exact-safe edge.";
    } else {
      rootCause = "INGESTION_MISSING";
      rationale = "A remote exact BTC counterpart window exists on the public venue surface, but one or more counterpart markets are absent from local inventory.";
    }
  } else if (localCandidateCount > 0 || remoteCandidateCount > 0) {
    rootCause = "TRUE_STRUCTURE_MISMATCH";
    rationale = "Counterpart markets exist in the same BTC family/date lane, but threshold, cutoff, comparator, or observation-type structure is genuinely different.";
  } else {
    rootCause = "UPSTREAM_INVENTORY_MISSING";
    rationale = "No BTC counterpart candidate was found for this family/date window.";
  }

  return {
    family: input.family,
    venuePair,
    windowLabel: buildFamilyDateLabel(input.family, input.familyDateKey),
    rootCause,
    rationale,
    localCandidateCount,
    remoteCandidateCount,
    exactEdgePresent: false
  };
};

export const buildBtcMissingEdgeRootCauseSummary = (data: BtcAuditData): BtcMissingEdgeRootCauseSummary => {
  const localEligibleRows = listBtcEligibleRows(data.localMarkets.map((entry) => entry.row));
  const remoteEligibleRows = listBtcEligibleRows(data.remoteMarkets);
  const localAllRows = data.localMarkets.map((entry) => entry.row);
  const exactApprovedPairs = new Set(
    getExactApprovedEdges(data.pairEdges).map((edge) =>
      `${edge.family}|${buildVenuePairKey(edge.leftVenue as BtcAuditVenue, edge.rightVenue as BtcAuditVenue)}`
    )
  );
  const entries: BtcMissingEdgeRootCauseEntry[] = [];

  for (const family of TARGET_FAMILIES) {
    const familyDateKeys = new Set<string | null>();
    for (const row of [...localEligibleRows, ...remoteEligibleRows]) {
      if (row.normalizedFamily === family) {
        familyDateKeys.add(row.familyDateKey);
      }
    }
    for (const familyDateKey of familyDateKeys) {
      for (const [leftVenue, rightVenue] of VENUE_PAIRS) {
        const entry = findRootCause({
          family,
          familyDateKey,
          leftVenue,
          rightVenue,
          localEligibleRows,
          remoteEligibleRows,
          localAllRows,
          exactApprovedPairs
        });
        if (entry) {
          entries.push(entry);
        }
      }
    }
  }

  const countsByRootCause: Record<BtcMissingEdgeRootCause, number> = {
    UPSTREAM_INVENTORY_MISSING: 0,
    INGESTION_MISSING: 0,
    NORMALIZATION_MISSING: 0,
    TRUE_STRUCTURE_MISMATCH: 0
  };
  for (const entry of entries) {
    countsByRootCause[entry.rootCause] += 1;
  }

  const dominantRootCause = (Object.entries(countsByRootCause) as Array<[BtcMissingEdgeRootCause, number]>)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? "UPSTREAM_INVENTORY_MISSING";

  return {
    observedAt: new Date().toISOString(),
    countsByRootCause,
    entries: entries.sort((left, right) =>
      left.family.localeCompare(right.family)
      || left.venuePair.localeCompare(right.venuePair)
      || left.windowLabel.localeCompare(right.windowLabel)
    ),
    dominantRootCause
  };
};

export const buildBtcMissingEdgeRootCauseSummaryMarkdown = (
  artifact: BtcMissingEdgeRootCauseSummary
): string => [
  "# BTC Missing Edge Root Cause Summary",
  "",
  `- dominant root cause: \`${artifact.dominantRootCause}\``,
  `- upstream inventory missing: ${artifact.countsByRootCause.UPSTREAM_INVENTORY_MISSING}`,
  `- ingestion missing: ${artifact.countsByRootCause.INGESTION_MISSING}`,
  `- normalization missing: ${artifact.countsByRootCause.NORMALIZATION_MISSING}`,
  `- true structure mismatch: ${artifact.countsByRootCause.TRUE_STRUCTURE_MISMATCH}`,
  "",
  "| Family | Venue Pair | Window | Root Cause | Local Candidates | Remote Candidates | Rationale |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...artifact.entries.map((entry) =>
    `| ${entry.family} | ${entry.venuePair} | ${entry.windowLabel} | ${entry.rootCause} | ${entry.localCandidateCount} | ${entry.remoteCandidateCount} | ${entry.rationale} |`
  ),
  ""
].join("\n");
