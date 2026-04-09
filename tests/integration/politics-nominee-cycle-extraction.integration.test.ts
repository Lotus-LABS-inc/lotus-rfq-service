import { describe, expect, it } from "vitest";

import { admitNominee2028Row } from "../../src/matching/politics/politics-nominee-2028-cluster.js";
import type { PoliticsExtractedRow } from "../../src/matching/politics/politics-types.js";

const baseRow: PoliticsExtractedRow = {
  interpretedContractId: "row-1",
  venue: "LIMITLESS",
  venueMarketId: "1",
  sourceMarketSlug: null,
  canonicalEventId: "evt-1",
  title: "Who will be the Republican nominee for U.S. president?",
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
  candidateNames: [],
  candidateSetFingerprint: null,
  partyTerms: ["republican"],
  partyStructureFingerprint: "republican",
  thresholdSemantics: null,
  dateBoundarySemantics: null,
  eventType: null,
  outcomeStructureType: "YES_NO",
  resolutionBasisHints: [],
  family: "NOMINEE_WINNER",
  extractionConfidence: "HIGH",
  parseFailures: [],
  inventoryTemporalBasis: "LIVE_CURRENT_STATE"
};

describe("politics nominee cycle extraction", () => {
  it("admits rows with derived 2028 cycle from extracted cycleYear", () => {
    const result = admitNominee2028Row(baseRow);
    expect(result.admitted).toBe(true);
  });

  it("rejects non-2028 nominee rows", () => {
    const result = admitNominee2028Row({
      ...baseRow,
      title: "Who will be the Republican nominee for U.S. president in 2026?",
      cycleYear: "2026"
    });
    expect(result.admitted).toBe(false);
    expect(result.reason).toBe("OUT_OF_SCOPE_FOR_2028_PRESIDENTIAL_NOMINEE_CLUSTER");
  });
});
