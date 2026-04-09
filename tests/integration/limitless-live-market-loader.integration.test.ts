import { describe, expect, it } from "vitest";

import { loadLimitlessLiveMarkets } from "../../src/integrations/limitless/limitless-live-market-loader.js";

describe("limitless live market loader", () => {
  it("parses embedded public market payloads into live inventory", async () => {
    const html = `<!DOCTYPE html><script>window.__STATE__={"markets":[{"id":123,"title":"Will Bitcoin go up or down on March 30?","description":"BTC daily directional market","expirationTimestamp":1774862400000,"createdAt":"2026-03-29T10:00:00.000Z","updatedAt":"2026-03-29T10:05:00.000Z","categories":["Crypto"],"tags":["Bitcoin"],"openInterest":"10","volume":"20","liquidity":"30","slug":"will-bitcoin-go-up-or-down-on-march-30","marketType":"single","status":"FUNDED"}]};</script>`;
    const result = await loadLimitlessLiveMarkets({
      repoRoot: process.cwd(),
      fetchRemote: true,
      fetchImpl: async () => new Response(html, { status: 200 }),
      baseUrl: "https://limitless.exchange",
      paths: ["/markets"]
    });

    expect(result.summary.fetchedFromLiveSurface).toBe(true);
    expect(result.markets).toHaveLength(1);
    expect(result.markets[0]).toEqual(
      expect.objectContaining({
        venueMarketId: "will-bitcoin-go-up-or-down-on-march-30",
        canonicalCategory: "CRYPTO",
        family: "SAME_DAY_DIRECTIONAL",
        asset: "bitcoin"
      })
    );
  });
});
