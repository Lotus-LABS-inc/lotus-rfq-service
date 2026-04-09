import { describe, expect, it } from "vitest";

import { SportsPocketMatchingPipeline } from "../../src/matching/sports/sports-pocket-matching-pipeline.js";
import { buildSportsFixtureSupplyArtifactsFromResult } from "../../src/reports/sports-fixture-supply-pass.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";
import { InMemorySportsRepository } from "./sports-test-harness.js";

const buildNbaMarket = (input: {
  interpretedContractId: string;
  venue: "POLYMARKET" | "OPINION" | "PREDICT";
  title: string;
  sourceMetadataVersion?: string;
  historicalRowCount?: number;
}) => ({
  ...buildMatchingMarket({
    interpretedContractId: input.interpretedContractId,
    venue: input.venue,
    venueMarketId: input.interpretedContractId,
    title: input.title,
    rulesText: "NBA matchup on March 21 at 7:00PM ET. If the Lakers win, the market resolves to Lakers. If the Magic win, the market resolves to Magic.",
    category: "SPORTS",
    ...(input.sourceMetadataVersion ? { sourceMetadataVersion: input.sourceMetadataVersion } : {}),
    ...(input.historicalRowCount !== undefined ? { historicalRowCount: input.historicalRowCount } : {})
  }),
  outcomes: [{ label: "Lakers" }, { label: "Magic" }],
  outcomeSchema: { outcomeLabels: ["Lakers", "Magic"] }
});

const buildDotaMarket = (input: {
  interpretedContractId: string;
  title: string;
}) => ({
  ...buildMatchingMarket({
    interpretedContractId: input.interpretedContractId,
    venue: "OPINION",
    venueMarketId: input.interpretedContractId,
    title: input.title,
    rulesText: "This market is based on the DOTA2 match in ESL One Birmingham 2026.",
    category: "ESPORTS"
  }),
  outcomes: [{ label: "Aurora" }, { label: "Tundra" }],
  outcomeSchema: { outcomeLabels: ["Aurora", "Tundra"] }
});

