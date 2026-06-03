import { describe, expect, it } from "vitest";
import {
  buildMarketOrderbookRecorderConfig,
  buildMarketOrderbookRecorderConfigs,
  MarketOrderbookRecorder,
  type MarketOrderbookRecorderLogger
} from "../src/services/market-orderbook-recorder.service.js";
import type { MarketCatalogMarket } from "../src/repositories/market-catalog.repository.js";
import type { VenueOrderbookSnapshotInput } from "../src/repositories/venue-orderbook-snapshot.repository.js";

const logger: MarketOrderbookRecorderLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

describe("MarketOrderbookRecorder", () => {
  it("enables recording by default for worker-owned runtime config", () => {
    expect(buildMarketOrderbookRecorderConfig()).toMatchObject({
      intervalMs: 13_000,
      marketBatchSize: 16,
      activeMarketBatchSize: 250,
      activeMaxSamplesPerTick: 28,
      priorityMarketBatchSize: 120,
      priorityVenues: ["OPINION", "LIMITLESS", "PREDICT_FUN", "POLYMARKET"],
      maxSamplesPerTick: 40,
      sampleConcurrency: 12,
      maxTickDurationMs: 11_500,
      sampleTimeoutMs: 4_000,
      cleanupIntervalMs: 30 * 60_000
    });
  });

  it("ignores deprecated per-duty env flags so worker-owned recording stays code-owned", () => {
    const previous = process.env.MARKET_ORDERBOOK_RECORDER_ENABLED;
    process.env.MARKET_ORDERBOOK_RECORDER_ENABLED = "false";
    try {
      expect(buildMarketOrderbookRecorderConfig()).toMatchObject({
        intervalMs: 13_000,
        marketBatchSize: 16,
        activeMarketBatchSize: 250,
        activeMaxSamplesPerTick: 28,
        priorityMarketBatchSize: 120,
        priorityVenues: ["OPINION", "LIMITLESS", "PREDICT_FUN", "POLYMARKET"],
        maxSamplesPerTick: 40,
        sampleConcurrency: 12,
        maxTickDurationMs: 11_500,
        sampleTimeoutMs: 4_000,
        cleanupIntervalMs: 30 * 60_000
      });
      expect(buildMarketOrderbookRecorderConfig()).not.toHaveProperty("enabled");
    } finally {
      if (previous === undefined) {
        delete process.env.MARKET_ORDERBOOK_RECORDER_ENABLED;
      } else {
        process.env.MARKET_ORDERBOOK_RECORDER_ENABLED = previous;
      }
    }
  });

  it("builds sharded recorder lanes for broad live quote coverage", () => {
    const configs = buildMarketOrderbookRecorderConfigs();

    expect(configs).toHaveLength(2);
    expect(configs.map((config) => config.shardCount)).toEqual([2, 2]);
    expect(configs.map((config) => config.shardIndex)).toEqual([0, 1]);
    expect(configs.every((config) => config.intervalMs === 13_000)).toBe(true);
    expect(configs.every((config) => config.maxSamplesPerTick === 40)).toBe(true);
    expect(configs.every((config) => config.activeMaxSamplesPerTick === 28)).toBe(true);
    expect(configs.every((config) => config.sampleTimeoutMs === 4_000)).toBe(true);
    expect(configs.every((config) => (config.maxTickDurationMs ?? 0) < config.intervalMs)).toBe(true);
  });

  it("records approved open market outcome snapshots and skips closed markets", async () => {
    const inserted: VenueOrderbookSnapshotInput[] = [];
    const recorder = new MarketOrderbookRecorder(
      {
        listMarkets: async () => [
          marketFixture("OPEN"),
          marketFixture("RESOLVED_OR_EXPIRED")
        ]
      },
      {
        getQuoteSnapshotReport: async ({ canonicalOutcomeId }) => ({
          snapshots: [{
            venue: "POLYMARKET",
            venueMarketId: "poly-1",
            venueOutcomeId: canonicalOutcomeId ?? "YES",
            source: "REST",
            quoteQuality: "FULL_DEPTH_REST",
            sourceTimestamp: new Date("2026-05-10T12:00:00.000Z"),
            receivedAt: new Date("2026-05-10T12:00:01.000Z"),
            bids: [{ price: canonicalOutcomeId === "NO" ? "0.39" : "0.59", size: "10" }],
            asks: [{ price: canonicalOutcomeId === "NO" ? "0.41" : "0.61", size: "11" }],
            blockers: [],
            missingFactors: []
          }],
          blocked: []
        })
      },
      {
        insertMany: async (snapshots) => {
          inserted.push(...snapshots);
          return snapshots.length;
        },
        cleanupSnapshots: async () => ({
          deletedOldSnapshots: 2,
          deletedClosedMarketSnapshots: 3,
          deletedClosedLatestSnapshots: 4,
          deletedStaleBlockedLatestSnapshots: 5
        })
      },
      logger,
      {
        intervalMs: 60_000,
        marketBatchSize: 10,
        priorityMarketBatchSize: 0,
        priorityVenues: [],
        maxSamplesPerTick: 40,
        cleanupIntervalMs: 0,
        retentionHours: 720,
        levelsPerSide: 25,
        quoteProviderCooldownMs: 30_000
      }
    );

    const result = await recorder.runOnce();

    expect(result).toMatchObject({
      scannedMarkets: 2,
      skippedClosedMarkets: 1,
      sampledOutcomes: 2,
      insertedSnapshots: 2,
      failedSamples: 0,
      skippedCooldownSamples: 0,
      deletedOldSnapshots: 2,
      deletedClosedMarketSnapshots: 3,
      deletedClosedLatestSnapshots: 4,
      deletedStaleBlockedLatestSnapshots: 5
    });
    expect(inserted.map((snapshot) => snapshot.canonicalOutcomeId)).toEqual(["YES", "NO"]);
    expect(inserted[0]).toMatchObject({
      canonicalEventId: "event-1",
      canonicalMarketId: "market-1",
      venue: "POLYMARKET",
      bestBid: "0.59",
      bestAsk: "0.61",
      midpoint: "0.6",
      bidDepth: "10",
      askDepth: "11"
    });
  });

  it("caps live venue samples per tick so recorder work stays bounded", async () => {
    const inserted: VenueOrderbookSnapshotInput[] = [];
    const recorder = new MarketOrderbookRecorder(
      {
        listMarkets: async () => [
          marketFixture("OPEN")
        ]
      },
      {
        getQuoteSnapshotReport: async ({ canonicalOutcomeId }) => ({
          snapshots: [{
            venue: "POLYMARKET",
            venueMarketId: "poly-1",
            venueOutcomeId: canonicalOutcomeId ?? "YES",
            source: "REST",
            quoteQuality: "FULL_DEPTH_REST",
            sourceTimestamp: new Date("2026-05-10T12:00:00.000Z"),
            receivedAt: new Date("2026-05-10T12:00:01.000Z"),
            bids: [{ price: "0.59", size: "10" }],
            asks: [{ price: "0.61", size: "11" }],
            blockers: [],
            missingFactors: []
          }],
          blocked: []
        })
      },
      {
        insertMany: async (snapshots) => {
          inserted.push(...snapshots);
          return snapshots.length;
        },
        cleanupSnapshots: async () => ({
          deletedOldSnapshots: 0,
          deletedClosedMarketSnapshots: 0,
          deletedClosedLatestSnapshots: 0,
          deletedStaleBlockedLatestSnapshots: 0
        })
      },
      logger,
      {
        intervalMs: 60_000,
        marketBatchSize: 10,
        maxSamplesPerTick: 1,
        retentionHours: 720,
        levelsPerSide: 25,
        quoteProviderCooldownMs: 30_000
      }
    );

    const result = await recorder.runOnce();

    expect(result.sampledOutcomes).toBe(1);
    expect(result.insertedSnapshots).toBe(1);
    expect(inserted).toHaveLength(1);
  });

  it("samples outcomes with bounded concurrency so one slow outcome does not block the whole tick", async () => {
    const startedOutcomes: string[] = [];
    let releaseYes: (() => void) | undefined;
    const yesCanFinish = new Promise<void>((resolve) => {
      releaseYes = resolve;
    });
    const recorder = new MarketOrderbookRecorder(
      {
        listMarkets: async () => [marketFixture("OPEN")]
      },
      {
        getQuoteSnapshotReport: async ({ canonicalOutcomeId }) => {
          startedOutcomes.push(canonicalOutcomeId ?? "UNKNOWN");
          if (canonicalOutcomeId === "YES") {
            await yesCanFinish;
          }
          return {
            snapshots: [],
            blocked: []
          };
        }
      },
      {
        insertMany: async () => 0,
        cleanupSnapshots: async () => ({
          deletedOldSnapshots: 0,
          deletedClosedMarketSnapshots: 0,
          deletedClosedLatestSnapshots: 0,
          deletedStaleBlockedLatestSnapshots: 0
        })
      },
      logger,
      {
        intervalMs: 60_000,
        marketBatchSize: 1,
        priorityMarketBatchSize: 0,
        priorityVenues: [],
        maxSamplesPerTick: 2,
        sampleConcurrency: 2,
        sampleTimeoutMs: 500,
        retentionHours: 720,
        levelsPerSide: 25,
        quoteProviderCooldownMs: 30_000
      }
    );

    const run = recorder.runOnce();
    await waitUntil(() => startedOutcomes.includes("YES") && startedOutcomes.includes("NO"));
    releaseYes?.();
    const result = await run;

    expect(result.sampledOutcomes).toBe(2);
    expect(result.failedSamples).toBe(0);
    expect(startedOutcomes).toEqual(["YES", "NO"]);
  });

  it("samples priority Opinion markets even when the normal catalog page has not reached them", async () => {
    const sampledMarketIds: string[] = [];
    const recorder = new MarketOrderbookRecorder(
      {
        listMarkets: async (filter) => (filter?.limit ?? 0) >= 250
          ? [{
              ...opinionMarketFixture(),
              canonicalEventId: "event-opinion",
              canonicalMarketIds: ["market-opinion"],
              venueMarkets: opinionMarketFixture().venueMarkets.map((venueMarket) => ({
                ...venueMarket,
                canonicalMarketId: "market-opinion"
              }))
            }]
          : [marketFixture("OPEN")]
      },
      {
        getQuoteSnapshotReport: async ({ canonicalMarketId }) => {
          sampledMarketIds.push(canonicalMarketId);
          return {
            snapshots: [],
            blocked: []
          };
        }
      },
      {
        insertMany: async () => 0,
        cleanupSnapshots: async () => ({
          deletedOldSnapshots: 0,
          deletedClosedMarketSnapshots: 0,
          deletedClosedLatestSnapshots: 0,
          deletedStaleBlockedLatestSnapshots: 0
        })
      },
      logger,
      {
        intervalMs: 60_000,
        marketBatchSize: 1,
        priorityMarketBatchSize: 1,
        priorityVenues: ["OPINION"],
        maxSamplesPerTick: 40,
        retentionHours: 720,
        levelsPerSide: 25,
        quoteProviderCooldownMs: 30_000
      }
    );

    const result = await recorder.runOnce();

    expect(result.scannedMarkets).toBe(2);
    expect(sampledMarketIds).toEqual(["market-opinion", "market-1", "market-opinion", "market-1"]);
  });

  it("round-robins capped samples across priority venues so one venue cannot starve the others", async () => {
    const sampled: string[] = [];
    const recorder = new MarketOrderbookRecorder(
      {
        listMarkets: async () => [
          venueMarketFixture("POLYMARKET", "market-poly-1"),
          venueMarketFixture("POLYMARKET", "market-poly-2"),
          venueMarketFixture("LIMITLESS", "market-limitless"),
          venueMarketFixture("OPINION", "market-opinion")
        ]
      },
      {
        getQuoteSnapshotReport: async ({ canonicalMarketId, canonicalOutcomeId }) => {
          sampled.push(`${canonicalMarketId}:${canonicalOutcomeId}`);
          return {
            snapshots: [],
            blocked: []
          };
        }
      },
      {
        insertMany: async () => 0,
        cleanupSnapshots: async () => ({
          deletedOldSnapshots: 0,
          deletedClosedMarketSnapshots: 0,
          deletedClosedLatestSnapshots: 0,
          deletedStaleBlockedLatestSnapshots: 0
        })
      },
      logger,
      {
        intervalMs: 60_000,
        marketBatchSize: 4,
        priorityMarketBatchSize: 0,
        priorityVenues: ["OPINION", "LIMITLESS", "POLYMARKET"],
        maxSamplesPerTick: 3,
        retentionHours: 720,
        levelsPerSide: 25,
        quoteProviderCooldownMs: 30_000
      }
    );

    const result = await recorder.runOnce();

    expect(result.sampledOutcomes).toBe(3);
    expect(sampled).toEqual([
      "market-opinion:YES",
      "market-limitless:YES",
      "market-poly-1:YES"
    ]);
  });

  it("round-robins capped samples across event cards so one multi-outcome event cannot starve the catalog", async () => {
    const sampled: string[] = [];
    const recorder = new MarketOrderbookRecorder(
      {
        listMarkets: async () => [
          multiMarketEventFixture("event-large", ["market-large-1", "market-large-2", "market-large-3", "market-large-4"]),
          venueMarketFixture("POLYMARKET", "market-small-1"),
          venueMarketFixture("POLYMARKET", "market-small-2")
        ]
      },
      {
        getQuoteSnapshotReport: async ({ canonicalMarketId, canonicalOutcomeId }) => {
          sampled.push(`${canonicalMarketId}:${canonicalOutcomeId}`);
          return {
            snapshots: [],
            blocked: []
          };
        }
      },
      {
        insertMany: async () => 0,
        cleanupSnapshots: async () => ({
          deletedOldSnapshots: 0,
          deletedClosedMarketSnapshots: 0,
          deletedClosedLatestSnapshots: 0,
          deletedStaleBlockedLatestSnapshots: 0
        })
      },
      logger,
      {
        intervalMs: 60_000,
        marketBatchSize: 3,
        priorityMarketBatchSize: 0,
        priorityVenues: ["POLYMARKET"],
        maxSamplesPerTick: 3,
        retentionHours: 720,
        levelsPerSide: 25,
        quoteProviderCooldownMs: 30_000
      }
    );

    const result = await recorder.runOnce();

    expect(result.sampledOutcomes).toBe(3);
    expect(sampled).toEqual([
      "market-large-1:YES",
      "market-small-1:YES",
      "market-small-2:YES"
    ]);
  });

  it("samples active UI markets before the normal catalog sweep", async () => {
    const sampledMarketIds: string[] = [];
    const activeMarket = {
      ...marketFixture("OPEN"),
      canonicalEventId: "event-active",
      canonicalMarketIds: ["market-active"],
      venueMarkets: marketFixture("OPEN").venueMarkets.map((venueMarket) => ({
        ...venueMarket,
        canonicalMarketId: "market-active"
      }))
    };
    const normalMarket = marketFixture("OPEN");
    const recorder = new MarketOrderbookRecorder(
      {
        listMarkets: async (filter) => (filter?.limit ?? 0) >= 250
          ? [activeMarket, normalMarket]
          : [normalMarket]
      },
      {
        getQuoteSnapshotReport: async ({ canonicalMarketId }) => {
          sampledMarketIds.push(canonicalMarketId);
          return {
            snapshots: [],
            blocked: []
          };
        }
      },
      {
        insertMany: async () => 0,
        cleanupSnapshots: async () => ({
          deletedOldSnapshots: 0,
          deletedClosedMarketSnapshots: 0,
          deletedClosedLatestSnapshots: 0,
          deletedStaleBlockedLatestSnapshots: 0
        })
      },
      logger,
      {
        intervalMs: 60_000,
        marketBatchSize: 1,
        activeMarketBatchSize: 10,
        priorityMarketBatchSize: 0,
        priorityVenues: [],
        maxSamplesPerTick: 40,
        retentionHours: 720,
        levelsPerSide: 25,
        quoteProviderCooldownMs: 30_000
      },
      {
        listActiveMarketsFromRedis: async () => [{
          canonicalMarketId: "market-active",
          canonicalOutcomeId: "YES",
          lastSeenAt: new Date("2026-05-10T12:00:00.000Z")
        }]
      }
    );

    const result = await recorder.runOnce();

    expect(result.activeMarkets).toBe(1);
    expect(sampledMarketIds).toEqual(["market-active", "market-active", "market-1", "market-1"]);
  });

  it("reserves the first sample budget for active terminal outcomes", async () => {
    const sampled: string[] = [];
    const activeMarket = {
      ...marketFixture("OPEN"),
      canonicalEventId: "event-active",
      canonicalMarketIds: ["market-active"],
      venueMarkets: marketFixture("OPEN").venueMarkets.map((venueMarket) => ({
        ...venueMarket,
        canonicalMarketId: "market-active"
      }))
    };
    const recorder = new MarketOrderbookRecorder(
      {
        listMarkets: async (filter) => (filter?.limit ?? 0) >= 250
          ? [activeMarket, marketFixture("OPEN")]
          : [marketFixture("OPEN")]
      },
      {
        getQuoteSnapshotReport: async ({ canonicalMarketId, canonicalOutcomeId }) => {
          sampled.push(`${canonicalMarketId}:${canonicalOutcomeId}`);
          return {
            snapshots: [],
            blocked: []
          };
        }
      },
      {
        insertMany: async () => 0,
        cleanupSnapshots: async () => ({
          deletedOldSnapshots: 0,
          deletedClosedMarketSnapshots: 0,
          deletedClosedLatestSnapshots: 0,
          deletedStaleBlockedLatestSnapshots: 0
        })
      },
      logger,
      {
        intervalMs: 60_000,
        marketBatchSize: 1,
        activeMarketBatchSize: 10,
        activeMaxSamplesPerTick: 1,
        priorityMarketBatchSize: 0,
        priorityVenues: ["POLYMARKET"],
        maxSamplesPerTick: 2,
        retentionHours: 720,
        levelsPerSide: 25,
        quoteProviderCooldownMs: 30_000
      },
      {
        listActiveMarketsFromRedis: async () => [{
          canonicalMarketId: "market-active",
          canonicalOutcomeId: "NO",
          lastSeenAt: new Date("2026-05-10T12:00:00.000Z")
        }]
      }
    );

    const result = await recorder.runOnce();

    expect(result.activeMarkets).toBe(1);
    expect(result.sampledOutcomes).toBe(2);
    expect(sampled).toEqual([
      "market-active:NO",
      "market-active:YES"
    ]);
  });

  it("bounds and cools down hung quote source samples so recorder ticks cannot stall indefinitely", async () => {
    const recorder = new MarketOrderbookRecorder(
      {
        listMarkets: async () => [marketFixture("OPEN")]
      },
      {
        getQuoteSnapshotReport: async () => await new Promise(() => undefined)
      },
      {
        insertMany: async () => 0,
        cleanupSnapshots: async () => ({
          deletedOldSnapshots: 0,
          deletedClosedMarketSnapshots: 0,
          deletedClosedLatestSnapshots: 0,
          deletedStaleBlockedLatestSnapshots: 0
        })
      },
      logger,
      {
        intervalMs: 60_000,
        marketBatchSize: 1,
        priorityMarketBatchSize: 0,
        priorityVenues: [],
        maxSamplesPerTick: 40,
        maxTickDurationMs: 50,
        sampleTimeoutMs: 1,
        retentionHours: 720,
        levelsPerSide: 25,
        quoteProviderCooldownMs: 30_000
      }
    );

    const first = await recorder.runOnce();
    const second = await recorder.runOnce();

    expect(first.scannedMarkets).toBe(1);
    expect(first.sampledOutcomes).toBeGreaterThan(0);
    expect(first.failedSamples).toBeGreaterThan(0);
    expect(first.insertedSnapshots).toBe(0);
    expect(second.sampledOutcomes).toBe(0);
    expect(second.failedSamples).toBe(0);
    expect(second.skippedCooldownSamples).toBe(2);
  });

  it("does not start more provider samples when the remaining tick budget cannot cover their timeout", async () => {
    const sampledOutcomes: string[] = [];
    const recorder = new MarketOrderbookRecorder(
      {
        listMarkets: async () => [marketFixture("OPEN")]
      },
      {
        getQuoteSnapshotReport: async ({ canonicalOutcomeId }) => {
          sampledOutcomes.push(canonicalOutcomeId ?? "");
          await delay(20);
          return {
            snapshots: [],
            blocked: []
          };
        }
      },
      {
        insertMany: async () => 0,
        cleanupSnapshots: async () => ({
          deletedOldSnapshots: 0,
          deletedClosedMarketSnapshots: 0,
          deletedClosedLatestSnapshots: 0,
          deletedStaleBlockedLatestSnapshots: 0
        })
      },
      logger,
      {
        intervalMs: 60_000,
        marketBatchSize: 1,
        priorityMarketBatchSize: 0,
        priorityVenues: [],
        maxSamplesPerTick: 40,
        sampleConcurrency: 1,
        maxTickDurationMs: 35,
        sampleTimeoutMs: 20,
        retentionHours: 720,
        levelsPerSide: 25,
        quoteProviderCooldownMs: 30_000
      }
    );

    const result = await recorder.runOnce();

    expect(result.sampledOutcomes).toBe(2);
    expect(sampledOutcomes).toHaveLength(1);
  });

  it("uses a non-overlapping start loop instead of skipping interval ticks while a sample is running", async () => {
    const warnings: string[] = [];
    const recorder = new MarketOrderbookRecorder(
      {
        listMarkets: async () => [marketFixture("OPEN")]
      },
      {
        getQuoteSnapshotReport: async () => await new Promise(() => undefined)
      },
      {
        insertMany: async () => 0,
        cleanupSnapshots: async () => ({
          deletedOldSnapshots: 0,
          deletedClosedMarketSnapshots: 0,
          deletedClosedLatestSnapshots: 0,
          deletedStaleBlockedLatestSnapshots: 0
        })
      },
      {
        info: () => undefined,
        warn: (_input, message) => warnings.push(message),
        error: () => undefined
      },
      {
        intervalMs: 5,
        marketBatchSize: 1,
        priorityMarketBatchSize: 0,
        priorityVenues: [],
        maxSamplesPerTick: 40,
        maxTickDurationMs: 200,
        sampleTimeoutMs: 100,
        retentionHours: 720,
        levelsPerSide: 25,
        quoteProviderCooldownMs: 30_000
      }
    );

    recorder.start();
    await delay(30);
    await recorder.stop();

    expect(warnings).not.toContain("Market orderbook recorder tick skipped because the previous tick is still running.");
  });

  it("does not run recording after stop is requested", async () => {
    const listMarkets = async () => [marketFixture("OPEN")];
    let listMarketsCalled = false;
    const recorder = new MarketOrderbookRecorder(
      {
        listMarkets: async () => {
          listMarketsCalled = true;
          return listMarkets();
        }
      },
      {
        getQuoteSnapshotReport: async () => ({
          snapshots: [],
          blocked: []
        })
      },
      {
        insertMany: async () => 0,
        cleanupSnapshots: async () => ({
          deletedOldSnapshots: 0,
          deletedClosedMarketSnapshots: 0,
          deletedClosedLatestSnapshots: 0,
          deletedStaleBlockedLatestSnapshots: 0
        })
      },
      logger,
      {
        intervalMs: 60_000,
        marketBatchSize: 10,
        maxSamplesPerTick: 40,
        cleanupIntervalMs: 0,
        retentionHours: 720,
        levelsPerSide: 25,
        quoteProviderCooldownMs: 30_000
      }
    );

    await recorder.stop();
    const result = await recorder.runOnce();

    expect(result).toMatchObject({
      scannedMarkets: 0,
      sampledOutcomes: 0,
      insertedSnapshots: 0
    });
    expect(listMarketsCalled).toBe(false);
  });

  it("records quote blockers and cools down fully blocked venue samples", async () => {
    const inserted: VenueOrderbookSnapshotInput[] = [];
    const recorder = new MarketOrderbookRecorder(
      {
        listMarkets: async () => [{
          ...marketFixture("OPEN"),
          venues: ["LIMITLESS"],
          venueMarkets: marketFixture("OPEN").venueMarkets.map((venueMarket) => ({
            ...venueMarket,
            venue: "LIMITLESS"
          }))
        }]
      },
      {
        getQuoteSnapshotReport: async () => ({
          snapshots: [],
          blocked: [{
            venue: "LIMITLESS",
            reason: "QUOTE_PROVIDER_HTTP_429",
            venueMarketId: "limitless-1",
            detailsCode: "Limitless_orderbook_request_failed_with_status_429."
          }]
        })
      },
      {
        insertMany: async (snapshots) => {
          inserted.push(...snapshots);
          return snapshots.length;
        },
        cleanupSnapshots: async () => ({
          deletedOldSnapshots: 0,
          deletedClosedMarketSnapshots: 0,
          deletedClosedLatestSnapshots: 0,
          deletedStaleBlockedLatestSnapshots: 0
        })
      },
      logger,
      {
        intervalMs: 60_000,
        marketBatchSize: 10,
        maxSamplesPerTick: 40,
        retentionHours: 720,
        levelsPerSide: 25,
        quoteProviderCooldownMs: 60_000
      }
    );

    const first = await recorder.runOnce();
    const second = await recorder.runOnce();

    expect(first.insertedSnapshots).toBe(2);
    expect(inserted[0]).toMatchObject({
      venue: "LIMITLESS",
      venueMarketId: "limitless-1",
      quoteQuality: "DIAGNOSTIC_ONLY",
      blockers: ["QUOTE_PROVIDER_HTTP_429", "Limitless_orderbook_request_failed_with_status_429."]
    });
    expect(second.skippedCooldownSamples).toBe(2);
  });

  it("records stable missing-source and 404 mapping blockers without cooling down the whole venue", async () => {
    const inserted: VenueOrderbookSnapshotInput[] = [];
    const recorder = new MarketOrderbookRecorder(
      {
        listMarkets: async () => [{
          ...marketFixture("OPEN"),
          venues: ["POLYMARKET"],
          venueMarkets: marketFixture("OPEN").venueMarkets.map((venueMarket) => ({
            ...venueMarket,
            venue: "POLYMARKET"
          }))
        }]
      },
      {
        getQuoteSnapshotReport: async () => ({
          snapshots: [],
          blocked: [{
            venue: "POLYMARKET",
            reason: "POLYMARKET_SOURCE_MATCH_MISSING",
            venueMarketId: "poly-missing",
            detailsCode: "QUOTE_PROVIDER_HTTP_404"
          }]
        })
      },
      {
        insertMany: async (snapshots) => {
          inserted.push(...snapshots);
          return snapshots.length;
        },
        cleanupSnapshots: async () => ({
          deletedOldSnapshots: 0,
          deletedClosedMarketSnapshots: 0,
          deletedClosedLatestSnapshots: 0,
          deletedStaleBlockedLatestSnapshots: 0
        })
      },
      logger,
      {
        intervalMs: 60_000,
        marketBatchSize: 10,
        maxSamplesPerTick: 40,
        retentionHours: 720,
        levelsPerSide: 25,
        quoteProviderCooldownMs: 30_000
      }
    );

    const first = await recorder.runOnce();
    const second = await recorder.runOnce();

    expect(first.insertedSnapshots).toBe(2);
    expect(inserted[0]).toMatchObject({
      venue: "POLYMARKET",
      venueMarketId: "poly-missing",
      quoteQuality: "DIAGNOSTIC_ONLY",
      blockers: ["POLYMARKET_SOURCE_MATCH_MISSING", "QUOTE_PROVIDER_HTTP_404"]
    });
    expect(second.skippedCooldownSamples).toBe(0);
    expect(second.insertedSnapshots).toBe(2);
  });

  it("does not persist transient quote timeouts as durable readiness blockers", async () => {
    const inserted: VenueOrderbookSnapshotInput[] = [];
    const recorder = new MarketOrderbookRecorder(
      {
        listMarkets: async () => [marketFixture("OPEN")]
      },
      {
        getQuoteSnapshotReport: async () => ({
          snapshots: [],
          blocked: [{
            venue: "POLYMARKET",
            reason: "QUOTE_PROVIDER_TIMEOUT",
            venueMarketId: "poly-1",
            detailsCode: "POLYMARKET_quote_reader_timeout_after_2000ms."
          }]
        })
      },
      {
        insertMany: async (snapshots) => {
          inserted.push(...snapshots);
          return snapshots.length;
        },
        cleanupSnapshots: async () => ({
          deletedOldSnapshots: 0,
          deletedClosedMarketSnapshots: 0,
          deletedClosedLatestSnapshots: 0,
          deletedStaleBlockedLatestSnapshots: 0
        })
      },
      logger,
      {
        intervalMs: 60_000,
        marketBatchSize: 10,
        maxSamplesPerTick: 40,
        retentionHours: 720,
        levelsPerSide: 25,
        quoteProviderCooldownMs: 30_000
      }
    );

    const first = await recorder.runOnce();
    const second = await recorder.runOnce();

    expect(first.sampledOutcomes).toBe(2);
    expect(first.insertedSnapshots).toBe(0);
    expect(inserted).toEqual([]);
    expect(second.sampledOutcomes).toBe(0);
    expect(second.skippedCooldownSamples).toBe(2);
  });

  it("does not cool down an entire venue after one transient sample timeout", async () => {
    const sampledMarketIds: string[] = [];
    const recorder = new MarketOrderbookRecorder(
      {
        listMarkets: async () => [
          venueMarketFixture("POLYMARKET", "market-timeout"),
          venueMarketFixture("POLYMARKET", "market-healthy")
        ]
      },
      {
        getQuoteSnapshotReport: async ({ canonicalMarketId, canonicalOutcomeId }) => {
          sampledMarketIds.push(canonicalMarketId);
          if (canonicalMarketId === "market-timeout") {
            return {
              snapshots: [],
              blocked: [{
                venue: "POLYMARKET",
                reason: "QUOTE_PROVIDER_TIMEOUT",
                venueMarketId: "poly-timeout",
                detailsCode: "POLYMARKET_quote_reader_timeout_after_1500ms."
              }]
            };
          }
          return {
            snapshots: [{
              venue: "POLYMARKET",
              venueMarketId: "poly-healthy",
              venueOutcomeId: canonicalOutcomeId ?? "YES",
              source: "REST",
              quoteQuality: "FULL_DEPTH_REST",
              sourceTimestamp: new Date("2026-05-10T12:00:00.000Z"),
              receivedAt: new Date("2026-05-10T12:00:01.000Z"),
              bids: [{ price: "0.59", size: "10" }],
              asks: [{ price: "0.61", size: "11" }],
              blockers: [],
              missingFactors: []
            }],
            blocked: []
          };
        }
      },
      {
        insertMany: async (snapshots) => snapshots.length,
        cleanupSnapshots: async () => ({
          deletedOldSnapshots: 0,
          deletedClosedMarketSnapshots: 0,
          deletedClosedLatestSnapshots: 0,
          deletedStaleBlockedLatestSnapshots: 0
        })
      },
      logger,
      {
        intervalMs: 60_000,
        marketBatchSize: 10,
        maxSamplesPerTick: 40,
        retentionHours: 720,
        levelsPerSide: 25,
        quoteProviderCooldownMs: 30_000
      }
    );

    const first = await recorder.runOnce();
    const second = await recorder.runOnce();

    expect(first.sampledOutcomes).toBe(4);
    expect(first.insertedSnapshots).toBe(2);
    expect(second.sampledOutcomes).toBe(2);
    expect(second.skippedCooldownSamples).toBe(2);
    expect(sampledMarketIds.filter((marketId) => marketId === "market-healthy")).toHaveLength(4);
  });

  it("does not cool down a whole sample when a transient venue timeout has another venue quote", async () => {
    const inserted: VenueOrderbookSnapshotInput[] = [];
    const recorder = new MarketOrderbookRecorder(
      {
        listMarkets: async () => [multiVenueMarketFixture(["POLYMARKET", "LIMITLESS"])]
      },
      {
        getQuoteSnapshotReport: async ({ canonicalOutcomeId }) => ({
          snapshots: [{
            venue: "POLYMARKET",
            venueMarketId: "poly-1",
            venueOutcomeId: canonicalOutcomeId ?? "YES",
            source: "REST",
            quoteQuality: "FULL_DEPTH_REST",
            sourceTimestamp: new Date("2026-05-10T12:00:00.000Z"),
            receivedAt: new Date("2026-05-10T12:00:01.000Z"),
            bids: [{ price: "0.59", size: "10" }],
            asks: [{ price: "0.61", size: "11" }],
            blockers: [],
            missingFactors: []
          }],
          blocked: [{
            venue: "LIMITLESS",
            reason: "QUOTE_PROVIDER_TIMEOUT",
            venueMarketId: "limitless-1",
            detailsCode: "LIMITLESS_quote_reader_timeout_after_1500ms."
          }]
        })
      },
      {
        insertMany: async (snapshots) => {
          inserted.push(...snapshots);
          return snapshots.length;
        },
        cleanupSnapshots: async () => ({
          deletedOldSnapshots: 0,
          deletedClosedMarketSnapshots: 0,
          deletedClosedLatestSnapshots: 0,
          deletedStaleBlockedLatestSnapshots: 0
        })
      },
      logger,
      {
        intervalMs: 60_000,
        marketBatchSize: 10,
        maxSamplesPerTick: 40,
        retentionHours: 720,
        levelsPerSide: 25,
        quoteProviderCooldownMs: 30_000
      }
    );

    const first = await recorder.runOnce();
    const second = await recorder.runOnce();

    expect(first.sampledOutcomes).toBe(2);
    expect(first.insertedSnapshots).toBe(2);
    expect(second.sampledOutcomes).toBe(2);
    expect(second.skippedCooldownSamples).toBe(0);
    expect(second.insertedSnapshots).toBe(2);
    expect(inserted).toHaveLength(4);
  });

  it("records Opinion display snapshots as quote-ready when fee discovery is the only missing factor", async () => {
    const inserted: VenueOrderbookSnapshotInput[] = [];
    const recorder = new MarketOrderbookRecorder(
      {
        listMarkets: async () => [opinionMarketFixture()]
      },
      {
        getQuoteSnapshotReport: async ({ canonicalOutcomeId }) => ({
          snapshots: [{
            venue: "OPINION",
            venueMarketId: "3062",
            venueOutcomeId: canonicalOutcomeId === "NO" ? "token-no" : "token-yes",
            source: "REST",
            quoteQuality: "FULL_DEPTH_REST",
            sourceTimestamp: new Date("2026-05-10T12:00:00.000Z"),
            receivedAt: new Date("2026-05-10T12:00:01.000Z"),
            bids: [{ price: "0.44", size: "10" }],
            asks: [{ price: "0.46", size: "11" }],
            blockers: [],
            missingFactors: ["FEE_DISCOVERY"]
          }],
          blocked: []
        })
      },
      {
        insertMany: async (snapshots) => {
          inserted.push(...snapshots);
          return snapshots.length;
        },
        cleanupSnapshots: async () => ({
          deletedOldSnapshots: 0,
          deletedClosedMarketSnapshots: 0,
          deletedClosedLatestSnapshots: 0,
          deletedStaleBlockedLatestSnapshots: 0
        })
      },
      logger,
      {
        intervalMs: 60_000,
        marketBatchSize: 10,
        maxSamplesPerTick: 40,
        retentionHours: 720,
        levelsPerSide: 25,
        quoteProviderCooldownMs: 30_000
      }
    );

    const result = await recorder.runOnce();

    expect(result.insertedSnapshots).toBe(2);
    expect(inserted[0]).toMatchObject({
      venue: "OPINION",
      bestBid: "0.44",
      bestAsk: "0.46",
      blockers: [],
      metadataVersion: "venue-orderbook-recorder-opinion-fee-warning-v1"
    });
  });

  it("records one-sided Opinion depth as display-ready without global blockers", async () => {
    const inserted: VenueOrderbookSnapshotInput[] = [];
    const recorder = new MarketOrderbookRecorder(
      {
        listMarkets: async () => [opinionMarketFixture()]
      },
      {
        getQuoteSnapshotReport: async ({ canonicalOutcomeId }) => ({
          snapshots: [{
            venue: "OPINION",
            venueMarketId: "3062",
            venueOutcomeId: canonicalOutcomeId === "NO" ? "token-no" : "token-yes",
            source: "REST",
            quoteQuality: "FULL_DEPTH_REST",
            sourceTimestamp: new Date("2026-05-10T12:00:00.000Z"),
            receivedAt: new Date("2026-05-10T12:00:01.000Z"),
            bids: canonicalOutcomeId === "NO" ? [{ price: "0.44", size: "10" }] : [],
            asks: canonicalOutcomeId === "YES" ? [{ price: "0.46", size: "11" }] : [],
            blockers: [],
            missingFactors: canonicalOutcomeId === "NO" ? ["ASK_DEPTH_MISSING"] : ["BID_DEPTH_MISSING"]
          }],
          blocked: []
        })
      },
      {
        insertMany: async (snapshots) => {
          inserted.push(...snapshots);
          return snapshots.length;
        },
        cleanupSnapshots: async () => ({
          deletedOldSnapshots: 0,
          deletedClosedMarketSnapshots: 0,
          deletedClosedLatestSnapshots: 0,
          deletedStaleBlockedLatestSnapshots: 0
        })
      },
      logger,
      {
        intervalMs: 60_000,
        marketBatchSize: 10,
        maxSamplesPerTick: 40,
        retentionHours: 720,
        levelsPerSide: 25,
        quoteProviderCooldownMs: 30_000
      }
    );

    const result = await recorder.runOnce();

    expect(result.insertedSnapshots).toBe(2);
    expect(inserted.map((snapshot) => snapshot.blockers)).toEqual([[], []]);
    expect(inserted.find((snapshot) => snapshot.canonicalOutcomeId === "YES")).toMatchObject({
      bestBid: null,
      bestAsk: "0.46",
      bidDepth: "0",
      askDepth: "11"
    });
    expect(inserted.find((snapshot) => snapshot.canonicalOutcomeId === "NO")).toMatchObject({
      bestBid: "0.44",
      bestAsk: null,
      bidDepth: "10",
      askDepth: "0"
    });
  });
});

