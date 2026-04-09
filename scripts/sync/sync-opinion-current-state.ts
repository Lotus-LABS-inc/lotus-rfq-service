#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import { CanonicalGraphProjector } from "../src/canonical/canonical-graph-projector.js";
import { CanonicalCompatibilityProjector } from "../src/canonical/canonical-compatibility-projector.js";
import { CuratedCanonicalGraphSnapshotBuilder } from "../src/canonical/curated-canonical-graph.js";
import { HistoricalMarketClass, type CreateHistoricalMarketStateInput } from "../src/core/historical-simulation/historical-simulation.types.js";
import { OpinionClient } from "../src/integrations/opinion/opinion-client.js";
import { OpinionMarketAdapter } from "../src/integrations/opinion/opinion-market-adapter.js";
import type { OpinionNormalizedMarket } from "../src/integrations/opinion/opinion-types.js";
import { CanonicalCompatibilityRepository } from "../src/repositories/canonical-compatibility.repository.js";
import { CanonicalGraphRepository } from "../src/repositories/canonical-graph.repository.js";
import { CompatibilityVersionRepository } from "../src/repositories/compatibility-version.repository.js";
import { HistoricalMarketStateRepository } from "../src/repositories/historical-market-state.repository.js";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

interface ParsedArgs {
  pageSize: number;
  maxPages: number;
  categories: readonly string[];
  maxPerCategory: number;
  marketIds: readonly string[] | null;
  includeClosed: boolean;
}

const metadataVersion = "opinion-current-bootstrap-v1";

