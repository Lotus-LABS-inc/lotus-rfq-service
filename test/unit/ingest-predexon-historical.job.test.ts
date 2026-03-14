import { beforeEach, describe, expect, it, vi } from "vitest";

import { metricsRegistry } from "../../src/observability/metrics.js";
import {
  PredexonHistoricalIngestionJob,
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
    const adapter = {
      getVenueAdapter: () => ({ metadataVersion: "predexon-v2" }),
      buildCandleStateFragments,
      buildVolumeOpenInterestFragments: vi.fn(async () => []),
      buildOrderbookStateFragments: vi.fn(async () => []),
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

    expect(buildCandleStateFragments).toHaveBeenCalledWith(expect.anything(), {
      condition_id: "condition-1",
      start_time: 1_773_360_005,
      end_time: 1_773_360_060
    });
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
});
