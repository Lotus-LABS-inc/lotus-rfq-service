import { describe, expect, it } from "vitest";

import {
  buildNominee2028PairMatcherFinalDecision,
  buildNominee2028PairMatcherTopicSummary
} from "../../src/matching/politics/politics-nominee-2028-pair-matcher-eval.js";
import type {
  PoliticsNomineeSharedCoreOutcomeRow
} from "../../src/matching/politics/politics-types.js";

const pairOutcome = (
  venue: PoliticsNomineeSharedCoreOutcomeRow["venue"],
  topicKey: PoliticsNomineeSharedCoreOutcomeRow["topicKey"],
  candidateIdentityKey: string,
  venues: readonly PoliticsNomineeSharedCoreOutcomeRow["venue"][],
  routeabilityClass: PoliticsNomineeSharedCoreOutcomeRow["routeabilityClass"] = "EXACT_AUTO_ROUTEABLE"
): PoliticsNomineeSharedCoreOutcomeRow => ({
  venue,
  venueMarketId: `${venue}-${candidateIdentityKey}`,
  topicKey,
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

describe("politics nominee 2028 pair matcher eval", () => {
  it("builds an exact pair lane and prefers the stronger lane across topics", () => {
    const republican = buildNominee2028PairMatcherTopicSummary({
      topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
      topicDecision: {
        topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
        topicDecision: "TOPIC_SHARED_CORE_PAIR_ONLY",
        ruleDecision: "EXACT_RULE_COMPATIBLE",
        sharedNamedOutcomeCount: 6,
        triSharedNamedOutcomeCount: 0,
        pairSharedNamedOutcomeCount: 6,
        excludedTailCount: 5,
        othersExcluded: true,
        exactAutoRouteable: true,
        reviewRequiredRouteable: false,
        matcherEvalJustified: true
      },
      outcomeCore: {
        topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
        triSharedNamedOutcomes: [],
        pairSharedNamedOutcomes: [
          pairOutcome("OPINION", "NOMINEE|US_PRESIDENT|2028|REPUBLICAN", "jd_vance", ["LIMITLESS", "OPINION"]),
          pairOutcome("LIMITLESS", "NOMINEE|US_PRESIDENT|2028|REPUBLICAN", "jd_vance", ["LIMITLESS", "OPINION"]),
          pairOutcome("OPINION", "NOMINEE|US_PRESIDENT|2028|REPUBLICAN", "marco_rubio", ["LIMITLESS", "OPINION"]),
          pairOutcome("LIMITLESS", "NOMINEE|US_PRESIDENT|2028|REPUBLICAN", "marco_rubio", ["LIMITLESS", "OPINION"])
        ],
        singleVenueOnlyOutcomes: [],
        excludedOutcomes: []
      }
    });

    const democratic = buildNominee2028PairMatcherTopicSummary({
      topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
      topicDecision: {
        topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
        topicDecision: "TOPIC_SHARED_CORE_PAIR_ONLY",
        ruleDecision: "EXACT_RULE_COMPATIBLE",
        sharedNamedOutcomeCount: 2,
        triSharedNamedOutcomeCount: 0,
        pairSharedNamedOutcomeCount: 2,
        excludedTailCount: 5,
        othersExcluded: true,
        exactAutoRouteable: true,
        reviewRequiredRouteable: false,
        matcherEvalJustified: true
      },
      outcomeCore: {
        topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
        triSharedNamedOutcomes: [],
        pairSharedNamedOutcomes: [
          pairOutcome("POLYMARKET", "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC", "gavin_newsom", ["LIMITLESS", "POLYMARKET"]),
          pairOutcome("LIMITLESS", "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC", "gavin_newsom", ["LIMITLESS", "POLYMARKET"])
        ],
        singleVenueOnlyOutcomes: [],
        excludedOutcomes: []
      }
    });

    const finalDecision = buildNominee2028PairMatcherFinalDecision({
      republican,
      democratic
    });

    expect(republican.bestPairLane?.venuePair).toBe("LIMITLESS|OPINION");
    expect(republican.bestPairLane?.sharedNamedCandidateCount).toBe(2);
    expect(democratic.bestPairLane?.sharedNamedCandidateCount).toBe(1);
    expect(finalDecision.overallDecision).toBe("NOMINEE_2028_PAIR_MATCHER_READY");
    expect(finalDecision.recommendedStartingTopic).toBe("NOMINEE|US_PRESIDENT|2028|REPUBLICAN");
    expect(finalDecision.recommendedStartingPair).toBe("LIMITLESS|OPINION");
  });

  it("marks a lane review-required when the shared pair only survives with review variance", () => {
    const topicSummary = buildNominee2028PairMatcherTopicSummary({
      topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
      topicDecision: {
        topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
        topicDecision: "TOPIC_SHARED_CORE_ROUTEABLE_WITH_REVIEW",
        ruleDecision: "REVIEW_REQUIRED_RULE_VARIANCE",
        sharedNamedOutcomeCount: 2,
        triSharedNamedOutcomeCount: 0,
        pairSharedNamedOutcomeCount: 2,
        excludedTailCount: 2,
        othersExcluded: true,
        exactAutoRouteable: false,
        reviewRequiredRouteable: true,
        matcherEvalJustified: true
      },
      outcomeCore: {
        topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
        triSharedNamedOutcomes: [],
        pairSharedNamedOutcomes: [
          pairOutcome("OPINION", "NOMINEE|US_PRESIDENT|2028|REPUBLICAN", "jd_vance", ["LIMITLESS", "OPINION"], "REVIEW_REQUIRED_ROUTEABLE"),
          pairOutcome("LIMITLESS", "NOMINEE|US_PRESIDENT|2028|REPUBLICAN", "jd_vance", ["LIMITLESS", "OPINION"], "REVIEW_REQUIRED_ROUTEABLE")
        ],
        singleVenueOnlyOutcomes: [],
        excludedOutcomes: []
      }
    });

    expect(topicSummary.bestPairLane?.pairDecision).toBe("PAIR_ROUTEABLE_WITH_REVIEW");
    expect(topicSummary.bestPairLane?.matcherEvalJustified).toBe(true);
  });
});
