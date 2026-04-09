import { describe, expect, it } from "vitest";

import { buildConfirmationMarket, buildGeopoliticalMarket, buildOfficeWinnerMarket, runPoliticsArtifacts } from "./politics-test-fixtures.js";

describe("politics inventory census", () => {
  it("counts politics rows by venue and exposes extraction failures deterministically", async () => {
    const artifacts = await runPoliticsArtifacts([
      buildOfficeWinnerMarket({ interpretedContractId: "op-1", venue: "OPINION" }),
      buildOfficeWinnerMarket({ interpretedContractId: "pm-1", venue: "POLYMARKET" }),
      buildGeopoliticalMarket({ interpretedContractId: "ll-1", venue: "LIMITLESS" }),
      buildConfirmationMarket({ interpretedContractId: "pd-1", venue: "PREDICT" })
    ]);

    expect(artifacts.inventoryCensusSummary.totalPoliticsRowsByVenue).toEqual({
      LIMITLESS: 1,
      OPINION: 1,
      POLYMARKET: 1,
      PREDICT: 1
    });
    expect(artifacts.inventoryByVenue.venues.OPINION?.families.OFFICE_WINNER).toBe(1);
    expect(artifacts.extractionFailureSummary.failures).toBeDefined();
  });
});
