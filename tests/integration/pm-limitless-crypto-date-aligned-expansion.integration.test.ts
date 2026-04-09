import { describe, expect, it } from "vitest";

import { buildPmLimitlessCryptoDateAlignedSeeds } from "../../src/operations/semantic-expansion/pm-limitless-crypto-date-aligned-expansion.js";

describe("buildPmLimitlessCryptoDateAlignedSeeds integration shape", () => {
  it("does not add anchors when live Opinion support is absent for the exact BTC date/cutoff", () => {
    const result = buildPmLimitlessCryptoDateAlignedSeeds({
      baselineSeeds: [],
      matrix: {
        observedAt: new Date().toISOString(),
        metadataVersion: "test",
        scannedCryptoMarketCount: 0,
        countsByFamily: {
          ATH_BY_DATE: 0,
          THRESHOLD_BY_DATE: 0,
          SAME_DAY_DIRECTIONAL: 0,
          PRICE_AT_CLOSE: 0,
          GENERIC_UP_DOWN: 0
        },
        btcTargetableDates: [],
        matrix: []
      },
      inventoryByKey: new Map(),
      matches: []
    });

    expect(result.summary.addedSeedCount).toBe(0);
    expect(result.seeds).toHaveLength(0);
  });
});
