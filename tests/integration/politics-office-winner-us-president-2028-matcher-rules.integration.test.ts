import { describe, expect, it } from "vitest";

import { buildPoliticsOfficeWinnerUsPresident2028MatcherMaterialization } from "../../src/matching/politics/politics-office-winner-us-president-2028-matcher.js";
import type {
  PoliticsOfficeWinnerComparabilityTopicSummary,
  PoliticsOfficeWinnerNormalizedTopicRow
} from "../../src/matching/politics/politics-office-winner-family-pass.js";

const normalizedRows: PoliticsOfficeWinnerNormalizedTopicRow[] = [
  {
    interpretedContractId: "limitless-1",
    venue: "LIMITLESS",
    venueMarketId: "limitless-2028",
    title: "Presidential Election Winner 2028",
    canonicalFamily: "OFFICE_WINNER",
    canonicalTopicKey: "OFFICE_WINNER|USA|US_PRESIDENT|2028",
    canonicalSubject: "donald trump",
    canonicalJurisdiction: "usa",
    canonicalCycle: "2028",
    canonicalOffice: "president",
    canonicalOfficeLevel: "national",
    canonicalElectionType: null,
    canonicalTemporalBasis: "DATE_BOUND",
    electionRound: null,
    officeScope: "national",
    jurisdictionScope: "usa",
    candidateSet: ["donald trump", "kamala harris", "other"],
    candidateSetType: "FIELD",
    dateBounded: true,
    interpretationConfidence: "HIGH",
    interpretationNotes: [],
    rejectionReason: null
  },
  {
    interpretedContractId: "poly-1",
    venue: "POLYMARKET",
    venueMarketId: "presidential-election-winner-2028",
    title: "Presidential Election Winner 2028",
    canonicalFamily: "OFFICE_WINNER",
    canonicalTopicKey: "OFFICE_WINNER|USA|US_PRESIDENT|2028",
    canonicalSubject: "donald trump",
    canonicalJurisdiction: "usa",
    canonicalCycle: "2028",
    canonicalOffice: "president",
    canonicalOfficeLevel: "national",
    canonicalElectionType: null,
    canonicalTemporalBasis: "DATE_BOUND",
    electionRound: null,
    officeScope: "national",
    jurisdictionScope: "usa",
    candidateSet: ["Donald Trump", "Kamala Harris", "Other"],
    candidateSetType: "FIELD",
    dateBounded: true,
    interpretationConfidence: "HIGH",
    interpretationNotes: [],
    rejectionReason: null
  }
];

describe("office winner usa president 2028 matcher rules", () => {
  it("fails closed when office-winner rules are materially incompatible", () => {
    const materialized = buildPoliticsOfficeWinnerUsPresident2028MatcherMaterialization({
      normalizedTopics: normalizedRows,
      comparabilitySummary: [{
        canonicalTopicKey: "OFFICE_WINNER|USA|US_PRESIDENT|2028",
        venuesPresent: ["LIMITLESS", "POLYMARKET"],
        pairSharedNamedOutcomesCount: 2,
        triSharedNamedOutcomesCount: 0,
        excludedOutcomesCount: 1,
        ruleCompatibilityClassification: "RULES_MATERIALLY_INCOMPATIBLE",
        fragmentationLabel: "FAMILY_REFRESHED_RULE_FRAGMENTED",
        matcherCandidate: false,
        sharedNamedCandidates: ["donald trump", "kamala harris"],
        excludedOutcomes: [{ label: "other", reason: "OTHERS_EXCLUDED", venues: ["LIMITLESS", "POLYMARKET"] }],
        notes: []
      } satisfies PoliticsOfficeWinnerComparabilityTopicSummary]
    });

    expect(materialized.matcherLanes).toHaveLength(0);
    expect(materialized.finalDecision.overallDecision).toBe("OFFICE_WINNER_US_PRESIDENT_2028_PAIR_MATCHER_HELD_ON_RULES");
    expect(materialized.rejections.some((rejection) => rejection.reason === "RULE_MISMATCH")).toBe(true);
  });
});
