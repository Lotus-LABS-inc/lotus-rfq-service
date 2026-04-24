#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { CanonicalGraphProjector } from "../../src/canonical/canonical-graph-projector.js";
import { CanonicalCompatibilityProjector } from "../../src/canonical/canonical-compatibility-projector.js";
import { CuratedCanonicalGraphSnapshotBuilder, type CuratedCanonicalGraphSeed } from "../../src/canonical/curated-canonical-graph.js";
import { HistoricalMarketClass, type CreateHistoricalMarketStateInput } from "../../src/core/historical-simulation/historical-simulation.types.js";
import { PredictClient, PredictClientError } from "../../src/integrations/predict/predict-client.js";
import { PredictMarketAdapter } from "../../src/integrations/predict/predict-market-adapter.js";
import { PredictOrderbookAdapter } from "../../src/integrations/predict/predict-orderbook-adapter.js";
import type { PredictEnvironment, PredictNormalizedMarket, PredictNormalizedOrderbookSnapshot } from "../../src/integrations/predict/predict-types.js";
import { CanonicalCompatibilityRepository } from "../../src/repositories/canonical-compatibility.repository.js";
import { CanonicalGraphRepository } from "../../src/repositories/canonical-graph.repository.js";
import { CompatibilityVersionRepository } from "../../src/repositories/compatibility-version.repository.js";
import { HistoricalMarketStateRepository } from "../../src/repositories/historical-market-state.repository.js";
import { PredictBootstrapRepository } from "../../src/repositories/predict-bootstrap.repository.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

interface ParsedArgs {
  environment: PredictEnvironment;
  pageSize: number;
  maxPages: number;
  categories: readonly string[];
  maxPerCategory: number;
  marketIds: readonly string[] | null;
}

const parseArgs = (): ParsedArgs => {
  const args = new Map<string, string>();
  for (const rawArg of process.argv.slice(2)) {
    if (!rawArg.startsWith("--")) {
      continue;
    }
    const [key, ...rest] = rawArg.slice(2).split("=");
    args.set(key, rest.join("="));
  }

  const environment = (args.get("environment") ?? "mainnet") as PredictEnvironment;
  if (environment !== "mainnet" && environment !== "testnet") {
    throw new Error(`Invalid Predict environment: ${environment}`);
  }

  const pageSize = Number.parseInt(args.get("pageSize") ?? "50", 10);
  const maxPages = Number.parseInt(args.get("maxPages") ?? "5", 10);
  if (!Number.isFinite(pageSize) || pageSize <= 0) {
    throw new Error("pageSize must be a positive integer.");
  }
  if (!Number.isFinite(maxPages) || maxPages <= 0) {
    throw new Error("maxPages must be a positive integer.");
  }

  const marketIdsArg = args.get("marketIds");
  const marketIds = marketIdsArg
    ? [...new Set(marketIdsArg.split(",").map((value) => value.trim()).filter((value) => value.length > 0))]
    : null;

  const maxPerCategory = Number.parseInt(args.get("maxPerCategory") ?? "1", 10);
  if (!Number.isFinite(maxPerCategory) || maxPerCategory <= 0) {
    throw new Error("maxPerCategory must be a positive integer.");
  }

  return {
    environment,
    pageSize,
    maxPages,
    categories: (args.get("categories") ?? "POLITICS,CRYPTO,SPORTS,ESPORTS")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter((value) => value.length > 0),
    maxPerCategory,
    marketIds
  };
};

const databaseUrl = process.env.DATABASE_URL;
const predictApiKey = process.env.PREDICT_API_KEY;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

if (!predictApiKey) {
  throw new Error("PREDICT_API_KEY is required.");
}

const metadataVersion = "predict-current-bootstrap-v1";

const selectMarketsByCategory = (
  markets: readonly PredictNormalizedMarket[],
  adapter: PredictMarketAdapter,
  categories: readonly string[],
  maxPerCategory: number
): readonly PredictNormalizedMarket[] => {
  const selected: PredictNormalizedMarket[] = [];
  const selectedIds = new Set<string>();

  for (const category of categories) {
    const matches = markets.filter((market) =>
      adapter.inferCanonicalCategory(market) === category && !selectedIds.has(market.venueMarketId)
    );
    for (const market of matches.slice(0, maxPerCategory)) {
      selected.push(market);
      selectedIds.add(market.venueMarketId);
    }
  }

  return selected;
};

const toHistoricalState = (
  market: PredictNormalizedMarket,
  seed: CuratedCanonicalGraphSeed,
  orderbook: PredictNormalizedOrderbookSnapshot | null,
  fetchedAt: Date
): CreateHistoricalMarketStateInput => ({
  canonicalEventId: seed.canonicalEventId,
  canonicalMarketId: seed.canonicalMarketId,
  canonicalCategory: seed.canonicalCategory,
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
        source: "predict_current_state_bootstrap",
        environment: market.environment,
        bestBid: orderbook.bestBid,
        bestAsk: orderbook.bestAsk,
        midpoint: orderbook.midpoint,
        spread: orderbook.spread,
        topOfBookSize: orderbook.topOfBookSize,
        raw: orderbook.raw
      }
    : {
        source: "predict_current_state_bootstrap",
        environment: market.environment,
        orderbookUnavailable: true
      },
  marketEvents: {
    source: "predict_current_state_bootstrap",
    status: market.status
  },
  metadataVersion,
  sourceTimestamp: orderbook?.sourceTimestamp ?? fetchedAt
});

