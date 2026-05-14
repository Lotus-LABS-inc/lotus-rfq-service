import { describe, expect, it } from "vitest";
import {
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
          deletedClosedMarketSnapshots: 3
        })
      },
      logger,
      {
        enabled: true,
        intervalMs: 60_000,
        marketBatchSize: 10,
        retentionHours: 720,
        levelsPerSide: 25
      }
    );

    const result = await recorder.runOnce();

    expect(result).toMatchObject({
      scannedMarkets: 2,
      skippedClosedMarkets: 1,
      sampledOutcomes: 2,
      insertedSnapshots: 2,
      failedSamples: 0,
      deletedOldSnapshots: 2,
      deletedClosedMarketSnapshots: 3
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
});

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
