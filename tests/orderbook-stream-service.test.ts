import { describe, expect, it, vi } from "vitest";
import type { NormalizedVenueQuoteSnapshot } from "../src/core/sor/quote-snapshot.js";
import { parseOrderbookStreamVenues, resolveOpinionStreamAuth, resolvePredictWebSocketUrl } from "../src/orderbook-stream-service.js";
import {
  OrderbookStreamService,
  marketOrderbookTopic,
  parseMarketOrderbookTopic,
  subscriptionKey,
  type VenueOrderbookRestRefresher,
  type VenueOrderbookStreamConnector,
  type VenueOrderbookSubscriptionTarget
} from "../src/services/orderbook-stream.service.js";

const now = new Date("2026-05-23T12:00:00.000Z");

const snapshot = (target: VenueOrderbookSubscriptionTarget): NormalizedVenueQuoteSnapshot => ({
  venue: target.venue,
  venueMarketId: target.venueMarketId,
  ...(target.venueOutcomeId ? { venueOutcomeId: target.venueOutcomeId } : {}),
  source: "STREAM",
  quoteQuality: "FULL_DEPTH_STREAM",
  sourceTimestamp: now,
  receivedAt: now,
  bids: [{ price: "0.49", size: "10" }],
  asks: [{ price: "0.51", size: "10" }],
  missingFactors: [],
  blockers: [],
  streamResynced: true,
  metadata: {}
});

class FakeConnector implements VenueOrderbookStreamConnector {
  public subscribed: VenueOrderbookSubscriptionTarget[] = [];
  public unsubscribed: string[] = [];
  public disconnected = 0;
  private listener: ((snapshot: NormalizedVenueQuoteSnapshot, target: VenueOrderbookSubscriptionTarget) => void) | null = null;

  public constructor(public readonly venue: string) {}

  public async subscribe(
    targets: readonly VenueOrderbookSubscriptionTarget[],
    onSnapshot: (snapshot: NormalizedVenueQuoteSnapshot, target: VenueOrderbookSubscriptionTarget) => void
  ): Promise<void> {
    this.listener = onSnapshot;
    this.subscribed.push(...targets);
  }

  public async unsubscribe(subscriptionKeys: readonly string[]): Promise<void> {
    this.unsubscribed.push(...subscriptionKeys);
  }

  public async disconnect(): Promise<void> {
    this.disconnected += 1;
  }

  public emit(target: VenueOrderbookSubscriptionTarget, override: Partial<NormalizedVenueQuoteSnapshot> = {}): void {
    this.listener?.({ ...snapshot(target), ...override }, target);
  }
}

class FailingSubscribeConnector extends FakeConnector {
  public async subscribe(): Promise<void> {
    throw new Error("venue subscribe timeout");
  }
}