const delay = async (durationMs: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
};

const marketFixture = (status: MarketCatalogMarket["status"]): MarketCatalogMarket => ({
  eventId: "event:fixture",
  eventTitle: "Fixture",
  canonicalEventId: "event-1",
  canonicalMarketIds: ["market-1"],
  displayTopic: "Fixture",
  displayOutcome: "Fixture market",
  displayOutcomeKey: "label:FIXTURE_MARKET",
  title: "Fixture market",
  normalizedTitle: "fixture market",
  category: "CRYPTO",
  marketClass: "BINARY",
  status,
  startsAt: null,
  expiresAt: null,
  resolvesAt: null,
  venues: ["POLYMARKET"],
  venueCount: 1,
  venueMarketCount: 1,
  outcomeCount: 2,
  routeability: {
    hasSingleVenue: true,
    hasCrossVenue: false
  },
  imageUrl: null,
  iconUrl: null,
  volume: null,
  volume24h: null,
  liquidity: null,
  buyVolume: null,
  sellVolume: null,
  tradeCount: null,
  buyCount: null,
  sellCount: null,
  venueMarkets: [{
    canonicalMarketId: "market-1",
    canonicalMarketTitle: "Fixture market",
    venue: "POLYMARKET",
    venueMarketProfileId: "profile-1",
    venueMarketId: "poly-1",
    venueTitle: "Fixture market",
    imageUrl: null,
    iconUrl: null,
    volume: null,
    volume24h: null,
    liquidity: null,
    buyVolume: null,
    sellVolume: null,
    tradeCount: null,
    buyCount: null,
    sellCount: null,
    change24h: null,
    changePercent24h: null,
    marketClass: "BINARY",
    outcomes: [
      { id: "YES", label: "Yes" },
      { id: "NO", label: "No" }
    ],
    network: null,
    chain: null,
    expiresAt: null,
    resolvesAt: null
  }],
  updatedAt: "2026-05-10T12:00:00.000Z"
});

