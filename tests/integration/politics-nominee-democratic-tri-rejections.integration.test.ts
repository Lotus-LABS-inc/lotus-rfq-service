import { describe, expect, it } from "vitest";

import { buildDemocraticTriMatcherMaterialization } from "../../src/matching/politics/politics-nominee-2028-democratic-tri-matcher.js";
import type {
  PoliticsNomineeDemocraticPairMatcherFinalDecision,
  PoliticsNomineeTriEvalTopicSummary
} from "../../src/matching/politics/politics-types.js";

describe("politics nominee democratic tri rejections", () => {
  it("maps pair-only and unknown exclusions without Republican spillover", () => {
    const triSummary: PoliticsNomineeTriEvalTopicSummary = {
      topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
      sharedCoreTopicDecision: "TOPIC_SHARED_CORE_PAIR_ONLY",
      bestPairLane: {
        venuePair: "LIMITLESS|POLYMARKET",
        pairDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
        ruleDecision: "EXACT_RULE_COMPATIBLE",
        sharedNamedCandidateCount: 2,
        exactRouteableCandidateCount: 2,
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
            candidateIdentityKey: "kamala_harris",
            normalizedCandidateName: "kamala harris",
            exclusionReasons: ["PAIR_ONLY"],
            sharedAcrossWhichVenues: ["LIMITLESS", "POLYMARKET"]
          },
          {
            candidateIdentityKey: null,
            normalizedCandidateName: null,
            exclusionReasons: ["UNKNOWN_COMPOSITE"],
            sharedAcrossWhichVenues: ["OPINION"]
          },
          {
            candidateIdentityKey: null,
            normalizedCandidateName: null,
            exclusionReasons: ["OTHERS_EXCLUDED"],
            sharedAcrossWhichVenues: ["LIMITLESS"]
          }
        ],
        matcherEvalJustified: false,
        thinness: "THIN"
      },
      triSafeCandidateCount: 0,
      pairSafeCandidateCount: 2,
      topicFinalDecision: "PAIR_ONLY_STILL_BEST",
      operatorCredible: true
    };

    const pairMatcherFinalDecision: PoliticsNomineeDemocraticPairMatcherFinalDecision = {
      overallDecision: "DEMOCRATIC_PAIR_MATCHER_READY",
      bestPair: "LIMITLESS|POLYMARKET",
      bestStartingCandidates: ["kamala_harris", "gavin_newsom"],
      pairMatcherReady: true,
      operatorCredible: true,
      pairPreferred: true,
      triNotYetPreferred: true,
      exactSafeCandidateCount: 2,
      singleBestNextAction: "Start limited-prod readiness review on the Democratic pair lane LIMITLESS|POLYMARKET."
    };

    const materialized = buildDemocraticTriMatcherMaterialization({
      triSummary,
      pairMatcherFinalDecision
    });

    expect(materialized.matcherLanes).toHaveLength(0);
    expect(materialized.rejections.some((rejection) => rejection.rejectionReason === "PAIR_ONLY" && rejection.candidateIdentityKey === "kamala_harris")).toBe(true);
    expect(materialized.rejections.some((rejection) => rejection.rejectionReason === "CANDIDATE_IDENTITY_UNRESOLVED")).toBe(true);
    expect(materialized.rejections.some((rejection) => rejection.rejectionReason === "OTHERS_EXCLUDED")).toBe(true);
    expect(materialized.rejections.some((rejection) => rejection.notes.includes("Republican"))).toBe(false);
  });
});
