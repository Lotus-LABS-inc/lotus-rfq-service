import { describe, expect, it } from "vitest";

import { buildDemocraticPairMatcherMaterialization } from "../../src/matching/politics/politics-nominee-2028-democratic-pair-matcher.js";
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
  topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
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

describe("politics nominee 2028 democratic pair matcher", () => {
  it("materializes exact-safe Democratic matcher lanes and chooses LIMITLESS|POLYMARKET as best pair", () => {
    const outcomeCore = {
      topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC" as const,
      triSharedNamedOutcomes: [],
      pairSharedNamedOutcomes: [
        outcome("LIMITLESS", "alexandria_ocasio_cortez", ["LIMITLESS", "POLYMARKET"]),
        outcome("POLYMARKET", "alexandria_ocasio_cortez", ["LIMITLESS", "POLYMARKET"]),
        outcome("LIMITLESS", "andy_beshear", ["LIMITLESS", "POLYMARKET"]),
        outcome("POLYMARKET", "andy_beshear", ["LIMITLESS", "POLYMARKET"]),
        outcome("LIMITLESS", "gavin_newsom", ["LIMITLESS", "POLYMARKET"]),
        outcome("POLYMARKET", "gavin_newsom", ["LIMITLESS", "POLYMARKET"]),
        outcome("LIMITLESS", "josh_shapiro", ["LIMITLESS", "POLYMARKET"]),
        outcome("POLYMARKET", "josh_shapiro", ["LIMITLESS", "POLYMARKET"]),
        outcome("LIMITLESS", "kamala_harris", ["LIMITLESS", "POLYMARKET"]),
        outcome("POLYMARKET", "kamala_harris", ["LIMITLESS", "POLYMARKET"]),
        outcome("LIMITLESS", "pete_buttigieg", ["LIMITLESS", "POLYMARKET"]),
        outcome("POLYMARKET", "pete_buttigieg", ["LIMITLESS", "POLYMARKET"])
      ],
      singleVenueOnlyOutcomes: [],
      excludedOutcomes: []
    };

    const pairSummary = buildNominee2028PairMatcherTopicSummary({
      topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
      topicDecision: {
        topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
        topicDecision: "TOPIC_SHARED_CORE_PAIR_ONLY",
        ruleDecision: "EXACT_RULE_COMPATIBLE",
        sharedNamedOutcomeCount: 6,
        triSharedNamedOutcomeCount: 0,
        pairSharedNamedOutcomeCount: 6,
        excludedTailCount: 0,
        othersExcluded: true,
        exactAutoRouteable: true,
        reviewRequiredRouteable: false,
        matcherEvalJustified: true
      },
      outcomeCore
    });

    const result = buildDemocraticPairMatcherMaterialization({
      pairSummary,
      outcomeCore,
      triSummary: null
    });

    expect(result.finalDecision.bestPair).toBe("LIMITLESS|POLYMARKET");
    expect(result.finalDecision.bestStartingCandidates).toEqual([
      "alexandria_ocasio_cortez",
      "andy_beshear",
      "gavin_newsom",
      "josh_shapiro",
      "kamala_harris",
      "pete_buttigieg"
    ]);
    expect(result.matcherLanes).toHaveLength(6);
    expect(result.finalDecision.overallDecision).toBe("DEMOCRATIC_PAIR_MATCHER_READY");
    expect(result.finalDecision.exactSafeCandidateCount).toBe(6);
  });
});
