import { describe, expect, it } from "vitest";

import { buildOpinionFamilyInventoryMap } from "../../src/integrations/opinion/opinion-family-inventory-map.js";

describe("buildOpinionFamilyInventoryMap", () => {
  it("classifies paged Opinion inventory into normalized family buckets", async () => {
    const pages = [
      [
        {
          marketId: "1",
          marketTitle: "Bitcoin all time high by March 31, 2026?",
          labels: ["Crypto"],
          rules: "Resolves YES if BTC reaches a new all time high by March 31, 2026."
        },
        {
          marketId: "2",
          marketTitle: "NBA: Suns vs Magic (Mar. 31 7:00PM ET)",
          labels: ["NBA", "Sports"],
          rules: null
        }
      ],
      []
    ];
    let pageIndex = 0;
    const client = {
      listMarkets: async () => pages[pageIndex++] ?? []
    };

    const result = await buildOpinionFamilyInventoryMap({
      client
    });

    expect(result.summary.scannedMarketCount).toBe(2);
    expect(result.summary.countsByFamily.ATH_BY_DATE).toBe(1);
    expect(result.summary.countsByFamily.MATCHUP_WINNER).toBe(1);
  });
});
