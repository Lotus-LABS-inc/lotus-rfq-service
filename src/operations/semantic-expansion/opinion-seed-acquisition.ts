import type { Pool } from "pg";

import { CanonicalGraphProjector } from "../../canonical/canonical-graph-projector.js";
import { CanonicalCompatibilityProjector } from "../../canonical/canonical-compatibility-projector.js";
import { CuratedCanonicalGraphSnapshotBuilder } from "../../canonical/curated-canonical-graph.js";
import { HistoricalMarketClass, type CreateHistoricalMarketStateInput } from "../../core/historical-simulation/historical-simulation.types.js";
import { OpinionClient } from "../../integrations/opinion/opinion-client.js";
import { OpinionMarketAdapter } from "../../integrations/opinion/opinion-market-adapter.js";
import type { OpinionNormalizedMarket } from "../../integrations/opinion/opinion-types.js";
import { CanonicalCompatibilityRepository } from "../../repositories/canonical-compatibility.repository.js";
import { CanonicalGraphRepository } from "../../repositories/canonical-graph.repository.js";
import { CompatibilityVersionRepository } from "../../repositories/compatibility-version.repository.js";
import { HistoricalMarketStateRepository } from "../../repositories/historical-market-state.repository.js";
import {
  historicalRouteCandidatesSchema,
  type HistoricalRouteCandidates
} from "../../simulation/historical-route-catalog-manifest.js";
import {
  canLooseMatchCategoryText,
  compareStructuredPropositions,
  parseStructuredProposition,
  type PropositionComparison
} from "../../simulation/proposition-matching.js";
import { readArtifact, writeArtifact } from "./shared.js";

const metadataVersion = "opinion-seed-acquisition-v1";

type SupportedSeedCategory = "POLITICS" | "CRYPTO" | "SPORTS" | "ESPORTS";

interface OpinionSeedDefinition {
  seedReference: string;
  category: SupportedSeedCategory;
  title: string;
  sourceText: string;
}

interface CandidateSelection {
  market: OpinionNormalizedMarket;
  comparison: PropositionComparison;
}

export interface OpinionSeedAcquisitionSummary {
  observedAt: string;
  metadataVersion: string;
  selectedSeedCount: number;
  scannedMarketCount: number;
  acquiredMarketCount: number;
  insertedStates: number;
  skippedStates: number;
  attempts: ReadonlyArray<{
    seedReference: string;
    category: SupportedSeedCategory;
    selectedCandidateCount: number;
    selectedCandidates: ReadonlyArray<{
      marketId: string;
      title: string;
      classification: PropositionComparison["classification"];
      matchScore: number;
      failedDimensions: readonly string[];
    }>;
  }>;
}

const isSupportedSeedCategory = (value: string): value is SupportedSeedCategory =>
  value === "POLITICS" || value === "CRYPTO" || value === "SPORTS" || value === "ESPORTS";

const buildSeedDefinitions = (artifact: HistoricalRouteCandidates): readonly OpinionSeedDefinition[] =>
  artifact.candidates
    .filter((candidate) => isSupportedSeedCategory(candidate.canonicalCategory))
    .filter((candidate) => candidate.venueProfiles.some((profile) => profile.venue === "POLYMARKET" || profile.venue === "LIMITLESS"))
    .map((candidate) => ({
      seedReference: candidate.historicalCanonicalMarketId,
      category: candidate.canonicalCategory as SupportedSeedCategory,
      title: candidate.title,
      sourceText: `${candidate.title} | ${candidate.venueProfiles.map((profile) => profile.title).join(" | ")}`
    }));

const rankCandidate = (comparison: PropositionComparison): number => {
  const classificationScore =
    comparison.classification === "semantic_exact_historical_qualified" ? 4
    : comparison.classification === "semantic_exact_live_only" ? 3
    : comparison.classification === "semantic_near_exact" ? 2
    : 0;
  return classificationScore * 10 + comparison.matchScore;
};

const selectCandidatesForSeed = (
  seed: OpinionSeedDefinition,
  markets: readonly OpinionNormalizedMarket[]
): readonly CandidateSelection[] => {
  const parsedSeed = parseStructuredProposition({
    category: seed.category,
    title: seed.title,
    rules: seed.sourceText
  });

  return markets
    .filter((market) =>
      canLooseMatchCategoryText(seed.category, `${market.title} ${market.rules ?? ""}`.trim())
    )
    .map((market) => ({
      market,
      comparison: compareStructuredPropositions({
        seed: parsedSeed,
        candidate: parseStructuredProposition({
          category: seed.category,
          title: market.title,
          rules: market.rules
        }),
        historyQualified: false,
        requireHistoricalQualification: false
      })
    }))
    .filter((entry) =>
      entry.comparison.classification === "semantic_exact_historical_qualified"
      || entry.comparison.classification === "semantic_exact_live_only"
      || entry.comparison.classification === "semantic_near_exact"
    )
    .sort((left, right) =>
      rankCandidate(right.comparison) - rankCandidate(left.comparison)
      || left.market.venueMarketId.localeCompare(right.market.venueMarketId)
    )
    .slice(0, 3);
};

