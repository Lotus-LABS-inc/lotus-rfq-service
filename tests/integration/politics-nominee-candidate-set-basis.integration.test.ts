import { describe, expect, it } from "vitest";

import { buildNominee2028ClusterSummary } from "../../src/matching/politics/politics-nominee-2028-cluster.js";
import type { PoliticsNominee2028NormalizedRow } from "../../src/matching/politics/politics-nominee-2028-cluster.js";

const fieldRow = (venue: PoliticsNominee2028NormalizedRow["venue"]): PoliticsNominee2028NormalizedRow => ({
  interpretedContractId: `${venue}-field`,
  venue,
  venueMarketId: `${venue}-field`,
  title: "Who will be the Republican nominee for U.S. president in 2028?",
  canonicalFamily: "NOMINEE_WINNER",
  canonicalSubject: null,
  canonicalJurisdiction: "usa",
  canonicalCycle: "2028",
  canonicalOffice: "president",
  canonicalOfficeLevel: "national",
  canonicalElectionType: "nomination",
  canonicalOutcomeBasis: "winner_of_nomination",
  canonicalTemporalBasis: "LIVE_CURRENT_STATE",
  interpretationConfidence: "HIGH",
  interpretationNotes: [],
  rejectionReason: null,
  party: "REPUBLICAN",
  candidateSet: ["nikki haley", "ron desantis", "other"],
  candidateSetType: "FIELD_BASED_FULL_PARTY_NOMINEE",
  officeScope: "US_PRESIDENT",
  cycleExplicitness: "EXPLICIT",
  jurisdictionScope: "US_NATIONAL",
  subgroupKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
  resolutionBasis: null
});

const singleCandidateRow = (venue: PoliticsNominee2028NormalizedRow["venue"]): PoliticsNominee2028NormalizedRow => ({
  ...fieldRow(venue),
  interpretedContractId: `${venue}-single`,
  venueMarketId: `${venue}-single`,
  title: "Will Nikki Haley win the 2028 Republican presidential nomination?",
  canonicalSubject: "nikki haley",
  candidateSet: ["nikki haley"],
  candidateSetType: "SINGLE_CANDIDATE_WITHIN_NOMINEE_RACE"
});

describe("politics nominee candidate-set basis", () => {
  it("treats field-based vs single-candidate nominee rows as a candidate-set mismatch", () => {
    const summary = buildNominee2028ClusterSummary("NOMINEE|US_PRESIDENT|2028|REPUBLICAN", [
      fieldRow("OPINION"),
      singleCandidateRow("POLYMARKET")
    ]);

    expect(summary.decision).toBe("CANDIDATE_SET_MISMATCH");
  });
});
