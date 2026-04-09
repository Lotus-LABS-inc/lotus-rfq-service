import type { Pool } from "pg";

import { CuratedCanonicalGraphSnapshotBuilder } from "../canonical/curated-canonical-graph.js";
import { CanonicalGraphProjector } from "../canonical/canonical-graph-projector.js";
import { CanonicalCompatibilityProjector } from "../canonical/canonical-compatibility-projector.js";
import {
  HistoricalMarketClass,
  type CreateHistoricalMarketStateInput,
  type HistoricalCanonicalCategory
} from "../core/historical-simulation/historical-simulation.types.js";
import {
  buildLimitlessLiveSeed,
  loadLimitlessLiveMarkets,
  type LimitlessLiveMarket
} from "../integrations/limitless/limitless-live-market-loader.js";
import { CanonicalGraphRepository } from "../repositories/canonical-graph.repository.js";
import { CanonicalCompatibilityRepository } from "../repositories/canonical-compatibility.repository.js";
import { CompatibilityVersionRepository } from "../repositories/compatibility-version.repository.js";
import { HistoricalMarketStateRepository } from "../repositories/historical-market-state.repository.js";
import { writeArtifact } from "../operations/semantic-expansion/shared.js";

const metadataVersion = "limitless-live-bootstrap-v1";

export interface LimitlessLiveIngestionSummary {
  observedAt: string;
  metadataVersion: string;
  selectedMarkets: number;
  insertedStates: number;
  skippedStates: number;
  fetchedFromLiveSurface: boolean;
  sources: readonly string[];
  families: Record<string, number>;
  assets: Record<string, number>;
  categories: Record<string, number>;
  selected: ReadonlyArray<{
    venueMarketId: string;
    title: string;
    category: string;
    family: string;
    asset: string | null;
    sourceRef: string;
  }>;
}

const toHistoricalState = (market: LimitlessLiveMarket): CreateHistoricalMarketStateInput => ({
  canonicalEventId: buildLimitlessLiveSeed(market, metadataVersion).canonicalEventId,
  canonicalMarketId: buildLimitlessLiveSeed(market, metadataVersion).canonicalMarketId,
  canonicalCategory: (["SPORTS", "CRYPTO", "POLITICS", "ESPORTS", "OTHER"].includes(market.canonicalCategory)
    ? market.canonicalCategory
    : "OTHER") as HistoricalCanonicalCategory,
  venue: "LIMITLESS",
  venueMarketId: market.venueMarketId,
  marketClass: HistoricalMarketClass.BINARY,
  timestamp: market.fetchedAt,
  volume: market.volume,
  openInterest: market.openInterest,
  orderbookSnapshot: {
    source: "limitless_live_market_loader",
    title: market.title,
    slug: market.slug,
    status: market.status,
    liquidity: market.liquidity,
    categories: market.categories,
    tags: market.tags
  },
  marketEvents: {
    source: "limitless_live_market_loader",
    createdAt: market.createdAt?.toISOString() ?? null,
    updatedAt: market.updatedAt?.toISOString() ?? null,
    sourceRef: market.sourceRef
  },
  metadataVersion,
  sourceTimestamp: market.fetchedAt
});

export const runLimitlessLiveMarketIngestion = async (input: {
  repoRoot: string;
  pool: Pool;
  categories?: readonly string[];
  fetchRemote?: boolean;
}): Promise<LimitlessLiveIngestionSummary> => {
  const loaded = await loadLimitlessLiveMarkets({
    repoRoot: input.repoRoot,
    ...(input.fetchRemote === undefined ? {} : { fetchRemote: input.fetchRemote })
  });
  const categories = new Set((input.categories ?? ["CRYPTO", "SPORTS", "ESPORTS", "POLITICS"]).map((value) => value.toUpperCase()));
  const selectedMarkets = loaded.markets.filter((market) => categories.has(market.canonicalCategory));
  const seeds = selectedMarkets.map((market) => buildLimitlessLiveSeed(market, metadataVersion));
  const states = selectedMarkets.map((market) => toHistoricalState(market));

  const projector = new CanonicalGraphProjector(
    new CanonicalGraphRepository(input.pool),
    new CanonicalCompatibilityProjector(
      new CanonicalCompatibilityRepository(input.pool),
      new CompatibilityVersionRepository(input.pool)
    )
  );
  const historyRepository = new HistoricalMarketStateRepository(input.pool);

  if (seeds.length > 0) {
    await projector.persistAndProject(new CuratedCanonicalGraphSnapshotBuilder().build(seeds));
  }

  const result = await historyRepository.insertManyIgnoreDuplicates(states);
  const summary: LimitlessLiveIngestionSummary = {
    observedAt: new Date().toISOString(),
    metadataVersion,
    selectedMarkets: selectedMarkets.length,
    insertedStates: result.inserted,
    skippedStates: result.skipped,
    fetchedFromLiveSurface: loaded.summary.fetchedFromLiveSurface,
    sources: loaded.summary.sourceRefs,
    families: selectedMarkets.reduce<Record<string, number>>((accumulator, market) => {
      accumulator[market.family] = (accumulator[market.family] ?? 0) + 1;
      return accumulator;
    }, {}),
    assets: selectedMarkets.reduce<Record<string, number>>((accumulator, market) => {
      const key = market.asset ?? "UNKNOWN";
      accumulator[key] = (accumulator[key] ?? 0) + 1;
      return accumulator;
    }, {}),
    categories: selectedMarkets.reduce<Record<string, number>>((accumulator, market) => {
      accumulator[market.canonicalCategory] = (accumulator[market.canonicalCategory] ?? 0) + 1;
      return accumulator;
    }, {}),
    selected: selectedMarkets.map((market) => ({
      venueMarketId: market.venueMarketId,
      title: market.title,
      category: market.canonicalCategory,
      family: market.family,
      asset: market.asset,
      sourceRef: market.sourceRef
    }))
  };

  writeArtifact(input.repoRoot, "docs/limitless-live-ingestion-summary.json", summary);
  return summary;
};
