import { describe, expect, it } from "vitest";

import { buildLimitlessBtcDirectionalInventoryArtifact } from "../../src/reports/limitless-btc-directional-inventory.js";
import type { LimitlessLiveMarket } from "../../src/integrations/limitless/limitless-live-market-loader.js";

const buildMarket = (input: Partial<LimitlessLiveMarket> & Pick<LimitlessLiveMarket, "venueMarketId" | "title" | "canonicalCategory" | "family" | "asset">): LimitlessLiveMarket => ({
  venueMarketId: input.venueMarketId,
  marketId: input.marketId ?? input.venueMarketId,
  title: input.title,
  description: input.description ?? null,
  slug: input.slug ?? input.venueMarketId,
  status: input.status ?? "open",
  categories: input.categories ?? ["CRYPTO"],
  tags: input.tags ?? [],
  createdAt: input.createdAt ?? new Date("2026-04-02T00:00:00.000Z"),
  updatedAt: input.updatedAt ?? new Date("2026-04-02T00:00:00.000Z"),
  expiresAt: input.expiresAt ?? new Date("2026-03-21T16:00:00.000Z"),
  openInterest: input.openInterest ?? null,
  volume: input.volume ?? null,
  liquidity: input.liquidity ?? null,
  marketType: input.marketType ?? "BINARY",
  sourceRef: input.sourceRef ?? "limitless-live-market-loader",
  fetchedAt: input.fetchedAt ?? new Date("2026-04-02T00:00:00.000Z"),
  canonicalCategory: input.canonicalCategory,
  family: input.family,
  asset: input.asset,
  timeBoundary: input.timeBoundary ?? null,
  threshold: input.threshold ?? null,
  raw: input.raw ?? {}
});

describe("limitless btc directional inventory", () => {
  it("admits only BTC SAME_DAY_DIRECTIONAL candidates and rejects noisy rows explicitly", async () => {
    const artifact = await buildLimitlessBtcDirectionalInventoryArtifact({
      repoRoot: process.cwd(),
      loadedMarkets: [
        buildMarket({
          venueMarketId: "lt-btc-sdd",
          title: "Bitcoin higher or lower on March 21",
          description: "Will BTC close higher or lower on March 21 at 4:00 PM UTC?",
          canonicalCategory: "CRYPTO",
          family: "GENERIC_DIRECTIONAL",
          asset: "bitcoin"
        }),
        buildMarket({
          venueMarketId: "lt-eth",
          title: "Ethereum higher or lower on March 21",
          description: "Will ETH close higher or lower on March 21 at 4:00 PM UTC?",
          canonicalCategory: "CRYPTO",
          family: "GENERIC_DIRECTIONAL",
          asset: "ethereum"
        }),
        buildMarket({
          venueMarketId: "lt-sports",
          title: "Who will win tonight?",
          canonicalCategory: "SPORTS",
          family: "MATCHUP_WINNER",
          asset: null
        })
      ],
      sourceRefCountOverride: 1
    });

    expect(artifact.candidates).toHaveLength(1);
    expect(artifact.candidates[0]?.venueMarketId).toBe("lt-btc-sdd");
    expect(artifact.exclusions.map((entry) => entry.venueMarketId)).toEqual(expect.arrayContaining([
      "lt-eth",
      "lt-sports"
    ]));
  });
});
