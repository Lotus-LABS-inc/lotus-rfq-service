import { describe, expect, it } from "vitest";

import { admitNominee2028Row } from "../../src/matching/politics/politics-nominee-2028-cluster.js";
import type { PoliticsExtractedRow } from "../../src/matching/politics/politics-types.js";

const makeRow = (title: string): PoliticsExtractedRow => ({
  interpretedContractId: "row-1",
  venue: "OPINION",
  venueMarketId: "1",
  sourceMarketSlug: null,
  canonicalEventId: "evt-1",
  title,
  rulesText: null,
  category: "POLITICS",
  marketClass: "BINARY",
  tags: [],
  outcomeCount: 2,
  outcomeLabels: ["Yes", "No"],
  publishedAt: null,
  expiresAt: null,
  resolvesAt: null,
  jurisdiction: "usa",
  office: "president",
  institution: null,
  chamber: null,
  branch: "executive",
  cycleYear: "2028",
  contestStage: "nomination",
  candidateNames: ["nikki haley"],
  candidateSetFingerprint: "nikki haley",
  partyTerms: [],
  partyStructureFingerprint: null,
  thresholdSemantics: null,
  dateBoundarySemantics: null,
  eventType: null,
  outcomeStructureType: "YES_NO",
  resolutionBasisHints: [],
  family: "NOMINEE_WINNER",
  extractionConfidence: "HIGH",
  parseFailures: [],
  inventoryTemporalBasis: "LIVE_CURRENT_STATE"
});

describe("politics nominee party extraction", () => {
  it("maps republican nominee rows to the republican subgroup", () => {
    const result = admitNominee2028Row(makeRow("Will Nikki Haley win the 2028 Republican presidential nomination?"));
    expect(result.admitted).toBe(true);
    expect(result.subgroupKey).toBe("NOMINEE|US_PRESIDENT|2028|REPUBLICAN");
  });

  it("maps democratic nominee rows to the democratic subgroup", () => {
    const result = admitNominee2028Row(makeRow("Who will be the Democratic nominee for U.S. president in 2028?"));
    expect(result.admitted).toBe(true);
    expect(result.subgroupKey).toBe("NOMINEE|US_PRESIDENT|2028|DEMOCRATIC");
  });
});
