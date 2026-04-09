import { describe, expect, it } from "vitest";

import { SportsMatchingPipeline } from "../../src/matching/sports/sports-matching-pipeline.js";
import { buildSportsFamilyPassArtifactsFromResult } from "../../src/reports/sports-family-pass.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";
import { InMemorySportsRepository } from "./sports-test-harness.js";

const buildMatchupMarket = (input: {
  interpretedContractId: string;
  venue: "POLYMARKET" | "OPINION";
  title: string;
}) => ({
  ...buildMatchingMarket({
    interpretedContractId: input.interpretedContractId,
    venue: input.venue,
    venueMarketId: input.interpretedContractId,
    title: input.title,
    rulesText: "In the upcoming NBA game, scheduled for March 21 at 7:00PM ET: If the Lakers win, the market will resolve to Lakers. If the Magic win, the market will resolve to Magic.",
    category: "SPORTS"
  }),
  outcomes: [{ label: "Lakers" }, { label: "Magic" }],
  outcomeSchema: { outcomeLabels: ["Lakers", "Magic"] }
});

describe("sports-family-pass", () => {
  it("builds exact-safe sports pair edges and ROI artifacts", async () => {
    const repository = new InMemorySportsRepository([
      buildMatchupMarket({
        interpretedContractId: "sports-pass-left",
        venue: "POLYMARKET",
        title: "Lakers vs. Magic"
      }),
      buildMatchupMarket({
        interpretedContractId: "sports-pass-right",
        venue: "OPINION",
        title: "NBA: Lakers vs Magic (Mar. 21 7:00PM ET)"
      })
    ]);

    const result = await new SportsMatchingPipeline(repository).run();
    const artifacts = buildSportsFamilyPassArtifactsFromResult({
      result,
      cryptoGraph: {
        observedAt: new Date().toISOString(),
        sourceCryptoMarketCount: 10,
        structurallyEligibleMarketCount: 2,
        pairEdgeCount: 0,
        labelDistribution: {},
        blockerReasons: {}
      },
      cryptoRouteability: {
        observedAt: new Date().toISOString(),
        exactSafePairsByAsset: {},
        exactSafePairsByFamily: {},
        exactSafePairsByAssetFamily: {},
        exactSafePairsByVenuePair: {},
        pairRouteableOpportunitiesByAssetFamily: {},
        triCapableAssetFamilies: [],
        triBlockersByAssetFamily: {},
        exactSafeApprovedCount: 0
      }
    });

    expect(result.pairEdges).toHaveLength(1);
    expect(result.pairEdges[0]?.label).toBe("EXACT");
    expect(artifacts.pairRouteabilitySummary.exactSafeApprovedCount).toBe(1);
    expect(artifacts.decision.decision).toBe("SPORTS_FAMILY_PASS_SUCCESS__STAY_ON_SPORTS");
    expect(artifacts.decision.bestPerformingFamily).toBe("MATCHUP_WINNER");
  });
});
