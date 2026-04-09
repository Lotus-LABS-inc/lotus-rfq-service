import { describe, expect, it } from "vitest";

import { classifySportsFamily } from "../../src/matching/sports/sports-family-classifier.js";
import { normalizeSportsCompetitionContext } from "../../src/matching/sports/sports-competition-context.js";
import { normalizeSportsSubjectEntities } from "../../src/matching/sports/sports-subject-entity.js";
import { buildSportsStructuralFingerprint } from "../../src/matching/sports/sports-structural-fingerprint.js";
import { runSportsStructuralMatcher } from "../../src/matching/sports/sports-structural-matcher.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";

const buildFingerprint = (marketTitle: string, interpretedContractId: string, venue: "POLYMARKET" | "OPINION") => {
  const market = {
    ...buildMatchingMarket({
      interpretedContractId,
      venue,
      venueMarketId: interpretedContractId,
      title: marketTitle,
      rulesText: `In the upcoming NBA game, scheduled for March 21 at 7:00PM ET: If the Lakers win, the market will resolve to "Lakers". If the Magic win, the market will resolve to "Magic".`,
      category: "SPORTS"
    }),
    outcomes: [{ label: "Lakers" }, { label: "Magic" }],
    outcomeSchema: { outcomeLabels: ["Lakers", "Magic"] }
  };
  const classification = classifySportsFamily(market);
  const context = normalizeSportsCompetitionContext({
    market,
    domain: "SPORTS",
    family: "MATCHUP_WINNER"
  });
  const subject = normalizeSportsSubjectEntities({
    market,
    family: "MATCHUP_WINNER"
  });
  return buildSportsStructuralFingerprint({
    market,
    domain: "SPORTS",
    family: "MATCHUP_WINNER",
    competitionContext: context,
    subjectNormalization: subject
  });
};

describe("sports-structural-matcher", () => {
  it("detects exact same-family matchup winners", () => {
    const left = buildFingerprint("Lakers vs. Magic", "sports-exact-left", "POLYMARKET");
    const right = buildFingerprint("NBA: Lakers vs Magic (Mar. 21 7:00PM ET)", "sports-exact-right", "OPINION");

    const result = runSportsStructuralMatcher({
      leftFingerprint: left,
      rightFingerprint: right
    });

    expect(result.outcome).toBe("EXACT");
  });

  it("rejects structurally different outcome mappings", () => {
    const left = buildFingerprint("Lakers vs. Magic", "sports-reject-left", "POLYMARKET");
    const predictStyle = {
      ...buildMatchingMarket({
        interpretedContractId: "sports-reject-right",
        venue: "PREDICT",
        venueMarketId: "sports-reject-right",
        title: "Lakers",
        rulesText: "In the upcoming NBA game, scheduled for March 21 at 7:00PM ET If Lakers wins this market resolves to Yes.",
        category: "SPORTS"
      }),
      outcomes: [{ label: "Yes" }, { label: "No" }],
      outcomeSchema: { outcomeLabels: ["Yes", "No"] }
    };
    const predictFingerprint = buildSportsStructuralFingerprint({
      market: predictStyle,
      domain: "SPORTS",
      family: "MATCHUP_WINNER",
      competitionContext: normalizeSportsCompetitionContext({
        market: predictStyle,
        domain: "SPORTS",
        family: "MATCHUP_WINNER"
      }),
      subjectNormalization: normalizeSportsSubjectEntities({
        market: predictStyle,
        family: "MATCHUP_WINNER"
      })
    });

    const result = runSportsStructuralMatcher({
      leftFingerprint: left,
      rightFingerprint: predictFingerprint
    });

    expect(result.outcome).toBe("REJECTED");
  });
});
