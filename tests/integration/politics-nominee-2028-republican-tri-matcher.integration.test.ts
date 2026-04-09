import { describe, expect, it } from "vitest";

import { buildRepublicanTriMatcherMaterialization } from "../../src/matching/politics/politics-nominee-2028-republican-tri-matcher.js";
import type { PoliticsNomineeTriEvalTopicSummary } from "../../src/matching/politics/politics-types.js";

describe("politics nominee 2028 republican tri matcher", () => {
  it("materializes exactly the approved tri-safe subset on the fixed tri venue set", () => {
    const triSummary: PoliticsNomineeTriEvalTopicSummary = {
      topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
      sharedCoreTopicDecision: "TOPIC_SHARED_CORE_TRI_READY",
      bestPairLane: {
        venuePair: "LIMITLESS|POLYMARKET",
        pairDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
        ruleDecision: "EXACT_RULE_COMPATIBLE",
        sharedNamedCandidateCount: 4,
        exactRouteableCandidateCount: 4,
        reviewRequiredCandidateCount: 0,
        matcherEvalJustified: true,
        excludedCandidates: []
      },
      triLane: {
        topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
        venueSet: "LIMITLESS|OPINION|POLYMARKET",
        triDecision: "TRI_EXACT_AUTO_ROUTEABLE",
        ruleDecision: "EXACT_RULE_COMPATIBLE",
        safeCandidates: [
          {
            candidateIdentityKey: "jd_vance",
            normalizedCandidateName: "jd vance",
            routeabilityClass: "EXACT_AUTO_ROUTEABLE",
            venueOutcomes: [
              { venue: "LIMITLESS", venueMarketId: "l-jd", rawOutcomeLabel: "J.D. Vance" },
              { venue: "OPINION", venueMarketId: "o-jd", rawOutcomeLabel: "J.D. Vance" },
              { venue: "POLYMARKET", venueMarketId: "p-jd", rawOutcomeLabel: "J.D. Vance" }
            ]
          },
          {
            candidateIdentityKey: "marco_rubio",
            normalizedCandidateName: "marco rubio",
            routeabilityClass: "EXACT_AUTO_ROUTEABLE",
            venueOutcomes: [
              { venue: "LIMITLESS", venueMarketId: "l-mr", rawOutcomeLabel: "Marco Rubio" },
              { venue: "OPINION", venueMarketId: "o-mr", rawOutcomeLabel: "Marco Rubio" },
              { venue: "POLYMARKET", venueMarketId: "p-mr", rawOutcomeLabel: "Marco Rubio" }
            ]
          },
          {
            candidateIdentityKey: "ron_desantis",
            normalizedCandidateName: "ron desantis",
            routeabilityClass: "EXACT_AUTO_ROUTEABLE",
            venueOutcomes: [
              { venue: "LIMITLESS", venueMarketId: "l-rd", rawOutcomeLabel: "Ron DeSantis" },
              { venue: "OPINION", venueMarketId: "o-rd", rawOutcomeLabel: "Ron DeSantis" },
              { venue: "POLYMARKET", venueMarketId: "p-rd", rawOutcomeLabel: "Ron DeSantis" }
            ]
          }
        ],
        excludedCandidates: [
          {
            candidateIdentityKey: "donald_trump",
            normalizedCandidateName: "donald trump",
            exclusionReasons: ["PAIR_ONLY"],
            sharedAcrossWhichVenues: ["LIMITLESS", "POLYMARKET"]
          }
        ],
        matcherEvalJustified: true,
        thinness: "THIN"
      },
      triSafeCandidateCount: 3,
      pairSafeCandidateCount: 4,
      topicFinalDecision: "TRI_READY_BUT_PAIR_FIRST",
      operatorCredible: true
    };

    const result = buildRepublicanTriMatcherMaterialization({ triSummary });

    expect(result.venueSet).toBe("LIMITLESS|OPINION|POLYMARKET");
    expect(result.matcherLanes).toHaveLength(3);
    expect(result.matcherLanes.map((lane) => lane.candidateIdentityKey)).toEqual([
      "jd_vance",
      "marco_rubio",
      "ron_desantis"
    ]);
    expect(result.matcherLanes.every((lane) => lane.routeabilityDecision === "TRI_EXACT_AUTO_ROUTEABLE")).toBe(true);
    expect(result.finalDecision.overallDecision).toBe("REPUBLICAN_TRI_MATCHER_READY_NARROW_SUBSET_ONLY");
  });
});
