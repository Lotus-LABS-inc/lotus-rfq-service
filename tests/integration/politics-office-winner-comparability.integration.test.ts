import { describe, expect, it } from "vitest";

import { buildPoliticsOfficeWinnerFamilyArtifacts } from "../../src/matching/politics/politics-office-winner-family-pass.js";
import type { PoliticsExtractedRow } from "../../src/matching/politics/politics-types.js";

const row = (overrides: Partial<PoliticsExtractedRow>): PoliticsExtractedRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "m1",
  sourceMarketSlug: null,
  canonicalEventId: "evt-1",
  title: overrides.title ?? "Who will win the 2028 U.S. presidential election?",
  rulesText: overrides.rulesText ?? "Resolves to the candidate who wins the 2028 U.S. presidential election.",
  category: "POLITICS",
  marketClass: "MULTI_OUTCOME",
  tags: [],
  outcomeCount: 4,
  outcomeLabels: overrides.outcomeLabels ?? ["Kamala Harris", "Gavin Newsom", "Other", "No one"],
  publishedAt: null,
  expiresAt: null,
  resolvesAt: null,
  jurisdiction: overrides.jurisdiction ?? "usa",
  office: overrides.office ?? "president",
  institution: null,
  chamber: null,
  branch: "executive",
  cycleYear: overrides.cycleYear ?? "2028",
  contestStage: overrides.contestStage ?? "general",
  candidateNames: overrides.candidateNames ?? ["kamala harris", "gavin newsom"],
  candidateSetFingerprint: overrides.candidateSetFingerprint ?? "gavin newsom|kamala harris",
  partyTerms: [],
  partyStructureFingerprint: null,
  thresholdSemantics: null,
  dateBoundarySemantics: null,
  eventType: null,
  outcomeStructureType: "MULTI_CANDIDATE",
  resolutionBasisHints: [],
  family: "OFFICE_WINNER",
  extractionConfidence: "HIGH",
  parseFailures: overrides.parseFailures ?? [],
  inventoryTemporalBasis: "LIVE_CURRENT_STATE"
});

describe("politics office winner comparability", () => {
  it("excludes others and non-shared tails from shared-core counts", () => {
    const artifacts = buildPoliticsOfficeWinnerFamilyArtifacts([
      row({ interpretedContractId: "o1", venue: "OPINION", venueMarketId: "o1" }),
      row({
        interpretedContractId: "l1",
        venue: "LIMITLESS",
        venueMarketId: "l1",
        candidateNames: ["kamala harris", "pete buttigieg"],
        candidateSetFingerprint: "kamala harris|pete buttigieg",
        outcomeLabels: ["Kamala Harris", "Pete Buttigieg", "Other"]
      })
    ]);

    const summary = artifacts.comparabilitySummary[0]!;
    expect(summary.pairSharedNamedOutcomesCount).toBe(1);
    expect(summary.sharedNamedCandidates).toEqual(["kamala harris"]);
    expect(summary.excludedOutcomes.some((outcome) => outcome.reason === "OTHERS_EXCLUDED")).toBe(true);
    expect(summary.excludedOutcomes.some((outcome) => outcome.reason === "NOT_SHARED")).toBe(true);
  });

  it("fails closed on rule mismatch instead of creating a matcher candidate", () => {
    const artifacts = buildPoliticsOfficeWinnerFamilyArtifacts([
      row({ interpretedContractId: "o1", venue: "OPINION", venueMarketId: "o1" }),
      row({
        interpretedContractId: "l1",
        venue: "LIMITLESS",
        venueMarketId: "l1",
        title: "Who will be the Democratic nominee in 2028?",
        rulesText: "Resolves to the Democratic nominee in 2028.",
        contestStage: "nomination"
      })
    ]);

    const summary = artifacts.comparabilitySummary[0]!;
    expect(summary.ruleCompatibilityClassification).toBe("RULES_MATERIALLY_INCOMPATIBLE");
    expect(summary.fragmentationLabel).toBe("FAMILY_REFRESHED_RULE_FRAGMENTED");
    expect(summary.matcherCandidate).toBe(false);
  });
});
