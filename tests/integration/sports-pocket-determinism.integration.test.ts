import { describe, expect, it } from "vitest";

import { SportsPocketMatchingPipeline } from "../../src/matching/sports/sports-pocket-matching-pipeline.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";
import { InMemorySportsRepository } from "./sports-test-harness.js";

const buildEsportsMarket = (input: {
  interpretedContractId: string;
  venue: "POLYMARKET" | "OPINION";
  title: string;
}) => ({
  ...buildMatchingMarket({
    interpretedContractId: input.interpretedContractId,
    venue: input.venue,
    venueMarketId: input.interpretedContractId,
    title: input.title,
    rulesText: "DOTA2 ESL match on March 23 at 3:00PM ET. If Falcons win, resolve to Falcons. If Tundra win, resolve to Tundra.",
    category: "ESPORTS"
  }),
  outcomes: [{ label: "Falcons" }, { label: "Tundra" }],
  outcomeSchema: { outcomeLabels: ["Falcons", "Tundra"] }
});

describe("sports-pocket-determinism", () => {
  it("produces deterministic edge ids and labels for identical pocket inputs", async () => {
    const markets = [
      buildEsportsMarket({
        interpretedContractId: "dota-left",
        venue: "OPINION",
        title: "DOTA2 ESL: Falcons vs Tundra Mar 23 at 3:00PM ET"
      }),
      buildEsportsMarket({
        interpretedContractId: "dota-right",
        venue: "POLYMARKET",
        title: "DOTA2 ESL: Falcons vs Tundra (Mar 23 3:00PM ET)"
      })
    ];

    const first = await new SportsPocketMatchingPipeline(new InMemorySportsRepository(markets)).run();
    const second = await new SportsPocketMatchingPipeline(new InMemorySportsRepository(markets)).run();

    expect(first.pairEdges).toHaveLength(1);
    expect(second.pairEdges).toHaveLength(1);
    expect(first.pairEdges[0]?.id).toBe(second.pairEdges[0]?.id);
    expect(first.pairEdges[0]?.label).toBe(second.pairEdges[0]?.label);
    expect(first.prefilterEvaluations).toEqual(second.prefilterEvaluations);
  });
});
