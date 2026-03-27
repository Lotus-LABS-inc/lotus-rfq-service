import { describe, expect, it } from "vitest";

import {
  parseLimitlessHistoricalPriceResponse,
  parseLimitlessMarketDetailResponse,
  parseLimitlessMarketEventsResponse
} from "../../src/integrations/limitless/limitless-schemas.js";

describe("limitlessSchemas", () => {
  it("accepts documented market detail responses with nullable venue fields", () => {
    const parsed = parseLimitlessMarketDetailResponse({
      title: "Bitcoin all time high by March 31?",
      slug: "bitcoin-all-time-high-by-march-31-1767809993576",
      status: "FUNDED",
      tradeType: "clob",
      marketType: "single",
      volume: "31634865732",
      venue: {
        exchange: "0x05c748E2f4DcDe0ec9Fa8DDc40DE6b867f923fa5",
        adapter: null
      }
    });

    expect(parsed.title).toBe("Bitcoin all time high by March 31?");
    expect(parsed.venue).toEqual(
      expect.objectContaining({
        exchange: "0x05c748E2f4DcDe0ec9Fa8DDc40DE6b867f923fa5",
        adapter: null
      })
    );
  });

  it("normalizes single-object historical price responses into series arrays", () => {
    const parsed = parseLimitlessHistoricalPriceResponse({
      title: "Gavin Newsom",
      prices: [{ timestamp: "1774009920000", price: 0.2485 }]
    });

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual(
      expect.objectContaining({
        title: "Gavin Newsom",
        prices: [expect.objectContaining({ price: 0.2485 })]
      })
    );
  });

  it("normalizes raw trade event payloads into timestamped event records", () => {
    const parsed = parseLimitlessMarketEventsResponse({
      events: [
        {
          createdAt: "2026-03-17T22:40:01.210Z",
          txHash: "0xa9d7",
          price: 0.756,
          side: 0
        }
      ]
    });

    expect(parsed.events).toEqual([
      expect.objectContaining({
        id: "0xa9d7",
        type: "TRADE",
        timestamp: "2026-03-17T22:40:01.210Z",
        data: expect.objectContaining({ price: 0.756, side: 0 })
      })
    ]);
  });
});