const toHistoricalState = (
  market: OpinionNormalizedMarket,
  fetchedAt: Date,
  seedReferences: readonly string[],
  target: {
    canonicalEventId: string;
    canonicalMarketId: string;
    canonicalCategory: "POLITICS" | "CRYPTO" | "SPORTS" | "ESPORTS" | "OTHER";
  }
): CreateHistoricalMarketStateInput => ({
  canonicalEventId: target.canonicalEventId,
  canonicalMarketId: target.canonicalMarketId,
  canonicalCategory: target.canonicalCategory,
  venue: "OPINION",
  venueMarketId: market.venueMarketId,
  marketClass: HistoricalMarketClass.BINARY,
  timestamp: fetchedAt,
  volume: market.volume,
  orderbookSnapshot: {
    source: "opinion_seed_acquisition",
    acquisitionSeedRefs: seedReferences,
    title: market.title,
    status: market.status
  },
  marketEvents: {
    source: "opinion_seed_acquisition",
    acquisitionSeedRefs: seedReferences,
    status: market.status
  },
  metadataVersion,
  sourceTimestamp: fetchedAt
});

export const runOpinionSeedAcquisition = async (input: {
  repoRoot: string;
  pool: Pool;
  opinionBaseUrl: string;
  opinionApiKey: string;
  pageSize?: number;
  maxPages?: number;
}): Promise<OpinionSeedAcquisitionSummary> => {
  const artifact = historicalRouteCandidatesSchema.parse(
    readArtifact<HistoricalRouteCandidates>(input.repoRoot, "docs/historical-route-candidates.json")
  );
  const seeds = buildSeedDefinitions(artifact);
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
  for (let page = 1; page <= maxPages; page += 1) {
    const batch = await adapter.listMarkets({ page, limit: pageSize });
    if (batch.length === 0) {
      break;
    }
    allMarkets.push(...batch);
    if (batch.length < pageSize) {
      break;
    }
  }

  const attempts = seeds.map((seed) => {
    const selected = selectCandidatesForSeed(seed, allMarkets);
    return {
      seedReference: seed.seedReference,
      category: seed.category,
      selected
    };
  });

  const selectedByMarketId = new Map<string, { market: OpinionNormalizedMarket; seedReferences: string[] }>();
  for (const attempt of attempts) {
    for (const entry of attempt.selected) {
      const existing = selectedByMarketId.get(entry.market.venueMarketId);
      if (existing) {
        existing.seedReferences.push(attempt.seedReference);
      } else {
        selectedByMarketId.set(entry.market.venueMarketId, {
          market: entry.market,
          seedReferences: [attempt.seedReference]
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
    canonical_category: "POLITICS" | "CRYPTO" | "SPORTS" | "ESPORTS" | "OTHER" | null;
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
    .map(({ market, seedReferences }) => {
      const seed = adapter.buildCanonicalSeed(market);
      return {
        ...seed,
        rawSourcePayload: {
          ...seed.rawSourcePayload,
          acquisitionSeedRefs: seedReferences
        },
        normalizedPayload: {
          ...seed.normalizedPayload,
          acquisitionSeedRefs: seedReferences
        },
        mappingLineage: [...(seed.mappingLineage ?? []), "opinion-seed-acquisition"],
        sourceMetadataVersion: metadataVersion
      };
    });

  const stateTargets = new Map(selectedMarkets.map(({ market }) => {
    const existing = existingProfiles.get(market.venueMarketId);
    if (existing?.canonical_market_id) {
      return [market.venueMarketId, {
        canonicalEventId: existing.canonical_event_id,
        canonicalMarketId: existing.canonical_market_id,
        canonicalCategory: existing.canonical_category ?? "OTHER"
      }] as const;
    }
    const projected = seedsToProject.find((seed) => seed.venueMarketId === market.venueMarketId);
    return [market.venueMarketId, {
      canonicalEventId: projected!.canonicalEventId,
      canonicalMarketId: projected!.canonicalMarketId,
      canonicalCategory: projected!.canonicalCategory as "POLITICS" | "CRYPTO" | "SPORTS" | "ESPORTS" | "OTHER"
    }] as const;
  }));
  const states = selectedMarkets.map(({ market, seedReferences }, index) =>
    toHistoricalState(market, fetchedAt, seedReferences, {
      canonicalEventId: stateTargets.get(market.venueMarketId)!.canonicalEventId,
      canonicalMarketId: stateTargets.get(market.venueMarketId)!.canonicalMarketId,
      canonicalCategory: stateTargets.get(market.venueMarketId)!.canonicalCategory
    })
  );

  if (seedsToProject.length > 0) {
    await input.pool.query(
      `DELETE FROM historical_market_states
        WHERE venue = 'OPINION'
          AND metadata_version = $1
          AND venue_market_id = ANY($2::text[])`,
      [metadataVersion, selectedMarkets.map((entry) => entry.market.venueMarketId)]
    );
    if (seedsToProject.length > 0) {
      await projector.persistAndProject(snapshotBuilder.build(seedsToProject));
    }
  }

  const insertResult = await historicalRepository.insertManyIgnoreDuplicates(states);
  const summary: OpinionSeedAcquisitionSummary = {
    observedAt: fetchedAt.toISOString(),
    metadataVersion,
    selectedSeedCount: seeds.length,
    scannedMarketCount: allMarkets.length,
    acquiredMarketCount: selectedMarkets.length,
    insertedStates: insertResult.inserted,
    skippedStates: insertResult.skipped,
    attempts: attempts.map((attempt) => ({
      seedReference: attempt.seedReference,
      category: attempt.category,
      selectedCandidateCount: attempt.selected.length,
      selectedCandidates: attempt.selected.map((entry) => ({
        marketId: entry.market.venueMarketId,
        title: entry.market.title,
        classification: entry.comparison.classification,
        matchScore: entry.comparison.matchScore,
        failedDimensions: entry.comparison.failedDimensions
      }))
    }))
  };

  writeArtifact(input.repoRoot, "docs/opinion-seed-acquisition-summary.json", summary);
  return summary;
};
