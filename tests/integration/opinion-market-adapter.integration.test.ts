import { describe, expect, it, vi } from "vitest";

import { OpinionMarketAdapter } from "../../src/integrations/opinion/opinion-market-adapter.js";

describe("OpinionMarketAdapter integration", () => {
  it("normalizes live Opinion discovery payloads and builds canonical seeds", async () => {
    const adapter = new OpinionMarketAdapter({
      metadataVersion: "opinion-v1",
      client: {
        listMarkets: vi.fn(async () => [{
          marketId: 10562,
          marketTitle: "DOTA2 - ESL: Yandex vs Tundra (Mar. 28 11:30AM ET)",
          slug: "dota2-esl-yandex-vs-tundra-mar-28-11-30am-et",
          status: 2,
          statusEnum: "Activated",
          labels: ["Esports", "Sports"],
          rules: "This market is based on the DOTA2 match between Team Yandex and Tundra Esports.",
          yesLabel: "Yandex",
          noLabel: "Tundra",
          yesTokenId: "yes-token",
          noTokenId: "no-token",
          conditionId: "condition-id",
          resultTokenId: "result-token-id",
          volume: "34.065",
          createdAt: 1774587391,
          cutoffAt: 1774656000,
          resolvedAt: 0
        }])
      }
    });

    const markets = await adapter.listMarkets({ page: 1, limit: 100 });
    expect(markets).toHaveLength(1);
    expect(adapter.inferCanonicalCategory(markets[0]!)).toBe("ESPORTS");

    const seed = adapter.buildCanonicalSeed(markets[0]!);
    expect(seed.venue).toBe("OPINION");
    expect(seed.canonicalCategory).toBe("ESPORTS");
    expect(seed.marketClass).toBe("BINARY");
    expect(seed.normalizedPayload).toMatchObject({
      marketId: "10562",
      slug: "dota2-esl-yandex-vs-tundra-mar-28-11-30am-et",
      quoteTokenId: "yes-token",
      quoteOutcomeTokenIds: {
        YES: "yes-token",
        NO: "no-token"
      },
      conditionId: "condition-id",
      resultTokenId: "result-token-id"
    });
  });

  it("maps live Opinion politics inventory into the politics bucket", () => {
    const adapter = new OpinionMarketAdapter({
      metadataVersion: "opinion-v1",
      client: {
        listMarkets: vi.fn()
      }
    });

    expect(adapter.inferCanonicalCategory({
      venue: "OPINION",
      venueMarketId: "8454",
      title: "Will another country strike Iran by March 31?",
      slug: "iran-strike-march-31",
      marketType: 0,
      status: "Activated",
      statusCode: 2,
      labels: ["Politics"],
      rules: "Politics market",
      yesLabel: "Yes",
      noLabel: "No",
      yesTokenId: null,
      noTokenId: null,
      conditionId: null,
      resultTokenId: null,
      volume: "0",
      volume24h: "0",
      volume7d: "0",
      quoteToken: null,
      chainId: "56",
      questionId: null,
      createdAt: null,
      cutoffAt: null,
      resolvedAt: null,
      childMarkets: [],
      sourceMetadataVersion: "opinion-v1",
      raw: {}
    })).toBe("POLITICS");
  });
});