describe("OrderbookStreamService", () => {
  it("parses explicit venue ownership without defaulting typoed values to all venues", () => {
    expect(Array.from(parseOrderbookStreamVenues(undefined))).toEqual([
      "POLYMARKET",
      "LIMITLESS",
      "PREDICT_FUN",
      "OPINION"
    ]);
    expect(Array.from(parseOrderbookStreamVenues("polymarket, limitless, predict"))).toEqual([
      "POLYMARKET",
      "LIMITLESS",
      "PREDICT_FUN"
    ]);
    expect(Array.from(parseOrderbookStreamVenues("opinion"))).toEqual(["OPINION"]);
    expect(Array.from(parseOrderbookStreamVenues("not-a-venue"))).toEqual([]);
  });

  it("resolves Opinion stream auth from canonical and legacy prod env names", () => {
    expect(resolveOpinionStreamAuth({
      OPINION_BUILDER_API_KEY: " builder-key ",
      OPINION_STREAM_WALLET_ADDRESS: " 0xstream "
    })).toEqual({
      apiKey: "builder-key",
      walletAddress: "0xstream"
    });
    expect(resolveOpinionStreamAuth({
      OPINION_BUILDER_API: "legacy-builder-key",
      OPINION_EOA: "0xeoa"
    })).toEqual({
      apiKey: "legacy-builder-key",
      walletAddress: "0xeoa"
    });
    expect(resolveOpinionStreamAuth({
      OPINION_BUILDER_API: "legacy-builder-key"
    })).toBeNull();
  });

  it("uses the documented Predict websocket path and attaches the API key without logging it", () => {
    expect(resolvePredictWebSocketUrl({})).toBe("wss://ws.predict.fun/ws");
    expect(resolvePredictWebSocketUrl({
      configuredUrl: "wss://ws.predict.fun/",
      apiKey: "predict-secret"
    })).toBe("wss://ws.predict.fun/ws?apiKey=predict-secret");
    expect(resolvePredictWebSocketUrl({
      configuredUrl: "wss://ws.predict.fun/ws?apiKey=existing",
      apiKey: "predict-secret"
    })).toBe("wss://ws.predict.fun/ws?apiKey=existing");
  });

  it("round-trips market orderbook websocket topics without exposing raw separators", () => {
    const topic = marketOrderbookTopic("OFFICE_WINNER|SEOUL|MAYOR|2026", "YES");

    expect(topic).toBe("markets:orderbook:T0ZGSUNFX1dJTk5FUnxTRU9VTHxNQVlPUnwyMDI2:WUVT");
    expect(parseMarketOrderbookTopic(topic)).toEqual({
      canonicalMarketId: "OFFICE_WINNER|SEOUL|MAYOR|2026",
      canonicalOutcomeId: "YES"
    });
    expect(parseMarketOrderbookTopic(marketOrderbookTopic("market-without-outcome"))).toEqual({
      canonicalMarketId: "market-without-outcome"
    });
    expect(parseMarketOrderbookTopic("execution:user:user-1")).toBeNull();
  });

  it("subscribes quote-ready mappings for Redis-active markets and unsubscribes idle targets", async () => {
    let active = [{
      canonicalMarketId: "canonical-1",
      canonicalOutcomeId: "YES",
      lastSeenAt: now
    }];
    const connector = new FakeConnector("POLYMARKET");
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return active;
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness() {
          return [{
            venue: "POLYMARKET",
            approvedVenueMarketId: "approved-1",
            venueMarketId: "market-1",
            venueOutcomeId: "token-yes",
            quoteReady: true,
            blockers: []
          }];
        }
      },
      connectors: [connector],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => now,
      config: { subscriptionHoldMs: 0 }
    });

    await expect(service.runOnce()).resolves.toMatchObject({ subscribed: 1, unsubscribed: 0 });
    expect(connector.subscribed).toHaveLength(1);

    active = [];
    await expect(service.runOnce()).resolves.toMatchObject({ subscribed: 0, unsubscribed: 1 });
    expect(connector.unsubscribed).toEqual([subscriptionKey(connector.subscribed[0]!)]);
  });

  it("writes hot snapshots and publishes sanitized market updates to the existing gateway channel", async () => {
    const connector = new FakeConnector("POLYMARKET");
    const put = vi.fn();
    const publish = vi.fn(async () => 1);
    const upsertLatestMany = vi.fn(async () => 1);
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [{
            canonicalMarketId: "OFFICE_WINNER|SEOUL|MAYOR|2026",
            canonicalOutcomeId: "YES",
            lastSeenAt: now
          }];
        }
      },
      hotSnapshots: { put },
      mappingResolver: {
        async getReadiness() {
          return [{
            venue: "POLYMARKET",
            approvedVenueMarketId: "approved-1",
            venueMarketId: "market-1",
            venueOutcomeId: "token-yes",
            quoteReady: true,
            blockers: []
          }];
        }
      },
      connectors: [connector],
      latestSnapshots: { upsertLatestMany },
      publisher: { publish },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => now
    });

    await service.runOnce();
    connector.emit(connector.subscribed[0]!);

    expect(put).toHaveBeenCalledWith(expect.objectContaining({ venue: "POLYMARKET", source: "STREAM" }));
    const firstCall = publish.mock.calls[0] as unknown[] | undefined;
    expect(firstCall).toBeTruthy();
    const message = firstCall?.[1];
    expect(typeof message).toBe("string");
    const event = JSON.parse(message as string) as Record<string, unknown>;
    expect(event.type).toBe("MARKET_ORDERBOOK_UPDATE");
    expect(event.topic).toBe(marketOrderbookTopic("OFFICE_WINNER|SEOUL|MAYOR|2026", "YES"));
    expect(event.payload).toMatchObject({
      schemaVersion: "lotus-orderbook-stream-v2",
      updateType: "snapshot",
      seq: 1,
      canonicalMarketId: "OFFICE_WINNER|SEOUL|MAYOR|2026",
      canonicalOutcomeId: "YES",
      venue: "POLYMARKET",
      bestBid: "0.49",
      bestAsk: "0.51",
      midpoint: "0.500000",
      spread: "0.020000",
      venueCount: 1,
      liveVenueCount: 1,
      snapshotStatus: "live"
    });
    expect(event.payload).toMatchObject({
      checksum: expect.stringMatching(/^[a-f0-9]{16}$/)
    });
    connector.emit(connector.subscribed[0]!, {
      bids: [{ price: "0.50", size: "12" }],
      asks: [{ price: "0.52", size: "8" }]
    });
    const secondCall = publish.mock.calls[1] as unknown[] | undefined;
    const secondMessage = secondCall?.[1];
    expect(typeof secondMessage).toBe("string");
    const secondEvent = JSON.parse(secondMessage as string) as Record<string, unknown>;
    expect(secondEvent.payload).toMatchObject({
      updateType: "delta",
      seq: 2,
      bestBid: "0.50",
      bestAsk: "0.52",
      bidDeltas: [
        { price: "0.50", size: "12" },
        { price: "0.49", size: "0" }
      ],
      askDeltas: [
        { price: "0.52", size: "8" },
        { price: "0.51", size: "0" }
      ]
    });
    expect(secondEvent.payload).not.toHaveProperty("bids");
    expect(secondEvent.payload).not.toHaveProperty("asks");
    await vi.waitFor(() => expect(upsertLatestMany).toHaveBeenCalledTimes(1));
    expect(upsertLatestMany).toHaveBeenCalledWith([
      expect.objectContaining({
        canonicalEventId: "OFFICE_WINNER|SEOUL|MAYOR|2026",
        canonicalMarketId: "OFFICE_WINNER|SEOUL|MAYOR|2026",
        canonicalOutcomeId: "YES",
        venue: "POLYMARKET",
        venueMarketId: "market-1",
        venueOutcomeId: "token-yes",
        source: "STREAM",
        bestBid: "0.49",
        bestAsk: "0.51",
        midpoint: "0.500000",
        spread: "0.020000",
        bidDepth: "10.000000",
        askDepth: "10.000000",
        receivedAt: now,
        metadataVersion: "orderbook-stream-latest-v1"
      })
    ]);
  });

  it("loads approved quote readiness in one batch for active market scans", async () => {
    const connector = new FakeConnector("POLYMARKET");
    const getReadiness = vi.fn();
    const listApprovedReadiness = vi.fn(async () => [{
      canonicalEventId: "event-1",
      canonicalMarketIds: ["canonical-1", "canonical-2"],
      title: "Event",
      category: "Politics",
      venues: [{
        venue: "POLYMARKET",
        approvedVenueMarketId: "approved-1",
        venueMarketId: "market-1",
        venueOutcomeId: "token-yes",
        quoteReady: true,
        blockers: []
      }]
    }]);
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [
            { canonicalMarketId: "canonical-1", canonicalOutcomeId: "YES", lastSeenAt: now },
            { canonicalMarketId: "canonical-2", canonicalOutcomeId: "YES", lastSeenAt: now }
          ];
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        getReadiness,
        listApprovedReadiness
      },
      connectors: [connector],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => now
    });

    await expect(service.runOnce()).resolves.toMatchObject({ activeMarkets: 2, subscribed: 2 });
    expect(listApprovedReadiness).toHaveBeenCalledTimes(1);
    expect(getReadiness).not.toHaveBeenCalled();
  });

  it("fills stream subscriptions from approved readiness when no terminal market is active", async () => {
    const connector = new FakeConnector("LIMITLESS");
    const listApprovedReadiness = vi.fn(async () => [
      {
        canonicalEventId: "event-1",
        canonicalMarketIds: ["canonical-1", "canonical-2"],
        title: "Event",
        category: "Crypto",
        venues: [
          {
            venue: "LIMITLESS",
            approvedVenueMarketId: "approved-1",
            venueMarketId: "limitless-1",
            venueOutcomeId: "token-1",
            quoteReady: true,
            blockers: []
          },
          {
            venue: "LIMITLESS",
            approvedVenueMarketId: "approved-2",
            venueMarketId: "limitless-2",
            venueOutcomeId: "token-2",
            quoteReady: true,
            blockers: []
          }
        ]
      }
    ]);
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [];
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness() {
          return [];
        },
        listApprovedReadiness
      },
      connectors: [connector],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => now,
      config: { backgroundReadinessMarketLimit: 2, maxBackgroundSubscriptionTargets: 3 }
    });

    await expect(service.runOnce()).resolves.toMatchObject({
      activeMarkets: 0,
      desiredSubscriptions: 2,
      subscribed: 2
    });
    expect(listApprovedReadiness).toHaveBeenCalledWith({ limit: 2 });
    expect(connector.subscribed.map((target) => target.canonicalMarketId)).toEqual(["canonical-1", "canonical-1"]);
  });

  it("uses outcome-aware background readiness so card prices land on outcome websocket topics", async () => {
    const connector = new FakeConnector("POLYMARKET");
    const listApprovedReadiness = vi.fn(async () => [
      {
        canonicalEventId: "event-1",
        canonicalMarketIds: ["canonical-1"],
        title: "Event",
        category: "Crypto",
        venues: [],
        outcomeVenues: [
          {
            canonicalOutcomeId: "YES",
            venue: "POLYMARKET",
            approvedVenueMarketId: "approved-yes",
            venueMarketId: "poly-market",
            venueOutcomeId: "token-yes",
            quoteReady: true,
            blockers: []
          },
          {
            canonicalOutcomeId: "NO",
            venue: "POLYMARKET",
            approvedVenueMarketId: "approved-no",
            venueMarketId: "poly-market",
            venueOutcomeId: "token-no",
            quoteReady: true,
            blockers: []
          }
        ]
      }
    ]);
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [];
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness() {
          return [];
        },
        listApprovedReadiness
      },
      connectors: [connector],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => now,
      config: { backgroundReadinessMarketLimit: 1, maxBackgroundSubscriptionTargets: 4 }
    });

    await expect(service.runOnce()).resolves.toMatchObject({
      desiredSubscriptions: 2,
      subscribed: 2
    });
    expect(connector.subscribed.map((target) => ({
      canonicalOutcomeId: target.canonicalOutcomeId,
      venueOutcomeId: target.venueOutcomeId
    }))).toEqual([
      { canonicalOutcomeId: "YES", venueOutcomeId: "token-yes" },
      { canonicalOutcomeId: "NO", venueOutcomeId: "token-no" }
    ]);
  });

  it("prioritizes YES outcome books for active display markets without an explicit outcome", async () => {
    const connector = new FakeConnector("POLYMARKET");
    const listApprovedReadiness = vi.fn(async () => [
      {
        canonicalEventId: "event-1",
        canonicalMarketIds: ["canonical-1"],
        title: "Event",
        category: "Crypto",
        venues: [{
          venue: "POLYMARKET",
          approvedVenueMarketId: "approved-generic",
          venueMarketId: "poly-market",
          venueOutcomeId: null,
          quoteReady: true,
          blockers: []
        }],
        outcomeVenues: [
          {
            canonicalOutcomeId: "NO",
            venue: "POLYMARKET",
            approvedVenueMarketId: "approved-no",
            venueMarketId: "poly-market",
            venueOutcomeId: "token-no",
            quoteReady: true,
            blockers: []
          },
          {
            canonicalOutcomeId: "YES",
            venue: "POLYMARKET",
            approvedVenueMarketId: "approved-yes",
            venueMarketId: "poly-market",
            venueOutcomeId: "token-yes",
            quoteReady: true,
            blockers: []
          }
        ]
      }
    ]);
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [{ canonicalMarketId: "canonical-1", lastSeenAt: now }];
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness() {
          return [];
        },
        listApprovedReadiness
      },
      connectors: [connector],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => now,
      config: { backgroundReadinessMarketLimit: 1, maxBackgroundSubscriptionTargets: 0 }
    });

    await expect(service.runOnce()).resolves.toMatchObject({
      activeMarkets: 1,
      desiredSubscriptions: 1,
      subscribed: 1
    });
    expect(connector.subscribed.map((target) => ({
      canonicalOutcomeId: target.canonicalOutcomeId,
      venueOutcomeId: target.venueOutcomeId
    }))).toEqual([
      { canonicalOutcomeId: "YES", venueOutcomeId: "token-yes" }
    ]);
  });

  it("keeps explicit active outcome targets precise for terminal orderbooks", async () => {
    const connector = new FakeConnector("POLYMARKET");
    const listApprovedReadiness = vi.fn(async () => [
      {
        canonicalEventId: "event-1",
        canonicalMarketIds: ["canonical-1"],
        title: "Event",
        category: "Crypto",
        venues: [{
          venue: "POLYMARKET",
          approvedVenueMarketId: "approved-generic",
          venueMarketId: "poly-market",
          venueOutcomeId: null,
          quoteReady: true,
          blockers: []
        }],
        outcomeVenues: [
          {
            canonicalOutcomeId: "YES",
            venue: "POLYMARKET",
            approvedVenueMarketId: "approved-yes",
            venueMarketId: "poly-market",
            venueOutcomeId: "token-yes",
            quoteReady: true,
            blockers: []
          },
          {
            canonicalOutcomeId: "NO",
            venue: "POLYMARKET",
            approvedVenueMarketId: "approved-no",
            venueMarketId: "poly-market",
            venueOutcomeId: "token-no",
            quoteReady: true,
            blockers: []
          }
        ]
      }
    ]);
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [{ canonicalMarketId: "canonical-1", canonicalOutcomeId: "NO", lastSeenAt: now }];
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness() {
          return [];
        },
        listApprovedReadiness
      },
      connectors: [connector],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => now,
      config: { backgroundReadinessMarketLimit: 1, maxBackgroundSubscriptionTargets: 0 }
    });

    await expect(service.runOnce()).resolves.toMatchObject({
      activeMarkets: 1,
      desiredSubscriptions: 1,
      subscribed: 1
    });
    expect(connector.subscribed[0]).toMatchObject({
      canonicalOutcomeId: "NO",
      venueOutcomeId: "token-no"
    });
  });

  it("shrinks background subscriptions when visible active targets consume the budget", async () => {
    const connector = new FakeConnector("POLYMARKET");
    const listApprovedReadiness = vi.fn(async () => [
      {
        canonicalEventId: "event-1",
        canonicalMarketIds: ["active-1"],
        title: "Active Event",
        category: "Crypto",
        venues: [],
        outcomeVenues: [
          {
            canonicalOutcomeId: "YES",
            venue: "POLYMARKET",
            approvedVenueMarketId: "approved-active-yes",
            venueMarketId: "poly-active",
            venueOutcomeId: "active-yes",
            quoteReady: true,
            blockers: []
          },
          {
            canonicalOutcomeId: "NO",
            venue: "POLYMARKET",
            approvedVenueMarketId: "approved-active-no",
            venueMarketId: "poly-active",
            venueOutcomeId: "active-no",
            quoteReady: true,
            blockers: []
          }
        ]
      },
      {
        canonicalEventId: "event-2",
        canonicalMarketIds: ["background-1"],
        title: "Background Event",
        category: "Crypto",
        venues: [{
          venue: "POLYMARKET",
          approvedVenueMarketId: "approved-background",
          venueMarketId: "poly-background",
          venueOutcomeId: null,
          quoteReady: true,
          blockers: []
        }]
      }
    ]);
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [{ canonicalMarketId: "active-1", lastSeenAt: now }];
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness() {
          return [];
        },
        listApprovedReadiness
      },
      connectors: [connector],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => now,
      config: { backgroundReadinessMarketLimit: 2, maxBackgroundSubscriptionTargets: 1 }
    });

    await expect(service.runOnce()).resolves.toMatchObject({
      activeMarkets: 1,
      desiredSubscriptions: 1,
      subscribed: 1
    });
    expect(connector.subscribed).toEqual([
      expect.objectContaining({
        canonicalMarketId: "active-1",
        canonicalOutcomeId: "YES",
        venueMarketId: "poly-active",
        venueOutcomeId: "active-yes"
      })
    ]);
  });

  it("keeps warming background markets when active targets leave spare budget", async () => {
    const connector = new FakeConnector("POLYMARKET");
    const listApprovedReadiness = vi.fn(async () => [
      {
        canonicalEventId: "event-1",
        canonicalMarketIds: ["active-1"],
        title: "Active Event",
        category: "Crypto",
        venues: [],
        outcomeVenues: [{
          canonicalOutcomeId: "YES",
          venue: "POLYMARKET",
          approvedVenueMarketId: "approved-active-yes",
          venueMarketId: "poly-active",
          venueOutcomeId: "active-yes",
          quoteReady: true,
          blockers: []
        }]
      },
      {
        canonicalEventId: "event-2",
        canonicalMarketIds: ["background-1"],
        title: "Background Event",
        category: "Crypto",
        venues: [{
          venue: "POLYMARKET",
          approvedVenueMarketId: "approved-background",
          venueMarketId: "poly-background",
          venueOutcomeId: null,
          quoteReady: true,
          blockers: []
        }]
      }
    ]);
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [{ canonicalMarketId: "active-1", lastSeenAt: now }];
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness() {
          return [];
        },
        listApprovedReadiness
      },
      connectors: [connector],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => now,
      config: { backgroundReadinessMarketLimit: 2, maxBackgroundSubscriptionTargets: 2 }
    });

    await expect(service.runOnce()).resolves.toMatchObject({
      activeMarkets: 1,
      desiredSubscriptions: 2,
      subscribed: 2
    });
    expect(connector.subscribed).toEqual([
      expect.objectContaining({
        canonicalMarketId: "active-1",
        canonicalOutcomeId: "YES",
        venueMarketId: "poly-active",
        venueOutcomeId: "active-yes"
      }),
      expect.objectContaining({
        canonicalMarketId: "background-1",
        venueMarketId: "poly-background"
      })
    ]);
  });

  it("keeps active terminal targets ahead of background readiness duplicates", async () => {
    const connector = new FakeConnector("POLYMARKET");
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [{ canonicalMarketId: "canonical-1", canonicalOutcomeId: "YES", lastSeenAt: now }];
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness() {
          return [{
            venue: "POLYMARKET",
            approvedVenueMarketId: "approved-active",
            venueMarketId: "poly-market",
            venueOutcomeId: "poly-token",
            quoteReady: true,
            blockers: []
          }];
        },
        async listApprovedReadiness() {
          return [{
            canonicalEventId: "event-1",
            canonicalMarketIds: ["canonical-1"],
            title: "Event",
            category: "Politics",
            venues: [{
              venue: "POLYMARKET",
              approvedVenueMarketId: "approved-background",
              venueMarketId: "poly-market",
              venueOutcomeId: "poly-token",
              quoteReady: true,
              blockers: []
            }]
          }];
        }
      },
      connectors: [connector],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => now
    });

    await expect(service.runOnce()).resolves.toMatchObject({
      activeMarkets: 1,
      desiredSubscriptions: 1,
      subscribed: 1
    });
    expect(connector.subscribed[0]).toMatchObject({
      canonicalMarketId: "canonical-1",
      canonicalOutcomeId: "YES",
      venueMarketId: "poly-market",
      venueOutcomeId: "poly-token"
    });
  });

  it("keeps a failed venue subscription from failing the whole stream tick", async () => {
    const failing = new FailingSubscribeConnector("LIMITLESS");
    const healthy = new FakeConnector("POLYMARKET");
    const warn = vi.fn();
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [{ canonicalMarketId: "canonical-1", canonicalOutcomeId: "YES", lastSeenAt: now }];
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness() {
          return [
            {
              venue: "LIMITLESS",
              approvedVenueMarketId: "approved-limitless",
              venueMarketId: "limitless-market",
              venueOutcomeId: "YES",
              quoteReady: true,
              blockers: []
            },
            {
              venue: "POLYMARKET",
              approvedVenueMarketId: "approved-poly",
              venueMarketId: "poly-market",
              venueOutcomeId: "poly-token",
              quoteReady: true,
              blockers: []
            }
          ];
        }
      },
      connectors: [failing, healthy],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn, error: vi.fn() },
      now: () => now
    });

    await expect(service.runOnce()).resolves.toMatchObject({ activeMarkets: 1, desiredSubscriptions: 2 });
    expect(healthy.subscribed).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ venue: "LIMITLESS", targetCount: 1 }),
      "Venue orderbook subscribe failed."
    );
  });

  it("skips quote-ready venues owned by another stream worker without warning noise", async () => {
    const connector = new FakeConnector("POLYMARKET");
    const warn = vi.fn();
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [{ canonicalMarketId: "canonical-1", canonicalOutcomeId: "YES", lastSeenAt: now }];
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness() {
          return [
            {
              venue: "POLYMARKET",
              approvedVenueMarketId: "approved-poly",
              venueMarketId: "poly-market",
              venueOutcomeId: "poly-token",
              quoteReady: true,
              blockers: []
            },
            {
              venue: "OPINION",
              approvedVenueMarketId: "approved-opinion",
              venueMarketId: "opinion-market",
              venueOutcomeId: "opinion-token",
              quoteReady: true,
              blockers: []
            }
          ];
        }
      },
      connectors: [connector],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn, error: vi.fn() },
      now: () => now
    });

    await expect(service.runOnce()).resolves.toMatchObject({
      desiredSubscriptions: 1,
      subscribed: 1,
      unsupportedVenueTargets: 1
    });
    expect(connector.subscribed).toHaveLength(1);
    expect(warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ venue: "OPINION" }),
      "No orderbook stream connector registered for venue."
    );
  });

  it("does not resubscribe unchanged active targets on every tick", async () => {
    const connector = new FakeConnector("POLYMARKET");
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [{ canonicalMarketId: "canonical-1", canonicalOutcomeId: "YES", lastSeenAt: now }];
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness() {
          return [{
            venue: "POLYMARKET",
            approvedVenueMarketId: "approved-1",
            venueMarketId: "market-1",
            venueOutcomeId: "token-yes",
            quoteReady: true,
            blockers: []
          }];
        }
      },
      connectors: [connector],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => now
    });

    await service.runOnce();
    await service.runOnce();

    expect(connector.subscribed).toHaveLength(1);
  });

  it("holds subscriptions through brief active-market gaps instead of churning venue sockets", async () => {
    let active = true;
    const connector = new FakeConnector("POLYMARKET");
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return active
            ? [{ canonicalMarketId: "canonical-1", canonicalOutcomeId: "YES", lastSeenAt: now }]
            : [];
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness() {
          return [{
            venue: "POLYMARKET",
            approvedVenueMarketId: "approved-1",
            venueMarketId: "market-1",
            venueOutcomeId: "token-yes",
            quoteReady: true,
            blockers: []
          }];
        }
      },
      connectors: [connector],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => now,
      config: { subscriptionHoldMs: 60_000 }
    });

    await service.runOnce();
    active = false;
    await expect(service.runOnce()).resolves.toMatchObject({ unsubscribed: 0, retainedSubscriptions: 1 });
    expect(connector.unsubscribed).toEqual([]);
  });

  it("does not mark failed venue subscriptions active so later ticks can retry", async () => {
    const failing = new FailingSubscribeConnector("LIMITLESS");
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [{ canonicalMarketId: "canonical-1", canonicalOutcomeId: "YES", lastSeenAt: now }];
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness() {
          return [{
            venue: "LIMITLESS",
            approvedVenueMarketId: "approved-limitless",
            venueMarketId: "limitless-market",
            venueOutcomeId: "YES",
            quoteReady: true,
            blockers: []
          }];
        }
      },
      connectors: [failing],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => now
    });

    await expect(service.runOnce()).resolves.toMatchObject({ subscribed: 0, pendingSubscriptions: 1 });
    await expect(service.runOnce()).resolves.toMatchObject({ subscribed: 0, pendingSubscriptions: 1 });
    expect(failing.subscribed).toHaveLength(0);
  });

  it("refreshes subscribed targets through bounded REST fallback and publishes terminal updates", async () => {
    const connector = new FakeConnector("POLYMARKET");
    const put = vi.fn();
    const publish = vi.fn(async () => 1);
    const refresher: VenueOrderbookRestRefresher = {
      venue: "POLYMARKET",
      async refresh(target) {
        return {
          ...snapshot(target),
          source: "REST",
          quoteQuality: "FULL_DEPTH_REST"
        };
      }
    };
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [{ canonicalMarketId: "canonical-1", canonicalOutcomeId: "YES", lastSeenAt: now }];
        }
      },
      hotSnapshots: { put },
      mappingResolver: {
        async getReadiness() {
          return [{
            venue: "POLYMARKET",
            approvedVenueMarketId: "approved-1",
            venueMarketId: "market-1",
            venueOutcomeId: "token-yes",
            quoteReady: true,
            blockers: []
          }];
        }
      },
      connectors: [connector],
      restRefreshers: [refresher],
      publisher: { publish },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => now
    });

    await expect(service.runOnce()).resolves.toMatchObject({ subscribed: 1, restRefreshed: 1 });

    expect(put).toHaveBeenCalledWith(expect.objectContaining({
      venue: "POLYMARKET",
      source: "REST",
      quoteQuality: "FULL_DEPTH_REST"
    }));
    const firstPublishCall = publish.mock.calls[0] as unknown[] | undefined;
    const message = firstPublishCall?.[1];
    expect(typeof message).toBe("string");
    const event = JSON.parse(message as string) as Record<string, unknown>;
    expect(event).toMatchObject({
      type: "MARKET_ORDERBOOK_UPDATE",
      topic: marketOrderbookTopic("canonical-1", "YES")
    });
  });

  it("respects REST refresh cooldowns so active target refreshes do not storm providers", async () => {
    const connector = new FakeConnector("POLYMARKET");
    const refresh = vi.fn(async (target: VenueOrderbookSubscriptionTarget) => ({
      ...snapshot(target),
      source: "REST" as const,
      quoteQuality: "FULL_DEPTH_REST" as const
    }));
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [{ canonicalMarketId: "canonical-1", canonicalOutcomeId: "YES", lastSeenAt: now }];
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness() {
          return [{
            venue: "POLYMARKET",
            approvedVenueMarketId: "approved-1",
            venueMarketId: "market-1",
            venueOutcomeId: "token-yes",
            quoteReady: true,
            blockers: []
          }];
        }
      },
      connectors: [connector],
      restRefreshers: [{ venue: "POLYMARKET", refresh }],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => now,
      config: { restRefreshIntervalMs: 60_000 }
    });

    await expect(service.runOnce()).resolves.toMatchObject({ restRefreshed: 1 });
    await expect(service.runOnce()).resolves.toMatchObject({ restRefreshed: 0 });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("bounds REST fallback refreshes per venue so one provider cannot starve the rest", async () => {
    const connectors = [
      new FakeConnector("POLYMARKET"),
      new FakeConnector("LIMITLESS")
    ];
    const refresh = vi.fn(async (target: VenueOrderbookSubscriptionTarget) => ({
      ...snapshot(target),
      source: "REST" as const,
      quoteQuality: "FULL_DEPTH_REST" as const
    }));
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [
            { canonicalMarketId: "canonical-1", canonicalOutcomeId: "YES", lastSeenAt: now },
            { canonicalMarketId: "canonical-2", canonicalOutcomeId: "YES", lastSeenAt: now },
            { canonicalMarketId: "canonical-3", canonicalOutcomeId: "YES", lastSeenAt: now }
          ];
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness(input) {
          return [
            {
              venue: "POLYMARKET",
              approvedVenueMarketId: `${input.canonicalMarketId}-poly`,
              venueMarketId: `${input.canonicalMarketId}-poly`,
              venueOutcomeId: "poly-token",
              quoteReady: true,
              blockers: []
            },
            {
              venue: "LIMITLESS",
              approvedVenueMarketId: `${input.canonicalMarketId}-limitless`,
              venueMarketId: `${input.canonicalMarketId}-limitless`,
              venueOutcomeId: "YES",
              quoteReady: true,
              blockers: []
            }
          ];
        }
      },
      connectors,
      restRefreshers: [
        { venue: "POLYMARKET", refresh },
        { venue: "LIMITLESS", refresh }
      ],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => now,
      config: {
        maxRestRefreshTargetsPerVenuePerTick: 1,
        maxRestRefreshTargetsPerTick: 10,
        restRefreshVenuePolicies: {
          POLYMARKET: { maxTargetsPerSweep: 1 },
          LIMITLESS: { maxTargetsPerSweep: 1 }
        }
      }
    });

    await expect(service.runOnce()).resolves.toMatchObject({ restRefreshed: 2 });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh.mock.calls.map(([target]) => target.venue).sort()).toEqual(["LIMITLESS", "POLYMARKET"]);
  });

  it("refreshes duplicate native venue books once and fans out to Lotus subscriptions", async () => {
    const connector = new FakeConnector("PREDICT_FUN");
    const put = vi.fn();
    const publish = vi.fn(async () => 1);
    const refresh = vi.fn(async (target: VenueOrderbookSubscriptionTarget) => ({
      ...snapshot(target),
      source: "REST" as const,
      quoteQuality: "FULL_DEPTH_REST" as const
    }));
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [
            { canonicalMarketId: "canonical-1", canonicalOutcomeId: "YES", lastSeenAt: now },
            { canonicalMarketId: "canonical-2", canonicalOutcomeId: "YES", lastSeenAt: now }
          ];
        }
      },
      hotSnapshots: { put },
      mappingResolver: {
        async getReadiness() {
          return [{
            venue: "PREDICT_FUN",
            approvedVenueMarketId: "predict-approved",
            venueMarketId: "predict-market",
            venueOutcomeId: "predict-token",
            quoteReady: true,
            blockers: []
          }];
        }
      },
      connectors: [connector],
      restRefreshers: [{ venue: "PREDICT_FUN", refresh }],
      publisher: { publish },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => now
    });

    await expect(service.runOnce()).resolves.toMatchObject({ restRefreshed: 1 });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(2);
    const topics = (publish.mock.calls as unknown[][]).map((call) => JSON.parse(String(call[1])).topic);
    expect(topics).toEqual([
      marketOrderbookTopic("canonical-1", "YES"),
      marketOrderbookTopic("canonical-2", "YES")
    ]);
  });

  it("times out slow REST fallback refreshes without failing the stream tick", async () => {
    const connector = new FakeConnector("POLYMARKET");
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [{ canonicalMarketId: "canonical-1", canonicalOutcomeId: "YES", lastSeenAt: now }];
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness() {
          return [{
            venue: "POLYMARKET",
            approvedVenueMarketId: "approved-1",
            venueMarketId: "market-1",
            venueOutcomeId: "token-yes",
            quoteReady: true,
            blockers: []
          }];
        }
      },
      connectors: [connector],
      restRefreshers: [{
        venue: "POLYMARKET",
        async refresh() {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return null;
        }
      }],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => now,
      config: { restRefreshTimeoutMs: 1 }
    });

    await expect(service.runOnce()).resolves.toMatchObject({
      activeMarkets: 1,
      subscribed: 1,
      restRefreshed: 0
    });
  });

  it("puts failed REST fallback targets on cooldown before retrying providers", async () => {
    const connector = new FakeConnector("POLYMARKET");
    const refresh = vi.fn(async () => {
      throw new Error("provider 429");
    });
    let currentNow = now;
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [{ canonicalMarketId: "canonical-1", canonicalOutcomeId: "YES", lastSeenAt: currentNow }];
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness() {
          return [{
            venue: "POLYMARKET",
            approvedVenueMarketId: "approved-1",
            venueMarketId: "polymarket-market",
            venueOutcomeId: "YES",
            quoteReady: true,
            blockers: []
          }];
        }
      },
      connectors: [connector],
      restRefreshers: [{ venue: "POLYMARKET", refresh }],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => currentNow,
      config: {
        restRefreshIntervalMs: 1,
        restRefreshFailureCooldownMs: 60_000
      }
    });

    await expect(service.runOnce()).resolves.toMatchObject({ restRefreshed: 0 });
    currentNow = new Date(now.getTime() + 10_000);
    await expect(service.runOnce()).resolves.toMatchObject({ restRefreshed: 0 });
    expect(refresh).toHaveBeenCalledTimes(1);

    currentNow = new Date(now.getTime() + 61_000);
    await expect(service.runOnce()).resolves.toMatchObject({ restRefreshed: 0 });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("applies venue-specific REST fallback budgets from code defaults", async () => {
    const connectors = [
      new FakeConnector("POLYMARKET"),
      new FakeConnector("PREDICT_FUN"),
      new FakeConnector("LIMITLESS"),
      new FakeConnector("OPINION")
    ];
    const refresh = vi.fn(async (target: VenueOrderbookSubscriptionTarget) => ({
      ...snapshot(target),
      source: "REST" as const,
      quoteQuality: "FULL_DEPTH_REST" as const
    }));
    const activeMarkets = [
      ...Array.from({ length: 4 }, (_, index) => ({ canonicalMarketId: `poly-${index}`, venue: "POLYMARKET" })),
      ...Array.from({ length: 4 }, (_, index) => ({ canonicalMarketId: `predict-${index}`, venue: "PREDICT_FUN" })),
      ...Array.from({ length: 4 }, (_, index) => ({ canonicalMarketId: `limitless-${index}`, venue: "LIMITLESS" })),
      ...Array.from({ length: 4 }, (_, index) => ({ canonicalMarketId: `opinion-${index}`, venue: "OPINION" }))
    ];
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return activeMarkets.map((market) => ({
            canonicalMarketId: market.canonicalMarketId,
            canonicalOutcomeId: "YES",
            lastSeenAt: now
          }));
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness(input) {
          const market = activeMarkets.find((item) => item.canonicalMarketId === input.canonicalMarketId);
          if (!market) {
            return [];
          }
          return [{
            venue: market.venue,
            approvedVenueMarketId: `${market.canonicalMarketId}-approved`,
            venueMarketId: `${market.canonicalMarketId}-book`,
            venueOutcomeId: "YES",
            quoteReady: true,
            blockers: []
          }];
        }
      },
      connectors,
      restRefreshers: [
        { venue: "POLYMARKET", refresh },
        { venue: "PREDICT_FUN", refresh },
        { venue: "LIMITLESS", refresh },
        { venue: "OPINION", refresh }
      ],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => now,
      config: {
        backgroundReadinessMarketLimit: 16,
        maxBackgroundSubscriptionTargets: 16,
        maxRestRefreshTargetsPerTick: 20,
        maxRestRefreshTargetsPerVenuePerTick: 4
      }
    });

    await expect(service.runOnce()).resolves.toMatchObject({ restRefreshed: 13 });
    const countsByVenue = new Map<string, number>();
    for (const [target] of refresh.mock.calls) {
      countsByVenue.set(target.venue, (countsByVenue.get(target.venue) ?? 0) + 1);
    }
    expect(countsByVenue).toEqual(new Map([
      ["POLYMARKET", 4],
      ["PREDICT_FUN", 4],
      ["LIMITLESS", 4],
      ["OPINION", 1]
    ]));
  });

  it("lets venue-specific REST policies raise a venue above the generic per-venue cap", async () => {
    const connector = new FakeConnector("LIMITLESS");
    const refresh = vi.fn(async (target: VenueOrderbookSubscriptionTarget) => ({
      ...snapshot(target),
      source: "REST" as const,
      quoteQuality: "FULL_DEPTH_REST" as const
    }));
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return Array.from({ length: 5 }, (_, index) => ({
            canonicalMarketId: `limitless-${index}`,
            canonicalOutcomeId: "YES",
            lastSeenAt: now
          }));
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness(input) {
          return [{
            venue: "LIMITLESS",
            approvedVenueMarketId: `${input.canonicalMarketId}-approved`,
            venueMarketId: `${input.canonicalMarketId}-book`,
            venueOutcomeId: "YES",
            quoteReady: true,
            blockers: []
          }];
        }
      },
      connectors: [connector],
      restRefreshers: [{ venue: "LIMITLESS", refresh }],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => now,
      config: {
        maxRestRefreshTargetsPerTick: 10,
        maxRestRefreshTargetsPerVenuePerTick: 1,
        restRefreshVenuePolicies: {
          LIMITLESS: { maxTargetsPerSweep: 5 }
        }
      }
    });

    await expect(service.runOnce()).resolves.toMatchObject({ restRefreshed: 5 });
    expect(refresh).toHaveBeenCalledTimes(5);
  });

  it("does not put the whole venue on cooldown when one REST target returns no snapshot", async () => {
    const connector = new FakeConnector("LIMITLESS");
    const refresh = vi.fn(async (target: VenueOrderbookSubscriptionTarget) => {
      if (target.canonicalMarketId === "canonical-1") {
        return null;
      }
      return {
        ...snapshot(target),
        source: "REST" as const,
        quoteQuality: "FULL_DEPTH_REST" as const
      };
    });
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [
            { canonicalMarketId: "canonical-1", canonicalOutcomeId: "YES", lastSeenAt: now },
            { canonicalMarketId: "canonical-2", canonicalOutcomeId: "YES", lastSeenAt: now }
          ];
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness(input) {
          return [{
            venue: "LIMITLESS",
            approvedVenueMarketId: `${input.canonicalMarketId}-approved`,
            venueMarketId: `${input.canonicalMarketId}-book`,
            venueOutcomeId: "YES",
            quoteReady: true,
            blockers: []
          }];
        }
      },
      connectors: [connector],
      restRefreshers: [{ venue: "LIMITLESS", refresh }],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => now,
      config: {
        maxRestRefreshTargetsPerTick: 10,
        restRefreshVenuePolicies: {
          LIMITLESS: { maxTargetsPerSweep: 2 }
        }
      }
    });

    await expect(service.runOnce()).resolves.toMatchObject({ restRefreshed: 1 });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("uses longer venue-specific REST failure cooldowns for slow venues", async () => {
    const connector = new FakeConnector("OPINION");
    const refresh = vi.fn(async () => null);
    let currentNow = now;
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [{ canonicalMarketId: "canonical-1", canonicalOutcomeId: "YES", lastSeenAt: currentNow }];
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness() {
          return [{
            venue: "OPINION",
            approvedVenueMarketId: "approved-1",
            venueMarketId: "opinion-market",
            venueOutcomeId: "YES",
            quoteReady: true,
            blockers: []
          }];
        }
      },
      connectors: [connector],
      restRefreshers: [{ venue: "OPINION", refresh }],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => currentNow,
      config: {
        restRefreshIntervalMs: 1,
        restRefreshFailureCooldownMs: 60_000
      }
    });

    await expect(service.runOnce()).resolves.toMatchObject({ restRefreshed: 0 });
    currentNow = new Date(now.getTime() + 61_000);
    await expect(service.runOnce()).resolves.toMatchObject({ restRefreshed: 0 });
    expect(refresh).toHaveBeenCalledTimes(1);

    currentNow = new Date(now.getTime() + 301_000);
    await expect(service.runOnce()).resolves.toMatchObject({ restRefreshed: 0 });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("backs off blocked no-depth REST snapshots per target without cooling down the whole venue", async () => {
    const connector = new FakeConnector("OPINION");
    const refresh = vi.fn(async (target: VenueOrderbookSubscriptionTarget) => {
      if (target.canonicalMarketId === "canonical-1") {
        return {
          ...snapshot(target),
          source: "REST" as const,
          quoteQuality: "TOP_OF_BOOK_REST" as const,
          bids: [],
          asks: [],
          blockers: ["QUOTE_PROVIDER_EMPTY_BOOK"]
        };
      }
      return {
        ...snapshot(target),
        source: "REST" as const,
        quoteQuality: "FULL_DEPTH_REST" as const
      };
    });
    let currentNow = now;
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [
            { canonicalMarketId: "canonical-1", canonicalOutcomeId: "YES", lastSeenAt: currentNow },
            { canonicalMarketId: "canonical-2", canonicalOutcomeId: "YES", lastSeenAt: currentNow }
          ];
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness(input) {
          return [{
            venue: "OPINION",
            approvedVenueMarketId: `${input.canonicalMarketId}-approved`,
            venueMarketId: `${input.canonicalMarketId}-opinion-book`,
            venueOutcomeId: "YES",
            quoteReady: true,
            blockers: []
          }];
        }
      },
      connectors: [connector],
      restRefreshers: [{ venue: "OPINION", refresh }],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => currentNow,
      config: {
        restRefreshIntervalMs: 1,
        maxRestRefreshTargetsPerTick: 10,
        maxRestRefreshTargetsPerVenuePerTick: 2,
        restRefreshVenuePolicies: {
          OPINION: { maxTargetsPerSweep: 2, failureCooldownMs: 300_000 }
        }
      }
    });

    await expect(service.runOnce()).resolves.toMatchObject({ restRefreshed: 2 });
    currentNow = new Date(now.getTime() + 2_000);
    await expect(service.runOnce()).resolves.toMatchObject({ restRefreshed: 1 });
    expect(refresh.mock.calls.map(([target]) => target.canonicalMarketId)).toEqual([
      "canonical-1",
      "canonical-2",
      "canonical-2"
    ]);

    currentNow = new Date(now.getTime() + 301_000);
    await expect(service.runOnce()).resolves.toMatchObject({ restRefreshed: 2 });
    expect(refresh).toHaveBeenCalledTimes(5);
  });

  it("backs off a failed venue instead of rotating through every native book", async () => {
    const connector = new FakeConnector("LIMITLESS");
    const refresh = vi.fn(async () => {
      throw new Error("provider 429");
    });
    let currentNow = now;
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [
            { canonicalMarketId: "canonical-1", canonicalOutcomeId: "YES", lastSeenAt: currentNow },
            { canonicalMarketId: "canonical-2", canonicalOutcomeId: "YES", lastSeenAt: currentNow }
          ];
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness(input) {
          return [{
            venue: "LIMITLESS",
            approvedVenueMarketId: `${input.canonicalMarketId}-approved`,
            venueMarketId: `${input.canonicalMarketId}-limitless-book`,
            venueOutcomeId: "YES",
            quoteReady: true,
            blockers: []
          }];
        }
      },
      connectors: [connector],
      restRefreshers: [{ venue: "LIMITLESS", refresh }],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => currentNow,
      config: {
        restRefreshIntervalMs: 1,
        maxRestRefreshTargetsPerTick: 10,
        maxRestRefreshTargetsPerVenuePerTick: 4
      }
    });

    await expect(service.runOnce()).resolves.toMatchObject({ restRefreshed: 0 });
    currentNow = new Date(now.getTime() + 10_000);
    await expect(service.runOnce()).resolves.toMatchObject({ restRefreshed: 0 });
    expect(refresh).toHaveBeenCalledTimes(1);

    currentNow = new Date(now.getTime() + 301_000);
    await expect(service.runOnce()).resolves.toMatchObject({ restRefreshed: 0 });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not let an inactive market cool down the whole REST venue", async () => {
    const connector = new FakeConnector("LIMITLESS");
    const refresh = vi.fn(async (target: VenueOrderbookSubscriptionTarget) => {
      if (target.venueMarketId === "inactive-market") {
        throw new Error("Limitless orderbook request failed with status 400. Market is not active");
      }
      return {
        ...snapshot(target),
        source: "REST" as const,
        quoteQuality: "FULL_DEPTH_REST" as const
      };
    });
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [
            { canonicalMarketId: "canonical-inactive", canonicalOutcomeId: "YES", lastSeenAt: now },
            { canonicalMarketId: "canonical-live", canonicalOutcomeId: "YES", lastSeenAt: now }
          ];
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness(input) {
          return input.canonicalMarketId === "canonical-inactive"
            ? [{
              venue: "LIMITLESS",
              approvedVenueMarketId: "approved-inactive",
              venueMarketId: "inactive-market",
              venueOutcomeId: "YES",
              quoteReady: true,
              blockers: []
            }]
            : [{
              venue: "LIMITLESS",
              approvedVenueMarketId: "approved-live",
              venueMarketId: "live-market",
              venueOutcomeId: "YES",
              quoteReady: true,
              blockers: []
            }];
        }
      },
      connectors: [connector],
      restRefreshers: [{ venue: "LIMITLESS", refresh }],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => now,
      config: {
        maxRestRefreshTargetsPerVenuePerTick: 2,
        restRefreshVenuePolicies: {
          LIMITLESS: { maxTargetsPerSweep: 2, failureCooldownMs: 300_000 }
        }
      }
    });

    await expect(service.runOnce()).resolves.toMatchObject({
      desiredSubscriptions: 2,
      restRefreshed: 1
    });
    expect(refresh.mock.calls.map(([target]) => target.venueMarketId)).toEqual([
      "inactive-market",
      "live-market"
    ]);
  });

  it("runs REST fallback as bounded sweeps instead of rotating through new targets every poll", async () => {
    const connector = new FakeConnector("PREDICT_FUN");
    const refresh = vi.fn(async (target: VenueOrderbookSubscriptionTarget) => ({
      ...snapshot(target),
      source: "REST" as const,
      quoteQuality: "FULL_DEPTH_REST" as const
    }));
    let currentNow = now;
    const service = new OrderbookStreamService({
      activeMarkets: {
        async listActiveMarketsFromRedis() {
          return [
            { canonicalMarketId: "canonical-1", canonicalOutcomeId: "YES", lastSeenAt: currentNow },
            { canonicalMarketId: "canonical-2", canonicalOutcomeId: "YES", lastSeenAt: currentNow },
            { canonicalMarketId: "canonical-3", canonicalOutcomeId: "YES", lastSeenAt: currentNow },
            { canonicalMarketId: "canonical-4", canonicalOutcomeId: "YES", lastSeenAt: currentNow }
          ];
        }
      },
      hotSnapshots: { put: vi.fn() },
      mappingResolver: {
        async getReadiness(input) {
          return [{
            venue: "PREDICT_FUN",
            approvedVenueMarketId: `${input.canonicalMarketId}-predict`,
            venueMarketId: `${input.canonicalMarketId}-predict`,
            venueOutcomeId: "YES",
            quoteReady: true,
            blockers: []
          }];
        }
      },
      connectors: [connector],
      restRefreshers: [{ venue: "PREDICT_FUN", refresh }],
      publisher: { publish: vi.fn(async () => 1) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => currentNow,
      config: {
        maxRestRefreshTargetsPerVenuePerTick: 2,
        restRefreshIntervalMs: 10_000,
        restRefreshVenuePolicies: {
          PREDICT_FUN: { maxTargetsPerSweep: 2 }
        }
      }
    });

    await expect(service.runOnce()).resolves.toMatchObject({ restRefreshed: 2 });
    currentNow = new Date(now.getTime() + 1_000);
    await expect(service.runOnce()).resolves.toMatchObject({ restRefreshed: 0 });
    expect(refresh).toHaveBeenCalledTimes(2);

    currentNow = new Date(now.getTime() + 11_000);
    await expect(service.runOnce()).resolves.toMatchObject({ restRefreshed: 2 });
    expect(refresh).toHaveBeenCalledTimes(4);
  });
});
