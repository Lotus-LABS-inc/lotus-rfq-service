import type { BtcAuditData, BtcInventoryAlignmentRow } from "./btc-audit-types.js";
import { listBtcEligibleRows } from "./btc-audit-shared.js";
import type {
  LimitlessBtcDirectionalAlignmentMatrix,
  LimitlessBtcDirectionalAlignmentRow,
  LimitlessBtcDirectionalInventoryArtifact,
  LimitlessBtcDirectionalKnownWindow
} from "./limitless-btc-directional-types.js";

export const buildKnownDirectionalWindows = (
  rows: readonly BtcInventoryAlignmentRow[]
): readonly LimitlessBtcDirectionalKnownWindow[] => {
  const directionalRows = rows.filter((row) =>
    (row.venue === "POLYMARKET" || row.venue === "OPINION")
    && row.normalizedAsset === "BTC"
    && row.normalizedFamily === "SAME_DAY_DIRECTIONAL"
  );

  const deduped = new Map<string, LimitlessBtcDirectionalKnownWindow>();
  for (const row of listBtcEligibleRows(directionalRows)) {
    const key = `${row.venue}|${row.venueMarketId}`;
    deduped.set(key, {
      venue: row.venue as "POLYMARKET" | "OPINION",
      venueMarketId: row.venueMarketId,
      title: row.title,
      exactWindowKey: row.exactWindowKey ?? key,
      date: row.date,
      cutoffTimestamp: row.cutoffTimestamp,
      timezoneNormalizedCutoff: row.timezoneNormalizedCutoff,
      bucketGranularity: row.bucketGranularity,
      observationType: row.observationType,
      binaryStructure: row.binaryStructure
    });
  }

  return [...deduped.values()].sort((left, right) =>
    (left.date ?? "").localeCompare(right.date ?? "")
    || left.venue.localeCompare(right.venue)
    || left.venueMarketId.localeCompare(right.venueMarketId)
  );
};

const getKnownDirectionalWindows = (data: BtcAuditData): readonly LimitlessBtcDirectionalKnownWindow[] =>
  buildKnownDirectionalWindows([
    ...data.localMarkets.map((entry) => entry.row),
    ...data.remoteMarkets
  ]);

const classifyAlignment = (
  window: LimitlessBtcDirectionalKnownWindow,
  inventory: LimitlessBtcDirectionalInventoryArtifact
): LimitlessBtcDirectionalAlignmentRow => {
  if (inventory.candidates.length === 0) {
    return {
      knownWindow: window,
      blocker: inventory.authenticatedEnrichmentAttempted ? "NO_LIMITLESS_COUNTERPART" : "SURFACE_INSUFFICIENT",
      exactSafeComparable: false,
      matchedLimitlessMarketId: null,
      rationale: inventory.authenticatedEnrichmentAttempted
        ? "No Limitless BTC SAME_DAY_DIRECTIONAL candidates were reachable on the current public/live and authenticated detail surfaces."
        : "Only public/live discovery was reachable, and it exposed no BTC SAME_DAY_DIRECTIONAL candidates."
    };
  }

  const exact = inventory.candidates.find((candidate) =>
    candidate.date === window.date
    && candidate.timezoneNormalizedCutoff === window.timezoneNormalizedCutoff
    && candidate.observationType === window.observationType
    && candidate.bucketGranularity === window.bucketGranularity
    && candidate.binaryStructure === window.binaryStructure
  );
  if (exact) {
    return {
      knownWindow: window,
      blocker: "NO_LIMITLESS_COUNTERPART",
      exactSafeComparable: true,
      matchedLimitlessMarketId: exact.venueMarketId,
      rationale: "Limitless exposes an exact-safe BTC SAME_DAY_DIRECTIONAL counterpart for this PM/Opinion window."
    };
  }

  const sameDate = inventory.candidates.find((candidate) => candidate.date === window.date);
  if (!sameDate) {
    return {
      knownWindow: window,
      blocker: "DATE_MISMATCH",
      exactSafeComparable: false,
      matchedLimitlessMarketId: null,
      rationale: "Limitless directional candidates exist, but none share the exact PM/Opinion day boundary."
    };
  }
  if (sameDate.timezoneNormalizedCutoff !== window.timezoneNormalizedCutoff) {
    return {
      knownWindow: window,
      blocker: "CUTOFF_MISMATCH",
      exactSafeComparable: false,
      matchedLimitlessMarketId: sameDate.venueMarketId,
      rationale: "A same-day Limitless directional candidate exists, but the cutoff model does not align exactly."
    };
  }
  if (sameDate.observationType !== window.observationType) {
    return {
      knownWindow: window,
      blocker: "OBSERVATION_TYPE_MISMATCH",
      exactSafeComparable: false,
      matchedLimitlessMarketId: sameDate.venueMarketId,
      rationale: "A same-day Limitless candidate exists, but the observation type is not exact-safe compatible."
    };
  }
  if (sameDate.bucketGranularity !== window.bucketGranularity) {
    return {
      knownWindow: window,
      blocker: "BUCKET_GRANULARITY_MISMATCH",
      exactSafeComparable: false,
      matchedLimitlessMarketId: sameDate.venueMarketId,
      rationale: "A same-day Limitless candidate exists, but the bucket granularity differs."
    };
  }
  return {
    knownWindow: window,
    blocker: "STRUCTURE_MISMATCH",
    exactSafeComparable: false,
    matchedLimitlessMarketId: sameDate.venueMarketId,
    rationale: "A same-day Limitless candidate exists, but the remaining structural fields still do not align exactly."
  };
};

export const buildLimitlessBtcDirectionalAlignmentMatrix = (input: {
  btcAuditData: BtcAuditData;
  inventory: LimitlessBtcDirectionalInventoryArtifact;
}): LimitlessBtcDirectionalAlignmentMatrix => {
  const knownWindows = getKnownDirectionalWindows(input.btcAuditData);
  return {
    observedAt: new Date().toISOString(),
    knownWindows,
    limitlessCandidateCount: input.inventory.candidates.length,
    rows: knownWindows.map((window) => classifyAlignment(window, input.inventory))
  };
};

export const buildLimitlessBtcDirectionalAlignmentMatrixMarkdown = (
  artifact: LimitlessBtcDirectionalAlignmentMatrix
): string => [
  "# Limitless BTC Directional Alignment Matrix",
  "",
  `- known PM/Opinion windows: ${artifact.knownWindows.length}`,
  `- Limitless candidates: ${artifact.limitlessCandidateCount}`,
  "",
  "| Venue | Market | Date | Cutoff | Status | Limitless Match |",
  "| --- | --- | --- | --- | --- | --- |",
  ...artifact.rows.map((row) =>
    `| ${row.knownWindow.venue} | ${row.knownWindow.title} | ${row.knownWindow.date ?? "none"} | ${row.knownWindow.timezoneNormalizedCutoff ?? "none"} | ${row.exactSafeComparable ? "EXACT" : row.blocker} | ${row.matchedLimitlessMarketId ?? "none"} |`
  ),
  ""
].join("\n");
