import { describe, expect, it } from "vitest";

import { normalizeSportsCompetitionContext } from "../../src/matching/sports/sports-competition-context.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";

describe("sports-competition-context", () => {
  it("normalizes competition keys for sports and esports", () => {
    const nbaMatch = buildMatchingMarket({
      interpretedContractId: "sports-ctx-1",
      venue: "POLYMARKET",
      venueMarketId: "sports-ctx-1",
      title: "Lakers vs. Magic",
      rulesText: "In the upcoming NBA game, scheduled for March 21 at 7:00PM ET.",
      category: "SPORTS"
    });
    const lckLeague = buildMatchingMarket({
      interpretedContractId: "sports-ctx-2",
      venue: "LIMITLESS",
      venueMarketId: "sports-ctx-2",
      title: "Will T1 win the LCK 2026 season playoffs?",
      rulesText: "Winner of the LCK 2026 season playoffs.",
      category: "ESPORTS"
    });

    const nbaContext = normalizeSportsCompetitionContext({
      market: nbaMatch,
      domain: "SPORTS",
      family: "MATCHUP_WINNER"
    });
    const lckContext = normalizeSportsCompetitionContext({
      market: lckLeague,
      domain: "ESPORTS",
      family: "LEAGUE_WINNER"
    });

    expect(nbaContext.competitionKey).toBe("nba");
    expect(nbaContext.competitionScope).toBe("MATCH");
    expect(lckContext.competitionKey).toBe("lck");
    expect(lckContext.competitionScope).toBe("OUTRIGHT");
  });

  it("fails closed when competition context is missing", () => {
    const unknown = buildMatchingMarket({
      interpretedContractId: "sports-ctx-3",
      venue: "OPINION",
      venueMarketId: "sports-ctx-3",
      title: "Team A vs Team B",
      rulesText: "Upcoming game.",
      category: "SPORTS"
    });

    const context = normalizeSportsCompetitionContext({
      market: unknown,
      domain: "SPORTS",
      family: "MATCHUP_WINNER"
    });

    expect(context.blockers).toContain("COMPETITION_SCOPE_MISSING");
  });
});
