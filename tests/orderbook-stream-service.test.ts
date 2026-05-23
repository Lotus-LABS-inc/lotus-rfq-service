import { describe, expect, it, vi } from "vitest";
import type { NormalizedVenueQuoteSnapshot } from "../src/core/sor/quote-snapshot.js";
import {
  OrderbookStreamService,
  marketOrderbookTopic,
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

describe("OrderbookStreamService", () => {
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
      now: () => now
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
});