const summarizeCategories = (
  markets: readonly PredictNormalizedMarket[],
  adapter: PredictMarketAdapter
): Record<string, number> =>
  markets.reduce<Record<string, number>>((accumulator, market) => {
    const category = adapter.inferCanonicalCategory(market);
    accumulator[category] = (accumulator[category] ?? 0) + 1;
    return accumulator;
  }, {});

const deleteExistingCurrentStateRows = async (
  pool: Pool,
  marketIds: readonly string[]
): Promise<void> => {
  if (marketIds.length === 0) {
    return;
  }

  await pool.query(
    `DELETE FROM historical_market_states
      WHERE venue = 'PREDICT'
        AND metadata_version = $1
        AND venue_market_id = ANY($2::text[])`,
    [metadataVersion, marketIds]
  );
};

const main = async (): Promise<void> => {
  const args = parseArgs();
  const fetchedAt = new Date();
  const client = new PredictClient({
    environment: args.environment,
    apiKey: predictApiKey
  });
  const marketAdapter = new PredictMarketAdapter({
    client,
    environment: args.environment,
    metadataVersion
  });
  const orderbookAdapter = new PredictOrderbookAdapter({
    client,
    environment: args.environment
  });

  const markets = args.marketIds
    ? await Promise.all(args.marketIds.map((marketId) => marketAdapter.getMarketById(marketId)))
    : await (async (): Promise<readonly PredictNormalizedMarket[]> => {
        const aggregated: PredictNormalizedMarket[] = [];
        for (let page = 1; page <= args.maxPages; page += 1) {
          const batch = await client.getMarkets({ page, limit: args.pageSize });
          if (batch.length === 0) {
            break;
          }
          const enrichedBatch = await Promise.all(
            batch.map((market) => marketAdapter.getMarketById(String(market.id)))
          );
          aggregated.push(...enrichedBatch);
          if (batch.length < args.pageSize) {
            break;
          }
        }
        return selectMarketsByCategory(aggregated, marketAdapter, args.categories, args.maxPerCategory);
      })();

  const uniqueMarkets = [...new Map(markets.map((market) => [market.venueMarketId, market])).values()];

  const orderbookResults = await Promise.all(
    uniqueMarkets.map(async (market) => {
      try {
        return [market.venueMarketId, await orderbookAdapter.getOrderbookSnapshot(market.venueMarketId)] as const;
      } catch (error) {
        if (error instanceof PredictClientError && error.status === 404) {
          return [market.venueMarketId, null] as const;
        }
        console.warn(`Predict orderbook unavailable for ${market.venueMarketId}.`, error);
        return [market.venueMarketId, null] as const;
      }
    })
  );

  const orderbookByMarketId = new Map<string, PredictNormalizedOrderbookSnapshot | null>(orderbookResults);
  const canonicalSeeds = uniqueMarkets.map((market) => marketAdapter.buildCanonicalSeed({ market }));
  const seedByMarketId = new Map(canonicalSeeds.map((seed) => [seed.venueMarketId, seed]));
  const historicalStates = uniqueMarkets.map((market) =>
    toHistoricalState(
      market,
      seedByMarketId.get(market.venueMarketId)!,
      orderbookByMarketId.get(market.venueMarketId) ?? null,
      fetchedAt
    )
  );

  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "sync-predict-current-state"
  });

  try {
    const projector = new CanonicalGraphProjector(
      new CanonicalGraphRepository(pool),
      new CanonicalCompatibilityProjector(
        new CanonicalCompatibilityRepository(pool),
        new CompatibilityVersionRepository(pool)
      )
    );
    const snapshotBuilder = new CuratedCanonicalGraphSnapshotBuilder();
    const bootstrapRepository = new PredictBootstrapRepository(pool);
    const historicalRepository = new HistoricalMarketStateRepository(pool);

    await deleteExistingCurrentStateRows(pool, uniqueMarkets.map((market) => market.venueMarketId));
    await projector.persistAndProject(snapshotBuilder.build(canonicalSeeds));
    const metadataUpserts = await bootstrapRepository.upsertMarketMetadata(uniqueMarkets);
    const orderbookInserts = await bootstrapRepository.insertOrderbookSnapshots(
      [...orderbookByMarketId.values()]
        .filter((snapshot): snapshot is PredictNormalizedOrderbookSnapshot => snapshot !== null)
        .map((snapshot) => PredictBootstrapRepository.toPersistedOrderbookSnapshot(snapshot))
    );
    const historicalInsertResult = await historicalRepository.insertManyIgnoreDuplicates(historicalStates);

    console.log(
      JSON.stringify(
        {
          environment: args.environment,
          fetchedMarkets: uniqueMarkets.length,
          categories: summarizeCategories(uniqueMarkets, marketAdapter),
          canonicalSeeds: canonicalSeeds.length,
          metadataUpserts,
          orderbookSnapshotsPersisted: orderbookInserts,
          historicalStatesInserted: historicalInsertResult.inserted,
          historicalStatesSkipped: historicalInsertResult.skipped,
          withOrderbook: [...orderbookByMarketId.values()].filter((snapshot) => snapshot !== null).length,
          withoutOrderbook: [...orderbookByMarketId.values()].filter((snapshot) => snapshot === null).length,
          fetchedAt: fetchedAt.toISOString()
        },
        null,
        2
      )
    );
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to sync Predict current state.");
  console.error(error);
  process.exit(1);
});
