import type { Pool } from "pg";

import { normalizeCategory } from "../../canonical/canonicalization-types.js";
import { CanonicalGraphProjector } from "../../canonical/canonical-graph-projector.js";
import { CanonicalCompatibilityProjector } from "../../canonical/canonical-compatibility-projector.js";
import { CuratedCanonicalGraphSnapshotBuilder, type CuratedCanonicalGraphSeed } from "../../canonical/curated-canonical-graph.js";
import { HistoricalMarketClass, type CreateHistoricalMarketStateInput } from "../../core/historical-simulation/historical-simulation.types.js";
import { PredictClient, PredictClientError } from "../../integrations/predict/predict-client.js";
import { PredictMarketAdapter } from "../../integrations/predict/predict-market-adapter.js";
import { PredictOrderbookAdapter } from "../../integrations/predict/predict-orderbook-adapter.js";
import type {
  PredictEnvironment,
  PredictNormalizedMarket,
  PredictNormalizedOrderbookSnapshot
} from "../../integrations/predict/predict-types.js";
import { CanonicalCompatibilityRepository } from "../../repositories/canonical-compatibility.repository.js";
import { CanonicalGraphRepository } from "../../repositories/canonical-graph.repository.js";
import { CompatibilityVersionRepository } from "../../repositories/compatibility-version.repository.js";
import { HistoricalMarketStateRepository } from "../../repositories/historical-market-state.repository.js";
import { PredictBootstrapRepository } from "../../repositories/predict-bootstrap.repository.js";
import { PredictReadinessRepository } from "../../repositories/predict-readiness.repository.js";
import {
  canLooseMatchCategoryText,
  compareStructuredPropositions,
  parseStructuredProposition,
  type PropositionComparison
} from "../../simulation/proposition-matching.js";
import {
  buildExactDateCandidateStatus,
  loadExactSeedDefinitions,
  buildAcquisitionTargetFamilies,
  isSeedRelevantToVenue,
  toHistoricalCanonicalCategory,
  toSupportedSemanticCategory,
  type ExactSeedDefinition
} from "./exact-seed-shared.js";
import { runPredictFocusedEvidence } from "./predict-focused-evidence.js";
import {
  DEFAULT_SAME_DAY_SEED_CATALOG_PATH,
  getCatalogEntryForSeed,
  getCatalogVenueEntry,
  loadSameDaySeedCatalog
} from "./same-day-seed-catalog.js";
import { writeArtifact } from "./shared.js";

const metadataVersion = "predict-exact-seed-acquisition-v1";

interface CandidateSelection {
  market: PredictNormalizedMarket;
  comparison: PropositionComparison;
  targetPairFamilies: readonly string[];
  exactDateStatus: "exact_date_found" | "wrong_date_same_family" | "not_exact_date_searchable" | "no_day_boundary_match";
}

export interface PredictExactSeedAcquisitionSummary {
  observedAt: string;
  metadataVersion: string;
  environment: PredictEnvironment;
  selectedSeedCount: number;
  scannedMarketCount: number;
  acquiredMarketCount: number;
  canonicalSeeds: number;
  metadataUpserts: number;
  orderbookSnapshotsPersisted: number;
  historicalStatesInserted: number;
  historicalStatesSkipped: number;
  focusedEvidence: Awaited<ReturnType<typeof runPredictFocusedEvidence>>;
  readinessByMarket: ReadonlyArray<{
    marketId: string;
    status: string;
    historicalQualified: boolean;
    reason: string | null;
  }>;
  attempts: ReadonlyArray<{
    seedReference: string;
    category: ExactSeedDefinition["canonicalCategory"];
    targetPairFamilies: readonly string[];
    selectedCandidateCount: number;
    selectedCandidates: ReadonlyArray<{
      marketId: string;
      title: string;
      classification: PropositionComparison["classification"];
      matchScore: number;
      failedDimensions: readonly string[];
      targetPairFamilies: readonly string[];
      exactDateStatus: CandidateSelection["exactDateStatus"];
    }>;
  }>;
}

const rankCandidate = (comparison: PropositionComparison): number => {
  const classificationScore =
    comparison.classification === "semantic_exact_historical_qualified" ? 4
    : comparison.classification === "semantic_exact_live_only" ? 3
    : comparison.classification === "semantic_near_exact" ? 2
    : comparison.classification === "proxy_or_mismatch" ? 1
    : 0;
  return classificationScore * 10 + comparison.matchScore;
};

