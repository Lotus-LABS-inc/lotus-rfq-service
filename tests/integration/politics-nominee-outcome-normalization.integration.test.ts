import { describe, expect, it } from "vitest";

import { extractNominee2028SharedCoreOutcomes, normalizeNominee2028SharedCoreMarket } from "../../src/matching/politics/politics-nominee-2028-shared-core.js";
import type { PoliticsExtractedRow } from "../../src/matching/politics/politics-types.js";

const buildRow = (overrides: Partial<PoliticsExtractedRow> = {}): PoliticsExtractedRow => ({
  interpretedContractId: "test-1",
  venue: "OPINION",
  venueMarketId: "market-1",
  sourceMarketSlug: null,
  canonicalEventId: "event-1",
  title: "Who will be the Republican nominee for U.S. president in 2028?",
  rulesText: "Resolves to the candidate who wins the 2028 Republican nomination for U.S. president.",
  category: "POLITICS",
  marketClass: "MULTI_OUTCOME",
  tags: [],
  outcomeCount: 4,
  outcomeLabels: ["JD Vance", "J.D. Vance", "Donald Trump Jr.", "Others"],
  publishedAt: null,
  expiresAt: null,
  resolvesAt: null,
  jurisdiction: "usa",
  office: "president",
  institution: "executive",
  chamber: null,
  branch: "executive",
  cycleYear: "2028",
  contestStage: "nomination",
  candidateNames: ["JD Vance", "Donald Trump Jr."],
  candidateSetFingerprint: null,
  partyTerms: ["republican"],
  partyStructureFingerprint: null,
  thresholdSemantics: null,
  dateBoundarySemantics: null,
  eventType: null,
  outcomeStructureType: "MULTI_CANDIDATE",
  resolutionBasisHints: ["CENTRAL"],
  family: "NOMINEE_WINNER",
  extractionConfidence: "HIGH",
  parseFailures: [],
  inventoryTemporalBasis: "LIVE_CURRENT_STATE",
  ...overrides
});

describe("politics nominee outcome normalization", () => {
  it("normalizes candidate identities deterministically across punctuation and suffix noise", () => {
    const row = buildRow();
    const market = normalizeNominee2028SharedCoreMarket(row)!;
    const outcomes = extractNominee2028SharedCoreOutcomes(row, market);

    const jdVance = outcomes.filter((outcome) => outcome.candidateIdentityKey === "jd_vance");
    const trumpJr = outcomes.find((outcome) => outcome.candidateIdentityKey === "donald_trump_jr");

    expect(jdVance).toHaveLength(2);
    expect(trumpJr?.normalizedCandidateName).toBe("donald trump jr");
  });

  it("does not collapse distinct candidates that only share a surname", () => {
    const row = buildRow({
      outcomeLabels: ["Donald Trump", "Donald Trump Jr."],
      candidateNames: ["Donald Trump", "Donald Trump Jr."]
    });
    const market = normalizeNominee2028SharedCoreMarket(row)!;
    const outcomes = extractNominee2028SharedCoreOutcomes(row, market);

    const identityKeys = outcomes.map((outcome) => outcome.candidateIdentityKey).filter(Boolean);
    expect(identityKeys).toContain("donald_trump");
    expect(identityKeys).toContain("donald_trump_jr");
  });

  it("derives the named candidate from a Polymarket-style nominee binary title instead of yes/no labels", () => {
    const row = buildRow({
      venue: "POLYMARKET",
      title: "Will J.D. Vance win the 2028 Republican presidential nomination?",
      rulesText: "Resolves yes if J.D. Vance wins the 2028 Republican nomination for U.S. president.",
      outcomeLabels: ["Yes", "No"],
      candidateNames: [],
      outcomeStructureType: "YES_NO",
      outcomeCount: 2
    });

    const market = normalizeNominee2028SharedCoreMarket(row)!;
    const outcomes = extractNominee2028SharedCoreOutcomes(row, market);

    expect(market.candidateMenuType).toBe("CANDIDATE_SPECIFIC_BINARY");
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.rawOutcomeLabel).toBe("J.D. Vance");
    expect(outcomes[0]?.candidateIdentityKey).toBe("jd_vance");
    expect(outcomes[0]?.outcomeType).toBe("NAMED_CANDIDATE");
  });
});
