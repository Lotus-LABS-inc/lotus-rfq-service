import { describe, expect, it, vi } from "vitest";
import type { NormalizedVenueQuoteSnapshot } from "../src/core/sor/quote-snapshot.js";
import { parseOrderbookStreamVenues } from "../src/orderbook-stream-service.js";
import {
  OrderbookStreamService,
  marketOrderbookTopic,
  parseMarketOrderbookTopic,
  subscriptionKey,
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

  public emit(target: VenueOrderbookSubscriptionTarget): void {
    this.listener?.(snapshot(target), target);
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
      canonicalMarketId: "OFFICE_WINNER|SEOUL|MAYOR|2026",
      canonicalOutcomeId: "YES",
      venue: "POLYMARKET",
      bestBid: "0.49",
      bestAsk: "0.51",
      snapshotStatus: "live"
    });
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
});
