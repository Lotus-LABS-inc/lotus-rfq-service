import { describe, expect, it } from "vitest";
import {
  LimitlessOrderbookStreamAdapter,
  OpinionOrderbookStreamAdapter,
  PolymarketOrderbookStreamAdapter,
  PredictOrderbookStreamAdapter,
  DEFAULT_POLYMARKET_MARKET_WS_URL
} from "../src/integrations/orderbook-stream-normalizers.js";

const receivedAt = new Date("2026-05-23T12:00:00.000Z");

describe("venue orderbook stream normalizers", () => {
  it("normalizes Polymarket stream books into stream snapshots", () => {
    const adapter = new PolymarketOrderbookStreamAdapter();
    const snapshot = adapter.normalize({
      venueMarketId: "condition-1",
      venueOutcomeId: "token-1",
      receivedAt,
      payload: {
        bids: [{ price: "0.49", size: "10" }, { price: "0.48", size: "8" }],
        asks: [{ price: "0.51", size: "11" }, { price: "0.52", size: "9" }]
      }
    });

    expect(DEFAULT_POLYMARKET_MARKET_WS_URL).toContain("wss://");
    expect(snapshot?.venue).toBe("POLYMARKET");
    expect(snapshot?.source).toBe("STREAM");
    expect(snapshot?.quoteQuality).toBe("FULL_DEPTH_STREAM");
    expect(snapshot?.metadata?.streamAdapterVersion).toBe("venue-orderbook-stream-v1");
  });

  it("normalizes Limitless stream orderbooks through the existing venue normalizer", () => {
    const adapter = new LimitlessOrderbookStreamAdapter();
    const snapshot = adapter.normalize({
      venueMarketId: "limitless-1",
      receivedAt,
      payload: {
        data: {
          bids: [{ price: "0.45", size: "3" }, { price: "0.44", size: "4" }],
          asks: [{ price: "0.55", size: "5" }, { price: "0.56", size: "6" }]
        }
      }
    });

    expect(snapshot?.venue).toBe("LIMITLESS");
    expect(snapshot?.source).toBe("STREAM");
    expect(snapshot?.asks[0]?.price).toBe("0.55");
  });

  it("normalizes Opinion stream orderbooks", () => {
    const adapter = new OpinionOrderbookStreamAdapter();
    const snapshot = adapter.normalize({
      venueMarketId: "opinion-1",
      venueOutcomeId: "token-yes",
      receivedAt,
      payload: {
        result: {
          bids: [[0.4, 7], [0.39, 2]],
          asks: [[0.6, 9], [0.61, 1]]
        }
      }
    });

    expect(snapshot?.venue).toBe("OPINION");
    expect(snapshot?.source).toBe("STREAM");
    expect(snapshot?.venueOutcomeId).toBe("token-yes");
  });

  it("normalizes Predict stream orderbooks and preserves environment metadata", () => {
    const adapter = new PredictOrderbookStreamAdapter("mainnet");
    const snapshot = adapter.normalize({
      venueMarketId: "123",
      venueOutcomeId: "1",
      canonicalOutcomeId: "YES",
      receivedAt,
      payload: {
        data: {
          bids: [{ price: "0.47", size: "1" }, { price: "0.46", size: "2" }],
          asks: [{ price: "0.53", size: "3" }, { price: "0.54", size: "4" }]
        }
      }
    });

    expect(snapshot?.venue).toBe("PREDICT_FUN");
    expect(snapshot?.source).toBe("STREAM");
    expect(snapshot?.metadata?.environment).toBe("mainnet");
  });
});
