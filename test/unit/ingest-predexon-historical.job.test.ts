import { beforeEach, describe, expect, it, vi } from "vitest";

import { metricsRegistry } from "../../src/observability/metrics.js";
import {
  PredexonHistoricalIngestionJob,
  PredexonMappedMarketScopeProvider,
  PredexonHistoricalScopeProvider
} from "../../src/jobs/ingest-predexon-historical.job.js";

const metricValue = async (name: string, labels: Record<string, string>): Promise<number> => {
  const metric = metricsRegistry.getSingleMetric(name);
  if (!metric) {
    throw new Error(`Missing metric ${name}`);
  }

  const metrics = await metric.get();
  const sample = metrics.values.find((value) =>
    Object.entries(labels).every(([key, expected]) => value.labels[key] === expected)
  );

  return sample?.value ?? 0;
};

describe("PredexonHistoricalScopeProvider", () => {
  it("filters to sports and crypto discovery metadata only", async () => {
    const adapter = {
      listHistoricalEvents: vi
        .fn()
        .mockResolvedValueOnce([{ slug: "sports-1", raw: {}, eventId: "e1", title: "A", category: "sports", status: null, startDate: null, endDate: null }])
        .mockResolvedValueOnce([{ slug: "crypto-1", raw: {}, eventId: "e2", title: "B", category: "crypto", status: null, startDate: null, endDate: null }]),
      listHistoricalMarkets: vi
        .fn()
        .mockResolvedValueOnce([{ conditionId: "condition-sports", raw: {}, marketId: null, title: "Sports", eventId: null, eventSlug: "sports-1", marketSlug: null, tokenIds: [], status: null, volume: null, liquidity: null }])
        .mockResolvedValueOnce([{ conditionId: "condition-crypto", raw: {}, marketId: null, title: "Crypto", eventId: null, eventSlug: "crypto-1", marketSlug: null, tokenIds: [], status: null, volume: null, liquidity: null }])
      };

    const provider = new PredexonHistoricalScopeProvider(adapter as never);
    const result = await provider.listScopedMarkets({ categories: ["sports", "crypto"] });

    expect(result.map((entry) => entry.category)).toEqual(["sports", "crypto"]);
    expect(adapter.listHistoricalEvents).toHaveBeenCalledWith({ category: "sports" });
    expect(adapter.listHistoricalEvents).toHaveBeenCalledWith({ category: "crypto" });
  });
});

describe("PredexonMappedMarketScopeProvider", () => {
  it("returns mapped sports, crypto, politics, and esports scopes across supported venues", async () => {
    const adapter = {
      listHistoricalEvents: vi.fn(async ({ category }: { category: string }) => [
        { slug: `${category}-event`, raw: {}, eventId: `${category}-event-id`, title: `${category} event`, category, status: null, startDate: null, endDate: null }
      ]),
      listHistoricalMarkets: vi.fn(async () => [
        {
          conditionId: "poly-condition-1",
          marketId: null,
          title: "Mapped polymarket market",
          eventId: null,
          eventSlug: "sports-event",
          marketSlug: null,
          tokenIds: ["token-1"],
          status: null,
          volume: null,
          liquidity: null,
          raw: {}
        }
      ])
    };
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            venue: "POLYMARKET",
            venue_market_id: "poly-condition-1",
            canonical_event_id: "11111111-1111-4111-8111-111111111111",
            canonical_market_id: "POLYMARKET-NBA-LAL-ORL-2026-03-21-LAKERS-WIN",
            canonical_category: "SPORTS",
            title: "Sports market"
          },
          {
            venue: "LIMITLESS",
            venue_market_id: "limitless-btc-90k",
            canonical_event_id: "22222222-2222-4222-8222-222222222222",
            canonical_market_id: "LIMITLESS-BTC-ABOVE-90K",
            canonical_category: "CRYPTO",
            title: "Crypto market"
          },
          {
            venue: "OPINION",
            venue_market_id: "opinion-election-dem",
            canonical_event_id: "66666666-6666-4666-8666-666666666666",
            canonical_market_id: "US-ELECTION-2028-DEMOCRATIC-WINS",
            canonical_category: "POLITICS",
            title: "Politics market"
          },
          {
            venue: "OPINION",
            venue_market_id: "opinion-lol-t1",
            canonical_event_id: "77777777-7777-4777-8777-777777777777",
            canonical_market_id: "LOL-WORLDS-2026-T1-WINS",
            canonical_category: "ESPORTS",
            metadata_canonical_category: null,
            title: "Esports market"
          },
          {
            venue: "LIMITLESS",
            venue_market_id: "limitless-eth-live",
            canonical_event_id: "99999999-9999-4999-8999-999999999999",
            canonical_market_id: "LIVE-LIMITLESS-ETH",
            canonical_category: null,
            metadata_canonical_category: "CRYPTO",
            title: "Live metadata category market"
          }
        ]
      }))
    };

    const provider = new PredexonMappedMarketScopeProvider({
      adapter: adapter as never,
      pool: pool as never
    });

    const result = await provider.listScopedMarkets({
      categories: ["sports", "crypto", "politics", "esports"]
    });

    expect(result.length).toBe(5);
    expect(new Set(result.map((scope) => scope.category))).toEqual(new Set(["sports", "crypto", "politics", "esports"]));
    expect(result.find((scope) => scope.venue === "LIMITLESS")?.market.marketSlug).toBe("limitless-btc-90k");
    expect(result.find((scope) => scope.venue === "OPINION" && scope.category === "politics")?.market.marketId).toBe("opinion-election-dem");
    expect(result.find((scope) => scope.venue === "POLYMARKET")?.market.conditionId).toBe("poly-condition-1");
    expect(result.find((scope) => scope.market.conditionId === "limitless-eth-live")?.category).toBe("crypto");
  });
});

