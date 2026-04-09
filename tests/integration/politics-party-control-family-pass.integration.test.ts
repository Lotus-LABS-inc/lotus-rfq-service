import { describe, expect, it } from "vitest";

import { buildPoliticsPartyControlFamilyArtifacts } from "../../src/matching/politics/politics-party-control-family-pass.js";
import type { PoliticsExtractedRow } from "../../src/matching/politics/politics-types.js";

const buildRow = (overrides: Partial<PoliticsExtractedRow>): PoliticsExtractedRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  sourceMarketSlug: null,
  canonicalEventId: "event-1",
  title: overrides.title ?? "Balance of Power: 2026 Midterms",
  rulesText: overrides.rulesText ?? "Resolves to the final balance of power in the House and Senate after the 2026 midterms.",
  category: "POLITICS",
  marketClass: "BINARY",
  tags: [],
  outcomeCount: overrides.outcomeCount ?? 5,
  outcomeLabels: overrides.outcomeLabels ?? ["Democrats Sweep", "D Senate, R House", "R Senate, D House", "Republicans Sweep", "Other"],
  publishedAt: null,
  expiresAt: null,
  resolvesAt: null,
  jurisdiction: overrides.jurisdiction ?? "usa",
  office: overrides.office ?? "senate_control",
  institution: overrides.institution ?? "congress",
  chamber: overrides.chamber ?? "senate",
  branch: overrides.branch ?? "legislative",
  cycleYear: overrides.cycleYear ?? "2026",
  contestStage: overrides.contestStage ?? "general",
  candidateNames: overrides.candidateNames ?? [],
  candidateSetFingerprint: overrides.candidateSetFingerprint ?? null,
  partyTerms: overrides.partyTerms ?? ["democratic", "republican"],
  partyStructureFingerprint: overrides.partyStructureFingerprint ?? "democratic|republican",
  thresholdSemantics: null,
  dateBoundarySemantics: "2026",
  eventType: null,
  outcomeStructureType: overrides.outcomeStructureType ?? "MULTI_CANDIDATE",
  resolutionBasisHints: [],
  family: overrides.family ?? "PARTY_CONTROL",
  extractionConfidence: overrides.extractionConfidence ?? "HIGH",
  parseFailures: overrides.parseFailures ?? [],
  inventoryTemporalBasis: "LIVE_CURRENT_STATE"
});

describe("politics party-control family pass", () => {
  it("builds a narrow comparable pair candidate for balance-of-power 2026 midterms", () => {
    const artifacts = buildPoliticsPartyControlFamilyArtifacts([
      buildRow({
        interpretedContractId: "op",
        venue: "OPINION",
        venueMarketId: "493239",
        outcomeLabels: ["Democrats Sweep", "Republicans Sweep", "D Senate, R House", "Other"]
      }),
      buildRow({
        interpretedContractId: "pm",
        venue: "POLYMARKET",
        venueMarketId: "balance-of-power-2026-midterms"
      })
    ]);

    expect(artifacts.finalDecision.bestCandidateTopicKey).toBe("PARTY_CONTROL|USA|CONGRESS|2026|BALANCE_OF_POWER");
    expect(artifacts.comparabilitySummary[0]?.venuesPresent).toEqual(["OPINION", "POLYMARKET"]);
    expect(artifacts.comparabilitySummary[0]?.pairSharedNamedOutcomesCount).toBe(3);
    expect(artifacts.comparabilitySummary[0]?.triSharedNamedOutcomesCount).toBe(0);
    expect(artifacts.finalDecision.overallFamilyDecision).toBe("PARTY_CONTROL_FAMILY_REFRESHED_PAIR_MATCHER_CANDIDATE_FOUND");
  });
});
