import { describe, expect, it } from "vitest";

import { classifyPoliticsManualComparability, normalizePoliticsManualFamilyRow } from "../../src/matching/politics/politics-manual-family-pass.js";
import type { PoliticsExtractedRow } from "../../src/matching/politics/politics-types.js";

const row = (id: string, title: string): PoliticsExtractedRow => ({
  interpretedContractId: id,
  venue: id === "a" ? "OPINION" : "LIMITLESS",
  venueMarketId: id,
  sourceMarketSlug: null,
  canonicalEventId: `evt-${id}`,
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
  cycleYear: "2027",
  contestStage: null,
  candidateNames: ["donald trump"],
  candidateSetFingerprint: "donald trump",
  partyTerms: [],
  partyStructureFingerprint: null,
  thresholdSemantics: null,
  dateBoundarySemantics: "2027",
  eventType: "office_exit",
  outcomeStructureType: "YES_NO",
  resolutionBasisHints: [],
  family: "OFFICE_EXIT_BY_DATE",
  extractionConfidence: "HIGH",
  parseFailures: [],
  inventoryTemporalBasis: "LIVE_CURRENT_STATE"
});

describe("office exit by date normalization", () => {
  it("keeps removed vs out-of-office distinct when condition scope differs", () => {
    const left = normalizePoliticsManualFamilyRow({
      interpretedContractId: "a",
      venue: "OPINION",
      venueMarketId: "a",
      title: row("a", "Will Trump be removed as president by 2027?").title,
      family: "OFFICE_EXIT_BY_DATE",
      extracted: row("a", "Will Trump be removed as president by 2027?"),
      reason: null
    })!;
    const right = normalizePoliticsManualFamilyRow({
      interpretedContractId: "b",
      venue: "LIMITLESS",
      venueMarketId: "b",
      title: row("b", "Will Trump be out as president by 2027?").title,
      family: "OFFICE_EXIT_BY_DATE",
      extracted: row("b", "Will Trump be out as president by 2027?"),
      reason: null
    })!;

    expect(classifyPoliticsManualComparability("OFFICE_EXIT_BY_DATE", left, right)).toBe("CONDITION_SCOPE_MISMATCH");
  });
});
