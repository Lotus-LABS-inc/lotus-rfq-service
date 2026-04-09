import { describe, expect, it } from "vitest";

import { SportsMatchingPipeline } from "../../src/matching/sports/sports-matching-pipeline.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";
import { InMemorySportsRepository } from "./sports-test-harness.js";

const buildDeterministicMarkets = () => [
  {
    ...buildMatchingMarket({
      interpretedContractId: "sports-det-left",
      venue: "POLYMARKET",
      venueMarketId: "sports-det-left",
      title: "Lakers vs. Magic",
      rulesText: "In the upcoming NBA game, scheduled for March 21 at 7:00PM ET: If the Lakers win, the market will resolve to Lakers. If the Magic win, the market will resolve to Magic.",
      category: "SPORTS"
    }),
    outcomes: [{ label: "Lakers" }, { label: "Magic" }],
    outcomeSchema: { outcomeLabels: ["Lakers", "Magic"] }
  },
  {
    ...buildMatchingMarket({
      interpretedContractId: "sports-det-right",
      venue: "OPINION",
      venueMarketId: "sports-det-right",
      title: "NBA: Lakers vs Magic (Mar. 21 7:00PM ET)",
      rulesText: "In the upcoming NBA game, scheduled for March 21 at 7:00PM ET: If the Lakers win, the market will resolve to Lakers. If the Magic win, the market will resolve to Magic.",
      category: "SPORTS"
    }),
    outcomes: [{ label: "Lakers" }, { label: "Magic" }],
    outcomeSchema: { outcomeLabels: ["Lakers", "Magic"] }
  }
];

describe("sports-matching-determinism", () => {
  it("produces deterministic exact-safe sports edges for the same inputs", async () => {
    const first = await new SportsMatchingPipeline(new InMemorySportsRepository(buildDeterministicMarkets())).run();
    const second = await new SportsMatchingPipeline(new InMemorySportsRepository(buildDeterministicMarkets())).run();

    expect(first.pairEdges.map((edge) => ({
      family: edge.family,
      label: edge.label,
      approvalState: edge.approvalState,
      id: edge.id
    }))).toEqual(second.pairEdges.map((edge) => ({
      family: edge.family,
      label: edge.label,
      approvalState: edge.approvalState,
      id: edge.id
    })));
  });
});