const parseArgs = (): ParsedArgs => {
  const args = new Map<string, string>();
  for (const rawArg of process.argv.slice(2)) {
    if (!rawArg.startsWith("--")) {
      continue;
    }
    const [key, ...rest] = rawArg.slice(2).split("=");
    args.set(key, rest.join("="));
  }

  const parseIntArg = (key: string, fallback: string): number => {
    const value = Number.parseInt(args.get(key) ?? fallback, 10);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${key} must be a positive integer.`);
    }
    return value;
  };

  return {
    pageSize: parseIntArg("pageSize", "100"),
    maxPages: parseIntArg("maxPages", "20"),
    categories: (args.get("categories") ?? "POLITICS,CRYPTO,SPORTS,ESPORTS")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter((value) => value.length > 0),
    maxPerCategory: parseIntArg("maxPerCategory", "1"),
    marketIds: args.get("marketIds")
      ? [...new Set(args.get("marketIds")!.split(",").map((value) => value.trim()).filter((value) => value.length > 0))]
      : null,
    includeClosed: (args.get("includeClosed") ?? "false").toLowerCase() === "true"
  };
};

const databaseUrl = process.env.DATABASE_URL;
const opinionApiKey = process.env.OPINION_API_KEY;
const opinionBaseUrl = process.env.OPINION_OPENAPI_BASE_URL ?? "https://openapi.opinion.trade/openapi";

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

if (!opinionApiKey) {
  throw new Error("OPINION_API_KEY is required.");
}

const isActivatedMarket = (market: OpinionNormalizedMarket): boolean =>
  market.status?.toUpperCase() === "ACTIVATED" || market.statusCode === 2;

const selectMarketsByCategory = (
  markets: readonly OpinionNormalizedMarket[],
  adapter: OpinionMarketAdapter,
  categories: readonly string[],
  maxPerCategory: number,
  includeClosed: boolean
): readonly OpinionNormalizedMarket[] => {
  const selected: OpinionNormalizedMarket[] = [];
  const selectedIds = new Set<string>();

  for (const category of categories) {
    const matches = markets.filter((market) =>
      adapter.inferCanonicalCategory(market) === category
      && (includeClosed || isActivatedMarket(market))
      && !selectedIds.has(market.venueMarketId)
    );

    for (const market of matches.slice(0, maxPerCategory)) {
      selected.push(market);
      selectedIds.add(market.venueMarketId);
    }
  }

  return selected;
};

const fetchMarkets = async (
  client: OpinionClient,
  adapter: OpinionMarketAdapter,
  args: ParsedArgs
): Promise<readonly OpinionNormalizedMarket[]> => {
  if (args.marketIds) {
    const indexed = new Map<string, OpinionNormalizedMarket>();
    const remainingIds = new Set(args.marketIds);
    for (let page = 1; page <= args.maxPages && remainingIds.size > 0; page += 1) {
      const markets = await adapter.listMarkets({ page, limit: args.pageSize });
      for (const market of markets) {
        indexed.set(market.venueMarketId, market);
        remainingIds.delete(market.venueMarketId);
      }
    }
    return args.marketIds.map((marketId) => indexed.get(marketId)).filter((market): market is OpinionNormalizedMarket => market !== undefined);
  }

  const aggregated: OpinionNormalizedMarket[] = [];
  for (let page = 1; page <= args.maxPages; page += 1) {
    const markets = await adapter.listMarkets({ page, limit: args.pageSize });
    if (markets.length === 0) {
      break;
    }
    aggregated.push(...markets);
    if (markets.length < args.pageSize) {
      break;
    }
  }

  return selectMarketsByCategory(aggregated, adapter, args.categories, args.maxPerCategory, args.includeClosed);
};

const toHistoricalState = (
  market: OpinionNormalizedMarket,
  seed: ReturnType<OpinionMarketAdapter["buildCanonicalSeed"]>,
  fetchedAt: Date
): CreateHistoricalMarketStateInput => ({
  canonicalEventId: seed.canonicalEventId,
  canonicalMarketId: seed.canonicalMarketId,
  canonicalCategory: seed.canonicalCategory,
  venue: "OPINION",
  venueMarketId: market.venueMarketId,
  marketClass: HistoricalMarketClass.BINARY,
  timestamp: fetchedAt,
  midpoint: null,
  bestBid: null,
  bestAsk: null,
  spread: null,
  lastPrice: null,
  volume: market.volume,
  openInterest: null,
  orderbookSnapshot: {
    source: "opinion_current_state_bootstrap",
    market_title: market.title,
    labels: market.labels,
    status: market.status,
    yesLabel: market.yesLabel,
    noLabel: market.noLabel,
    volume24h: market.volume24h,
    volume7d: market.volume7d
  },
  marketEvents: {
    source: "opinion_current_state_bootstrap",
    status: market.status,
    statusCode: market.statusCode
  },
  metadataVersion,
  sourceTimestamp: fetchedAt
});

const persistBootstrap = async (
  pool: Pool,
  markets: readonly OpinionNormalizedMarket[],
  adapter: OpinionMarketAdapter,
  fetchedAt: Date
): Promise<{ inserted: number; skipped: number }> => {
  const seeds = markets.map((market) => adapter.buildCanonicalSeed(market));
  const states = markets.map((market, index) => toHistoricalState(market, seeds[index]!, fetchedAt));
  const projector = new CanonicalGraphProjector(
    new CanonicalGraphRepository(pool),
    new CanonicalCompatibilityProjector(
      new CanonicalCompatibilityRepository(pool),
      new CompatibilityVersionRepository(pool)
    )
  );
  const snapshotBuilder = new CuratedCanonicalGraphSnapshotBuilder();
  const historicalRepository = new HistoricalMarketStateRepository(pool);

  await pool.query(
    `DELETE FROM historical_market_states
      WHERE venue = 'OPINION'
        AND metadata_version = $1
        AND venue_market_id = ANY($2::text[])`,
    [metadataVersion, markets.map((market) => market.venueMarketId)]
  );
  await projector.persistAndProject(snapshotBuilder.build(seeds));
  return historicalRepository.insertManyIgnoreDuplicates(states);
};

const summarizeCategories = (
  markets: readonly OpinionNormalizedMarket[],
  adapter: OpinionMarketAdapter
): Record<string, number> =>
  markets.reduce<Record<string, number>>((accumulator, market) => {
    const category = adapter.inferCanonicalCategory(market);
    accumulator[category] = (accumulator[category] ?? 0) + 1;
    return accumulator;
  }, {});

const main = async (): Promise<void> => {
  const args = parseArgs();
  const fetchedAt = new Date();
  const client = new OpinionClient({
    baseUrl: opinionBaseUrl,
    apiKey: opinionApiKey
  });
  const adapter = new OpinionMarketAdapter({
    client,
    metadataVersion
  });
  const markets = await fetchMarkets(client, adapter, args);
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "sync-opinion-current-state"
  });

  try {
    const result = await persistBootstrap(pool, markets, adapter, fetchedAt);
    console.log(JSON.stringify({
      fetchedAt: fetchedAt.toISOString(),
      selectedMarkets: markets.length,
      categories: summarizeCategories(markets, adapter),
      insertedStates: result.inserted,
      skippedStates: result.skipped,
      selected: markets.map((market) => ({
        marketId: market.venueMarketId,
        title: market.title,
        category: adapter.inferCanonicalCategory(market),
        status: market.status
      }))
    }, null, 2));
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error("Failed to sync Opinion current state.");
  console.error(error);
  process.exit(1);
});
