import { describe, expect, it } from "vitest";
import { PolymarketGammaClient } from "../../src/integrations/polymarket/polymarket-gamma-client.js";

describe("PolymarketGammaClient", () => {
  it("resolves event-scoped slug/date identifiers to the matching market", async () => {
    const fetchImpl = async (url: URL | RequestInfo) => {
      expect(String(url)).toContain("/events/slug/will-trump-visit-china-by");
      return {
        ok: true,
        async json() {
          return {
            markets: [
              {
                question: "Will Trump visit China by May 31?",
                conditionId: "0xmay",
                slug: "will-trump-visit-china-by-may-31",
                outcomes: "[\"Yes\", \"No\"]",
                clobTokenIds: "[\"may-yes\", \"may-no\"]"
              },
              {
                question: "Will Trump visit China by April 30?",
                conditionId: "0xapr",
                slug: "will-trump-visit-china-by-april-30",
                outcomes: "[\"Yes\", \"No\"]",
                clobTokenIds: "[\"apr-yes\", \"apr-no\"]"
              }
            ]
          };
        }
      } as Response;
    };
    const client = new PolymarketGammaClient({ fetchImpl });

    const markets = await client.getMarketByIdentifier("will-trump-visit-china-by:april-30-2026");

    expect(markets).toHaveLength(1);
    expect(markets[0]?.conditionId).toBe("0xapr");
    expect(markets[0]?.raw.outcomes).toEqual([
      { label: "Yes", token_id: "apr-yes" },
      { label: "No", token_id: "apr-no" }
    ]);
  });
});
