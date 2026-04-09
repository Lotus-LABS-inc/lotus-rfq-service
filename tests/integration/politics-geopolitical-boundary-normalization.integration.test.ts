import { describe, expect, it } from "vitest";

import { classifyPoliticsManualComparability, normalizePoliticsManualFamilyRow } from "../../src/matching/politics/politics-manual-family-pass.js";
import type { PoliticsExtractedRow } from "../../src/matching/politics/politics-types.js";

const makeRow = (id: string, title: string): PoliticsExtractedRow => ({
  interpretedContractId: id,
  venue: id === "a" ? "POLYMARKET" : "OPINION",
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
  jurisdiction: null,
  office: null,
  institution: null,
  chamber: null,
  branch: null,
  cycleYear: "2026",
  contestStage: null,
  candidateNames: [],
  candidateSetFingerprint: null,
  partyTerms: [],
  partyStructureFingerprint: null,
  thresholdSemantics: null,
  dateBoundarySemantics: "june 30 2026",
  eventType: "ceasefire",
  outcomeStructureType: "YES_NO",
  resolutionBasisHints: [],
  family: "GEOPOLITICAL_EVENT_BY_DATE",
  extractionConfidence: "HIGH",
  parseFailures: [],
  inventoryTemporalBasis: "LIVE_CURRENT_STATE"
});

describe("geopolitical boundary normalization", () => {
  it("treats by vs before as a boundary mismatch", () => {
    const left = normalizePoliticsManualFamilyRow({
      interpretedContractId: "a",
      venue: "POLYMARKET",
      venueMarketId: "a",
      title: makeRow("a", "Will there be a US/Iran ceasefire by June 30 2026?").title,
      family: "GEOPOLITICAL_EVENT_BY_DATE",
      extracted: makeRow("a", "Will there be a US/Iran ceasefire by June 30 2026?"),
      reason: null
    })!;
    const right = normalizePoliticsManualFamilyRow({
      interpretedContractId: "b",
      venue: "OPINION",
      venueMarketId: "b",
      title: makeRow("b", "Will there be a US/Iran ceasefire before June 30 2026?").title,
      family: "GEOPOLITICAL_EVENT_BY_DATE",
      extracted: makeRow("b", "Will there be a US/Iran ceasefire before June 30 2026?"),
      reason: null
    })!;

    expect(classifyPoliticsManualComparability("GEOPOLITICAL_EVENT_BY_DATE", left, right)).toBe("DATE_BOUNDARY_MISMATCH");
  });
});
