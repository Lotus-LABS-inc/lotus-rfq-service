import { describe, expect, it } from "vitest";

import { classifySportsFamily } from "../../src/matching/sports/sports-family-classifier.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";

describe("sports-family-classifier", () => {
  it("classifies sports and esports families in scope", () => {
    const sportsMatchup = buildMatchingMarket({
      interpretedContractId: "sports-1",
      venue: "OPINION",
      venueMarketId: "sports-1",
      title: "NBA: Lakers vs Magic (Mar. 21 7:00PM ET)",
      rulesText: "In the upcoming NBA game, scheduled for March 21 at 7:00PM ET.",
      category: "SPORTS"
    });
    const sportsChampionship = buildMatchingMarket({
      interpretedContractId: "sports-2",
      venue: "LIMITLESS",
      venueMarketId: "sports-2",
      title: "Will the Oklahoma City Thunder win the 2026 NBA Finals?",
      rulesText: "This market resolves according to the team that wins the 2026 NBA Finals.",
      category: "SPORTS"
    });
    const esportsLeague = buildMatchingMarket({
      interpretedContractId: "esports-1",
      venue: "LIMITLESS",
      venueMarketId: "esports-1",
      title: "Will Gen.G Esports win the LCK 2026 season playoffs?",
      rulesText: "Winner of the LCK 2026 season playoffs.",
      category: "ESPORTS"
    });

    expect(classifySportsFamily(sportsMatchup).family).toBe("MATCHUP_WINNER");
    expect(classifySportsFamily(sportsChampionship).family).toBe("CHAMPIONSHIP_WINNER");
    expect(classifySportsFamily(esportsLeague).family).toBe("LEAGUE_WINNER");
  });

  it("rejects props and other out-of-scope rows", () => {
    const prop = buildMatchingMarket({
      interpretedContractId: "prop-1",
      venue: "LIMITLESS",
      venueMarketId: "prop-1",
      title: "Will Bournemouth receive more cards than Man Utd on March 20?",
      rulesText: "Cards market for March 20.",
      category: "SPORTS"
    });

    const classification = classifySportsFamily(prop);
    expect(classification.metadata.taxonomyStatus).toBe("FAMILY_OUT_OF_SCOPE");
    expect(classification.metadata.scopeRejectionReasons).toContain("FAMILY_OUT_OF_SCOPE");
  });
});
