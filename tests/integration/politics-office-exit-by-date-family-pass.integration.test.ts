import { describe, expect, it } from "vitest";

import { buildPoliticsOfficeExitByDateFamilyArtifacts } from "../../src/matching/politics/politics-office-exit-by-date-family-pass.js";
import type { PoliticsExtractedRow } from "../../src/matching/politics/politics-types.js";

const buildRow = (overrides: Partial<PoliticsExtractedRow>): PoliticsExtractedRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  sourceMarketSlug: null,
  canonicalEventId: "event-1",
  title: overrides.title ?? "Trump out as President before 2027?",
  rulesText: overrides.rulesText ?? "This market resolves to Yes if Donald Trump ceases to be President of the United States for any period of time by December 31, 2026.",
  category: "POLITICS",
  marketClass: "BINARY",
  tags: [],
  outcomeCount: overrides.outcomeCount ?? 2,
  outcomeLabels: overrides.outcomeLabels ?? ["Yes", "No"],
  publishedAt: null,
  expiresAt: null,
  resolvesAt: null,
  jurisdiction: overrides.jurisdiction ?? "usa",
  office: overrides.office ?? "president",
  institution: overrides.institution ?? null,
  chamber: overrides.chamber ?? null,
  branch: overrides.branch ?? "executive",
  cycleYear: overrides.cycleYear ?? "2026",
  contestStage: overrides.contestStage ?? null,
  candidateNames: overrides.candidateNames ?? ["donald trump"],
  candidateSetFingerprint: overrides.candidateSetFingerprint ?? "donald trump",
  partyTerms: overrides.partyTerms ?? [],
  partyStructureFingerprint: overrides.partyStructureFingerprint ?? null,
  thresholdSemantics: null,
  dateBoundarySemantics: overrides.dateBoundarySemantics ?? "2026-12-31",
  eventType: overrides.eventType ?? "office_exit",
  outcomeStructureType: overrides.outcomeStructureType ?? "YES_NO",
  resolutionBasisHints: [],
  family: overrides.family ?? "OFFICE_EXIT_BY_DATE",
  extractionConfidence: overrides.extractionConfidence ?? "HIGH",
  parseFailures: overrides.parseFailures ?? [],
  inventoryTemporalBasis: "LIVE_CURRENT_STATE"
});

describe("politics office-exit-by-date family pass", () => {
  it("proves exact venue truth first and selects the strongest narrow matcher candidate", () => {
    const artifacts = buildPoliticsOfficeExitByDateFamilyArtifacts([
      buildRow({ interpretedContractId: "trump-opinion", venue: "OPINION", venueMarketId: "o-trump" }),
      buildRow({ interpretedContractId: "trump-poly", venue: "POLYMARKET", venueMarketId: "p-trump" }),
      buildRow({ interpretedContractId: "trump-predict", venue: "PREDICT", venueMarketId: "pr-trump" }),
      buildRow({ interpretedContractId: "trump-limitless", venue: "LIMITLESS", venueMarketId: "l-trump" }),
      buildRow({
        interpretedContractId: "starmer-myriad",
        venue: "MYRIAD",
        venueMarketId: "m-starmer",
        title: "Keir Starmer out before July?",
        rulesText: "This market resolves to Yes if Keir Starmer ceases to be Prime Minister of the United Kingdom for any period of time by June 30, 2026.",
        jurisdiction: "uk",
        office: "prime_minister",
        candidateNames: ["keir starmer"],
        candidateSetFingerprint: "keir starmer",
        dateBoundarySemantics: "2026-06-30"
      }),
      buildRow({
        interpretedContractId: "starmer-poly",
        venue: "POLYMARKET",
        venueMarketId: "p-starmer",
        title: "Keir Starmer out before July 2026?",
        rulesText: "This market resolves to Yes if Keir Starmer ceases to be Prime Minister of the United Kingdom for any period of time by June 30, 2026.",
        jurisdiction: "uk",
        office: "prime_minister",
        candidateNames: ["keir starmer"],
        candidateSetFingerprint: "keir starmer",
        dateBoundarySemantics: "2026-06-30"
      }),
      buildRow({
        interpretedContractId: "winner-row",
        venue: "POLYMARKET",
        venueMarketId: "winner-row",
        title: "Who will win the 2028 U.S. presidential election?",
        rulesText: "Resolves to the election winner.",
        family: "OFFICE_WINNER",
        eventType: null,
        candidateNames: ["kamala harris"],
        candidateSetFingerprint: "kamala harris",
        dateBoundarySemantics: null
      })
    ]);

    const trumpSummary = artifacts.comparabilitySummary.find(
      (summary) => summary.canonicalTopicKey === "OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31"
    );

    expect(artifacts.admissionSummary.totalAdmittedOfficeExitRows).toBe(6);
    expect(artifacts.finalDecision.bestCandidateTopicKey).toBe("OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31");
    expect(trumpSummary?.venuesPresent).toEqual(["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"]);
    expect(artifacts.finalDecision.overallFamilyDecision).toBe("OFFICE_EXIT_BY_DATE_FAMILY_REFRESHED_TRI_MATCHER_CANDIDATE_FOUND");
    expect(artifacts.admissionSummary.rowsRejectedByReason["OFFICE_WINNER_NOT_OFFICE_EXIT_BY_DATE"]).toBe(1);
  });
});
