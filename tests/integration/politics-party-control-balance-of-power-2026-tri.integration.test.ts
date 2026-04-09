import { describe, expect, it } from "vitest";

import { buildPoliticsPartyControlBalanceOfPower2026MatcherMaterialization } from "../../src/matching/politics/politics-party-control-balance-of-power-2026-matcher.js";
import type {
  PoliticsPartyControlComparabilityTopicSummary,
  PoliticsPartyControlNormalizedTopicRow
} from "../../src/matching/politics/politics-party-control-family-pass.js";

const normalizedRow = (overrides: Partial<PoliticsPartyControlNormalizedTopicRow>): PoliticsPartyControlNormalizedTopicRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "OPINION",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  title: overrides.title ?? "Balance of Power: 2026 Midterms",
  canonicalFamily: "PARTY_CONTROL",
  canonicalTopicKey: overrides.canonicalTopicKey ?? "PARTY_CONTROL|USA|CONGRESS|2026|BALANCE_OF_POWER",
  canonicalJurisdiction: overrides.canonicalJurisdiction ?? "usa",
  canonicalCycle: overrides.canonicalCycle ?? "2026",
  canonicalInstitution: overrides.canonicalInstitution ?? "congress",
  canonicalControlScope: overrides.canonicalControlScope ?? "house_and_senate",
  canonicalTemporalBasis: overrides.canonicalTemporalBasis ?? "DATE_BOUND",
  normalizedOutcomes: overrides.normalizedOutcomes ?? ["DEMOCRATS_SWEEP", "D_SENATE_R_HOUSE", "REPUBLICANS_SWEEP"],
  interpretationConfidence: overrides.interpretationConfidence ?? "HIGH",
  interpretationNotes: overrides.interpretationNotes ?? [],
  rejectionReason: overrides.rejectionReason ?? null
});

const topicSummary = (overrides: Partial<PoliticsPartyControlComparabilityTopicSummary> = {}): PoliticsPartyControlComparabilityTopicSummary => ({
  canonicalTopicKey: overrides.canonicalTopicKey ?? "PARTY_CONTROL|USA|CONGRESS|2026|BALANCE_OF_POWER",
  venuesPresent: overrides.venuesPresent ?? ["OPINION", "POLYMARKET", "PREDICT"],
  pairSharedNamedOutcomesCount: overrides.pairSharedNamedOutcomesCount ?? 4,
  triSharedNamedOutcomesCount: overrides.triSharedNamedOutcomesCount ?? 3,
  excludedOutcomesCount: overrides.excludedOutcomesCount ?? 1,
  ruleCompatibilityClassification: overrides.ruleCompatibilityClassification ?? "EXACT_RULE_COMPATIBLE",
  fragmentationLabel: overrides.fragmentationLabel ?? "FAMILY_REFRESHED_COMPARABLE_TRI_EXISTS",
  matcherCandidate: overrides.matcherCandidate ?? true,
  sharedNamedOutcomes: overrides.sharedNamedOutcomes ?? [
    "D_SENATE_R_HOUSE",
    "DEMOCRATS_SWEEP",
    "R_SENATE_D_HOUSE",
    "REPUBLICANS_SWEEP"
  ],
  excludedOutcomes: overrides.excludedOutcomes ?? [
    { label: "Other", reason: "OTHERS_EXCLUDED", venues: ["OPINION", "POLYMARKET", "PREDICT"] }
  ],
  notes: overrides.notes ?? []
});

describe("party-control balance of power 2026 tri", () => {
  it("enforces strict 3-venue intersection and rejects pair-only outcomes from tri", () => {
    const materialized = buildPoliticsPartyControlBalanceOfPower2026MatcherMaterialization({
      normalizedTopics: [
        normalizedRow({
          venue: "OPINION",
          venueMarketId: "opinion-balance-2026",
          normalizedOutcomes: ["DEMOCRATS_SWEEP", "D_SENATE_R_HOUSE", "REPUBLICANS_SWEEP"]
        }),
        normalizedRow({
          interpretedContractId: "poly-balance",
          venue: "POLYMARKET",
          venueMarketId: "balance-of-power-2026-midterms",
          normalizedOutcomes: ["DEMOCRATS_SWEEP", "D_SENATE_R_HOUSE", "R_SENATE_D_HOUSE", "REPUBLICANS_SWEEP"]
        }),
        normalizedRow({
          interpretedContractId: "predict-balance",
          venue: "PREDICT",
          venueMarketId: "balance-of-power-2026-midterm-elections",
          normalizedOutcomes: ["DEMOCRATS_SWEEP", "D_SENATE_R_HOUSE", "R_SENATE_D_HOUSE", "REPUBLICANS_SWEEP"]
        })
      ],
      comparabilitySummary: [topicSummary()]
    });

    expect(materialized.triLanes.map((lane) => lane.outcomeIdentityKey)).toEqual([
      "D_SENATE_R_HOUSE",
      "DEMOCRATS_SWEEP",
      "REPUBLICANS_SWEEP"
    ]);
    expect(materialized.triLanes.every((lane) => lane.routeabilityDecision === "TRI_EXACT_AUTO_ROUTEABLE")).toBe(true);
    expect(materialized.rejections.some((rejection) =>
      rejection.reason === "TRI_EDGE_MISSING" && rejection.outcomeIdentityKey === "R_SENATE_D_HOUSE"
    )).toBe(true);
    expect(materialized.finalDecision.bestTriIfAny).toBe("OPINION|POLYMARKET|PREDICT");
    expect(materialized.finalDecision.pairStillPreferred).toBe(true);
  });
});
