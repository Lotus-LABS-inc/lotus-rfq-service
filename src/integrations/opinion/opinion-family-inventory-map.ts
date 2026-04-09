import { OpinionMarketAdapter } from "./opinion-market-adapter.js";
import type { OpinionClient } from "./opinion-client.js";
import {
  classifyOpinionMarketFamily,
  type OpinionFamilyBucket,
  type OpinionFamilyCategory,
  type OpinionFamilyClassification,
  type OpinionTimeBoundaryPattern
} from "./opinion-family-classifier.js";
import type { OpinionNormalizedMarket } from "./opinion-types.js";

export interface OpinionFamilyInventoryClassification {
  marketId: string;
  title: string;
  category: OpinionFamilyCategory;
  familyBucket: OpinionFamilyBucket;
  subject: string | null;
  competitionOrContext: string | null;
  threshold: string | null;
  deadlineOrSeason: string | null;
  timeBoundaryPattern: OpinionTimeBoundaryPattern;
  structureType: OpinionFamilyClassification["structureType"];
}

export interface OpinionFamilyInventorySummary {
  observedAt: string;
  metadataVersion: string;
  scannedMarketCount: number;
  countsByCategory: Record<OpinionFamilyCategory, number>;
  countsByFamily: Record<OpinionFamilyBucket, number>;
  families: ReadonlyArray<{
    category: OpinionFamilyCategory;
    familyBucket: OpinionFamilyBucket;
    count: number;
    representativeExamples: readonly { marketId: string; title: string }[];
    entitiesOrAssets: readonly string[];
    competitionContexts: readonly string[];
    timeBoundaryPatterns: readonly OpinionTimeBoundaryPattern[];
  }>;
}

export interface OpinionFamilyInventoryMapResult {
  summary: OpinionFamilyInventorySummary;
  classifications: readonly OpinionFamilyInventoryClassification[];
}

const METADATA_VERSION = "opinion-family-inventory-map-v1";
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 50;

const dedupeSort = (values: readonly string[]): readonly string[] =>
  [...new Set(values.filter((value) => value.trim().length > 0))].sort((left, right) => left.localeCompare(right));

const buildClassification = (
  market: OpinionNormalizedMarket,
  adapter: OpinionMarketAdapter
): OpinionFamilyInventoryClassification => {
  const category = adapter.inferCanonicalCategory(market) as OpinionFamilyCategory;
  const family = classifyOpinionMarketFamily(market, category);
  return {
    marketId: market.venueMarketId,
    title: market.title,
    category: family.category,
    familyBucket: family.familyBucket,
    subject: family.subject,
    competitionOrContext: family.competitionOrContext,
    threshold: family.threshold,
    deadlineOrSeason: family.deadlineOrSeason,
    timeBoundaryPattern: family.timeBoundaryPattern,
    structureType: family.structureType
  };
};

export const buildOpinionFamilyInventoryMap = async (input: {
  client: Pick<OpinionClient, "listMarkets">;
  metadataVersion?: string;
  pageSize?: number;
  maxPages?: number;
}): Promise<OpinionFamilyInventoryMapResult> => {
  const adapter = new OpinionMarketAdapter({
    client: input.client,
    metadataVersion: input.metadataVersion ?? METADATA_VERSION
  });
  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = input.maxPages ?? DEFAULT_MAX_PAGES;
  const markets: OpinionNormalizedMarket[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const batch = await adapter.listMarkets({ page, limit: pageSize });
    if (batch.length === 0) {
      break;
    }
    markets.push(...batch);
  }

  const classifications = markets.map((market) => buildClassification(market, adapter));
  const countsByCategory: Record<OpinionFamilyCategory, number> = {
    CRYPTO: 0,
    SPORTS: 0,
    ESPORTS: 0,
    OTHER: 0
  };
  const countsByFamily: Record<OpinionFamilyBucket, number> = {
    ATH_BY_DATE: 0,
    THRESHOLD_BY_DATE: 0,
    SAME_DAY_DIRECTIONAL: 0,
    PRICE_AT_CLOSE: 0,
    GENERIC_UP_DOWN: 0,
    MATCHUP_WINNER: 0,
    CHAMPIONSHIP_WINNER: 0,
    SEASON_WINNER: 0,
    TOURNAMENT_WINNER: 0,
    SPLIT_WINNER: 0,
    LEAGUE_WINNER: 0,
    OTHER: 0
  };

  const families = new Map<string, {
    category: OpinionFamilyCategory;
    familyBucket: OpinionFamilyBucket;
    count: number;
    representativeExamples: { marketId: string; title: string }[];
    entitiesOrAssets: string[];
    competitionContexts: string[];
    timeBoundaryPatterns: Set<OpinionTimeBoundaryPattern>;
  }>();

  for (const row of classifications) {
    countsByCategory[row.category] += 1;
    countsByFamily[row.familyBucket] += 1;
    const key = `${row.category}:${row.familyBucket}`;
    const family = families.get(key) ?? {
      category: row.category,
      familyBucket: row.familyBucket,
      count: 0,
      representativeExamples: [],
      entitiesOrAssets: [],
      competitionContexts: [],
      timeBoundaryPatterns: new Set<OpinionTimeBoundaryPattern>()
    };
    family.count += 1;
    if (family.representativeExamples.length < 5) {
      family.representativeExamples.push({
        marketId: row.marketId,
        title: row.title
      });
    }
    if (row.subject) {
      family.entitiesOrAssets.push(row.subject);
    }
    if (row.competitionOrContext) {
      family.competitionContexts.push(row.competitionOrContext);
    }
    family.timeBoundaryPatterns.add(row.timeBoundaryPattern);
    families.set(key, family);
  }

  return {
    summary: {
      observedAt: new Date().toISOString(),
      metadataVersion: input.metadataVersion ?? METADATA_VERSION,
      scannedMarketCount: classifications.length,
      countsByCategory,
      countsByFamily,
      families: [...families.values()]
        .sort((left, right) =>
          left.category.localeCompare(right.category)
          || left.familyBucket.localeCompare(right.familyBucket)
        )
        .map((family) => ({
          category: family.category,
          familyBucket: family.familyBucket,
          count: family.count,
          representativeExamples: family.representativeExamples,
          entitiesOrAssets: dedupeSort(family.entitiesOrAssets),
          competitionContexts: dedupeSort(family.competitionContexts),
          timeBoundaryPatterns: [...family.timeBoundaryPatterns].sort((left, right) => left.localeCompare(right))
        }))
    },
    classifications
  };
};