describe("sports-fixture-supply-pass", () => {
  it("collapses reversed nba rows onto one deterministic fixture and marks it exact-safe eligible in principle", async () => {
    const repository = new InMemorySportsRepository([
      buildNbaMarket({
        interpretedContractId: "nba-left",
        venue: "POLYMARKET",
        title: "NBA: Lakers vs Magic Mar 21 at 7:00PM ET"
      }),
      buildNbaMarket({
        interpretedContractId: "nba-right",
        venue: "OPINION",
        title: "NBA: Magic vs Lakers (Mar 21 7:00PM ET)"
      })
    ]);

    const result = await new SportsPocketMatchingPipeline(repository).run();
    const artifacts = buildSportsFixtureSupplyArtifactsFromResult({ result });

    expect(artifacts.fixtureCoverageMatrix.fixtures).toHaveLength(1);
    expect(artifacts.fixtureCoverageMatrix.fixtures[0]?.boundVenueCount).toBe(2);
    expect(artifacts.fixtureCoverageMatrix.fixtures[0]?.exactSafeEligibleInPrinciple).toBe(true);
    expect(artifacts.pocketGapClassifier.pockets["SPORTS|MATCHUP_WINNER|NBA"]?.gap).toBe("BINDABLE_AND_PROMISING");
    expect(artifacts.finalDecision.decision).toBe("SPORTS_FIXTURE_BINDING_READY__TARGETED_SUPPLY_RECOVERY_NEXT");
  });

  it("classifies same-fixture nba overlap as basis fragmented when basis buckets diverge", async () => {
    const repository = new InMemorySportsRepository([
      buildNbaMarket({
        interpretedContractId: "nba-historical",
        venue: "POLYMARKET",
        title: "NBA: Lakers vs Magic Mar 21 at 7:00PM ET",
        sourceMetadataVersion: "historical-v1",
        historicalRowCount: 12
      }),
      buildNbaMarket({
        interpretedContractId: "nba-current",
        venue: "OPINION",
        title: "NBA: Lakers vs Magic (Mar 21 7:00PM ET)",
        sourceMetadataVersion: "current-state-v1",
        historicalRowCount: 1
      })
    ]);

    const result = await new SportsPocketMatchingPipeline(repository).run();
    const artifacts = buildSportsFixtureSupplyArtifactsFromResult({ result });

    expect(artifacts.fixtureCoverageMatrix.fixtures[0]?.comparableOverlapCount).toBe(0);
    expect(artifacts.fixtureCoverageMatrix.fixtures[0]?.blockers).toContain("BASIS_FRAGMENTED");
    expect(artifacts.pocketGapClassifier.pockets["SPORTS|MATCHUP_WINNER|NBA"]?.gap).toBe("BASIS_FRAGMENTED");
    expect(artifacts.targetedSupplyRecoveryPlan.pockets["SPORTS|MATCHUP_WINNER|NBA"]?.recommendation).toBe("TARGETED_CURRENT_STATE_CAPTURE");
    expect(artifacts.liveFixtureIngestionReadiness.pockets["SPORTS|MATCHUP_WINNER|NBA"]?.readiness).toBe("HIGH_VALUE_NOW");
  });

  it("marks opinion-only dota2 supply as thin while keeping live ingestion premature", async () => {
    const repository = new InMemorySportsRepository([
      buildDotaMarket({ interpretedContractId: "dota-a", title: "DOTA2 - ESL: Aurora vs Tundra (Mar. 26 11:30AM ET)" }),
      buildDotaMarket({ interpretedContractId: "dota-b", title: "DOTA2 - ESL: Yandex vs Spirit (Mar. 26 11:30AM ET)" }),
      buildDotaMarket({ interpretedContractId: "dota-c", title: "DOTA2 - ESL: Falcons vs PARI (Mar. 27 8:00AM ET)" }),
      buildDotaMarket({ interpretedContractId: "dota-d", title: "DOTA2 - ESL: MOUZ vs XG (Mar. 27 8:00AM ET)" })
    ]);

    const result = await new SportsPocketMatchingPipeline(repository).run();
    const artifacts = buildSportsFixtureSupplyArtifactsFromResult({ result });

    expect(artifacts.pocketSupplySummary.pockets["ESPORTS|MATCHUP_WINNER|DOTA2_ESL"]?.admittedRows).toBe(4);
    expect(artifacts.pocketGapClassifier.pockets["ESPORTS|MATCHUP_WINNER|DOTA2_ESL"]?.gap).toBe("SUPPLY_THIN");
    expect(artifacts.targetedSupplyRecoveryPlan.pockets["ESPORTS|MATCHUP_WINNER|DOTA2_ESL"]?.recommendation).toBe("TARGETED_DISCOVERY_FOR_MISSING_VENUE_ROWS");
    expect(artifacts.liveFixtureIngestionReadiness.pockets["ESPORTS|MATCHUP_WINNER|DOTA2_ESL"]?.readiness).toBe("LOW_VALUE_UNTIL_SUPPLY_IMPROVES");
  });

  it("holds zero-admission pockets as too thin and keeps sports secondary when no strong pocket exists", async () => {
    const repository = new InMemorySportsRepository([
      {
        ...buildMatchingMarket({
          interpretedContractId: "noise-only",
          venue: "LIMITLESS",
          venueMarketId: "noise-only",
          title: "Will Manchester City win?",
          rulesText: "Single-side prop.",
          category: "SPORTS"
        }),
        outcomes: [{ label: "Yes" }, { label: "No" }],
        outcomeSchema: { outcomeLabels: ["Yes", "No"] }
      }
    ]);

    const result = await new SportsPocketMatchingPipeline(repository).run();
    const artifacts = buildSportsFixtureSupplyArtifactsFromResult({ result });

    expect(artifacts.pocketGapClassifier.pockets["ESPORTS|MATCHUP_WINNER|LCK"]?.gap).toBe("TOO_THIN_TO_JUSTIFY");
    expect(artifacts.finalDecision.sportsFrontierRecommendation).toBe("REMAIN_SECONDARY");
  });
});
