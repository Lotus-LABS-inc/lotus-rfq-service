import { describe, expect, it } from "vitest";

import { buildPoliticsManualFamilySummary, normalizePoliticsManualFamilyRow } from "../../src/matching/politics/politics-manual-family-pass.js";
import type { PoliticsExtractedRow } from "../../src/matching/politics/politics-types.js";

const makeRow = (id: string, venue: "OPINION" | "LIMITLESS", candidateSetFingerprint: string): PoliticsExtractedRow => ({
  interpretedContractId: id,
  venue,
  venueMarketId: id,
  sourceMarketSlug: null,
  canonicalEventId: `evt-${id}`,
  title: "Who will be the Democratic nominee for U.S. president in 2028?",
  rulesText: null,
  category: "POLITICS",
  marketClass: "BINARY",
  tags: [],
  outcomeCount: 3,
  outcomeLabels: ["Gavin Newsom", "Pete Buttigieg", "Other"],
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
  candidateNames: candidateSetFingerprint.split("|"),
  candidateSetFingerprint,
  partyTerms: ["democratic"],
  partyStructureFingerprint: "democratic",
  thresholdSemantics: null,
  dateBoundarySemantics: null,
  eventType: null,
  outcomeStructureType: "MULTI_CANDIDATE",
  resolutionBasisHints: [],
  family: "NOMINEE_WINNER",
  extractionConfidence: "HIGH",
  parseFailures: [],
  inventoryTemporalBasis: "LIVE_CURRENT_STATE"
});

describe("nominee family normalization", () => {
  it("keeps aligned nominee contests matcher-ready", () => {
    const rows = [
      normalizePoliticsManualFamilyRow({
        interpretedContractId: "a",
        venue: "OPINION",
        venueMarketId: "a",
        title: makeRow("a", "OPINION", "gavin newsom|pete buttigieg").title,
        family: "NOMINEE_WINNER",
        extracted: makeRow("a", "OPINION", "gavin newsom|pete buttigieg"),
        reason: null
      })!,
      normalizePoliticsManualFamilyRow({
        interpretedContractId: "b",
        venue: "LIMITLESS",
        venueMarketId: "b",
        title: makeRow("b", "LIMITLESS", "gavin newsom|pete buttigieg").title,
        family: "NOMINEE_WINNER",
        extracted: makeRow("b", "LIMITLESS", "gavin newsom|pete buttigieg"),
        reason: null
      })!
    ];

    const summary = buildPoliticsManualFamilySummary("NOMINEE_WINNER", rows);
    expect(summary.matcherReady).toBe(true);
    expect(summary.comparableClusters[0]?.comparability).toBe("EXACT_COMPARABLE");
  });
});
