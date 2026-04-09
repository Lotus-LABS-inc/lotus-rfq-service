import { describe, expect, it } from "vitest";

import { buildDemocraticTriMatcherMaterialization } from "../../src/matching/politics/politics-nominee-2028-democratic-tri-matcher.js";
import type {
  PoliticsNomineeDemocraticPairMatcherFinalDecision,
  PoliticsNomineeTriEvalTopicSummary
} from "../../src/matching/politics/politics-types.js";

describe("politics nominee 2028 democratic tri eval", () => {
  it("keeps democratic pair-first when no strict tri-safe candidate survives", () => {
    const triSummary: PoliticsNomineeTriEvalTopicSummary = {
      topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
      sharedCoreTopicDecision: "TOPIC_SHARED_CORE_PAIR_ONLY",
      bestPairLane: {
        venuePair: "LIMITLESS|POLYMARKET",
        pairDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
        ruleDecision: "EXACT_RULE_COMPATIBLE",
        sharedNamedCandidateCount: 6,
        exactRouteableCandidateCount: 6,
        reviewRequiredCandidateCount: 0,
        matcherEvalJustified: true,
        excludedCandidates: []
      },
      triLane: {
        topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
        venueSet: "LIMITLESS|OPINION|POLYMARKET",
        triDecision: "TRI_NO_SHARED_CORE",
        ruleDecision: "EXACT_RULE_COMPATIBLE",
        safeCandidates: [],
        excludedCandidates: [
          {
            candidateIdentityKey: "gavin_newsom",
            normalizedCandidateName: "gavin newsom",
            exclusionReasons: ["PAIR_ONLY"],
            sharedAcrossWhichVenues: ["LIMITLESS", "POLYMARKET"]
          }
        ],
        matcherEvalJustified: false,
        thinness: "THIN"
      },
      triSafeCandidateCount: 0,
      pairSafeCandidateCount: 6,
      topicFinalDecision: "PAIR_ONLY_STILL_BEST",
      operatorCredible: true
    };

    const pairMatcherFinalDecision: PoliticsNomineeDemocraticPairMatcherFinalDecision = {
      overallDecision: "DEMOCRATIC_PAIR_MATCHER_READY",
      bestPair: "LIMITLESS|POLYMARKET",
      bestStartingCandidates: [
        "alexandria_ocasio_cortez",
        "andy_beshear",
        "gavin_newsom",
        "josh_shapiro",
        "kamala_harris",
        "pete_buttigieg"
      ],
      pairMatcherReady: true,
      operatorCredible: true,
      pairPreferred: true,
      triNotYetPreferred: true,
      exactSafeCandidateCount: 6,
      singleBestNextAction: "Start limited-prod readiness review on the Democratic pair lane LIMITLESS|POLYMARKET."
    };

    const materialized = buildDemocraticTriMatcherMaterialization({
      triSummary,
      pairMatcherFinalDecision
    });

    expect(materialized.finalDecision.overallDecision).toBe("DEMOCRATIC_TRI_NOT_JUSTIFIED_PAIR_ONLY");
    expect(materialized.finalDecision.triReady).toBe(false);
    expect(materialized.finalDecision.bestPairFallback?.venuePair).toBe("LIMITLESS|POLYMARKET");
    expect(materialized.finalDecision.bestPairFallback?.candidates).toEqual(pairMatcherFinalDecision.bestStartingCandidates);
    expect(materialized.finalDecision.readinessReviewJustified).toBe(false);
    expect(materialized.rejections[0]?.rejectionReason).toBe("PAIR_ONLY");
  });

  it("materializes a real democratic tri lane when strict three-venue evidence exists", () => {
    const triSummary: PoliticsNomineeTriEvalTopicSummary = {
      topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
      sharedCoreTopicDecision: "TOPIC_SHARED_CORE_TRI_READY",
      bestPairLane: {
        venuePair: "LIMITLESS|POLYMARKET",
        pairDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
        ruleDecision: "EXACT_RULE_COMPATIBLE",
        sharedNamedCandidateCount: 1,
        exactRouteableCandidateCount: 1,
        reviewRequiredCandidateCount: 0,
        matcherEvalJustified: true,
        excludedCandidates: []
      },
      triLane: {
        topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
        venueSet: "LIMITLESS|OPINION|POLYMARKET",
        triDecision: "TRI_EXACT_AUTO_ROUTEABLE",
        ruleDecision: "EXACT_RULE_COMPATIBLE",
        safeCandidates: [
          {
            candidateIdentityKey: "gavin_newsom",
            normalizedCandidateName: "gavin newsom",
            routeabilityClass: "EXACT_AUTO_ROUTEABLE",
            venueOutcomes: [
              { venue: "LIMITLESS", venueMarketId: "l1", rawOutcomeLabel: "Gavin Newsom" },
              { venue: "OPINION", venueMarketId: "o1", rawOutcomeLabel: "Gavin Newsom" },
              { venue: "POLYMARKET", venueMarketId: "p1", rawOutcomeLabel: "Gavin Newsom" }
            ]
          }
        ],
        excludedCandidates: [],
        matcherEvalJustified: true,
        thinness: "THIN"
      },
      triSafeCandidateCount: 1,
      pairSafeCandidateCount: 1,
      topicFinalDecision: "TRI_EXACT_AUTO_ROUTEABLE",
      operatorCredible: true
    };

    const pairMatcherFinalDecision: PoliticsNomineeDemocraticPairMatcherFinalDecision = {
      overallDecision: "DEMOCRATIC_PAIR_MATCHER_READY",
      bestPair: "LIMITLESS|POLYMARKET",
      bestStartingCandidates: ["gavin_newsom"],
      pairMatcherReady: true,
      operatorCredible: true,
      pairPreferred: true,
      triNotYetPreferred: true,
      exactSafeCandidateCount: 1,
      singleBestNextAction: "Start limited-prod readiness review on the Democratic pair lane LIMITLESS|POLYMARKET."
    };

    const materialized = buildDemocraticTriMatcherMaterialization({
      triSummary,
      pairMatcherFinalDecision
    });

    expect(materialized.finalDecision.overallDecision).toBe("DEMOCRATIC_TRI_MATCHER_READY");
    expect(materialized.finalDecision.triReady).toBe(true);
    expect(materialized.matcherLanes).toHaveLength(1);
    expect(materialized.matcherLanes[0]?.candidateIdentityKey).toBe("gavin_newsom");
    expect(materialized.finalDecision.bestPairFallback?.venuePair).toBe("LIMITLESS|POLYMARKET");
  });
});