const rankExactDateStatus = (status: CandidateSelection["exactDateStatus"]): number =>
  status === "exact_date_found" ? 3
  : status === "wrong_date_same_family" ? 2
  : status === "no_day_boundary_match" ? 1
  : 0;

const selectCandidatesForSeed = (
  seed: ExactSeedDefinition,
  markets: readonly PredictNormalizedMarket[]
): readonly CandidateSelection[] => {
  const semanticCategory = toSupportedSemanticCategory(seed.canonicalCategory);
  const parsedSeed = parseStructuredProposition({
    category: semanticCategory,
    title: seed.title,
    rules: seed.sourceText,
    boundaryReferenceAt: seed.boundaryReferenceAt ? new Date(seed.boundaryReferenceAt) : null
  });

  return markets
    .filter((market) => canLooseMatchCategoryText(semanticCategory, `${market.title} ${market.description ?? ""}`.trim()))
    .map((market) => {
      const exactDateStatus = buildExactDateCandidateStatus({
        seed,
        candidateTitle: market.title,
        candidateRules: market.description,
        boundaryReferenceAt: market.closesAt ?? market.resolvesAt ?? market.createdAt ?? null
      });
      const comparison = compareStructuredPropositions({
        seed: parsedSeed,
        candidate: parseStructuredProposition({
          category: semanticCategory,
          title: market.title,
          rules: market.description,
          boundaryReferenceAt: market.closesAt ?? market.resolvesAt ?? market.createdAt ?? null
        }),
        historyQualified: false,
        requireHistoricalQualification: false
      });
      return {
        market,
        comparison,
        targetPairFamilies: buildAcquisitionTargetFamilies(seed, "PREDICT"),
        exactDateStatus
      };
    })
    .filter((entry) =>
      entry.comparison.classification === "semantic_exact_historical_qualified"
      || entry.comparison.classification === "semantic_exact_live_only"
      || entry.comparison.classification === "semantic_near_exact"
    )
    .sort((left, right) =>
      rankExactDateStatus(right.exactDateStatus) - rankExactDateStatus(left.exactDateStatus)
      || rankCandidate(right.comparison) - rankCandidate(left.comparison)
      || left.market.venueMarketId.localeCompare(right.market.venueMarketId)
    )
    .slice(0, 3);
};

const toHistoricalState = (
  market: PredictNormalizedMarket,
  seed: CuratedCanonicalGraphSeed,
  orderbook: PredictNormalizedOrderbookSnapshot | null,
  fetchedAt: Date,
  seedReferences: readonly string[],
  targetPairFamilies: readonly string[]
): CreateHistoricalMarketStateInput => ({
  canonicalEventId: seed.canonicalEventId,
  canonicalMarketId: seed.canonicalMarketId,
  canonicalCategory: toHistoricalCanonicalCategory(normalizeCategory(seed.canonicalCategory)),
  venue: "PREDICT",
  venueMarketId: market.venueMarketId,
  marketClass: HistoricalMarketClass.BINARY,
  timestamp: fetchedAt,
  midpoint: orderbook?.midpoint ?? null,
  bestBid: orderbook?.bestBid ?? null,
  bestAsk: orderbook?.bestAsk ?? null,
  spread: orderbook?.spread ?? null,
  lastPrice: market.lastSale?.price ?? null,
  volume: market.statistics?.volume ?? null,
  openInterest: market.statistics?.openInterest ?? null,
  orderbookSnapshot: orderbook
    ? {
        source: "predict_exact_seed_acquisition",
        environment: market.environment,
        acquisitionSeedRefs: seedReferences,
        targetPairFamilies,
        bestBid: orderbook.bestBid,
        bestAsk: orderbook.bestAsk,
        midpoint: orderbook.midpoint,
        spread: orderbook.spread,
        topOfBookSize: orderbook.topOfBookSize,
        raw: orderbook.raw
      }
    : {
        source: "predict_exact_seed_acquisition",
        environment: market.environment,
        acquisitionSeedRefs: seedReferences,
        targetPairFamilies,
        orderbookUnavailable: true
      },
  marketEvents: {
    source: "predict_exact_seed_acquisition",
    acquisitionSeedRefs: seedReferences,
    targetPairFamilies,
    status: market.status
  },
  metadataVersion,
  sourceTimestamp: orderbook?.sourceTimestamp ?? fetchedAt
});

