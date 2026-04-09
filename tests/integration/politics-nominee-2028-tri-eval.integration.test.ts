import { describe, expect, it } from "vitest";

import {
  buildNominee2028TriEvalFinalDecision,
  buildNominee2028TriEvalTopicSummary
} from "../../src/matching/politics/politics-nominee-2028-tri-eval.js";
import type { PoliticsNomineeSharedCoreOutcomeRow } from "../../src/matching/politics/politics-types.js";

const outcome = (
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

describe("politics nominee 2028 tri eval", () => {
  it("marks a republican-like tri lane as tri-ready-but-pair-first when tri is thinner than best pair", () => {
    const topicKey = "NOMINEE|US_PRESIDENT|2028|REPUBLICAN";
    const summary = buildNominee2028TriEvalTopicSummary({
      topicKey,
      topicDecision: {
        topicKey,
        topicDecision: "TOPIC_SHARED_CORE_TRI_READY",
        ruleDecision: "EXACT_RULE_COMPATIBLE",
        sharedNamedOutcomeCount: 8,
        triSharedNamedOutcomeCount: 3,
        pairSharedNamedOutcomeCount: 5,
        excludedTailCount: 2,
        othersExcluded: true,
        exactAutoRouteable: true,
        reviewRequiredRouteable: false,
        matcherEvalJustified: true
      },
      pairSummary: {
        topicKey,
        sharedCoreTopicDecision: "TOPIC_SHARED_CORE_TRI_READY",
        routeablePairLaneCount: 1,
        matcherEvalJustified: true,
        bestPairLane: {
          topicKey,
          venuePair: "LIMITLESS|POLYMARKET",
          pairDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
          ruleDecision: "EXACT_RULE_COMPATIBLE",
          sharedNamedCandidateCount: 4,
          exactRouteableCandidateCount: 4,
          reviewRequiredCandidateCount: 0,
          matcherEvalJustified: true,
          candidates: [],
          excludedCandidates: []
        },
        pairLanes: []
      },
      outcomeCore: {
        topicKey,
        triSharedNamedOutcomes: [
          outcome("POLYMARKET", topicKey, "jd_vance", ["LIMITLESS", "OPINION", "POLYMARKET"]),
          outcome("OPINION", topicKey, "jd_vance", ["LIMITLESS", "OPINION", "POLYMARKET"]),
          outcome("LIMITLESS", topicKey, "jd_vance", ["LIMITLESS", "OPINION", "POLYMARKET"])
        ],
        pairSharedNamedOutcomes: [],
        singleVenueOnlyOutcomes: [],
        excludedOutcomes: []
      }
    });

    expect(summary.triLane.triDecision).toBe("TRI_EXACT_AUTO_ROUTEABLE");
    expect(summary.topicFinalDecision).toBe("TRI_READY_BUT_PAIR_FIRST");
  });

  it("marks a democratic-like topic pair-only when no tri-safe candidate survives", () => {
    const topicKey = "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC";
    const summary = buildNominee2028TriEvalTopicSummary({
      topicKey,
      topicDecision: {
        topicKey,
        topicDecision: "TOPIC_SHARED_CORE_PAIR_ONLY",
        ruleDecision: "EXACT_RULE_COMPATIBLE",
        sharedNamedOutcomeCount: 6,
        triSharedNamedOutcomeCount: 0,
        pairSharedNamedOutcomeCount: 6,
        excludedTailCount: 1,
        othersExcluded: true,
        exactAutoRouteable: true,
        reviewRequiredRouteable: false,
        matcherEvalJustified: true
      },
      pairSummary: {
        topicKey,
        sharedCoreTopicDecision: "TOPIC_SHARED_CORE_PAIR_ONLY",
        routeablePairLaneCount: 1,
        matcherEvalJustified: true,
        bestPairLane: {
          topicKey,
          venuePair: "LIMITLESS|POLYMARKET",
          pairDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
          ruleDecision: "EXACT_RULE_COMPATIBLE",
          sharedNamedCandidateCount: 6,
          exactRouteableCandidateCount: 6,
          reviewRequiredCandidateCount: 0,
          matcherEvalJustified: true,
          candidates: [],
          excludedCandidates: []
        },
        pairLanes: []
      },
      outcomeCore: {
        topicKey,
        triSharedNamedOutcomes: [],
        pairSharedNamedOutcomes: [
          outcome("POLYMARKET", topicKey, "gavin_newsom", ["LIMITLESS", "POLYMARKET"]),
          outcome("LIMITLESS", topicKey, "gavin_newsom", ["LIMITLESS", "POLYMARKET"])
        ],
        singleVenueOnlyOutcomes: [],
        excludedOutcomes: []
      }
    });

    expect(summary.triLane.triDecision).toBe("TRI_NO_SHARED_CORE");
    expect(summary.topicFinalDecision).toBe("PAIR_ONLY_STILL_BEST");
  });

  it("prefers an exact tri lane over an exact pair lane in the final ranking", () => {
    const republican = {
      topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
      sharedCoreTopicDecision: "TOPIC_SHARED_CORE_TRI_READY",
      bestPairLane: {
        topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
        venuePair: "LIMITLESS|POLYMARKET",
        pairDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
        ruleDecision: "EXACT_RULE_COMPATIBLE",
        sharedNamedCandidateCount: 4,
        exactRouteableCandidateCount: 4,
        reviewRequiredCandidateCount: 0,
        matcherEvalJustified: true,
        candidates: [],
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
            venueOutcomes: []
          }
        ],
        excludedCandidates: [],
        matcherEvalJustified: true,
        thinness: "THIN"
      },
      triSafeCandidateCount: 1,
      pairSafeCandidateCount: 4,
      topicFinalDecision: "TRI_READY_BUT_PAIR_FIRST",
      operatorCredible: true
    } as const;
    const democratic = {
      topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
      sharedCoreTopicDecision: "TOPIC_SHARED_CORE_PAIR_ONLY",
      bestPairLane: {
        topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
        venuePair: "LIMITLESS|POLYMARKET",
        pairDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
        ruleDecision: "EXACT_RULE_COMPATIBLE",
        sharedNamedCandidateCount: 6,
        exactRouteableCandidateCount: 6,
        reviewRequiredCandidateCount: 0,
        matcherEvalJustified: true,
        candidates: [],
        excludedCandidates: []
      },
      triLane: {
        topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
        venueSet: "LIMITLESS|OPINION|POLYMARKET",
        triDecision: "TRI_NO_SHARED_CORE",
        ruleDecision: "EXACT_RULE_COMPATIBLE",
        safeCandidates: [],
        excludedCandidates: [],
        matcherEvalJustified: false,
        thinness: "THIN"
      },
      triSafeCandidateCount: 0,
      pairSafeCandidateCount: 6,
      topicFinalDecision: "PAIR_ONLY_STILL_BEST",
      operatorCredible: true
    } as const;

    const finalDecision = buildNominee2028TriEvalFinalDecision({
      republican,
      democratic
    });

    expect(finalDecision.recommendedStartingLane?.laneType).toBe("TRI");
    expect(finalDecision.recommendedStartingLane?.topicKey).toBe("NOMINEE|US_PRESIDENT|2028|REPUBLICAN");
  });
});
