import { describe, expect, it } from "vitest";

import { buildRepublicanPairMatcherMaterialization } from "../../src/matching/politics/politics-nominee-2028-republican-pair-matcher.js";
import { buildNominee2028TriEvalTopicSummary } from "../../src/matching/politics/politics-nominee-2028-tri-eval.js";
import { buildNominee2028PairMatcherTopicSummary } from "../../src/matching/politics/politics-nominee-2028-pair-matcher-eval.js";
import type { PoliticsNomineeSharedCoreOutcomeRow } from "../../src/matching/politics/politics-types.js";

const outcome = (
  venue: PoliticsNomineeSharedCoreOutcomeRow["venue"],
  candidateIdentityKey: string,
  venues: readonly PoliticsNomineeSharedCoreOutcomeRow["venue"][],
  routeabilityClass: PoliticsNomineeSharedCoreOutcomeRow["routeabilityClass"] = "EXACT_AUTO_ROUTEABLE"
): PoliticsNomineeSharedCoreOutcomeRow => ({
  venue,
  venueMarketId: `${venue}-${candidateIdentityKey}`,
  topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
  rawOutcomeLabel: candidateIdentityKey.replace(/_/g, " "),
  normalizedCandidateName: candidateIdentityKey.replace(/_/g, " "),
  candidateIdentityKey,
  outcomeType: "NAMED_CANDIDATE",
  isNamedCandidate: true,
  isOthersBucket: false,
  sharedAcrossVenueCount: venues.length,
  sharedAcrossWhichVenues: [...venues],
  routeabilityClass
});

describe("politics nominee 2028 republican pair matcher", () => {
  it("materializes exact-safe matcher lanes and chooses LIMITLESS|POLYMARKET as best pair", () => {
    const outcomeCore = {
      topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN" as const,
      triSharedNamedOutcomes: [],
      pairSharedNamedOutcomes: [
        outcome("LIMITLESS", "donald_trump", ["LIMITLESS", "POLYMARKET"]),
        outcome("POLYMARKET", "donald_trump", ["LIMITLESS", "POLYMARKET"]),
        outcome("LIMITLESS", "donald_trump_jr", ["LIMITLESS", "POLYMARKET"]),
        outcome("POLYMARKET", "donald_trump_jr", ["LIMITLESS", "POLYMARKET"]),
        outcome("LIMITLESS", "ted_cruz", ["LIMITLESS", "POLYMARKET"]),
        outcome("POLYMARKET", "ted_cruz", ["LIMITLESS", "POLYMARKET"]),
        outcome("LIMITLESS", "tucker_carlson", ["LIMITLESS", "POLYMARKET"]),
        outcome("POLYMARKET", "tucker_carlson", ["LIMITLESS", "POLYMARKET"]),
        outcome("OPINION", "glenn_youngkin", ["OPINION", "POLYMARKET"]),
        outcome("POLYMARKET", "glenn_youngkin", ["OPINION", "POLYMARKET"])
      ],
      singleVenueOnlyOutcomes: [],
      excludedOutcomes: []
    };

    const pairSummary = buildNominee2028PairMatcherTopicSummary({
      topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
      topicDecision: {
        topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
        topicDecision: "TOPIC_SHARED_CORE_TRI_READY",
        ruleDecision: "EXACT_RULE_COMPATIBLE",
        sharedNamedOutcomeCount: 8,
        triSharedNamedOutcomeCount: 0,
        pairSharedNamedOutcomeCount: 8,
        excludedTailCount: 0,
        othersExcluded: true,
        exactAutoRouteable: true,
        reviewRequiredRouteable: false,
        matcherEvalJustified: true
      },
      outcomeCore
    });

    const triSummary = buildNominee2028TriEvalTopicSummary({
      topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
      topicDecision: {
        topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
        topicDecision: "TOPIC_SHARED_CORE_TRI_READY",
        ruleDecision: "EXACT_RULE_COMPATIBLE",
        sharedNamedOutcomeCount: 8,
        triSharedNamedOutcomeCount: 0,
        pairSharedNamedOutcomeCount: 8,
        excludedTailCount: 0,
        othersExcluded: true,
        exactAutoRouteable: true,
        reviewRequiredRouteable: false,
        matcherEvalJustified: true
      },
      outcomeCore,
      pairSummary
    });

    const result = buildRepublicanPairMatcherMaterialization({
      pairSummary,
      outcomeCore,
      triSummary
    });

    expect(result.finalDecision.bestPair).toBe("LIMITLESS|POLYMARKET");
    expect(result.finalDecision.bestStartingCandidates).toEqual([
      "donald_trump",
      "donald_trump_jr",
      "ted_cruz",
      "tucker_carlson"
    ]);
    expect(result.matcherLanes).toHaveLength(5);
    expect(result.finalDecision.overallDecision).toBe("REPUBLICAN_PAIR_MATCHER_READY");
  });
});
