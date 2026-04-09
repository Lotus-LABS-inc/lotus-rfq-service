import { describe, expect, it } from "vitest";

import { buildRepublicanPairMatcherMaterialization } from "../../src/matching/politics/politics-nominee-2028-republican-pair-matcher.js";
import type {
  PoliticsNomineePairMatcherTopicSummary
} from "../../src/matching/politics/politics-nominee-2028-pair-matcher-eval.js";
import type {
  PoliticsNomineeSharedCoreOutcomeRow,
  PoliticsNomineeTriEvalTopicSummary
} from "../../src/matching/politics/politics-types.js";

const outcome = (
  venue: PoliticsNomineeSharedCoreOutcomeRow["venue"],
  candidateIdentityKey: string | null,
  rawOutcomeLabel: string,
  venues: readonly PoliticsNomineeSharedCoreOutcomeRow["venue"][],
  options: Partial<PoliticsNomineeSharedCoreOutcomeRow> = {}
): PoliticsNomineeSharedCoreOutcomeRow => ({
  venue,
  venueMarketId: `${venue}-${candidateIdentityKey ?? rawOutcomeLabel}`,
  topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
  rawOutcomeLabel,
  normalizedCandidateName: candidateIdentityKey ? candidateIdentityKey.replace(/_/g, " ") : null,
  candidateIdentityKey,
  outcomeType: candidateIdentityKey ? "NAMED_CANDIDATE" : "OTHERS_BUCKET",
  isNamedCandidate: Boolean(candidateIdentityKey),
  isOthersBucket: !candidateIdentityKey,
  sharedAcrossVenueCount: venues.length,
  sharedAcrossWhichVenues: [...venues],
  routeabilityClass: candidateIdentityKey ? "EXCLUDED_NOT_SHARED" : "EXCLUDED_OTHER_BUCKET",
  ...options
});

describe("politics nominee republican pair matcher rejections", () => {
  it("keeps others, non-shared, and tri-only names out of materialized pair lanes", () => {
    const pairSummary: PoliticsNomineePairMatcherTopicSummary = {
      topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
      sharedCoreTopicDecision: "TOPIC_SHARED_CORE_TRI_READY",
      routeablePairLaneCount: 1,
      matcherEvalJustified: true,
      bestPairLane: {
        topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
        venuePair: "LIMITLESS|POLYMARKET",
        pairDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
        ruleDecision: "EXACT_RULE_COMPATIBLE",
        sharedNamedCandidateCount: 1,
        exactRouteableCandidateCount: 1,
        reviewRequiredCandidateCount: 0,
        matcherEvalJustified: true,
        candidates: [{
          candidateIdentityKey: "donald_trump",
          normalizedCandidateName: "donald trump",
          routeabilityClass: "EXACT_AUTO_ROUTEABLE",
          venueOutcomes: [
            { venue: "LIMITLESS", venueMarketId: "l-trump", rawOutcomeLabel: "Donald Trump" },
            { venue: "POLYMARKET", venueMarketId: "p-trump", rawOutcomeLabel: "Donald Trump" }
          ]
        }],
        excludedCandidates: []
      },
      pairLanes: [{
        topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
        venuePair: "LIMITLESS|POLYMARKET",
        pairDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
        ruleDecision: "EXACT_RULE_COMPATIBLE",
        sharedNamedCandidateCount: 1,
        exactRouteableCandidateCount: 1,
        reviewRequiredCandidateCount: 0,
        matcherEvalJustified: true,
        candidates: [{
          candidateIdentityKey: "donald_trump",
          normalizedCandidateName: "donald trump",
          routeabilityClass: "EXACT_AUTO_ROUTEABLE",
          venueOutcomes: [
            { venue: "LIMITLESS", venueMarketId: "l-trump", rawOutcomeLabel: "Donald Trump" },
            { venue: "POLYMARKET", venueMarketId: "p-trump", rawOutcomeLabel: "Donald Trump" }
          ]
        }],
        excludedCandidates: []
      }]
    };

    const triSummary: PoliticsNomineeTriEvalTopicSummary = {
      topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
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
        topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
        venueSet: "LIMITLESS|OPINION|POLYMARKET",
        triDecision: "TRI_EXACT_AUTO_ROUTEABLE",
        ruleDecision: "EXACT_RULE_COMPATIBLE",
        safeCandidates: [{
          candidateIdentityKey: "jd_vance",
          normalizedCandidateName: "jd vance",
          routeabilityClass: "EXACT_AUTO_ROUTEABLE",
          venueOutcomes: [
            { venue: "LIMITLESS", venueMarketId: "l-vance", rawOutcomeLabel: "J.D. Vance" },
            { venue: "OPINION", venueMarketId: "o-vance", rawOutcomeLabel: "J.D. Vance" },
            { venue: "POLYMARKET", venueMarketId: "p-vance", rawOutcomeLabel: "J.D. Vance" }
          ]
        }],
        excludedCandidates: [],
        matcherEvalJustified: true,
        thinness: "THIN"
      },
      triSafeCandidateCount: 1,
      pairSafeCandidateCount: 1,
      topicFinalDecision: "TRI_READY_BUT_PAIR_FIRST",
      operatorCredible: true
    };

    const outcomeCore = {
      topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN" as const,
      triSharedNamedOutcomes: [],
      pairSharedNamedOutcomes: [],
      singleVenueOnlyOutcomes: [],
      excludedOutcomes: [
        outcome("LIMITLESS", null, "Other", ["LIMITLESS"]),
        outcome("POLYMARKET", "nikki_haley", "Nikki Haley", ["POLYMARKET"]),
        outcome("POLYMARKET", "composite_field", "Republican Field", ["POLYMARKET"], {
          normalizedCandidateName: null,
          outcomeType: "UNKNOWN_COMPOSITE",
          isNamedCandidate: false,
          isOthersBucket: false,
          routeabilityClass: "EXCLUDED_UNKNOWN"
        })
      ]
    };

    const result = buildRepublicanPairMatcherMaterialization({
      pairSummary,
      outcomeCore,
      triSummary
    });

    expect(result.matcherLanes.map((lane) => lane.candidateIdentityKey)).toEqual(["donald_trump"]);
    expect(result.rejections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ candidateIdentityKey: null, reason: "OTHERS_EXCLUDED" }),
        expect.objectContaining({ candidateIdentityKey: "nikki_haley", reason: "NOT_SHARED" }),
        expect.objectContaining({ candidateIdentityKey: "jd_vance", reason: "PAIR_EDGE_MISSING" }),
        expect.objectContaining({ candidateIdentityKey: "composite_field", reason: "UNKNOWN_COMPOSITE" })
      ])
    );
  });
});
