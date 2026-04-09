import {
  buildOpinionFamilyInventoryMap,
  type OpinionFamilyInventoryClassification
} from "./opinion-family-inventory-map.js";
import type { OpinionClient } from "./opinion-client.js";

export type OpinionCryptoFamily =
  | "ATH_BY_DATE"
  | "THRESHOLD_BY_DATE"
  | "SAME_DAY_DIRECTIONAL"
  | "PRICE_AT_CLOSE"
  | "GENERIC_UP_DOWN";

export type OpinionCryptoCutoffStyle =
  | "NOON_ET_DAILY"
  | "UTC_HOURLY_CLOSE"
  | "END_OF_DAY_BY_DATE"
  | "UNKNOWN";

export interface OpinionCryptoDateFamilyRow {
  marketId: string;
  title: string;
  asset: string | null;
  family: OpinionCryptoFamily;
  exactDate: string | null;
  cutoffStyle: OpinionCryptoCutoffStyle;
  triggerStyle: string | null;
}

export interface OpinionCryptoDateFamilySummary {
  observedAt: string;
  metadataVersion: string;
  scannedCryptoMarketCount: number;
  countsByFamily: Record<OpinionCryptoFamily, number>;
  btcTargetableDates: ReadonlyArray<{
    family: OpinionCryptoFamily;
    exactDate: string;
    cutoffStyle: OpinionCryptoCutoffStyle;
    count: number;
    representativeMarkets: readonly { marketId: string; title: string }[];
  }>;
  matrix: ReadonlyArray<{
    asset: string;
    family: OpinionCryptoFamily;
    exactDate: string | null;
    cutoffStyle: OpinionCryptoCutoffStyle;
    count: number;
    representativeMarkets: readonly { marketId: string; title: string }[];
  }>;
}

export interface OpinionCryptoDateFamilyMatrixResult {
  summary: OpinionCryptoDateFamilySummary;
  rows: readonly OpinionCryptoDateFamilyRow[];
}

const METADATA_VERSION = "opinion-crypto-date-family-matrix-v1";

const SUPPORTED_CRYPTO_FAMILIES = new Set<OpinionCryptoFamily>([
  "ATH_BY_DATE",
  "THRESHOLD_BY_DATE",
  "SAME_DAY_DIRECTIONAL",
  "PRICE_AT_CLOSE",
  "GENERIC_UP_DOWN"
]);

const dedupeSort = <T extends string>(values: readonly T[]): readonly T[] =>
  [...new Set(values.filter((value) => value.length > 0))].sort((left, right) => left.localeCompare(right)) as readonly T[];

const normalizeExactDate = (value: string | null): string | null =>
  value?.toLowerCase().replace(/\s+/g, " ").trim() ?? null;

export const inferCryptoCutoffStyle = (input: {
  title: string;
  exactDate: string | null;
  timeBoundaryPattern: string;
}): OpinionCryptoCutoffStyle => {
  if (/\(12:00 et\)/i.test(input.title)) {
    return "NOON_ET_DAILY";
  }
  if (/\butc close\b/i.test(input.title) || /\bhourly\b/i.test(input.title)) {
    return "UTC_HOURLY_CLOSE";
  }
  if (
    input.timeBoundaryPattern === "BY_DATE"
    || (input.exactDate !== null && input.timeBoundaryPattern === "EXACT_DAY")
  ) {
    return "END_OF_DAY_BY_DATE";
  }
  return "UNKNOWN";
};

const inferTriggerStyle = (row: OpinionFamilyInventoryClassification): string | null => {
  switch (row.familyBucket) {
    case "SAME_DAY_DIRECTIONAL":
    case "GENERIC_UP_DOWN":
      return "directional_yes_no";
    case "ATH_BY_DATE":
      return "ath_yes_no";
    case "THRESHOLD_BY_DATE":
      return row.threshold ?? "threshold_yes_no";
    case "PRICE_AT_CLOSE":
      return "price_at_close_yes_no";
    default:
      return null;
  }
};

const toCryptoRow = (row: OpinionFamilyInventoryClassification): OpinionCryptoDateFamilyRow | null => {
  if (row.category !== "CRYPTO" || !SUPPORTED_CRYPTO_FAMILIES.has(row.familyBucket as OpinionCryptoFamily)) {
    return null;
  }
  return {
    marketId: row.marketId,
    title: row.title,
    asset: row.subject,
    family: row.familyBucket as OpinionCryptoFamily,
    exactDate: normalizeExactDate(row.deadlineOrSeason),
    cutoffStyle: inferCryptoCutoffStyle({
      title: row.title,
      exactDate: row.deadlineOrSeason,
      timeBoundaryPattern: row.timeBoundaryPattern
    }),
    triggerStyle: inferTriggerStyle(row)
  };
};

export const buildOpinionCryptoDateFamilyMatrix = async (input: {
  client: Pick<OpinionClient, "listMarkets">;
  pageSize?: number;
  maxPages?: number;
}): Promise<OpinionCryptoDateFamilyMatrixResult> => {
  const inventory = await buildOpinionFamilyInventoryMap({
    client: input.client,
    ...(input.pageSize !== undefined ? { pageSize: input.pageSize } : {}),
    ...(input.maxPages !== undefined ? { maxPages: input.maxPages } : {})
  });

  const rows = inventory.classifications
    .map(toCryptoRow)
    .filter((row): row is OpinionCryptoDateFamilyRow => row !== null);
  const countsByFamily = {
    ATH_BY_DATE: 0,
    THRESHOLD_BY_DATE: 0,
    SAME_DAY_DIRECTIONAL: 0,
    PRICE_AT_CLOSE: 0,
    GENERIC_UP_DOWN: 0
  } satisfies Record<OpinionCryptoFamily, number>;
  for (const row of rows) {
    countsByFamily[row.family] += 1;
  }

  const matrixBuckets = new Map<string, {
    asset: string;
    family: OpinionCryptoFamily;
    exactDate: string | null;
    cutoffStyle: OpinionCryptoCutoffStyle;
    count: number;
    representativeMarkets: { marketId: string; title: string }[];
  }>();

  for (const row of rows) {
    const asset = row.asset ?? "unknown";
    const key = `${asset}|${row.family}|${row.exactDate ?? "none"}|${row.cutoffStyle}`;
    const bucket = matrixBuckets.get(key) ?? {
      asset,
      family: row.family,
      exactDate: row.exactDate,
      cutoffStyle: row.cutoffStyle,
      count: 0,
      representativeMarkets: []
    };
    bucket.count += 1;
    if (bucket.representativeMarkets.length < 5) {
      bucket.representativeMarkets.push({
        marketId: row.marketId,
        title: row.title
      });
    }
    matrixBuckets.set(key, bucket);
  }

  const matrix = [...matrixBuckets.values()].sort((left, right) =>
    left.asset.localeCompare(right.asset)
    || left.family.localeCompare(right.family)
    || String(left.exactDate).localeCompare(String(right.exactDate))
    || left.cutoffStyle.localeCompare(right.cutoffStyle)
  );

  const btcTargetableDates = matrix
    .filter((row) => row.asset === "bitcoin" && row.exactDate !== null)
    .map((row) => ({
      family: row.family,
      exactDate: row.exactDate!,
      cutoffStyle: row.cutoffStyle,
      count: row.count,
      representativeMarkets: row.representativeMarkets
    }));

  return {
    summary: {
      observedAt: new Date().toISOString(),
      metadataVersion: METADATA_VERSION,
      scannedCryptoMarketCount: rows.length,
      countsByFamily,
      btcTargetableDates,
      matrix
    },
    rows
  };
};
