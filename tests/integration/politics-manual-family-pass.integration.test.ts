import { describe, expect, it } from "vitest";

import { buildPoliticsManualFamilyPassArtifacts } from "../../src/matching/politics/politics-manual-family-pass.js";
import type { PoliticsExtractedRow } from "../../src/matching/politics/politics-types.js";

const baseRow = (overrides: Partial<PoliticsExtractedRow>): PoliticsExtractedRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "m1",
  sourceMarketSlug: null,
  canonicalEventId: "evt-1",
  title: overrides.title ?? "Will the Democratic nominee win in 2028?",
  rulesText: overrides.rulesText ?? null,
  category: "POLITICS",
  marketClass: "BINARY",
  tags: [],
  outcomeCount: 2,
  outcomeLabels: overrides.outcomeLabels ?? ["Yes", "No"],
  publishedAt: null,
  expiresAt: null,
  resolvesAt: null,
  jurisdiction: overrides.jurisdiction ?? "usa",
  office: overrides.office ?? "president",
  institution: null,
  chamber: null,
  branch: "executive",
  cycleYear: overrides.cycleYear ?? "2028",
  contestStage: overrides.contestStage ?? "nomination",
  candidateNames: overrides.candidateNames ?? ["gavin newsom", "pete buttigieg"],
  candidateSetFingerprint: overrides.candidateSetFingerprint ?? "gavin newsom|pete buttigieg",
  partyTerms: overrides.partyTerms ?? ["democratic"],
  partyStructureFingerprint: overrides.partyStructureFingerprint ?? "democratic",
  thresholdSemantics: null,
  dateBoundarySemantics: overrides.dateBoundarySemantics ?? null,
  eventType: overrides.eventType ?? null,
  outcomeStructureType: overrides.outcomeStructureType ?? "MULTI_CANDIDATE",
  resolutionBasisHints: [],
  family: overrides.family ?? "NOMINEE_WINNER",
  extractionConfidence: overrides.extractionConfidence ?? "HIGH",
  parseFailures: overrides.parseFailures ?? [],
  inventoryTemporalBasis: "LIVE_CURRENT_STATE"
});

describe("politics manual family pass", () => {
  it("keeps only in-scope families and makes nominee the ready family when basis aligns", () => {
    const artifacts = buildPoliticsManualFamilyPassArtifacts([
      baseRow({ interpretedContractId: "a", venue: "OPINION", venueMarketId: "o-1" }),
      baseRow({ interpretedContractId: "b", venue: "POLYMARKET", venueMarketId: "p-1" }),
      baseRow({
        interpretedContractId: "c",
        venue: "POLYMARKET",
        venueMarketId: "p-2",
        title: "Will Democrats control the Senate?",
        family: "PARTY_CONTROL",
        office: "senate_control",
        cycleYear: "2028",
        candidateNames: [],
        candidateSetFingerprint: null,
        partyTerms: ["democratic"]
      })
    ]);

    expect(artifacts.familySummaries.NOMINEE_WINNER.matcherReady).toBe(true);
    expect(artifacts.classifiedRows.find((row) => row.interpretedContractId === "c")?.family).toBe("OUT_OF_SCOPE");
  });
});
