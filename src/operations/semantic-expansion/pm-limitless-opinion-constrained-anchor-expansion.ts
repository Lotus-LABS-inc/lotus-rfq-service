import type { Pool } from "pg";

import { buildStableTextId, buildStableUuid } from "../../canonical/canonicalization-types.js";
import { OpinionClient } from "../../integrations/opinion/opinion-client.js";
import {
  buildOpinionFamilyInventoryMap,
  type OpinionFamilyInventoryClassification,
  type OpinionFamilyInventorySummary
} from "../../integrations/opinion/opinion-family-inventory-map.js";
import { classifyStructuredOpinionFamily } from "../../integrations/opinion/opinion-family-classifier.js";
import { buildCrossVenueMatchReport } from "./cross-venue-match-report.js";
import {
  buildExactDateSeedSearch,
  buildSeedSourceText,
  indexInventoryByKey,
  type ExactSeedDefinition,
  type MissingPairFamily
} from "./exact-seed-shared.js";
import { loadPmLimitlessRouteableAnchorSeeds } from "./pm-limitless-anchor-seeds.js";
import {
  loadSemanticExpansionInventory,
  type CrossVenueMatchReport,
  type SemanticExpansionInventoryRow
} from "./shared.js";
import { writeArtifact } from "./shared.js";

type InScopeCategory = "CRYPTO" | "SPORTS" | "ESPORTS";

interface OpinionSupportDecision {
  supported: boolean;
  reason: string;
}

export interface OpinionConstrainedAnchorExpansionSummary {
  observedAt: string;
  metadataVersion: string;
  baselineSeedCount: number;
  addedSeedCount: number;
  totalSeedCount: number;
  baselineSeeds: ReadonlyArray<{
    seedReference: string;
    canonicalCategory: InScopeCategory;
    familyBucket: string;
  }>;
  addedSeeds: ReadonlyArray<{
    seedReference: string;
    canonicalCategory: InScopeCategory;
    familyBucket: string;
    supportReason: string;
    opinionFamilyCount: number;
    matchClass: string;
    memberVenueMarketIds: readonly string[];
  }>;
  excludedCandidates: ReadonlyArray<{
    seedReference: string;
    canonicalCategory: InScopeCategory;
    familyBucket: string;
    exclusionReason: string;
    opinionFamilyCount: number;
    matchClass: string;
  }>;
}

const METADATA_VERSION = "pm-limitless-opinion-constrained-anchor-expansion-v1";
const DEFAULT_FAMILY_SUMMARY_PATH = "docs/opinion-family-inventory-summary.json";
const DEFAULT_EXPANSION_SUMMARY_PATH = "docs/opinion-constrained-anchor-expansion-summary.json";
const TARGET_PAIR_FAMILIES: readonly MissingPairFamily[] = [
  "POLYMARKET_OPINION",
  "LIMITLESS_OPINION"
];

const inScopeCategory = (value: string): value is InScopeCategory =>
  value === "CRYPTO" || value === "SPORTS" || value === "ESPORTS";

const normalizeCompetitionValue = (value: string | null): string | null =>
  value?.replace(/\b20\d{2}\b/g, "").replace(/\s+/g, " ").trim() || null;

const buildSeedFromRows = (input: {
  left: SemanticExpansionInventoryRow;
  right: SemanticExpansionInventoryRow;
  matchClass: string;
}): ExactSeedDefinition => {
  const sortedRows = [input.left, input.right].sort((left, right) => left.venue.localeCompare(right.venue));
  const memberVenueMarketIds = sortedRows
    .map((row) => `${row.venue}:${row.venueMarketId}`)
    .sort((left, right) => left.localeCompare(right));
  const title = sortedRows.find((row) => row.title.trim().length > 0)?.title ?? `${input.left.title} | ${input.right.title}`;
  const sourceText = buildSeedSourceText({
    title,
    memberTitles: sortedRows.map((row) => row.title),
    memberRules: sortedRows.map((row) => row.rules ?? "")
  });
  const seedReference =
    input.left.canonicalMarketId !== null && input.left.canonicalMarketId === input.right.canonicalMarketId
      ? input.left.canonicalMarketId
      : buildStableTextId("pm-limitless-opinion-constrained-", memberVenueMarketIds.join("|"));
  const canonicalEventId =
    input.left.canonicalEventId === input.right.canonicalEventId
      ? input.left.canonicalEventId
      : buildStableUuid(`pm-limitless-opinion-constrained-event:${memberVenueMarketIds.join("|")}`);
  const canonicalMarketId =
    input.left.canonicalMarketId !== null && input.left.canonicalMarketId === input.right.canonicalMarketId
      ? input.left.canonicalMarketId
      : seedReference;
  const boundaryReferenceAt =
    sortedRows.find((row) => row.resolvesAt ?? row.expiresAt ?? row.publishedAt)?.resolvesAt
    ?? sortedRows.find((row) => row.resolvesAt ?? row.expiresAt ?? row.publishedAt)?.expiresAt
    ?? sortedRows.find((row) => row.resolvesAt ?? row.expiresAt ?? row.publishedAt)?.publishedAt
    ?? null;
  const canonicalCategory = input.left.canonicalCategory;

  return {
    seedReference,
    canonicalEventId,
    canonicalMarketId,
    canonicalCategory,
    title,
    sourceText,
    memberVenues: ["LIMITLESS", "POLYMARKET"],
    memberVenueMarketIds,
    targetPairFamilies: TARGET_PAIR_FAMILIES,
    boundaryReferenceAt,
    exactDateSearch: buildExactDateSeedSearch({
      canonicalCategory,
      title,
      sourceText,
      targetPairFamilies: TARGET_PAIR_FAMILIES,
      boundaryReferenceAt
    })
  };
};

