import { describe, expect, it } from "vitest";

import { buildOpinionCryptoDateFamilyMatrix, inferCryptoCutoffStyle } from "../../src/integrations/opinion/opinion-crypto-date-family-matrix.js";

describe("buildOpinionCryptoDateFamilyMatrix", () => {
  it("classifies BTC crypto families by date and cutoff style", async () => {
    const pages = [
      [
        {
          marketId: "100",
          marketTitle: "Bitcoin Up or Down on March 22?(12:00 ET)",
          labels: ["Crypto"],
          rules: null
        },
        {
          marketId: "101",
          marketTitle: "Bitcoin all time high by March 31, 2026?",
          labels: ["Crypto"],
          rules: "Resolves YES if BTC reaches a new all time high by March 31, 2026."
        },
        {
          marketId: "102",
          marketTitle: "Will Bitcoin be above $100,000 by March 31, 2026?",
          labels: ["Crypto"],
          rules: "Resolves YES if BTC is above $100,000 by March 31, 2026."
        },
        {
          marketId: "103",
          marketTitle: "Bitcoin price at UTC close on March 22?",
          labels: ["Crypto"],
          rules: null
        }
      ],
      []
    ];
    let pageIndex = 0;
    const client = {
      listMarkets: async () => pages[pageIndex++] ?? []
    };

    const result = await buildOpinionCryptoDateFamilyMatrix({ client });

    expect(result.summary.scannedCryptoMarketCount).toBe(4);
    expect(result.summary.countsByFamily.SAME_DAY_DIRECTIONAL).toBe(1);
    expect(result.summary.countsByFamily.ATH_BY_DATE).toBe(1);
    expect(result.summary.countsByFamily.THRESHOLD_BY_DATE).toBe(1);
    expect(result.summary.countsByFamily.PRICE_AT_CLOSE).toBe(1);
    expect(
      result.rows.some((row) =>
        row.family === "SAME_DAY_DIRECTIONAL" && row.cutoffStyle === "NOON_ET_DAILY"
      )
    ).toBe(true);
  });

  it("normalizes cutoff styles deterministically", () => {
    expect(inferCryptoCutoffStyle({
      title: "Bitcoin Up or Down on March 22?(12:00 ET)",
      exactDate: "march 22 2026",
      timeBoundaryPattern: "INTRADAY_CLOSE"
    })).toBe("NOON_ET_DAILY");

    expect(inferCryptoCutoffStyle({
      title: "Bitcoin price at UTC close on March 22?",
      exactDate: "march 22 2026",
      timeBoundaryPattern: "INTRADAY_CLOSE"
    })).toBe("UTC_HOURLY_CLOSE");

    expect(inferCryptoCutoffStyle({
      title: "Bitcoin all time high by March 31, 2026?",
      exactDate: "march 31 2026",
      timeBoundaryPattern: "BY_DATE"
    })).toBe("END_OF_DAY_BY_DATE");
  });
});