const listCandidateMarkets = async (
  client: PredictClient,
  adapter: PredictMarketAdapter,
  pageSize: number,
  maxPages: number
): Promise<readonly PredictNormalizedMarket[]> => {
  const aggregated: PredictNormalizedMarket[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const batch = await client.getMarkets({ page, limit: pageSize });
    if (batch.length === 0) {
      break;
    }
    const enriched = await Promise.all(
      batch.map((market) => adapter.getMarketById(String(market.id)))
    );
    aggregated.push(...enriched);
    if (batch.length < pageSize) {
      break;
    }
  }
  return [...new Map(aggregated.map((market) => [market.venueMarketId, market])).values()];
};

export const runPredictExactSeedAcquisition = async (input: {
  repoRoot: string;
  pool: Pool;
  environment: PredictEnvironment;
  apiKey: string;
  pageSize?: number;
  maxPages?: number;
  sameDayOnly?: boolean;
  catalogPath?: string;
}): Promise<PredictExactSeedAcquisitionSummary> => {
  const seeds = (await loadExactSeedDefinitions(input.pool)).filter((seed) => isSeedRelevantToVenue(seed, "PREDICT"));
  const catalog = input.sameDayOnly
    ? loadSameDaySeedCatalog(input.repoRoot, input.catalogPath ?? DEFAULT_SAME_DAY_SEED_CATALOG_PATH)
    : null;
  const client = new PredictClient({
    environment: input.environment,
    apiKey: input.apiKey
  });
  const marketAdapter = new PredictMarketAdapter({
    client,
    environment: input.environment,
    metadataVersion
  });
  const orderbookAdapter = new PredictOrderbookAdapter({
    client,
    environment: input.environment
  });

  const allMarkets = await listCandidateMarkets(
    client,
    marketAdapter,
    input.pageSize ?? 50,
    input.maxPages ?? 10
  );

  const curatedMarketCache = new Map<string, PredictNormalizedMarket>();
  const attempts = [];
  for (const seed of seeds) {
    const catalogEntry = catalog ? getCatalogEntryForSeed(catalog, seed.seedReference, seed.exactDateSearch?.exactDateKey ?? null) : null;
    const catalogVenueEntry = getCatalogVenueEntry(catalogEntry, "PREDICT");
    if (catalogVenueEntry?.marketIds?.length) {
      for (const marketId of catalogVenueEntry.marketIds) {
        if (curatedMarketCache.has(marketId)) {
          continue;
        }
        try {
          curatedMarketCache.set(marketId, await marketAdapter.getMarketById(marketId));
        } catch {
          // Keep the acquisition fail-closed and visible in downstream reports.
        }
      }
    }
    const candidatePool = [
      ...allMarkets,
      ...[...curatedMarketCache.values()].filter((market) => catalogVenueEntry?.marketIds?.includes(market.venueMarketId))
    ];
    attempts.push({
      seedReference: seed.seedReference,
      category: seed.canonicalCategory,
      targetPairFamilies: seed.targetPairFamilies.filter((family) => family.includes("PREDICT")),
      selected: selectCandidatesForSeed(seed, [...new Map(candidatePool.map((market) => [market.venueMarketId, market] as const)).values()])
    });
  }

  const selectedByMarketId = new Map<string, {
    market: PredictNormalizedMarket;
    seedReferences: string[];
    targetPairFamilies: Set<string>;
    exactDateStatus: CandidateSelection["exactDateStatus"];
  }>();
  for (const attempt of attempts) {
    for (const entry of attempt.selected) {
      if (input.sameDayOnly && entry.exactDateStatus !== "exact_date_found") {
        continue;
      }
      const existing = selectedByMarketId.get(entry.market.venueMarketId);
      if (existing) {
        existing.seedReferences.push(attempt.seedReference);
        for (const family of entry.targetPairFamilies) {
          existing.targetPairFamilies.add(family);
        }
        if (rankExactDateStatus(entry.exactDateStatus) > rankExactDateStatus(existing.exactDateStatus)) {
          existing.exactDateStatus = entry.exactDateStatus;
        }
      } else {
        selectedByMarketId.set(entry.market.venueMarketId, {
          market: entry.market,
          seedReferences: [attempt.seedReference],
          targetPairFamilies: new Set(entry.targetPairFamilies),
          exactDateStatus: entry.exactDateStatus
        });
      }
    }
  }

  const selectedMarkets = [...selectedByMarketId.values()].map(({ market, seedReferences, targetPairFamilies, exactDateStatus }) => ({
    market: {
      ...market,
      raw: {
        ...market.raw,
        exactSeedAcquisition: true,
        exactDateAcquisition: exactDateStatus === "exact_date_found",
        exactDateStatus,
        exactDateKey: seeds.find((candidateSeed) => seedReferences.includes(candidateSeed.seedReference))?.exactDateSearch?.exactDateKey ?? null,
        sameDayTargetedIngestion: input.sameDayOnly === true,
        sourcePolicy: input.sameDayOnly === true ? "api_plus_curated" : "api_only",
        curatedFallbackUsed: catalog?.entries.some((entry) => entry.PREDICT?.marketIds?.includes(market.venueMarketId)) ?? false,
        acquisitionSeedRefs: seedReferences,
        targetPairFamilies: [...targetPairFamilies]
      }
    },
    seedReferences,
    targetPairFamilies: [...targetPairFamilies].sort((left, right) => left.localeCompare(right)),
    exactDateStatus
  }));

  const fetchedAt = new Date();
  const orderbookResults = await Promise.all(
    selectedMarkets.map(async ({ market }) => {
      try {
        return [market.venueMarketId, await orderbookAdapter.getOrderbookSnapshot(market.venueMarketId)] as const;
      } catch (error) {
        if (error instanceof PredictClientError && error.status === 404) {
          return [market.venueMarketId, null] as const;
        }
        return [market.venueMarketId, null] as const;
      }
    })
  );
  const orderbookByMarketId = new Map<string, PredictNormalizedOrderbookSnapshot | null>(orderbookResults);
  const canonicalSeeds = selectedMarkets.map(({ market, seedReferences, targetPairFamilies, exactDateStatus }) => {
    const seed = marketAdapter.buildCanonicalSeed({ market });
    return {
      ...seed,
      rawSourcePayload: {
        ...seed.rawSourcePayload,
        exactSeedAcquisition: true,
        exactDateAcquisition: exactDateStatus === "exact_date_found",
        exactDateStatus,
        exactDateKey: seeds.find((candidateSeed) => seedReferences.includes(candidateSeed.seedReference))?.exactDateSearch?.exactDateKey ?? null,
        sameDayTargetedIngestion: input.sameDayOnly === true,
        sourcePolicy: input.sameDayOnly === true ? "api_plus_curated" : "api_only",
        curatedFallbackUsed: catalog?.entries.some((entry) => entry.PREDICT?.marketIds?.includes(market.venueMarketId)) ?? false,
        acquisitionSeedRefs: seedReferences,
        targetPairFamilies
      },
      normalizedPayload: {
        ...seed.normalizedPayload,
        exactSeedAcquisition: true,
        exactDateAcquisition: exactDateStatus === "exact_date_found",
        exactDateStatus,
        exactDateKey: seeds.find((candidateSeed) => seedReferences.includes(candidateSeed.seedReference))?.exactDateSearch?.exactDateKey ?? null,
        sameDayTargetedIngestion: input.sameDayOnly === true,
        sourcePolicy: input.sameDayOnly === true ? "api_plus_curated" : "api_only",
        curatedFallbackUsed: catalog?.entries.some((entry) => entry.PREDICT?.marketIds?.includes(market.venueMarketId)) ?? false,
        acquisitionSeedRefs: seedReferences,
        targetPairFamilies
      },
      mappingLineage: [...(seed.mappingLineage ?? []), "predict-exact-seed-acquisition"],
      sourceMetadataVersion: metadataVersion,
      executableMetadata: {
        ...(seed.executableMetadata ?? {}),
        exactSeedAcquisition: true,
        exactDateAcquisition: exactDateStatus === "exact_date_found",
        exactDateStatus,
        exactDateKey: seeds.find((candidateSeed) => seedReferences.includes(candidateSeed.seedReference))?.exactDateSearch?.exactDateKey ?? null,
        sameDayTargetedIngestion: input.sameDayOnly === true,
        sourcePolicy: input.sameDayOnly === true ? "api_plus_curated" : "api_only",
        curatedFallbackUsed: catalog?.entries.some((entry) => entry.PREDICT?.marketIds?.includes(market.venueMarketId)) ?? false,
        targetPairFamilies
      }
    } satisfies CuratedCanonicalGraphSeed;
  });
  const seedByMarketId = new Map(canonicalSeeds.map((seed) => [seed.venueMarketId, seed] as const));
  const historicalStates = selectedMarkets.map(({ market, seedReferences, targetPairFamilies }) =>
    toHistoricalState(
      market,
      seedByMarketId.get(market.venueMarketId)!,
      orderbookByMarketId.get(market.venueMarketId) ?? null,
      fetchedAt,
      seedReferences,
      targetPairFamilies
    )
  );

  const projector = new CanonicalGraphProjector(
    new CanonicalGraphRepository(input.pool),
    new CanonicalCompatibilityProjector(
      new CanonicalCompatibilityRepository(input.pool),
      new CompatibilityVersionRepository(input.pool)
    )
  );
  const snapshotBuilder = new CuratedCanonicalGraphSnapshotBuilder();
  const bootstrapRepository = new PredictBootstrapRepository(input.pool);
  const historicalRepository = new HistoricalMarketStateRepository(input.pool);

  if (selectedMarkets.length > 0) {
    await input.pool.query(
      `DELETE FROM historical_market_states
        WHERE venue = 'PREDICT'
          AND metadata_version = $1
          AND venue_market_id = ANY($2::text[])`,
      [metadataVersion, selectedMarkets.map((entry) => entry.market.venueMarketId)]
    );
    await projector.persistAndProject(snapshotBuilder.build(canonicalSeeds));
  }

  const metadataUpserts = await bootstrapRepository.upsertMarketMetadata(selectedMarkets.map((entry) => entry.market));
  const orderbookSnapshotsPersisted = await bootstrapRepository.insertOrderbookSnapshots(
    [...orderbookByMarketId.values()]
      .filter((snapshot): snapshot is PredictNormalizedOrderbookSnapshot => snapshot !== null)
      .map((snapshot) => PredictBootstrapRepository.toPersistedOrderbookSnapshot(snapshot))
  );
  const historicalInsertResult = await historicalRepository.insertManyIgnoreDuplicates(historicalStates);

  const focusedEvidence = await runPredictFocusedEvidence({
    repoRoot: input.repoRoot,
    pool: input.pool,
    environment: input.environment,
    marketIds: selectedMarkets.map((entry) => entry.market.venueMarketId)
  });
  const readinessRepository = new PredictReadinessRepository(input.pool);
  const readinessByMarketMap = await readinessRepository.summarizeReadinessByMarketIds({
    marketIds: selectedMarkets.map((entry) => entry.market.venueMarketId)
  });

  const summary: PredictExactSeedAcquisitionSummary = {
    observedAt: fetchedAt.toISOString(),
    metadataVersion,
    environment: input.environment,
    selectedSeedCount: seeds.length,
    scannedMarketCount: allMarkets.length,
    acquiredMarketCount: selectedMarkets.length,
    canonicalSeeds: canonicalSeeds.length,
    metadataUpserts,
    orderbookSnapshotsPersisted,
    historicalStatesInserted: historicalInsertResult.inserted,
    historicalStatesSkipped: historicalInsertResult.skipped,
    focusedEvidence,
    readinessByMarket: selectedMarkets.map(({ market }) => {
      const readiness = readinessByMarketMap.get(market.venueMarketId);
      return {
        marketId: market.venueMarketId,
        status: readiness?.state ?? "UNUSABLE",
        historicalQualified: readiness?.historicalQualified ?? false,
        reason: readiness?.reason ?? null
      };
    }),
    attempts: attempts.map((attempt) => ({
      seedReference: attempt.seedReference,
      category: attempt.category,
      targetPairFamilies: attempt.targetPairFamilies,
      selectedCandidateCount: attempt.selected.length,
      selectedCandidates: attempt.selected.map((entry) => ({
        marketId: entry.market.venueMarketId,
        title: entry.market.title,
        classification: entry.comparison.classification,
        matchScore: entry.comparison.matchScore,
        failedDimensions: entry.comparison.failedDimensions,
        targetPairFamilies: entry.targetPairFamilies,
        exactDateStatus: entry.exactDateStatus
      }))
    }))
  };

  writeArtifact(input.repoRoot, "docs/predict-exact-seed-acquisition-summary.json", summary);
  return summary;
};