const getOpinionFamilyCount = (
  summary: OpinionFamilyInventorySummary,
  category: InScopeCategory,
  familyBucket: string
): number =>
  summary.families.find((family) => family.category === category && family.familyBucket === familyBucket)?.count ?? 0;

const evaluateOpinionSupport = (input: {
  seed: ExactSeedDefinition;
  familyBucket: string;
  classifications: readonly OpinionFamilyInventoryClassification[];
}): OpinionSupportDecision => {
  const seedFamilyRows = input.classifications.filter((row) =>
    row.category === input.seed.canonicalCategory
    && row.familyBucket === input.familyBucket
  );
  if (seedFamilyRows.length === 0) {
    return {
      supported: false,
      reason: "family_absent_from_live_opinion_inventory"
    };
  }

  const parsedSeed = classifyStructuredOpinionFamily({
    category: input.seed.canonicalCategory,
    title: input.seed.title,
    rules: input.seed.sourceText,
    boundaryReferenceAt: input.seed.boundaryReferenceAt ? new Date(input.seed.boundaryReferenceAt) : null
  });

  if (input.seed.canonicalCategory === "CRYPTO") {
    const sameAsset = seedFamilyRows.some((row) => row.subject === parsedSeed.subject);
    return sameAsset
      ? { supported: true, reason: "same_asset_family_present_in_live_opinion_inventory" }
      : { supported: false, reason: "family_present_but_asset_absent_in_live_opinion_inventory" };
  }

  if (input.seed.canonicalCategory === "SPORTS" || input.seed.canonicalCategory === "ESPORTS") {
    const normalizedCompetition = normalizeCompetitionValue(parsedSeed.competitionOrContext);
    const sameCompetition = seedFamilyRows.some((row) =>
      normalizeCompetitionValue(row.competitionOrContext) === normalizedCompetition
    );
    const sameSubject = seedFamilyRows.some((row) => row.subject === parsedSeed.subject);
    if (sameCompetition || sameSubject) {
      return {
        supported: true,
        reason: sameCompetition
          ? "same_competition_family_present_in_live_opinion_inventory"
          : "same_subject_family_present_in_live_opinion_inventory"
      };
    }
    return {
      supported: false,
      reason: "family_present_but_subject_or_competition_absent_in_live_opinion_inventory"
    };
  }

  return {
    supported: false,
    reason: "category_out_of_scope"
  };
};