const opinionMarketFixture = (): MarketCatalogMarket => ({
  ...marketFixture("OPEN"),
  venues: ["OPINION"],
  venueMarkets: marketFixture("OPEN").venueMarkets.map((venueMarket) => ({
    ...venueMarket,
    venue: "OPINION",
    venueMarketId: "3062",
    venueMarketProfileId: "profile-opinion",
    network: "BNB_MAINNET",
    chain: "BNB",
    outcomes: [
      { id: "YES", label: "Yes" },
      { id: "NO", label: "No" }
    ]
  }))
});

const venueMarketFixture = (venue: string, canonicalMarketId: string): MarketCatalogMarket => {
  const base = marketFixture("OPEN");
  return {
    ...base,
    canonicalEventId: `event-${canonicalMarketId}`,
    canonicalMarketIds: [canonicalMarketId],
    venues: [venue],
    venueMarkets: base.venueMarkets.map((venueMarket) => ({
      ...venueMarket,
      canonicalMarketId,
      venue,
      venueMarketId: `${venue.toLowerCase()}-${canonicalMarketId}`,
      venueMarketProfileId: `profile-${venue.toLowerCase()}-${canonicalMarketId}`
    }))
  };
};

const multiVenueMarketFixture = (venues: readonly string[]): MarketCatalogMarket => {
  const base = marketFixture("OPEN");
  return {
    ...base,
    venues: [...venues],
    venueCount: venues.length,
    venueMarketCount: venues.length,
    venueMarkets: venues.map((venue, index) => ({
      ...base.venueMarkets[0]!,
      venue,
      venueMarketId: `${venue.toLowerCase()}-${index + 1}`,
      venueMarketProfileId: `profile-${venue.toLowerCase()}-${index + 1}`
    }))
  };
};

const multiMarketEventFixture = (canonicalEventId: string, canonicalMarketIds: readonly string[]): MarketCatalogMarket => {
  const base = marketFixture("OPEN");
  return {
    ...base,
    eventId: canonicalEventId,
    canonicalEventId,
    canonicalMarketIds: [...canonicalMarketIds],
    venueMarkets: canonicalMarketIds.map((canonicalMarketId, index) => ({
      ...base.venueMarkets[0]!,
      canonicalMarketId,
      venueMarketId: `poly-large-${index + 1}`,
      venueMarketProfileId: `profile-large-${index + 1}`,
      outcomes: [{ id: "YES", label: "Yes" }]
    }))
  };
};

const waitUntil = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition.");
};
