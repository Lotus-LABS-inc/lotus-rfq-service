import { describe, expect, it } from "vitest";

import { buildNominee2028TriLane } from "../../src/matching/politics/politics-nominee-2028-tri-eval.js";

describe("politics nominee tri rejection", () => {
  it("keeps unknown and pair-only candidates out of the tri-safe lane with explicit reasons", () => {
    const topicKey = "NOMINEE|US_PRESIDENT|2028|REPUBLICAN";
    const lane = buildNominee2028TriLane({
      topicKey,
      outcomeCore: {
        topicKey,
        triSharedNamedOutcomes: [],
        pairSharedNamedOutcomes: [
          {
            venue: "LIMITLESS",
            venueMarketId: "m3",
            topicKey,
            rawOutcomeLabel: "Ted Cruz",
            normalizedCandidateName: "ted cruz",
            candidateIdentityKey: "ted_cruz",
            outcomeType: "NAMED_CANDIDATE",
            isNamedCandidate: true,
            isOthersBucket: false,
            sharedAcrossVenueCount: 2,
            sharedAcrossWhichVenues: ["LIMITLESS", "POLYMARKET"],
            routeabilityClass: "EXACT_AUTO_ROUTEABLE"
          }
        ],
        singleVenueOnlyOutcomes: [],
        excludedOutcomes: [
          {
            venue: "LIMITLESS",
            venueMarketId: "m2",
            topicKey,
            rawOutcomeLabel: "Yes",
            normalizedCandidateName: null,
            candidateIdentityKey: null,
            outcomeType: "UNKNOWN_COMPOSITE",
            isNamedCandidate: false,
            isOthersBucket: false,
            sharedAcrossVenueCount: 3,
            sharedAcrossWhichVenues: ["LIMITLESS", "OPINION", "POLYMARKET"],
            routeabilityClass: "EXCLUDED_UNKNOWN"
          }
        ]
      }
    });

    const reasons = lane.excludedCandidates.flatMap((candidate) => candidate.exclusionReasons);
    expect(reasons).toContain("UNKNOWN_COMPOSITE");
    expect(reasons).toContain("PAIR_ONLY");
  });
});
