import { describe, expect, it } from "vitest";

import { buildOpinionCryptoDateFamilyMatrix } from "../../src/integrations/opinion/opinion-crypto-date-family-matrix.js";

describe("buildOpinionCryptoDateFamilyMatrix integration shape", () => {
  it("produces a BTC-first crypto date-family matrix from paged market responses", async () => {
    const pages = [
      [
        {
          marketId: "10045",
          marketTitle: "Bitcoin Up or Down on March 22?(12:00 ET)",
          labels: ["Crypto"],
          rules: null
        },
        {
          marketId: "10046",
          marketTitle: "Will Bitcoin be above $100,000 by March 31, 2026?",
          labels: ["Crypto"],
          rules: "Resolves YES if BTC is above $100,000 by March 31, 2026."
        }
      ],
      []
    ];
    let pageIndex = 0;
    const client = {
      listMarkets: async () => pages[pageIndex++] ?? []
    };

    const result = await buildOpinionCryptoDateFamilyMatrix({ client });

    expect(result.summary.scannedCryptoMarketCount).toBe(2);
    expect(result.summary.btcTargetableDates.length).toBeGreaterThan(0);
    expect(result.summary.matrix.some((row) => row.asset === "bitcoin" && row.family === "SAME_DAY_DIRECTIONAL")).toBe(true);
  });
});
