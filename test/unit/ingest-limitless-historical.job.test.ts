import { beforeEach, describe, expect, it, vi } from "vitest";

import { metricsRegistry } from "../../src/observability/metrics.js";
import { LimitlessHistoricalIngestionJob } from "../../src/jobs/ingest-limitless-historical.job.js";

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

describe("LimitlessHistoricalIngestionJob", () => {
  beforeEach(() => {
    metricsRegistry.resetMetrics();
  });

  it("uses seeded slugs and incremental watermark for later-only ingestion", async () => {
    const buildHistoricalPriceFragments = vi.fn(async () => [
      {
        canonicalEventId: "UNMAPPED_CANONICAL_EVENT",
        venue: "LIMITLESS",
        venueMarketId: "btc-above-100k",
        marketClass: "BINARY",
        timestamp: new Date("2026-03-13T00:00:05.000Z"),
        metadataVersion: "limitless-v1",
        sourceTimestamp: new Date("2026-03-13T00:00:05.000Z")
      }
    ]);
    const buildMarketEventFragments = vi
      .fn()
      .mockResolvedValueOnce([
        {
          canonicalEventId: "UNMAPPED_CANONICAL_EVENT",
          venue: "LIMITLESS",
          venueMarketId: "btc-above-100k",
          marketClass: "BINARY",
          timestamp: new Date("2026-03-13T00:00:06.000Z"),
          metadataVersion: "limitless-v1",
          sourceTimestamp: new Date("2026-03-13T00:00:06.000Z")
        }
      ])
      .mockResolvedValueOnce([]);

    const adapter = {
      getVenueAdapter: () => ({ metadataVersion: "limitless-v1" }),
      getHistoricalMarket: vi.fn(async () => ({
        raw: {},
        address: null,
        slug: "btc-above-100k",
        title: "BTC",
        status: "FUNDED",
        tradeType: "clob",
        marketType: "single",
        volume: null,
        openInterest: null,
        liquidity: null,
        venue: null
      })),
      buildHistoricalPriceFragments,
      buildMarketEventFragments,
      buildPortfolioHistoryFragments: vi.fn(async () => [])
    } as never;
    const repository = {
      getLatestSourceTimestamp: vi.fn(async () => new Date("2026-03-13T00:00:04.000Z")),
      insertManyIgnoreDuplicates: vi.fn(async () => ({ inserted: 1, skipped: 1 }))
    };
    const canonicalNormalizer = {
      normalize: vi.fn(async ({ records }: { records: readonly { state: { timestamp: Date } }[] }) =>
        records.map((record) => ({
          state: { ...record.state, canonicalEventId: "canonical-event-1" },
          canonicalCategory: "CRYPTO",
          resolutionRiskSnapshot: null,
          timelineSliceStart: record.state.timestamp,
          safeEquivalentEligible: true,
          mappingMetadata: {
            canonicalEventId: "canonical-event-1",
            canonicalCategory: "CRYPTO"
          }
        }))
      )
    } as never;
    const scopeProvider = {
      listScopedMarkets: vi.fn(async () => [{ slug: "btc-above-100k", category: "crypto" as const }])
    };

    const job = new LimitlessHistoricalIngestionJob({
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

    expect(scopeProvider.listScopedMarkets).toHaveBeenCalledWith({ categories: ["sports", "crypto"] });
    expect(buildHistoricalPriceFragments).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        from: "2026-03-13T00:00:04.001Z"
      })
    );
    expect(result.insertedRows).toBe(1);
    expect(result.skippedRows).toBe(1);
    expect(await metricValue("historical_rows_written_total", { venue: "LIMITLESS", mode: "incremental" })).toBe(1);
  });

  it("optionally ingests own execution history and stops event paging when page falls before window", async () => {
    const buildMarketEventFragments = vi
      .fn()
      .mockResolvedValueOnce([
        {
          canonicalEventId: "UNMAPPED_CANONICAL_EVENT",
          venue: "LIMITLESS",
          venueMarketId: "sports-game",
          marketClass: "BINARY",
          timestamp: new Date("2026-03-13T00:00:30.000Z"),
          metadataVersion: "limitless-v1",
          sourceTimestamp: new Date("2026-03-13T00:00:30.000Z")
        }
      ])
      .mockResolvedValueOnce([
        {
          canonicalEventId: "UNMAPPED_CANONICAL_EVENT",
          venue: "LIMITLESS",
          venueMarketId: "sports-game",
          marketClass: "BINARY",
          timestamp: new Date("2026-03-12T23:50:00.000Z"),
          metadataVersion: "limitless-v1",
          sourceTimestamp: new Date("2026-03-12T23:50:00.000Z")
        }
      ]);

    const adapter = {
      getVenueAdapter: () => ({ metadataVersion: "limitless-v1" }),
      getHistoricalMarket: vi.fn(async () => ({
        raw: {},
        address: null,
        slug: "sports-game",
        title: "Game",
        status: "FUNDED",
        tradeType: "clob",
        marketType: "single",
        volume: null,
        openInterest: null,
        liquidity: null,
        venue: null
      })),
      buildHistoricalPriceFragments: vi.fn(async () => []),
      buildMarketEventFragments,
      buildPortfolioHistoryFragments: vi.fn(async () => [
        {
          canonicalEventId: "UNMAPPED_CANONICAL_EVENT",
          venue: "LIMITLESS",
          venueMarketId: "sports-game",
          marketClass: "BINARY",
          timestamp: new Date("2026-03-13T00:00:40.000Z"),
          metadataVersion: "limitless-v1",
          sourceTimestamp: new Date("2026-03-13T00:00:40.000Z")
        }
      ])
    } as never;
    const repository = {
      getLatestSourceTimestamp: vi.fn(async () => null),
      insertManyIgnoreDuplicates: vi.fn(async () => ({ inserted: 2, skipped: 0 }))
    };
    const canonicalNormalizer = {
      normalize: vi.fn(async ({ records }: { records: readonly { state: { timestamp: Date } }[] }) =>
        records.map((record) => ({
          state: { ...record.state, canonicalEventId: "canonical-event-2" },
          canonicalCategory: "SPORTS",
          resolutionRiskSnapshot: null,
          timelineSliceStart: record.state.timestamp,
          safeEquivalentEligible: true,
          mappingMetadata: {
            canonicalEventId: "canonical-event-2",
            canonicalCategory: "SPORTS"
          }
        }))
      )
    } as never;
    const scopeProvider = {
      listScopedMarkets: vi.fn(async () => [{ slug: "sports-game", category: "sports" as const }])
    };

    const job = new LimitlessHistoricalIngestionJob({
      adapter,
      canonicalNormalizer,
      repository,
      scopeProvider
    });

    const result = await job.run({
      mode: "backfill",
      windowStart: new Date("2026-03-13T00:00:00.000Z"),
      windowEnd: new Date("2026-03-13T00:01:00.000Z"),
      batchSize: 100,
      includeOwnExecutionHistory: true
    });

    expect(buildMarketEventFragments).toHaveBeenCalledTimes(1);
    expect((adapter as { buildPortfolioHistoryFragments: ReturnType<typeof vi.fn> }).buildPortfolioHistoryFragments).toHaveBeenCalledOnce();
    expect(result.insertedRows).toBe(2);
  });
});
