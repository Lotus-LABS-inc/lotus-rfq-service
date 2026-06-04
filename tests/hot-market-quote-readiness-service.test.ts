import { describe, expect, it, vi } from "vitest";
import type { NormalizedVenueQuoteSnapshot } from "../src/core/sor/quote-snapshot.js";
import { HotMarketQuoteReadinessSource } from "../src/services/hot-market-quote-readiness.service.js";

const now = new Date("2026-06-02T12:00:00.000Z");

const snapshot = (venue: string, venueMarketId: string, venueOutcomeId?: string): NormalizedVenueQuoteSnapshot => ({
  venue,
  venueMarketId,
  ...(venueOutcomeId ? { venueOutcomeId } : {}),
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

describe("HotMarketQuoteReadinessSource", () => {
  it("uses hot snapshots before the DB fallback", async () => {
    const fallback = vi.fn();
    const source = new HotMarketQuoteReadinessSource({
      mappingResolver: {
        async listApprovedReadiness() {
          return [{
            canonicalEventId: "event-1",
            canonicalMarketIds: ["market-1"],
            title: "Market 1",
            category: "Crypto",
            venues: [{
              venue: "POLYMARKET",
              approvedVenueMarketId: "approved-1",
              venueMarketId: "poly-1",
              venueOutcomeId: "token-yes",
              quoteReady: true,
              blockers: []
            }]
          }];
        }
      },
      hotSnapshots: {
        async getDisplay(input) {
          return snapshot(input.venue, input.venueMarketId, input.venueOutcomeId);
        }
      },
      fallbackSource: { listLatestMarketQuoteReadiness: fallback }
    });

    const result = await source.listLatestMarketQuoteReadiness({ canonicalMarketIds: ["market-1"] });

    expect(fallback).not.toHaveBeenCalled();
    expect(result).toEqual([expect.objectContaining({
      canonicalMarketId: "market-1",
      quoteStatus: "live",
      quoteReadyVenueCount: 1,
      quoteReadyVenues: ["POLYMARKET"],
      lastQuoteAt: now.toISOString()
    })]);
  });

  it("uses fresh DB fallback only when hot snapshots are missing", async () => {
    const source = new HotMarketQuoteReadinessSource({
      mappingResolver: {
        async listApprovedReadiness() {
          return [{
            canonicalEventId: "event-1",
            canonicalMarketIds: ["market-1"],
            title: "Market 1",
            category: "Crypto",
            venues: [{
              venue: "LIMITLESS",
              approvedVenueMarketId: "approved-1",
              venueMarketId: "limitless-1",
              venueOutcomeId: "YES",
              quoteReady: true,
              blockers: []
            }]
          }];
        }
      },
      hotSnapshots: {
        async getDisplay() {
          return null;
        }
      },
      fallbackSource: {
        async listLatestMarketQuoteReadiness() {
          return [{
            canonicalMarketId: "market-1",
            quoteStatus: "live" as const,
            quoteReadyVenueCount: 1,
            quoteReadyVenues: ["LIMITLESS"],
            quoteBlockers: [],
            lastQuoteAt: now.toISOString()
          }];
        }
      }
    });

    await expect(source.listLatestMarketQuoteReadiness({ canonicalMarketIds: ["market-1"] }))
      .resolves.toEqual([expect.objectContaining({
        quoteStatus: "live",
        quoteReadyVenueCount: 1,
        quoteReadyVenues: ["LIMITLESS"]
      })]);
  });

  it("merges DB fallback venues when only part of the route is hot", async () => {
    const source = new HotMarketQuoteReadinessSource({
      mappingResolver: {
        async listApprovedReadiness() {
          return [{
            canonicalEventId: "event-1",
            canonicalMarketIds: ["market-1"],
            title: "Market 1",
            category: "Crypto",
            venues: [
              {
                venue: "POLYMARKET",
                approvedVenueMarketId: "approved-poly",
                venueMarketId: "poly-1",
                venueOutcomeId: "token-yes",
                quoteReady: true,
                blockers: []
              },
              {
                venue: "LIMITLESS",
                approvedVenueMarketId: "approved-limitless",
                venueMarketId: "limitless-1",
                venueOutcomeId: "YES",
                quoteReady: true,
                blockers: []
              }
            ]
          }];
        }
      },
      hotSnapshots: {
        async getDisplay(input) {
          return input.venue === "POLYMARKET"
            ? snapshot(input.venue, input.venueMarketId, input.venueOutcomeId)
            : null;
        }
      },
      fallbackSource: {
        async listLatestMarketQuoteReadiness(input) {
          expect(input.canonicalMarketIds).toEqual(["market-1"]);
          return [{
            canonicalMarketId: "market-1",
            quoteStatus: "live" as const,
            quoteReadyVenueCount: 1,
            quoteReadyVenues: ["LIMITLESS"],
            quoteBlockers: [],
            lastQuoteAt: new Date(now.getTime() + 1000).toISOString()
          }];
        }
      }
    });

    await expect(source.listLatestMarketQuoteReadiness({ canonicalMarketIds: ["market-1"] }))
      .resolves.toEqual([expect.objectContaining({
        quoteStatus: "live",
        quoteReadyVenueCount: 2,
        quoteReadyVenues: ["LIMITLESS", "POLYMARKET"],
        quoteBlockers: [],
        lastQuoteAt: new Date(now.getTime() + 1000).toISOString()
      })]);
  });

  it("does not let execution-only token blockers hide a priced display snapshot", async () => {
    const source = new HotMarketQuoteReadinessSource({
      mappingResolver: {
        async listApprovedReadiness() {
          return [{
            canonicalEventId: "event-1",
            canonicalMarketIds: ["market-1"],
            title: "Market 1",
            category: "Crypto",
            venues: [{
              venue: "PREDICT_FUN",
              approvedVenueMarketId: "approved-predict",
              venueMarketId: "predict-1",
              venueOutcomeId: null,
              quoteReady: true,
              blockers: []
            }]
          }];
        }
      },
      hotSnapshots: {
        async getDisplay(input) {
          return {
            ...snapshot(input.venue, input.venueMarketId, input.venueOutcomeId),
            source: "REST",
            blockers: ["PREDICT_FUN_TOKEN_ID_MISSING"]
          };
        }
      }
    });

    await expect(source.listLatestMarketQuoteReadiness({ canonicalMarketIds: ["market-1"] }))
      .resolves.toEqual([expect.objectContaining({
        quoteStatus: "live",
        quoteReadyVenueCount: 1,
        quoteReadyVenues: ["PREDICT_FUN"],
        quoteBlockers: [],
        lastQuoteAt: now.toISOString()
      })]);
  });

  it("drops execution-only token blockers from fallback readiness when the venue is display-ready", async () => {
    const source = new HotMarketQuoteReadinessSource({
      mappingResolver: {
        async listApprovedReadiness() {
          return [{
            canonicalEventId: "event-1",
            canonicalMarketIds: ["market-1"],
            title: "Market 1",
            category: "Crypto",
            venues: [{
              venue: "PREDICT_FUN",
              approvedVenueMarketId: "approved-predict",
              venueMarketId: "predict-1",
              venueOutcomeId: null,
              quoteReady: true,
              blockers: []
            }]
          }];
        }
      },
      hotSnapshots: {
        async getDisplay() {
          return null;
        }
      },
      fallbackSource: {
        async listLatestMarketQuoteReadiness() {
          return [{
            canonicalMarketId: "market-1",
            quoteStatus: "partial" as const,
            quoteReadyVenueCount: 1,
            quoteReadyVenues: ["PREDICT_FUN"],
            quoteBlockers: [{
              venue: "PREDICT_FUN",
              reason: "PREDICT_FUN_TOKEN_ID_MISSING",
              venueMarketId: "predict-1"
            }],
            lastQuoteAt: now.toISOString()
          }];
        }
      }
    });

    await expect(source.listLatestMarketQuoteReadiness({ canonicalMarketIds: ["market-1"] }))
      .resolves.toEqual([expect.objectContaining({
        quoteStatus: "live",
        quoteReadyVenueCount: 1,
        quoteReadyVenues: ["PREDICT_FUN"],
        quoteBlockers: []
      })]);
  });

  it("does not mark display partial for hard-closed venue mappings when another venue is live", async () => {
    const source = new HotMarketQuoteReadinessSource({
      mappingResolver: {
        async listApprovedReadiness() {
          return [{
            canonicalEventId: "event-1",
            canonicalMarketIds: ["market-1"],
            title: "Market 1",
            category: "Crypto",
            venues: [
              {
                venue: "POLYMARKET",
                approvedVenueMarketId: "approved-poly",
                venueMarketId: "poly-1",
                venueOutcomeId: "token-yes",
                quoteReady: true,
                blockers: []
              },
              {
                venue: "LIMITLESS",
                approvedVenueMarketId: "approved-limitless",
                venueMarketId: "limitless-1",
                venueOutcomeId: "YES",
                quoteReady: false,
                blockers: ["QUOTE_PROVIDER_MARKET_INACTIVE"]
              }
            ]
          }];
        }
      },
      hotSnapshots: {
        async getDisplay(input) {
          return input.venue === "POLYMARKET"
            ? snapshot(input.venue, input.venueMarketId, input.venueOutcomeId)
            : null;
        }
      }
    });

    await expect(source.listLatestMarketQuoteReadiness({ canonicalMarketIds: ["market-1"] }))
      .resolves.toEqual([expect.objectContaining({
        quoteStatus: "live",
        quoteReadyVenueCount: 1,
        quoteReadyVenues: ["POLYMARKET"],
        quoteBlockers: []
      })]);
  });

  it("suppresses hard provider fallback blockers when another venue is display-ready", async () => {
    const source = new HotMarketQuoteReadinessSource({
      mappingResolver: {
        async listApprovedReadiness() {
          return [{
            canonicalEventId: "event-1",
            canonicalMarketIds: ["market-1"],
            title: "Market 1",
            category: "Crypto",
            venues: [
              {
                venue: "POLYMARKET",
                approvedVenueMarketId: "approved-poly",
                venueMarketId: "poly-1",
                venueOutcomeId: "token-yes",
                quoteReady: true,
                blockers: []
              },
              {
                venue: "PREDICT_FUN",
                approvedVenueMarketId: "approved-predict",
                venueMarketId: "PREDICT:14343:canonical",
                venueOutcomeId: null,
                quoteReady: true,
                blockers: []
              }
            ]
          }];
        }
      },
      hotSnapshots: {
        async getDisplay(input) {
          return input.venue === "POLYMARKET"
            ? snapshot(input.venue, input.venueMarketId, input.venueOutcomeId)
            : null;
        }
      },
      fallbackSource: {
        async listLatestMarketQuoteReadiness() {
          return [{
            canonicalMarketId: "market-1",
            quoteStatus: "partial" as const,
            quoteReadyVenueCount: 1,
            quoteReadyVenues: ["POLYMARKET"],
            quoteBlockers: [{
              venue: "PREDICT_FUN",
              reason: "QUOTE_PROVIDER_HTTP_404",
              venueMarketId: "PREDICT:14343:canonical"
            }],
            lastQuoteAt: now.toISOString()
          }];
        }
      }
    });

    await expect(source.listLatestMarketQuoteReadiness({ canonicalMarketIds: ["market-1"] }))
      .resolves.toEqual([expect.objectContaining({
        quoteStatus: "live",
        quoteReadyVenueCount: 1,
        quoteReadyVenues: ["POLYMARKET"],
        quoteBlockers: []
      })]);
  });
});
