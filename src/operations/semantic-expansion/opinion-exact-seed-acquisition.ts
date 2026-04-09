import type { Pool } from "pg";

import { normalizeCategory } from "../../canonical/canonicalization-types.js";
import { CanonicalGraphProjector } from "../../canonical/canonical-graph-projector.js";
import { CanonicalCompatibilityProjector } from "../../canonical/canonical-compatibility-projector.js";
import { CuratedCanonicalGraphSnapshotBuilder, type CuratedCanonicalGraphSeed } from "../../canonical/curated-canonical-graph.js";
import { HistoricalMarketClass, type CreateHistoricalMarketStateInput } from "../../core/historical-simulation/historical-simulation.types.js";
import { OpinionClient } from "../../integrations/opinion/opinion-client.js";
import { OpinionMarketAdapter } from "../../integrations/opinion/opinion-market-adapter.js";
import type { OpinionNormalizedMarket } from "../../integrations/opinion/opinion-types.js";
import { CanonicalCompatibilityRepository } from "../../repositories/canonical-compatibility.repository.js";
import { CanonicalGraphRepository } from "../../repositories/canonical-graph.repository.js";
import { CompatibilityVersionRepository } from "../../repositories/compatibility-version.repository.js";
import { HistoricalMarketStateRepository } from "../../repositories/historical-market-state.repository.js";
import {
  canLooseMatchCategoryText,
  compareStructuredPropositions,
  parseStructuredProposition,
  type PropositionComparison,
  type StructuredProposition
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
import { loadPmLimitlessRouteableAnchorSeeds } from "./pm-limitless-anchor-seeds.js";
import { loadPmLimitlessOpinionConstrainedAnchorSeeds } from "./pm-limitless-opinion-constrained-anchor-expansion.js";
import { loadPmLimitlessCryptoDateAlignedSeeds } from "./pm-limitless-crypto-date-aligned-expansion.js";
import {
  DEFAULT_SAME_DAY_SEED_CATALOG_PATH,
  getCatalogEntryForSeed,
  getCatalogVenueEntry,
  loadSameDaySeedCatalog
} from "./same-day-seed-catalog.js";
import { writeArtifact } from "./shared.js";

const metadataVersion = "opinion-exact-seed-acquisition-v1";

interface CandidateSelection {
  market: OpinionNormalizedMarket;
  comparison: PropositionComparison;
  targetPairFamilies: readonly string[];
  exactDateStatus: "exact_date_found" | "wrong_date_same_family" | "not_exact_date_searchable" | "no_day_boundary_match";
  sourcePolicy: "live_api" | "curated_fallback" | "persisted_inventory_fallback";
  familyTemplate: string;
  sameFamily: boolean;
  familyRejectionReason: string | null;
}

export type OpinionFamilyMode = "default" | "same_family_only";

export interface OpinionExactSeedAcquisitionSummary {
  observedAt: string;
  metadataVersion: string;
  seedSource: "all_relevant" | "pm_limitless_routeable" | "pm_limitless_opinion_constrained" | "pm_limitless_crypto_date_aligned";
  liveApiFailed: boolean;
  selectedSeedCount: number;
  scannedMarketCount: number;
  acquiredMarketCount: number;
  insertedStates: number;
  skippedStates: number;
  exactCandidateCount: number;
  nearExactCandidateCount: number;
  rejectedCandidateCount: number;
  outOfFamilyIgnoredCount: number;
  attempts: ReadonlyArray<{
    seedReference: string;
    category: ExactSeedDefinition["canonicalCategory"];
    targetPairFamilies: readonly string[];
    familyTemplate: string;
    selectedCandidateCount: number;
    selectedCandidates: ReadonlyArray<{
      marketId: string;
      title: string;
      classification: PropositionComparison["classification"];
      matchScore: number;
      failedDimensions: readonly string[];
      targetPairFamilies: readonly string[];
      exactDateStatus: CandidateSelection["exactDateStatus"];
      sameFamily: boolean;
      familyTemplate: string;
    }>;
    outOfFamilyIgnoredCount: number;
    outOfFamilyIgnoredCandidates: ReadonlyArray<{
      marketId: string;
      title: string;
      familyRejectionReason: string | null;
      sourcePolicy: CandidateSelection["sourcePolicy"];
    }>;
    rejectedCandidateCount: number;
    rejectedCandidates: ReadonlyArray<{
      marketId: string;
      title: string;
      classification: PropositionComparison["classification"];
      matchScore: number;
      failedDimensions: readonly string[];
      exactDateStatus: CandidateSelection["exactDateStatus"];
      sourcePolicy: CandidateSelection["sourcePolicy"];
      familyTemplate: string;
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

const normalizeCompetitionTemplate = (value: string | null): string | null =>
  value?.replace(/\b20\d{2}\b/g, "").replace(/\s+/g, " ").trim() || null;

const isChampionshipFamily = (parsed: StructuredProposition): boolean =>
  parsed.actionOrCondition.normalized === "win championship" || parsed.actionOrCondition.normalized === "win series";

const deriveFamilyTemplate = (seed: ExactSeedDefinition): {
  familyTemplate: string;
  parsedSeed: StructuredProposition;
} => {
  const semanticCategory = toSupportedSemanticCategory(seed.canonicalCategory);
  const parsedSeed = parseStructuredProposition({
    category: semanticCategory,
    title: seed.title,
    rules: seed.sourceText,
    boundaryReferenceAt: seed.boundaryReferenceAt ? new Date(seed.boundaryReferenceAt) : null
  });

  const familyTemplate =
    seed.canonicalCategory === "CRYPTO"
      ? parsedSeed.threshold.normalized === "all time high" || parsedSeed.actionOrCondition.normalized === "reach all time high"
        ? "crypto_all_time_high_by_date"
        : parsedSeed.threshold.normalized !== null
          && (parsedSeed.actionOrCondition.normalized === "above threshold" || parsedSeed.actionOrCondition.normalized === "below threshold")
          ? "crypto_threshold_by_date"
          : parsedSeed.actionOrCondition.normalized === "up or down"
            ? "crypto_directional"
            : "crypto_other"
      : isChampionshipFamily(parsedSeed)
        ? "competition_winner"
        : parsedSeed.actionOrCondition.normalized === "win match"
          ? "match_winner"
          : "competition_other";

  return {
    familyTemplate,
    parsedSeed
  };
};

export const evaluateSameFamilyCandidate = (input: {
  seed: ExactSeedDefinition;
  parsedSeed: StructuredProposition;
  familyTemplate: string;
  candidate: OpinionNormalizedMarket;
}): {
  sameFamily: boolean;
  familyRejectionReason: string | null;
} => {
  const semanticCategory = toSupportedSemanticCategory(input.seed.canonicalCategory);
  const parsedCandidate = parseStructuredProposition({
    category: semanticCategory,
    title: input.candidate.title,
    rules: input.candidate.rules,
    boundaryReferenceAt: input.candidate.cutoffAt ?? input.candidate.resolvedAt ?? input.candidate.createdAt ?? null
  });

  if (input.seed.canonicalCategory === "CRYPTO") {
    const sameSubject = input.parsedSeed.subject.normalized !== null
      && input.parsedSeed.subject.normalized === parsedCandidate.subject.normalized;

    if (!sameSubject) {
      return { sameFamily: false, familyRejectionReason: "cross_asset_candidate" };
    }

    switch (input.familyTemplate) {
      case "crypto_all_time_high_by_date":
        if (!(parsedCandidate.threshold.normalized === "all time high" || parsedCandidate.actionOrCondition.normalized === "reach all time high")) {
          return { sameFamily: false, familyRejectionReason: "different_crypto_contract_family" };
        }
        return { sameFamily: true, familyRejectionReason: null };
      case "crypto_threshold_by_date":
        if (
          parsedCandidate.actionOrCondition.normalized !== input.parsedSeed.actionOrCondition.normalized
          || parsedCandidate.threshold.normalized !== input.parsedSeed.threshold.normalized
        ) {
          return { sameFamily: false, familyRejectionReason: "different_threshold_contract_family" };
        }
        return { sameFamily: true, familyRejectionReason: null };
      case "crypto_directional":
        if (parsedCandidate.actionOrCondition.normalized !== "up or down") {
          return { sameFamily: false, familyRejectionReason: "different_directional_family" };
        }
        return { sameFamily: true, familyRejectionReason: null };
      default:
        return { sameFamily: false, familyRejectionReason: "unsupported_crypto_family" };
    }
  }

  if (input.seed.canonicalCategory === "SPORTS" || input.seed.canonicalCategory === "ESPORTS") {
    if (input.familyTemplate !== "competition_winner") {
      return { sameFamily: false, familyRejectionReason: "non_winner_anchor_out_of_scope" };
    }
    if (!isChampionshipFamily(parsedCandidate)) {
      return { sameFamily: false, familyRejectionReason: "matchup_winner_not_competition_winner" };
    }
    if (parsedCandidate.subject.normalized !== input.parsedSeed.subject.normalized) {
      return { sameFamily: false, familyRejectionReason: "different_team_or_competitor" };
    }
    if (
      normalizeCompetitionTemplate(parsedCandidate.competitionOrContext.normalized)
      !== normalizeCompetitionTemplate(input.parsedSeed.competitionOrContext.normalized)
    ) {
      return { sameFamily: false, familyRejectionReason: "different_competition_family" };
    }
    return { sameFamily: true, familyRejectionReason: null };
  }

  return { sameFamily: false, familyRejectionReason: "category_out_of_scope" };
};

const loadCuratedFallbackOpinionMarkets = async (
  pool: Pool,
  marketIds?: readonly string[]
): Promise<readonly OpinionNormalizedMarket[]> => {
  if (marketIds && marketIds.length === 0) {
    return [];
  }

  const result = await pool.query<{
    venue_market_id: string;
    title: string | null;
    description: string | null;
    topics: unknown;
    outcome_schema: Record<string, unknown> | null;
    raw_source_payload: Record<string, unknown> | null;
    normalized_payload: Record<string, unknown> | null;
    published_at: Date | null;
    expires_at: Date | null;
    resolves_at: Date | null;
    source_metadata_version: string | null;
  }>(
    `SELECT
       venue_market_id,
       title,
       description,
       topics,
       outcome_schema,
       raw_source_payload,
       normalized_payload,
       published_at,
       expires_at,
       resolves_at,
       source_metadata_version
     FROM venue_market_profiles
    WHERE venue = 'OPINION'
      ${marketIds ? "AND venue_market_id = ANY($1::text[])" : ""}
    ORDER BY venue_market_id ASC`,
    marketIds ? [marketIds] : []
  );

  return result.rows.map((row) => ({
    venue: "OPINION",
    venueMarketId: row.venue_market_id,
    title: row.title ?? row.venue_market_id,
    slug: typeof row.normalized_payload?.slug === "string" ? row.normalized_payload.slug : null,
    status: typeof row.raw_source_payload?.statusEnum === "string" ? row.raw_source_payload.statusEnum : null,
    statusCode: typeof row.raw_source_payload?.status === "number" ? row.raw_source_payload.status : null,
    labels: Array.isArray(row.topics) ? row.topics.filter((value): value is string => typeof value === "string") : [],
    rules: row.description,
    yesLabel: typeof row.outcome_schema?.yesLabel === "string" ? row.outcome_schema.yesLabel : "Yes",
    noLabel: typeof row.outcome_schema?.noLabel === "string" ? row.outcome_schema.noLabel : "No",
    volume: typeof row.raw_source_payload?.volume === "string" || typeof row.raw_source_payload?.volume === "number"
      ? String(row.raw_source_payload.volume)
      : null,
    volume24h: typeof row.raw_source_payload?.volume24h === "string" || typeof row.raw_source_payload?.volume24h === "number"
      ? String(row.raw_source_payload.volume24h)
      : null,
    volume7d: typeof row.raw_source_payload?.volume7d === "string" || typeof row.raw_source_payload?.volume7d === "number"
      ? String(row.raw_source_payload.volume7d)
      : null,
    quoteToken: typeof row.raw_source_payload?.quoteToken === "string" ? row.raw_source_payload.quoteToken : null,
    chainId: typeof row.raw_source_payload?.chainId === "string" || typeof row.raw_source_payload?.chainId === "number"
      ? String(row.raw_source_payload.chainId)
      : null,
    questionId: typeof row.normalized_payload?.questionId === "string" ? row.normalized_payload.questionId : null,
    createdAt: row.published_at,
    cutoffAt: row.expires_at,
    resolvedAt: row.resolves_at,
    sourceMetadataVersion: row.source_metadata_version ?? metadataVersion,
    raw: {
      ...(row.raw_source_payload ?? {}),
      curatedFallbackLoaded: true
    }
  }));
};

const rankCandidateSelection = (left: CandidateSelection, right: CandidateSelection): number =>
  rankExactDateStatus(right.exactDateStatus) - rankExactDateStatus(left.exactDateStatus)
  || rankCandidate(right.comparison) - rankCandidate(left.comparison)
  || left.market.venueMarketId.localeCompare(right.market.venueMarketId);

const rankCandidatesForSeed = (
  seed: ExactSeedDefinition,
  markets: readonly (OpinionNormalizedMarket & { sourcePolicy?: CandidateSelection["sourcePolicy"] })[],
  familyMode: OpinionFamilyMode
): readonly CandidateSelection[] => {
  const semanticCategory = toSupportedSemanticCategory(seed.canonicalCategory);
  const { familyTemplate, parsedSeed } = deriveFamilyTemplate(seed);

  return markets
    .filter((market) => canLooseMatchCategoryText(semanticCategory, `${market.title} ${market.rules ?? ""}`.trim()))
    .map((market) => {
      const familyEvaluation = evaluateSameFamilyCandidate({
        seed,
        parsedSeed,
        familyTemplate,
        candidate: market
      });
      const exactDateStatus = buildExactDateCandidateStatus({
        seed,
        candidateTitle: market.title,
        candidateRules: market.rules,
        boundaryReferenceAt: market.cutoffAt ?? market.resolvedAt ?? market.createdAt ?? null
      });
      const comparison = compareStructuredPropositions({
        seed: parsedSeed,
        candidate: parseStructuredProposition({
          category: semanticCategory,
          title: market.title,
          rules: market.rules,
          boundaryReferenceAt: market.cutoffAt ?? market.resolvedAt ?? market.createdAt ?? null
        }),
        historyQualified: false,
        requireHistoricalQualification: false
      });
      return {
        market,
        comparison,
        targetPairFamilies: buildAcquisitionTargetFamilies(seed, "OPINION"),
        exactDateStatus,
        sourcePolicy: market.sourcePolicy ?? "live_api",
        familyTemplate,
        sameFamily: familyMode === "same_family_only" ? familyEvaluation.sameFamily : true,
        familyRejectionReason: familyEvaluation.familyRejectionReason
      };
    })
    .sort((left, right) =>
      Number(right.sameFamily) - Number(left.sameFamily)
      || rankCandidateSelection(left, right)
    );
};

const toHistoricalState = (
  market: OpinionNormalizedMarket,
  fetchedAt: Date,
  seedReferences: readonly string[],
  targetPairFamilies: readonly string[],
  target: {
    canonicalEventId: string;
    canonicalMarketId: string;
    canonicalCategory: ExactSeedDefinition["canonicalCategory"] | null;
  }
): CreateHistoricalMarketStateInput => ({
  canonicalEventId: target.canonicalEventId,
  canonicalMarketId: target.canonicalMarketId,
  canonicalCategory: toHistoricalCanonicalCategory(target.canonicalCategory ?? "OTHER"),
  venue: "OPINION",
  venueMarketId: market.venueMarketId,
  marketClass: HistoricalMarketClass.BINARY,
  timestamp: fetchedAt,
  volume: market.volume,
  orderbookSnapshot: {
    source: "opinion_exact_seed_acquisition",
    acquisitionSeedRefs: seedReferences,
    targetPairFamilies,
    title: market.title,
    status: market.status
  },
  marketEvents: {
    source: "opinion_exact_seed_acquisition",
    acquisitionSeedRefs: seedReferences,
    targetPairFamilies,
    status: market.status
  },
  metadataVersion,
  sourceTimestamp: fetchedAt
});

export const runOpinionExactSeedAcquisition = async (input: {
  repoRoot: string;
  pool: Pool;
  opinionBaseUrl: string;
  opinionApiKey: string;
  pageSize?: number;
  maxPages?: number;
  sameDayOnly?: boolean;
  catalogPath?: string;
  seedSource?: "all_relevant" | "pm_limitless_routeable" | "pm_limitless_opinion_constrained" | "pm_limitless_crypto_date_aligned";
  categories?: readonly ExactSeedDefinition["canonicalCategory"][];
  summaryOutputPath?: string;
  familyMode?: OpinionFamilyMode;
}): Promise<OpinionExactSeedAcquisitionSummary> => {
  const allSeeds =
    input.seedSource === "pm_limitless_routeable"
      ? await loadPmLimitlessRouteableAnchorSeeds({
          pool: input.pool,
          ...(input.categories ? { categories: input.categories.filter((category): category is "CRYPTO" | "SPORTS" | "ESPORTS" | "POLITICS" =>
            category === "CRYPTO" || category === "SPORTS" || category === "ESPORTS" || category === "POLITICS"
          ) } : {})
        })
      : input.seedSource === "pm_limitless_opinion_constrained"
        ? await loadPmLimitlessOpinionConstrainedAnchorSeeds({
            repoRoot: input.repoRoot,
            pool: input.pool,
            opinionBaseUrl: input.opinionBaseUrl,
            opinionApiKey: input.opinionApiKey
          })
        : input.seedSource === "pm_limitless_crypto_date_aligned"
          ? await loadPmLimitlessCryptoDateAlignedSeeds({
              repoRoot: input.repoRoot,
              pool: input.pool,
              opinionBaseUrl: input.opinionBaseUrl,
              opinionApiKey: input.opinionApiKey
            })
        : await loadExactSeedDefinitions(input.pool);
  const seeds = allSeeds.filter((seed) => isSeedRelevantToVenue(seed, "OPINION"));
  const seedByReference = new Map(seeds.map((seed) => [seed.seedReference, seed] as const));
  const catalog = input.sameDayOnly
    ? loadSameDaySeedCatalog(input.repoRoot, input.catalogPath ?? DEFAULT_SAME_DAY_SEED_CATALOG_PATH)
    : null;
  const client = new OpinionClient({
    baseUrl: input.opinionBaseUrl,
    apiKey: input.opinionApiKey
  });
  const adapter = new OpinionMarketAdapter({
    client,
    metadataVersion
  });

  const allMarkets: OpinionNormalizedMarket[] = [];
  const pageSize = input.pageSize ?? 100;
  const maxPages = input.maxPages ?? 50;
  let liveApiFailed = false;
  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const batch = await adapter.listMarkets({ page, limit: pageSize });
      if (batch.length === 0) {
        break;
      }
      allMarkets.push(...batch);
    }
  } catch {
    liveApiFailed = true;
  }
  const liveMarketIds = new Set(allMarkets.map((market) => market.venueMarketId));
  const curatedFallbackMarketIds = catalog
    ? [...new Set(catalog.entries.flatMap((entry) => entry.OPINION?.marketIds ?? []))]
        .filter((marketId) => !liveMarketIds.has(marketId))
    : [];
  const curatedFallbackMarkets = (await loadCuratedFallbackOpinionMarkets(input.pool, curatedFallbackMarketIds))
    .map((market) => ({ ...market, sourcePolicy: "curated_fallback" as const }));
  const liveMarkets = allMarkets.map((market) => ({ ...market, sourcePolicy: "live_api" as const }));
  const persistedInventoryMarkets = liveApiFailed
    ? (await loadCuratedFallbackOpinionMarkets(input.pool))
        .map((market) => ({ ...market, sourcePolicy: "persisted_inventory_fallback" as const }))
    : [];
  const allCandidateMarkets = [...liveMarkets, ...curatedFallbackMarkets, ...persistedInventoryMarkets];

  const attempts = seeds.map((seed) => {
    const { familyTemplate } = deriveFamilyTemplate(seed);
    const catalogEntry = catalog ? getCatalogEntryForSeed(catalog, seed.seedReference, seed.exactDateSearch?.exactDateKey ?? null) : null;
    const catalogVenueEntry = getCatalogVenueEntry(catalogEntry, "OPINION");
    const candidatePool = catalogVenueEntry?.marketIds?.length
      ? [
          ...allCandidateMarkets,
          ...allCandidateMarkets.filter((market) => catalogVenueEntry.marketIds?.includes(market.venueMarketId))
        ]
      : allCandidateMarkets;
    const ranked = rankCandidatesForSeed(
      seed,
      [...new Map(candidatePool.map((market) => [market.venueMarketId, market] as const)).values()],
      input.familyMode ?? "default"
    );
    const inFamily = (input.familyMode ?? "default") === "same_family_only"
      ? ranked.filter((entry) => entry.sameFamily)
      : ranked;
    const outOfFamilyIgnored = (input.familyMode ?? "default") === "same_family_only"
      ? ranked.filter((entry) => !entry.sameFamily).slice(0, 5)
      : [];
    const selected = inFamily
      .filter((entry) =>
        entry.comparison.classification === "semantic_exact_historical_qualified"
        || entry.comparison.classification === "semantic_exact_live_only"
        || entry.comparison.classification === "semantic_near_exact"
      )
      .slice(0, 3);
    const rejected = inFamily
      .filter((entry) => !selected.some((selectedEntry) => selectedEntry.market.venueMarketId === entry.market.venueMarketId))
      .filter((entry) =>
        seed.exactDateSearch !== null
          ? entry.exactDateStatus !== "exact_date_found"
            || entry.comparison.classification === "proxy_or_mismatch"
          : entry.comparison.classification === "proxy_or_mismatch"
      )
      .slice(0, 3);
    return {
      seedReference: seed.seedReference,
      category: seed.canonicalCategory,
      targetPairFamilies: seed.targetPairFamilies.filter((family) => family.includes("OPINION")),
      familyTemplate,
      selected,
      rejected,
      outOfFamilyIgnored
    };
  });

  const selectedByMarketId = new Map<string, {
    market: OpinionNormalizedMarket;
    seedReferences: string[];
    targetPairFamilies: Set<string>;
    exactDateStatus: CandidateSelection["exactDateStatus"];
    sourcePolicy: CandidateSelection["sourcePolicy"];
  }>();
  for (const attempt of attempts) {
    for (const entry of attempt.selected) {
      if (
        input.sameDayOnly
        && entry.exactDateStatus !== "exact_date_found"
        && seedByReference.get(attempt.seedReference)?.exactDateSearch !== null
      ) {
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
        if (entry.sourcePolicy === "curated_fallback") {
          existing.sourcePolicy = "curated_fallback";
        }
      } else {
        selectedByMarketId.set(entry.market.venueMarketId, {
          market: entry.market,
          seedReferences: [attempt.seedReference],
          targetPairFamilies: new Set(entry.targetPairFamilies),
          exactDateStatus: entry.exactDateStatus,
          sourcePolicy: entry.sourcePolicy
        });
      }
    }
  }

  const selectedMarkets = [...selectedByMarketId.values()];
  const fetchedAt = new Date();
  const projector = new CanonicalGraphProjector(
    new CanonicalGraphRepository(input.pool),
    new CanonicalCompatibilityProjector(
      new CanonicalCompatibilityRepository(input.pool),
      new CompatibilityVersionRepository(input.pool)
    )
  );
  const snapshotBuilder = new CuratedCanonicalGraphSnapshotBuilder();
  const historicalRepository = new HistoricalMarketStateRepository(input.pool);

  const existingProfilesResult = await input.pool.query<{
    venue_market_id: string;
    canonical_event_id: string;
    canonical_category: ExactSeedDefinition["canonicalCategory"] | null;
    canonical_market_id: string | null;
  }>(
    `SELECT venue_market_id, canonical_event_id, canonical_category, members.canonical_executable_market_id AS canonical_market_id
       FROM venue_market_profiles vmp
       LEFT JOIN canonical_executable_market_members members
         ON members.venue_market_profile_id = vmp.id
      WHERE vmp.venue = 'OPINION'
        AND vmp.venue_market_id = ANY($1::text[])`,
    [selectedMarkets.map((entry) => entry.market.venueMarketId)]
  );
  const existingProfiles = new Map(existingProfilesResult.rows.map((row) => [row.venue_market_id, row] as const));

  const seedsToProject = selectedMarkets
    .filter(({ market }) => !existingProfiles.has(market.venueMarketId))
    .map(({ market, seedReferences, targetPairFamilies, exactDateStatus, sourcePolicy }) => {
      const seed = adapter.buildCanonicalSeed(market);
      return {
        ...seed,
        rawSourcePayload: {
          ...seed.rawSourcePayload,
          exactSeedAcquisition: true,
          exactDateAcquisition: exactDateStatus === "exact_date_found",
          exactDateStatus,
          exactDateKey: seedReferences
            .map((seedReference) => seedByReference.get(seedReference)?.exactDateSearch?.exactDateKey ?? null)
            .find((value): value is string => typeof value === "string") ?? null,
          sameDayTargetedIngestion: input.sameDayOnly === true,
          sameFamilyTargetedIngestion: input.familyMode === "same_family_only",
          sourcePolicy,
          curatedFallbackUsed: sourcePolicy === "curated_fallback",
          acquisitionSeedRefs: seedReferences,
          targetPairFamilies: [...targetPairFamilies],
          seedSource: input.seedSource ?? "all_relevant",
          familyTemplate: attempts
            .find((attempt) => attempt.seedReference === seedReferences[0])?.familyTemplate ?? null
        },
        normalizedPayload: {
          ...seed.normalizedPayload,
          exactSeedAcquisition: true,
          exactDateAcquisition: exactDateStatus === "exact_date_found",
          exactDateStatus,
          exactDateKey: seedReferences
            .map((seedReference) => seedByReference.get(seedReference)?.exactDateSearch?.exactDateKey ?? null)
            .find((value): value is string => typeof value === "string") ?? null,
          sameDayTargetedIngestion: input.sameDayOnly === true,
          sameFamilyTargetedIngestion: input.familyMode === "same_family_only",
          sourcePolicy,
          curatedFallbackUsed: sourcePolicy === "curated_fallback",
          acquisitionSeedRefs: seedReferences,
          targetPairFamilies: [...targetPairFamilies],
          seedSource: input.seedSource ?? "all_relevant",
          familyTemplate: attempts
            .find((attempt) => attempt.seedReference === seedReferences[0])?.familyTemplate ?? null
        },
        mappingLineage: [...(seed.mappingLineage ?? []), "opinion-exact-seed-acquisition"],
        sourceMetadataVersion: metadataVersion,
        executableMetadata: {
          ...(seed.executableMetadata ?? {}),
          exactSeedAcquisition: true,
          exactDateAcquisition: exactDateStatus === "exact_date_found",
          exactDateStatus,
          exactDateKey: seedReferences
            .map((seedReference) => seedByReference.get(seedReference)?.exactDateSearch?.exactDateKey ?? null)
            .find((value): value is string => typeof value === "string") ?? null,
          sameDayTargetedIngestion: input.sameDayOnly === true,
          sameFamilyTargetedIngestion: input.familyMode === "same_family_only",
          sourcePolicy,
          curatedFallbackUsed: sourcePolicy === "curated_fallback",
          targetPairFamilies: [...targetPairFamilies],
          seedSource: input.seedSource ?? "all_relevant",
          familyTemplate: attempts
            .find((attempt) => attempt.seedReference === seedReferences[0])?.familyTemplate ?? null
        }
      } satisfies CuratedCanonicalGraphSeed;
    });

  const targetStateByMarketId = new Map<string, {
    canonicalEventId: string;
    canonicalMarketId: string;
    canonicalCategory: ExactSeedDefinition["canonicalCategory"] | null;
  }>();
  for (const { market } of selectedMarkets) {
    const existing = existingProfiles.get(market.venueMarketId);
    if (existing?.canonical_market_id) {
      targetStateByMarketId.set(market.venueMarketId, {
        canonicalEventId: existing.canonical_event_id,
        canonicalMarketId: existing.canonical_market_id,
        canonicalCategory: existing.canonical_category ?? "OTHER"
      });
      continue;
    }
    const projected = seedsToProject.find((seed) => seed.venueMarketId === market.venueMarketId)!;
    targetStateByMarketId.set(market.venueMarketId, {
      canonicalEventId: projected.canonicalEventId,
      canonicalMarketId: projected.canonicalMarketId,
      canonicalCategory: normalizeCategory(projected.canonicalCategory)
    });
  }

  const states = selectedMarkets.map(({ market, seedReferences, targetPairFamilies }) =>
    toHistoricalState(
      market,
      fetchedAt,
      seedReferences,
      [...targetPairFamilies].sort((left, right) => left.localeCompare(right)),
      targetStateByMarketId.get(market.venueMarketId)!
    )
  );

  if (selectedMarkets.length > 0) {
    await input.pool.query(
      `DELETE FROM historical_market_states
        WHERE venue = 'OPINION'
          AND metadata_version = $1
          AND venue_market_id = ANY($2::text[])`,
      [metadataVersion, selectedMarkets.map((entry) => entry.market.venueMarketId)]
    );
  }

  if (seedsToProject.length > 0) {
    await projector.persistAndProject(snapshotBuilder.build(seedsToProject));
  }

  const insertResult = await historicalRepository.insertManyIgnoreDuplicates(states);

  const summary: OpinionExactSeedAcquisitionSummary = {
    observedAt: fetchedAt.toISOString(),
    metadataVersion,
    seedSource: input.seedSource ?? "all_relevant",
    liveApiFailed,
    selectedSeedCount: seeds.length,
    scannedMarketCount: allMarkets.length,
    acquiredMarketCount: selectedMarkets.length,
    insertedStates: insertResult.inserted,
    skippedStates: insertResult.skipped,
    exactCandidateCount: attempts.reduce((total, attempt) => total + attempt.selected.filter((entry) =>
      entry.comparison.classification === "semantic_exact_historical_qualified"
      || entry.comparison.classification === "semantic_exact_live_only"
    ).length, 0),
    nearExactCandidateCount: attempts.reduce((total, attempt) => total + attempt.selected.filter((entry) =>
      entry.comparison.classification === "semantic_near_exact"
    ).length, 0),
    rejectedCandidateCount: attempts.reduce((total, attempt) => total + attempt.rejected.length, 0),
    outOfFamilyIgnoredCount: attempts.reduce((total, attempt) => total + attempt.outOfFamilyIgnored.length, 0),
    attempts: attempts.map((attempt) => ({
      seedReference: attempt.seedReference,
      category: attempt.category,
      targetPairFamilies: attempt.targetPairFamilies,
      familyTemplate: attempt.familyTemplate,
      selectedCandidateCount: attempt.selected.length,
      selectedCandidates: attempt.selected.map((entry) => ({
        marketId: entry.market.venueMarketId,
        title: entry.market.title,
        classification: entry.comparison.classification,
        matchScore: entry.comparison.matchScore,
        failedDimensions: entry.comparison.failedDimensions,
        targetPairFamilies: entry.targetPairFamilies,
        exactDateStatus: entry.exactDateStatus,
        sameFamily: entry.sameFamily,
        familyTemplate: entry.familyTemplate
      })),
      outOfFamilyIgnoredCount: attempt.outOfFamilyIgnored.length,
      outOfFamilyIgnoredCandidates: attempt.outOfFamilyIgnored.map((entry) => ({
        marketId: entry.market.venueMarketId,
        title: entry.market.title,
        familyRejectionReason: entry.familyRejectionReason,
        sourcePolicy: entry.sourcePolicy
      })),
      rejectedCandidateCount: attempt.rejected.length,
      rejectedCandidates: attempt.rejected.map((entry) => ({
        marketId: entry.market.venueMarketId,
        title: entry.market.title,
        classification: entry.comparison.classification,
        matchScore: entry.comparison.matchScore,
        failedDimensions: entry.comparison.failedDimensions,
        exactDateStatus: entry.exactDateStatus,
        sourcePolicy: entry.sourcePolicy,
        familyTemplate: entry.familyTemplate
      }))
    }))
  };

  writeArtifact(input.repoRoot, input.summaryOutputPath ?? "docs/opinion-exact-seed-acquisition-summary.json", summary);
  return summary;
};
