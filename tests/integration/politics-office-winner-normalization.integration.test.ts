import { describe, expect, it } from "vitest";

import { buildOfficeWinnerCanonicalTopicKey } from "../../src/matching/politics/politics-office-winner-family-pass.js";
import { buildPoliticsManualFamilySummary } from "../../src/matching/politics/politics-manual-family-pass.js";
import type { PoliticsManualNormalizedRow } from "../../src/matching/politics/politics-types.js";

const row = (venue: PoliticsManualNormalizedRow["venue"], jurisdiction: string): PoliticsManualNormalizedRow => ({
  interpretedContractId: `${venue}-${jurisdiction}`,
  canonicalFamily: "OFFICE_WINNER",
  venue,
  venueMarketId: `${venue}-${jurisdiction}`,
  title: `Who will win the ${jurisdiction} mayor race in 2026?`,
  canonicalSubject: null,
  canonicalJurisdiction: jurisdiction,
  canonicalCycle: "2026",
  canonicalOffice: "mayor",
  canonicalOfficeLevel: "local",
  canonicalElectionType: "general",
  canonicalEventActors: [],
  canonicalOutcomeBasis: "office_winner",
  canonicalTemporalBasis: "OPEN_ENDED",
  interpretationConfidence: "HIGH",
  interpretationNotes: [],
  rejectionReason: null,
  candidateSet: ["alice smith", "bob jones"],
  candidateSetType: "CANDIDATE_SET",
  electionRound: "general"
});

describe("office winner normalization", () => {
  it("derives a stable canonical office-winner topic key", () => {
    expect(buildOfficeWinnerCanonicalTopicKey(row("OPINION", "usa"))).toBe("OFFICE_WINNER|USA|MAYOR|2026");
  });

  it("does not cluster rows with the same office keyword but different jurisdictions", () => {
    const summary = buildPoliticsManualFamilySummary("OFFICE_WINNER", [
      row("OPINION", "new_york_city"),
      row("LIMITLESS", "chicago")
    ]);

    expect(summary.comparableClusters).toHaveLength(0);
    expect(summary.dominantBlocker).toBe("JURISDICTION_MISMATCH");
  });

  it("fails closed when office winner topic identity is missing critical fields", () => {
    expect(buildOfficeWinnerCanonicalTopicKey({
      ...row("OPINION", "usa"),
      canonicalCycle: null
    })).toBeNull();
  });
});
