import type { CanonicalVenue } from "../../canonical/canonicalization-types.js";
import { readArtifact } from "./shared.js";
import type { MissingPairFamily } from "./exact-seed-shared.js";

export interface SameDaySeedCatalogEntryVenue {
  marketIds?: readonly string[];
  searchAliases?: readonly string[];
}

export interface SameDaySeedCatalogEntry {
  seedReference: string;
  exactDateKey: string;
  targetPairFamilies: readonly MissingPairFamily[];
  OPINION?: SameDaySeedCatalogEntryVenue;
  PREDICT?: SameDaySeedCatalogEntryVenue;
}

export interface SameDaySeedCatalog {
  metadataVersion: string;
  entries: readonly SameDaySeedCatalogEntry[];
}

export const DEFAULT_SAME_DAY_SEED_CATALOG_PATH = "docs/same-day-exact-seed-catalog.json";

export const loadSameDaySeedCatalog = (
  repoRoot: string,
  relativePath: string = DEFAULT_SAME_DAY_SEED_CATALOG_PATH
): SameDaySeedCatalog => {
  try {
    return readArtifact<SameDaySeedCatalog>(repoRoot, relativePath);
  } catch {
    return {
      metadataVersion: "same-day-exact-seed-catalog-v1",
      entries: []
    };
  }
};

export const getCatalogEntryForSeed = (
  catalog: SameDaySeedCatalog,
  seedReference: string,
  exactDateKey: string | null
): SameDaySeedCatalogEntry | null =>
  catalog.entries.find((entry) =>
    entry.seedReference === seedReference
    || (exactDateKey !== null && entry.exactDateKey === exactDateKey)
  ) ?? null;

export const getCatalogVenueEntry = (
  entry: SameDaySeedCatalogEntry | null,
  venue: Extract<CanonicalVenue, "OPINION" | "PREDICT">
): SameDaySeedCatalogEntryVenue | null => {
  if (!entry) {
    return null;
  }
  return venue === "OPINION" ? entry.OPINION ?? null : entry.PREDICT ?? null;
};
