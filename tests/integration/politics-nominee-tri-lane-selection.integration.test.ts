import { describe, expect, it } from "vitest";

import { buildNominee2028TriLane } from "../../src/matching/politics/politics-nominee-2028-tri-eval.js";
import type { PoliticsNomineeSharedCoreOutcomeRow } from "../../src/matching/politics/politics-types.js";

const triOutcome = (
  venue: PoliticsNomineeSharedCoreOutcomeRow["venue"],
  candidateIdentityKey: string,
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
  sharedAcrossVenueCount: 3,
  sharedAcrossWhichVenues: ["LIMITLESS", "OPINION", "POLYMARKET"],
  routeabilityClass
});

describe("politics nominee tri lane selection", () => {
  it("marks a tri lane strong when four or more safe candidates survive", () => {
    const lane = buildNominee2028TriLane({
      topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
      outcomeCore: {
        topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
        triSharedNamedOutcomes: [
          triOutcome("POLYMARKET", "jd_vance"),
          triOutcome("OPINION", "jd_vance"),
          triOutcome("LIMITLESS", "jd_vance"),
          triOutcome("POLYMARKET", "marco_rubio"),
          triOutcome("OPINION", "marco_rubio"),
          triOutcome("LIMITLESS", "marco_rubio"),
          triOutcome("POLYMARKET", "ron_desantis"),
          triOutcome("OPINION", "ron_desantis"),
          triOutcome("LIMITLESS", "ron_desantis"),
          triOutcome("POLYMARKET", "glenn_youngkin"),
          triOutcome("OPINION", "glenn_youngkin"),
          triOutcome("LIMITLESS", "glenn_youngkin")
        ],
        pairSharedNamedOutcomes: [],
        singleVenueOnlyOutcomes: [],
        excludedOutcomes: []
      }
    });

    expect(lane.thinness).toBe("STRONG");
    expect(lane.triDecision).toBe("TRI_EXACT_AUTO_ROUTEABLE");
  });
});
