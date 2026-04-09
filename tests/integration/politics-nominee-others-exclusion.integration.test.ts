import { describe, expect, it } from "vitest";

import {
  buildNominee2028RuleCompatibility,
  buildNominee2028SharedOutcomeCore
} from "../../src/matching/politics/politics-nominee-2028-shared-core.js";
import type {
  PoliticsNomineeSharedCoreMarketRow,
  PoliticsNomineeSharedCoreOutcomeRow
} from "../../src/matching/politics/politics-types.js";

const market = (venue: PoliticsNomineeSharedCoreMarketRow["venue"]): PoliticsNomineeSharedCoreMarketRow => ({
  interpretedContractId: `${venue}-1`,
  venue,
  venueMarketId: `${venue}-1`,
  title: "Who will be the Republican nominee for U.S. president in 2028?",
  topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
  canonicalFamily: "NOMINEE_WINNER",
  canonicalOffice: "US_PRESIDENT",
  canonicalJurisdiction: "USA",
  canonicalCycle: "2028",
  canonicalParty: "REPUBLICAN",
  canonicalTopicLabel: "Republican Presidential Nominee 2028",
  canonicalResolutionMeaning: "PRESIDENTIAL_NOMINEE_WINNER",
  canonicalResolutionSourceType: "TITLE_AND_RULES",
  interpretationConfidence: "HIGH",
  interpretationNotes: [],
  ruleCompatibilityClass: "EXACT_RULE_COMPATIBLE",
  rejectionReason: null,
  candidateMenuType: "FIELD_MULTI_CANDIDATE",
  hasOthersBucket: venue === "LIMITLESS",
  fullMenuKnown: true,
  fullMenuComparable: venue !== "LIMITLESS",
  partialMenuComparable: false,
  reviewRequired: false,
  materiallyIncompatible: false
});

const outcome = (
  venue: PoliticsNomineeSharedCoreOutcomeRow["venue"],
  rawOutcomeLabel: string,
  candidateIdentityKey: string | null,
  isOthersBucket = false
): PoliticsNomineeSharedCoreOutcomeRow => ({
  venue,
  venueMarketId: `${venue}-1`,
  topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
  rawOutcomeLabel,
  normalizedCandidateName: candidateIdentityKey?.replace(/_/g, " ") ?? null,
  candidateIdentityKey,
  outcomeType: isOthersBucket ? "OTHERS_BUCKET" : "NAMED_CANDIDATE",
  isNamedCandidate: !isOthersBucket,
  isOthersBucket,
  sharedAcrossVenueCount: 0,
  sharedAcrossWhichVenues: [],
  routeabilityClass: "EXCLUDED_UNKNOWN"
});

describe("politics nominee others exclusion", () => {
  it("always excludes Others while preserving the named shared core", () => {
    const compatibility = buildNominee2028RuleCompatibility([
      market("POLYMARKET"),
      market("LIMITLESS")
    ]);
    const core = buildNominee2028SharedOutcomeCore({
      topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
      markets: compatibility.markets,
      outcomes: [
        outcome("POLYMARKET", "JD Vance", "jd_vance"),
        outcome("LIMITLESS", "JD Vance", "jd_vance"),
        outcome("LIMITLESS", "Others", null, true)
      ]
    });

    expect(core.pairSharedNamedOutcomes.some((entry) => entry.candidateIdentityKey === "jd_vance")).toBe(true);
    expect(core.excludedOutcomes.some((entry) => entry.routeabilityClass === "EXCLUDED_OTHER_BUCKET")).toBe(true);
  });
});
