import { describe, expect, it } from "vitest";

import { CryptoMatchingPipeline } from "../../src/matching/crypto/crypto-matching-pipeline.js";
import { listRouteableCryptoPairEdges } from "../../src/matching/crypto/crypto-pair-graph.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";
import { InMemoryCryptoRepository } from "./crypto-test-harness.js";

describe("crypto pair graph", () => {
  it("contains only approved exact BTC edges as routeable", async () => {
    const repository = new InMemoryCryptoRepository([
      buildMatchingMarket({
        interpretedContractId: "pm-ath",
        venue: "POLYMARKET",
        venueMarketId: "pm-1",
        category: "CRYPTO",
        title: "Bitcoin all time high by March 31, 2026?"
      }),
      buildMatchingMarket({
        interpretedContractId: "lt-ath",
        venue: "LIMITLESS",
        venueMarketId: "lt-1",
        category: "CRYPTO",
        title: "Bitcoin all time high by March 31?"
      }),
      buildMatchingMarket({
        interpretedContractId: "op-daily",
        venue: "OPINION",
        venueMarketId: "op-1",
        category: "CRYPTO",
        title: "Bitcoin Up or Down on March 21?(12:00 ET)"
      })
    ]);

    const result = await new CryptoMatchingPipeline(repository).run();
    const routeable = listRouteableCryptoPairEdges(result.pairGraph);

    expect(routeable).toHaveLength(1);
    expect(routeable[0]?.label).toBe("EXACT");
    expect(routeable[0]?.approvalState).toBe("autoApproved");
  });
});