describe("PredexonHistoricalIngestionJob", () => {
  beforeEach(() => {
    metricsRegistry.resetMetrics();
  });

  it("uses incremental watermark and counts only inserted rows", async () => {
    const scopeProvider = {
      listScopedMarkets: vi.fn(async () => [
        {
          category: "sports" as const,
          event: { raw: {}, slug: "sports-1", eventId: "e1", title: "Event", category: "sports", status: null, startDate: null, endDate: null },
          market: {
            conditionId: "condition-1",
            tokenIds: ["token-1"],
            raw: {},
            marketId: null,
            title: "Market",
            eventId: null,
            eventSlug: "sports-1",
            marketSlug: null,
            status: null,
            volume: null,
            liquidity: null
          }
        }
      ])
    };
    const buildCandleStateFragments = vi.fn(async () => [
      {
        canonicalEventId: "UNMAPPED_CANONICAL_EVENT",
        venue: "POLYMARKET",
        venueMarketId: "condition-1",
        marketClass: "BINARY",
        timestamp: new Date("2026-03-13T00:00:05.000Z"),
        metadataVersion: "predexon-v2",
        sourceTimestamp: new Date("2026-03-13T00:00:05.000Z")
      }
    ]);
    const buildOrderbookStateFragments = vi.fn(async () => []);
    const adapter = {
      getVenueAdapter: () => ({ metadataVersion: "predexon-v2" }),
      buildCandleStateFragments,
      buildVolumeOpenInterestFragments: vi.fn(async () => []),
      buildOrderbookStateFragments,
      buildTradeStateFragments: vi.fn(async () => [])
    } as never;
    const repository = {
      getLatestSourceTimestamp: vi.fn(async () => new Date("2026-03-13T00:00:04.000Z")),
      insertManyIgnoreDuplicates: vi.fn(async () => ({ inserted: 1, skipped: 0 }))
    };
    const canonicalNormalizer = {
      normalize: vi.fn(async ({ records }: { records: readonly { state: { timestamp: Date } }[] }) =>
        records.map((record) => ({
          state: record.state,
          canonicalCategory: "SPORTS",
          resolutionRiskSnapshot: null,
          timelineSliceStart: record.state.timestamp,
          safeEquivalentEligible: true,
          mappingMetadata: {
            canonicalEventId: "canonical-event-1",
            canonicalCategory: "SPORTS"
          }
        }))
      )
    } as never;

    const job = new PredexonHistoricalIngestionJob({
      adapter,
      canonicalNormalizer,
      repository,
      scopeProvider
    });

    const result = await job.run({
      mode: "incremental",
      windowStart: new Date("2026-03-13T00:00:00.000Z"),
      windowEnd: new Date("2026-03-13T00:01:00.000Z"),
      batchSize: 100
    });

    expect(buildCandleStateFragments).toHaveBeenCalledWith(
      expect.objectContaining({ venue: "POLYMARKET", venueMarketId: "condition-1" }),
      {
        condition_id: "condition-1",
        start_time: 1_773_360_005,
        end_time: 1_773_360_060,
        interval: 60
      }
    );
    expect(buildOrderbookStateFragments).toHaveBeenCalledWith(
      expect.objectContaining({ venue: "POLYMARKET", venueMarketId: "condition-1" }),
      {
        token_id: "token-1",
        start_time: 1_773_360_005_001,
        end_time: 1_773_360_060_000
      }
    );
    expect(result.insertedRows).toBe(1);
    expect(await metricValue("historical_rows_written_total", { venue: "POLYMARKET", mode: "incremental" })).toBe(1);
    expect(await metricValue("historical_ingest_runs_total", { venue: "POLYMARKET", mode: "incremental", status: "success" })).toBe(1);
  });

  it("continues after normalization failure and increments failure metrics", async () => {
    const scopeProvider = {
      listScopedMarkets: vi.fn(async () => [
        {
          category: "sports" as const,
          event: { raw: {}, slug: "sports-1", eventId: "e1", title: "Event", category: "sports", status: null, startDate: null, endDate: null },
          market: {
            conditionId: "condition-1",
            tokenIds: [],
            raw: {},
            marketId: null,
            title: "Market",
            eventId: null,
            eventSlug: "sports-1",
            marketSlug: null,
            status: null,
            volume: null,
            liquidity: null
          }
        }
      ])
    };
    const adapter = {
      getVenueAdapter: () => ({ metadataVersion: "predexon-v2" }),
      buildCandleStateFragments: vi.fn(async () => []),
      buildVolumeOpenInterestFragments: vi.fn(async () => []),
      buildOrderbookStateFragments: vi.fn(async () => []),
      buildTradeStateFragments: vi.fn(async () => [])
    } as never;
    const repository = {
      getLatestSourceTimestamp: vi.fn(async () => null),
      insertManyIgnoreDuplicates: vi.fn(async () => ({ inserted: 0, skipped: 0 }))
    };
    const canonicalNormalizer = {
      normalize: vi.fn(async () => {
        throw new Error("normalization_failed");
      })
    } as never;

    const job = new PredexonHistoricalIngestionJob({
      adapter,
      canonicalNormalizer,
      repository,
      scopeProvider
    });

    const result = await job.run({
      mode: "backfill",
      windowStart: new Date("2026-03-13T00:00:00.000Z"),
      windowEnd: new Date("2026-03-13T00:01:00.000Z"),
      batchSize: 100
    });

    expect(result.failedScopes).toBe(1);
    expect(await metricValue("historical_ingest_failures_total", { venue: "POLYMARKET", stage: "scope" })).toBe(1);
  });

  it("supports Limitless orderbook ingestion through Predexon with a configured scope provider", async () => {
    const scopeProvider = {
      listScopedMarkets: vi.fn(async () => [
        {
          category: "crypto" as const,
          venue: "LIMITLESS" as const,
          event: { raw: {}, slug: "btc", eventId: "e2", title: "BTC", category: "crypto", status: null, startDate: null, endDate: null },
          market: {
            conditionId: "fallback-limitless-id",
            marketSlug: "limitless-btc-90k",
            tokenIds: [],
            raw: {},
            marketId: null,
            title: "Limitless BTC 90K",
            eventId: null,
            eventSlug: "btc",
            status: null,
            volume: null,
            liquidity: null
          }
        }
      ])
    };
    const buildLimitlessOrderbookStateFragments = vi.fn(async () => [
      {
        canonicalEventId: "UNMAPPED_CANONICAL_EVENT",
        venue: "LIMITLESS",
        venueMarketId: "limitless-btc-90k",
        marketClass: "BINARY",
        timestamp: new Date("2026-03-13T00:00:05.000Z"),
        metadataVersion: "predexon-v2",
        sourceTimestamp: new Date("2026-03-13T00:00:05.000Z")
      }
    ]);
    const adapter = {
      getVenueAdapter: () => ({ metadataVersion: "predexon-v2" }),
      buildCandleStateFragments: vi.fn(async () => []),
      buildVolumeOpenInterestFragments: vi.fn(async () => []),
      buildOrderbookStateFragments: vi.fn(async () => []),
      buildTradeStateFragments: vi.fn(async () => []),
      buildLimitlessOrderbookStateFragments,
      buildOpinionOrderbookStateFragments: vi.fn(async () => [])
    } as never;
    const repository = {
      getLatestSourceTimestamp: vi.fn(async () => null),
      insertManyIgnoreDuplicates: vi.fn(async () => ({ inserted: 1, skipped: 0 }))
    };
    const canonicalNormalizer = {
      normalize: vi.fn(async ({ records }: { records: readonly { state: { timestamp: Date } }[] }) =>
        records.map((record) => ({
          state: record.state,
          canonicalCategory: "CRYPTO",
          resolutionRiskSnapshot: null,
          timelineSliceStart: record.state.timestamp,
          safeEquivalentEligible: true,
          mappingMetadata: {
            canonicalEventId: "canonical-event-2",
            canonicalCategory: "CRYPTO"
          }
        }))
      )
    } as never;

    const job = new PredexonHistoricalIngestionJob({
      adapter,
      canonicalNormalizer,
      repository,
      scopeProvider,
      venue: "LIMITLESS"
    });

    const result = await job.run({
      mode: "backfill",
      windowStart: new Date("2026-03-13T00:00:00.000Z"),
      windowEnd: new Date("2026-03-13T00:01:00.000Z"),
      batchSize: 100
    });

    expect(buildLimitlessOrderbookStateFragments).toHaveBeenCalledWith(
      expect.objectContaining({ venue: "LIMITLESS", venueMarketId: "limitless-btc-90k" }),
      expect.objectContaining({ market_slug: "limitless-btc-90k" })
    );
    expect(result.venue).toBe("LIMITLESS");
    expect(result.insertedRows).toBe(1);
  });
});
