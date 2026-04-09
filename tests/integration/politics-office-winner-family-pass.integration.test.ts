import { describe, expect, it } from "vitest";

import { buildPoliticsOfficeWinnerFamilyArtifacts } from "../../src/matching/politics/politics-office-winner-family-pass.js";
import type { PoliticsExtractedRow } from "../../src/matching/politics/politics-types.js";

const baseRow = (overrides: Partial<PoliticsExtractedRow>): PoliticsExtractedRow => ({
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
  outcomeCount: 3,
  outcomeLabels: overrides.outcomeLabels ?? ["Kamala Harris", "Gavin Newsom", "Other"],
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
  partyTerms: overrides.partyTerms ?? [],
  partyStructureFingerprint: overrides.partyStructureFingerprint ?? null,
  thresholdSemantics: null,
  dateBoundarySemantics: overrides.dateBoundarySemantics ?? null,
  eventType: overrides.eventType ?? null,
  outcomeStructureType: overrides.outcomeStructureType ?? "MULTI_CANDIDATE",
  resolutionBasisHints: [],
  family: overrides.family ?? "OFFICE_WINNER",
  extractionConfidence: overrides.extractionConfidence ?? "HIGH",
  parseFailures: overrides.parseFailures ?? [],
  inventoryTemporalBasis: "LIVE_CURRENT_STATE"
});

describe("politics office winner family pass", () => {
  it("admits only office-winner rows and keeps the strongest matcher candidate stable", () => {
    const artifacts = buildPoliticsOfficeWinnerFamilyArtifacts([
      baseRow({ interpretedContractId: "opinion", venue: "OPINION", venueMarketId: "o-1" }),
      baseRow({ interpretedContractId: "limitless", venue: "LIMITLESS", venueMarketId: "l-1" }),
      baseRow({
        interpretedContractId: "nominee",
        venue: "POLYMARKET",
        venueMarketId: "p-1",
        title: "Who will be the Democratic nominee in 2028?",
        rulesText: "Resolves to the 2028 Democratic nominee.",
        family: "NOMINEE_WINNER",
        contestStage: "nomination",
        partyTerms: ["democratic"]
      }),
      baseRow({
        interpretedContractId: "exit",
        venue: "PREDICT",
        venueMarketId: "pr-1",
        title: "Will the president be out of office before 2028?",
        rulesText: "Resolves yes if the president leaves office before 2028.",
        family: "OFFICE_EXIT_BY_DATE",
        dateBoundarySemantics: "2028-01-01"
      }),
      baseRow({
        interpretedContractId: "geopolitical",
        venue: "MYRIAD",
        venueMarketId: "m-2",
        title: "Will there be a ceasefire before year end?",
        rulesText: "Resolves yes if a ceasefire occurs before year end.",
        family: "GEOPOLITICAL_EVENT_BY_DATE",
        office: null,
        jurisdiction: null,
        cycleYear: null,
        candidateNames: [],
        candidateSetFingerprint: null,
        outcomeLabels: ["Yes", "No"],
        eventType: "ceasefire"
      })
    ]);

    expect(artifacts.admissionSummary.totalAdmittedOfficeWinnerRows).toBe(2);
    expect(artifacts.admissionSummary.rowsRejectedByReason["NOMINEE_NOT_OFFICE_WINNER"]).toBe(1);
    expect(artifacts.admissionSummary.rowsRejectedByReason["OFFICE_EXIT_NOT_OFFICE_WINNER"]).toBe(1);
    expect(artifacts.admissionSummary.rowsRejectedByReason["GEOPOLITICAL_NOT_OFFICE_WINNER"]).toBe(1);
    expect(artifacts.finalDecision.bestCandidateTopicKey).toBe("OFFICE_WINNER|USA|US_PRESIDENT|2028");
    expect(artifacts.finalDecision.matcherFollowUpJustified).toBe(true);
  });
});
