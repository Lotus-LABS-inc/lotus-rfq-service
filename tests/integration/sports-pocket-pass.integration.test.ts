import { describe, expect, it } from "vitest";

import { SportsPocketMatchingPipeline } from "../../src/matching/sports/sports-pocket-matching-pipeline.js";
import { buildSportsPocketPassArtifactsFromResult } from "../../src/reports/sports-pocket-pass.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";
import { InMemorySportsRepository } from "./sports-test-harness.js";

const buildNbaMarket = (input: {
  interpretedContractId: string;
  venue: "POLYMARKET" | "OPINION";
  title: string;
}) => ({
  ...buildMatchingMarket({
    interpretedContractId: input.interpretedContractId,
    venue: input.venue,
    venueMarketId: input.interpretedContractId,
    title: input.title,
    rulesText: "NBA matchup on March 21 at 7:00PM ET. If the Lakers win, the market resolves to Lakers. If the Magic win, the market resolves to Magic.",
    category: "SPORTS"
  }),
  outcomes: [{ label: "Lakers" }, { label: "Magic" }],
  outcomeSchema: { outcomeLabels: ["Lakers", "Magic"] }
});

describe("sports-pocket-pass", () => {
  it("admits only in-scope matchup pockets and produces an exact-safe nba edge", async () => {
    const repository = new InMemorySportsRepository([
      buildNbaMarket({
        interpretedContractId: "pocket-left",
        venue: "POLYMARKET",
        title: "NBA: Lakers vs Magic Mar 21 at 7:00PM ET"
      }),
      buildNbaMarket({
        interpretedContractId: "pocket-right",
        venue: "OPINION",
        title: "NBA: Lakers vs Magic (Mar 21 7:00PM ET)"
      }),
      {
        ...buildMatchingMarket({
          interpretedContractId: "pocket-reject",
          venue: "LIMITLESS",
          venueMarketId: "pocket-reject",
          title: "Will Manchester City win?",
          rulesText: "Single-side prop.",
          category: "SPORTS"
        }),
        outcomes: [{ label: "Yes" }, { label: "No" }],
        outcomeSchema: { outcomeLabels: ["Yes", "No"] }
      }
    ]);

    const result = await new SportsPocketMatchingPipeline(repository).run();

    expect(result.pocketMarkets).toHaveLength(2);
    expect(result.pairEdges).toHaveLength(1);
    expect(result.pairEdges[0]?.label).toBe("EXACT");
    expect(result.admissionEvaluations.find((row) => row.market.interpretedContractId === "pocket-reject")?.rejectionReasons).toContain("NON_MATCHUP_ROW");
  });

  it("builds roi artifacts and chooses the success label when a pocket yields an exact-safe edge", async () => {
    const repository = new InMemorySportsRepository([
      buildNbaMarket({
        interpretedContractId: "roi-left",
        venue: "POLYMARKET",
        title: "NBA: Lakers vs Magic Mar 21 at 7:00PM ET"
      }),
      buildNbaMarket({
        interpretedContractId: "roi-right",
        venue: "OPINION",
        title: "NBA: Lakers vs Magic (Mar 21 7:00PM ET)"
      })
    ]);

    const result = await new SportsPocketMatchingPipeline(repository).run();
    const artifacts = buildSportsPocketPassArtifactsFromResult({
      result,
      priorSportsGraph: {
        observedAt: new Date().toISOString(),
        sourceMarketCount: 10,
        structurallyEligibleMarketCount: 2,
        pairEdgeCount: 0,
        labelDistribution: {},
        blockerReasons: {}
      },
      priorSportsRouteability: {
        observedAt: new Date().toISOString(),
        exactSafePairsByDomain: {},
        exactSafePairsByFamily: {},
        exactSafePairsByVenuePair: {},
        routeablePairOpportunitiesByFamily: {},
        triCapableFamilies: [],
        triBlockersByFamily: {},
        exactSafeApprovedCount: 0
      },
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

    expect(artifacts.routeabilitySummary.exactSafeApprovedEdges).toBe(1);
    expect(artifacts.decision.decision).toBe("SPORTS_POCKET_PASS_SUCCESS__STAY_ON_MATCHUP_POCKETS");
    expect(artifacts.decision.bestPerformingPocket).toBe("SPORTS|MATCHUP_WINNER|NBA");
    expect(artifacts.coverageMatrix.pockets["SPORTS|MATCHUP_WINNER|NBA"]?.venues["POLYMARKET"]?.coverageLabel).toBe("VENUE_PRESENT_AND_CANDIDATE_ELIGIBLE");
    expect(artifacts.coverageMatrix.pockets["SPORTS|MATCHUP_WINNER|NBA"]?.venues["LIMITLESS"]?.coverageLabel).toBe("VENUE_ABSENT");
    expect(artifacts.basisSummary.pockets["SPORTS|MATCHUP_WINNER|NBA"]?.venues["POLYMARKET"]?.label).toBe("BASIS_COMPARABLE");
    expect(artifacts.rootCauseClassifier.pockets["ESPORTS|MATCHUP_WINNER|LCK"]?.dominantClass).toBe("LOW_SIGNAL_POCKET");
    expect(artifacts.targetedRecoveryPlan.pockets["SPORTS|MATCHUP_WINNER|NBA"]?.recommendation).toBe("TARGETED_DISCOVERY_RECOVERY_JUSTIFIED");
    expect(artifacts.priorityRecommendation.primaryRecommendation).toBe("TARGETED_RECOVERY_NBA");
    expect(artifacts.finalDecision.decision).toBe("SPORTS_COVERAGE_GAP_CONFIRMED__TARGETED_RECOVERY_JUSTIFIED");
  });

  it("classifies basis-only single-venue supply without a counterpart", async () => {
    const repository = new InMemorySportsRepository([
      {
        ...buildNbaMarket({
          interpretedContractId: "hist-only",
          venue: "POLYMARKET",
          title: "NBA: Lakers vs Magic Mar 21 at 7:00PM ET"
        }),
        sourceMetadataVersion: "historical-v1",
        historicalRowCount: 12,
        inventoryTemporalBasis: "HISTORICAL" as const
      }
    ]);

    const result = await new SportsPocketMatchingPipeline(repository).run();
    const artifacts = buildSportsPocketPassArtifactsFromResult({
      result,
      priorSportsGraph: {
        observedAt: new Date().toISOString(),
        sourceMarketCount: 1,
        structurallyEligibleMarketCount: 1,
        pairEdgeCount: 0,
        labelDistribution: {},
        blockerReasons: {}
      },
      priorSportsRouteability: {
        observedAt: new Date().toISOString(),
        exactSafePairsByDomain: {},
        exactSafePairsByFamily: {},
        exactSafePairsByVenuePair: {},
        routeablePairOpportunitiesByFamily: {},
        triCapableFamilies: [],
        triBlockersByFamily: {},
        exactSafeApprovedCount: 0
      },
      cryptoGraph: {
        observedAt: new Date().toISOString(),
        sourceCryptoMarketCount: 0,
        structurallyEligibleMarketCount: 0,
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

    expect(artifacts.basisSummary.pockets["SPORTS|MATCHUP_WINNER|NBA"]?.venues["POLYMARKET"]?.label).toBe("HISTORICAL_ONLY_WITHOUT_COUNTERPART");
    expect(artifacts.rootCauseClassifier.pockets["SPORTS|MATCHUP_WINNER|NBA"]?.dominantClass).toBe("LOW_SIGNAL_POCKET");
  });
});
