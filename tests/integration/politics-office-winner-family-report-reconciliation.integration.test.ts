import { describe, expect, it } from "vitest";

import type { PoliticsExtractedRow } from "../../src/matching/politics/politics-types.js";
import { filterSupplementalMyriadOfficeWinnerRows } from "../../src/reports/politics-office-winner-family-pass.js";

const baseRow = (overrides: Partial<PoliticsExtractedRow>): PoliticsExtractedRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "market-1",
  venue: overrides.venue ?? "LIMITLESS",
  venueMarketId: overrides.venueMarketId ?? "m-1",
  sourceMarketSlug: overrides.sourceMarketSlug ?? null,
  canonicalEventId: overrides.canonicalEventId ?? "evt-1",
  title: overrides.title ?? "Presidential Election Winner 2028",
  rulesText: overrides.rulesText ?? "This market resolves to the candidate who wins the 2028 U.S. presidential election.",
  category: overrides.category ?? "POLITICS",
  marketClass: overrides.marketClass ?? "MULTI_OUTCOME",
  tags: overrides.tags ?? [],
  outcomeCount: overrides.outcomeCount ?? 3,
  outcomeLabels: overrides.outcomeLabels ?? ["Donald Trump", "Kamala Harris", "Other"],
  publishedAt: overrides.publishedAt ?? null,
  expiresAt: overrides.expiresAt ?? null,
  resolvesAt: overrides.resolvesAt ?? null,
  jurisdiction: overrides.jurisdiction ?? "usa",
  office: overrides.office ?? "president",
  institution: overrides.institution ?? null,
  chamber: overrides.chamber ?? null,
  branch: overrides.branch ?? "executive",
  cycleYear: overrides.cycleYear ?? "2028",
  contestStage: overrides.contestStage ?? "general",
  candidateNames: overrides.candidateNames ?? ["donald trump", "kamala harris"],
  candidateSetFingerprint: overrides.candidateSetFingerprint ?? "donald trump|kamala harris",
  partyTerms: overrides.partyTerms ?? [],
  partyStructureFingerprint: overrides.partyStructureFingerprint ?? null,
  thresholdSemantics: overrides.thresholdSemantics ?? null,
  dateBoundarySemantics: overrides.dateBoundarySemantics ?? null,
  eventType: overrides.eventType ?? null,
  outcomeStructureType: overrides.outcomeStructureType ?? "MULTI_CANDIDATE",
  resolutionBasisHints: overrides.resolutionBasisHints ?? [],
  family: overrides.family ?? "OFFICE_WINNER",
  extractionConfidence: overrides.extractionConfidence ?? "HIGH",
  parseFailures: overrides.parseFailures ?? [],
  inventoryTemporalBasis: overrides.inventoryTemporalBasis ?? "LIVE_CURRENT_STATE"
});

describe("politics office winner family report reconciliation", () => {
  it("drops supplemental MYRIAD rows when the same office-winner topic is freshly re-proven on non-MYRIAD venues", () => {
    const freshRows = [
      baseRow({
        interpretedContractId: "limitless",
        venue: "LIMITLESS",
        venueMarketId: "limitless-2028"
      }),
      baseRow({
        interpretedContractId: "polymarket",
        venue: "POLYMARKET",
        venueMarketId: "polymarket-2028",
        title: "Who will win the 2028 U.S. presidential election?"
      })
    ];
    const myriadRows = [
      baseRow({
        interpretedContractId: "myriad-2028",
        venue: "MYRIAD",
        venueMarketId: "myriad-2028",
        title: "US Presidential Election Winner 2028"
      }),
      baseRow({
        interpretedContractId: "myriad-seoul",
        venue: "MYRIAD",
        venueMarketId: "myriad-seoul",
        title: "2026 Seoul Mayoral Election Winner",
        jurisdiction: "seoul",
        office: "mayor",
        cycleYear: "2026",
        candidateNames: ["oh se hoon", "park ju min"],
        candidateSetFingerprint: "oh se hoon|park ju min",
        outcomeLabels: ["Oh Se Hoon", "Park Ju Min", "Other"]
      })
    ];

    const filtered = filterSupplementalMyriadOfficeWinnerRows(freshRows, myriadRows);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.venueMarketId).toBe("myriad-seoul");
  });
});
