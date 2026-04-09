import type { SemanticEvidenceLabel } from "../operations/semantic-expansion/shared.js";

export type InventoryTemporalBasis =
  | "HISTORICAL"
  | "LIVE_CURRENT_STATE"
  | "LIVE_INVENTORY_ONLY"
  | "UNKNOWN";

export type RouteabilityTemporalBasis =
  | "HISTORICAL_ONLY"
  | "LIVE_ONLY"
  | "MIXED_BASIS"
  | "INSUFFICIENT_BASIS";

export const classifyEvidenceLabelBasis = (
  label: SemanticEvidenceLabel
): InventoryTemporalBasis =>
  label === "historical" ? "HISTORICAL"
  : label === "current_state" || label === "recorder" ? "LIVE_CURRENT_STATE"
  : label === "live_inventory_only" ? "LIVE_INVENTORY_ONLY"
  : "UNKNOWN";

export const classifyHistoricalMetadataVersionBasis = (
  metadataVersion: string
): InventoryTemporalBasis => {
  const normalized = metadataVersion.toLowerCase();
  if (normalized.includes("fallback")) {
    return "UNKNOWN";
  }
  if (normalized.includes("current") || normalized.includes("recorder") || normalized.includes("live")) {
    return normalized.includes("inventory_only") ? "LIVE_INVENTORY_ONLY" : "LIVE_CURRENT_STATE";
  }
  return "HISTORICAL";
};

export const isLiveTemporalBasis = (basis: InventoryTemporalBasis): boolean =>
  basis === "LIVE_CURRENT_STATE" || basis === "LIVE_INVENTORY_ONLY";

export const classifyRouteabilityBasis = (
  bases: readonly InventoryTemporalBasis[]
): RouteabilityTemporalBasis => {
  if (bases.length === 0 || bases.some((basis) => basis === "UNKNOWN")) {
    return "INSUFFICIENT_BASIS";
  }

  const hasHistorical = bases.includes("HISTORICAL");
  const hasLive = bases.some((basis) => isLiveTemporalBasis(basis));

  if (hasHistorical && hasLive) {
    return "MIXED_BASIS";
  }
  if (hasHistorical) {
    return "HISTORICAL_ONLY";
  }
  if (hasLive) {
    return "LIVE_ONLY";
  }
  return "INSUFFICIENT_BASIS";
};

export const summarizeBasisCounts = <T extends string>(
  values: readonly T[]
): Record<T, number> =>
  values.reduce<Record<T, number>>((accumulator, value) => {
    accumulator[value] = (accumulator[value] ?? 0) + 1;
    return accumulator;
  }, {} as Record<T, number>);
