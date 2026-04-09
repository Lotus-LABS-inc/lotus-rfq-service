import { describe, expect, it } from "vitest";

import { buildDemocraticPairMatcherMaterialization } from "../../src/matching/politics/politics-nominee-2028-democratic-pair-matcher.js";
import type { PoliticsNomineePairMatcherTopicSummary } from "../../src/matching/politics/politics-nominee-2028-pair-matcher-eval.js";
import type { PoliticsNomineeSharedCoreOutcomeRow } from "../../src/matching/politics/politics-types.js";

const outcome = (
  venue: PoliticsNomineeSharedCoreOutcomeRow["venue"],
  candidateIdentityKey: string | null,
  rawOutcomeLabel: string,
  venues: readonly PoliticsNomineeSharedCoreOutcomeRow["venue"][],
  options: Partial<PoliticsNomineeSharedCoreOutcomeRow> = {}
): PoliticsNomineeSharedCoreOutcomeRow => ({
  venue,
  venueMarketId: `${venue}-${candidateIdentityKey ?? rawOutcomeLabel}`,
  topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
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

describe("politics nominee democratic pair matcher rejections", () => {
  it("keeps others, venue-only tails, unknown composite outcomes, and blocked lanes out of the matcher", () => {
    const pairSummary: PoliticsNomineePairMatcherTopicSummary = {
      topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
      sharedCoreTopicDecision: "TOPIC_SHARED_CORE_PAIR_ONLY",
      routeablePairLaneCount: 1,
      matcherEvalJustified: true,
      bestPairLane: {
        topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
        venuePair: "LIMITLESS|POLYMARKET",
        pairDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
        ruleDecision: "EXACT_RULE_COMPATIBLE",
        sharedNamedCandidateCount: 1,
        exactRouteableCandidateCount: 1,
        reviewRequiredCandidateCount: 0,
        matcherEvalJustified: true,
        candidates: [{
          candidateIdentityKey: "gavin_newsom",
          normalizedCandidateName: "gavin newsom",
          routeabilityClass: "EXACT_AUTO_ROUTEABLE",
          venueOutcomes: [
            { venue: "LIMITLESS", venueMarketId: "l-newsom", rawOutcomeLabel: "Gavin Newsom" },
            { venue: "POLYMARKET", venueMarketId: "p-newsom", rawOutcomeLabel: "Gavin Newsom" }
          ]
        }],
        excludedCandidates: []
      },
      pairLanes: [
        {
          topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
          venuePair: "LIMITLESS|POLYMARKET",
          pairDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
          ruleDecision: "EXACT_RULE_COMPATIBLE",
          sharedNamedCandidateCount: 1,
          exactRouteableCandidateCount: 1,
          reviewRequiredCandidateCount: 0,
          matcherEvalJustified: true,
          candidates: [{
            candidateIdentityKey: "gavin_newsom",
            normalizedCandidateName: "gavin newsom",
            routeabilityClass: "EXACT_AUTO_ROUTEABLE",
            venueOutcomes: [
              { venue: "LIMITLESS", venueMarketId: "l-newsom", rawOutcomeLabel: "Gavin Newsom" },
              { venue: "POLYMARKET", venueMarketId: "p-newsom", rawOutcomeLabel: "Gavin Newsom" }
            ]
          }],
          excludedCandidates: []
        },
        {
          topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
          venuePair: "OPINION|POLYMARKET",
          pairDecision: "PAIR_SHARED_BUT_MATERIALLY_INCOMPATIBLE",
          ruleDecision: "RULES_MATERIALLY_INCOMPATIBLE",
          sharedNamedCandidateCount: 2,
          exactRouteableCandidateCount: 0,
          reviewRequiredCandidateCount: 0,
          matcherEvalJustified: false,
          candidates: [],
          excludedCandidates: []
        }
      ]
    };

    const outcomeCore = {
      topicKey: "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC" as const,
      triSharedNamedOutcomes: [],
      pairSharedNamedOutcomes: [],
      singleVenueOnlyOutcomes: [],
      excludedOutcomes: [
        outcome("LIMITLESS", null, "Other", ["LIMITLESS"]),
        outcome("POLYMARKET", "wes_moore", "Wes Moore", ["POLYMARKET"]),
        outcome("POLYMARKET", null, "Democratic Field", ["POLYMARKET"], {
          outcomeType: "UNKNOWN_COMPOSITE",
          isNamedCandidate: false,
          isOthersBucket: false,
          routeabilityClass: "EXCLUDED_UNKNOWN"
        })
      ]
    };

    const result = buildDemocraticPairMatcherMaterialization({
      pairSummary,
      outcomeCore,
      triSummary: null
    });

    expect(result.matcherLanes.map((lane) => lane.candidateIdentityKey)).toEqual(["gavin_newsom"]);
    expect(result.rejections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ candidateIdentityKey: null, reason: "OTHERS_EXCLUDED" }),
        expect.objectContaining({ candidateIdentityKey: "wes_moore", reason: "NOT_SHARED" }),
        expect.objectContaining({ candidateIdentityKey: null, reason: "CANDIDATE_IDENTITY_UNRESOLVED" }),
        expect.objectContaining({ venuePair: "OPINION|POLYMARKET", reason: "RULE_MISMATCH" })
      ])
    );
  });
});