export const buildOpinionConstrainedAnchorSeedsFromInputs = (input: {
  baselineSeeds: readonly ExactSeedDefinition[];
  report: CrossVenueMatchReport;
  inventoryByKey: ReadonlyMap<string, SemanticExpansionInventoryRow>;
  opinionFamilySummary: OpinionFamilyInventorySummary;
  opinionFamilyClassifications: readonly OpinionFamilyInventoryClassification[];
}): {
  seeds: readonly ExactSeedDefinition[];
  summary: OpinionConstrainedAnchorExpansionSummary;
} => {
  const baselineByReference = new Map(input.baselineSeeds.map((seed) => [seed.seedReference, seed] as const));
  const baselinePairKeys = new Set(
    input.baselineSeeds.map((seed) => seed.memberVenueMarketIds.slice().sort((left, right) => left.localeCompare(right)).join("|"))
  );
  const addedSeeds: Array<OpinionConstrainedAnchorExpansionSummary["addedSeeds"][number]> = [];
  const excludedCandidates: Array<OpinionConstrainedAnchorExpansionSummary["excludedCandidates"][number]> = [];
  const allSeeds = [...input.baselineSeeds];

  for (const match of input.report.matches) {
    const venues = [...match.venueSet].sort((left, right) => left.localeCompare(right));
    if (venues.length !== 2 || venues[0] !== "LIMITLESS" || venues[1] !== "POLYMARKET") {
      continue;
    }
    if (match.matchClass !== "semantic_exact_historical_qualified" && match.matchClass !== "semantic_exact_live_only" && match.matchClass !== "semantic_near_exact") {
      continue;
    }
    if (!inScopeCategory(match.category)) {
      continue;
    }
    const left = input.inventoryByKey.get(`${match.seed.venue}:${match.seed.venueMarketId}`);
    const right = input.inventoryByKey.get(`${match.candidate.venue}:${match.candidate.venueMarketId}`);
    if (!left || !right) {
      continue;
    }
    const seed = buildSeedFromRows({
      left,
      right,
      matchClass: match.matchClass
    });
    const pairKey = seed.memberVenueMarketIds.slice().sort((a, b) => a.localeCompare(b)).join("|");
    if (baselinePairKeys.has(pairKey) || baselineByReference.has(seed.seedReference)) {
      continue;
    }
    const family = classifyStructuredOpinionFamily({
      category: seed.canonicalCategory,
      title: seed.title,
      rules: seed.sourceText,
      boundaryReferenceAt: seed.boundaryReferenceAt ? new Date(seed.boundaryReferenceAt) : null
    });
    const familyCount = getOpinionFamilyCount(input.opinionFamilySummary, seed.canonicalCategory as InScopeCategory, family.familyBucket);
    const support = evaluateOpinionSupport({
      seed,
      familyBucket: family.familyBucket,
      classifications: input.opinionFamilyClassifications
    });

    if (!support.supported) {
      excludedCandidates.push({
        seedReference: seed.seedReference,
        canonicalCategory: seed.canonicalCategory as InScopeCategory,
        familyBucket: family.familyBucket,
        exclusionReason: support.reason,
        opinionFamilyCount: familyCount,
        matchClass: match.matchClass
      });
      continue;
    }

    allSeeds.push(seed);
    addedSeeds.push({
      seedReference: seed.seedReference,
      canonicalCategory: seed.canonicalCategory as InScopeCategory,
      familyBucket: family.familyBucket,
      supportReason: support.reason,
      opinionFamilyCount: familyCount,
      matchClass: match.matchClass,
      memberVenueMarketIds: seed.memberVenueMarketIds
    });
  }

  return {
    seeds: allSeeds.sort((left, right) =>
      left.canonicalCategory.localeCompare(right.canonicalCategory)
      || left.title.localeCompare(right.title)
      || left.seedReference.localeCompare(right.seedReference)
    ),
    summary: {
      observedAt: new Date().toISOString(),
      metadataVersion: METADATA_VERSION,
      baselineSeedCount: input.baselineSeeds.length,
      addedSeedCount: addedSeeds.length,
      totalSeedCount: allSeeds.length,
      baselineSeeds: input.baselineSeeds.map((seed) => {
        const family = classifyStructuredOpinionFamily({
          category: seed.canonicalCategory,
          title: seed.title,
          rules: seed.sourceText,
          boundaryReferenceAt: seed.boundaryReferenceAt ? new Date(seed.boundaryReferenceAt) : null
        });
        return {
          seedReference: seed.seedReference,
          canonicalCategory: seed.canonicalCategory as InScopeCategory,
          familyBucket: family.familyBucket
        };
      }),
      addedSeeds: addedSeeds.sort((left, right) => left.seedReference.localeCompare(right.seedReference)),
      excludedCandidates: excludedCandidates.sort((left, right) => left.seedReference.localeCompare(right.seedReference))
    }
  };
};

export const loadPmLimitlessOpinionConstrainedAnchorSeeds = async (input: {
  repoRoot: string;
  pool: Pool;
  opinionBaseUrl: string;
  opinionApiKey: string;
  pageSize?: number;
  maxPages?: number;
  familySummaryOutputPath?: string;
  expansionSummaryOutputPath?: string;
}): Promise<readonly ExactSeedDefinition[]> => {
  const client = new OpinionClient({
    baseUrl: input.opinionBaseUrl,
    apiKey: input.opinionApiKey
  });
  const familyMap = await buildOpinionFamilyInventoryMap({
    client,
    ...(input.pageSize !== undefined ? { pageSize: input.pageSize } : {}),
    ...(input.maxPages !== undefined ? { maxPages: input.maxPages } : {})
  });
  writeArtifact(input.repoRoot, input.familySummaryOutputPath ?? DEFAULT_FAMILY_SUMMARY_PATH, familyMap.summary);

  const [baselineSeeds, inventory, report] = await Promise.all([
    loadPmLimitlessRouteableAnchorSeeds({
      pool: input.pool,
      categories: ["CRYPTO", "SPORTS", "ESPORTS"] as const
    }),
    loadSemanticExpansionInventory(input.pool),
    buildCrossVenueMatchReport(input.pool)
  ]);

  const expansion = buildOpinionConstrainedAnchorSeedsFromInputs({
    baselineSeeds,
    report,
    inventoryByKey: indexInventoryByKey(inventory),
    opinionFamilySummary: familyMap.summary,
    opinionFamilyClassifications: familyMap.classifications
  });

  writeArtifact(input.repoRoot, input.expansionSummaryOutputPath ?? DEFAULT_EXPANSION_SUMMARY_PATH, expansion.summary);
  return expansion.seeds;
};
