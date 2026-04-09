import { describe, expect, it } from "vitest";

import { buildNominee2028ClusterSummary, buildNominee2028FinalDecision } from "../../src/matching/politics/politics-nominee-2028-cluster.js";
import type { PoliticsNominee2028NormalizedRow } from "../../src/matching/politics/politics-nominee-2028-cluster.js";

const exactRow = (
  venue: PoliticsNominee2028NormalizedRow["venue"],
  party: PoliticsNominee2028NormalizedRow["party"]
): PoliticsNominee2028NormalizedRow => ({
  interpretedContractId: `${venue}-${party}`,
  venue,
  venueMarketId: `${venue}-${party}`,
  title: `Who will be the ${party === "REPUBLICAN" ? "Republican" : "Democratic"} nominee for U.S. president in 2028?`,
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
  party,
  candidateSet: ["candidate_a", "candidate_b", "other"],
  candidateSetType: "FIELD_BASED_FULL_PARTY_NOMINEE",
  officeScope: "US_PRESIDENT",
  cycleExplicitness: "EXPLICIT",
  jurisdictionScope: "US_NATIONAL",
  subgroupKey: party === "REPUBLICAN" ? "NOMINEE|US_PRESIDENT|2028|REPUBLICAN" : "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC",
  resolutionBasis: null
});

describe("politics nominee 2028 cluster", () => {
  it("marks a subgroup exact-comparable when the critical fields align", () => {
    const summary = buildNominee2028ClusterSummary("NOMINEE|US_PRESIDENT|2028|DEMOCRATIC", [
      exactRow("OPINION", "DEMOCRATIC"),
      exactRow("LIMITLESS", "DEMOCRATIC")
    ]);

    expect(summary.decision).toBe("EXACT_COMPARABLE");
  });

  it("produces an overall narrow/exact-ready decision when one subgroup is comparable", () => {
    const republican = buildNominee2028ClusterSummary("NOMINEE|US_PRESIDENT|2028|REPUBLICAN", [
      exactRow("OPINION", "REPUBLICAN"),
      exactRow("LIMITLESS", "REPUBLICAN")
    ]);
    const democratic = buildNominee2028ClusterSummary("NOMINEE|US_PRESIDENT|2028|DEMOCRATIC", []);

    const finalDecision = buildNominee2028FinalDecision({ republican, democratic });
    expect(finalDecision.finalLabel).toBe("NOMINEE_2028_CLUSTER_EXACT_MATCHER_READY");
    expect(finalDecision.nomineeMatcherEvalJustified).toBe(true);
  });
});
