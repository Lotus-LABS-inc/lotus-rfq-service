import { describe, expect, it } from "vitest";

import { buildPoliticsOfficeWinnerColombiaPresident2026MatcherMaterialization } from "../../src/matching/politics/politics-office-winner-colombia-president-2026-matcher.js";
import type {
  PoliticsOfficeWinnerComparabilityTopicSummary,
  PoliticsOfficeWinnerNormalizedTopicRow
} from "../../src/matching/politics/politics-office-winner-family-pass.js";

const normalizedRow = (overrides: Partial<PoliticsOfficeWinnerNormalizedTopicRow>): PoliticsOfficeWinnerNormalizedTopicRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "LIMITLESS",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  title: overrides.title ?? "Colombia Presidential Election",
  canonicalFamily: "OFFICE_WINNER",
  canonicalTopicKey: overrides.canonicalTopicKey ?? "OFFICE_WINNER|COLOMBIA|US_PRESIDENT|2026",
  canonicalSubject: overrides.canonicalSubject ?? "abelardo de la espriella",
  canonicalJurisdiction: overrides.canonicalJurisdiction ?? "colombia",
  canonicalCycle: overrides.canonicalCycle ?? "2026",
  canonicalOffice: overrides.canonicalOffice ?? "president",
  canonicalOfficeLevel: overrides.canonicalOfficeLevel ?? "national",
  canonicalElectionType: overrides.canonicalElectionType ?? null,
  canonicalTemporalBasis: overrides.canonicalTemporalBasis ?? "DATE_BOUND",
  electionRound: overrides.electionRound ?? null,
  officeScope: overrides.officeScope ?? "national",
  jurisdictionScope: overrides.jurisdictionScope ?? "colombia",
  candidateSet: overrides.candidateSet ?? ["abelardo de la espriella", "paloma valencia", "other"],
  candidateSetType: overrides.candidateSetType ?? "FIELD",
  dateBounded: overrides.dateBounded ?? true,
  interpretationConfidence: overrides.interpretationConfidence ?? "HIGH",
  interpretationNotes: overrides.interpretationNotes ?? [],
  rejectionReason: overrides.rejectionReason ?? null
});

const topicSummary = (overrides: Partial<PoliticsOfficeWinnerComparabilityTopicSummary> = {}): PoliticsOfficeWinnerComparabilityTopicSummary => ({
  canonicalTopicKey: overrides.canonicalTopicKey ?? "OFFICE_WINNER|COLOMBIA|US_PRESIDENT|2026",
  venuesPresent: overrides.venuesPresent ?? ["LIMITLESS", "POLYMARKET"],
  pairSharedNamedOutcomesCount: overrides.pairSharedNamedOutcomesCount ?? 2,
  triSharedNamedOutcomesCount: overrides.triSharedNamedOutcomesCount ?? 0,
  excludedOutcomesCount: overrides.excludedOutcomesCount ?? 2,
  ruleCompatibilityClassification: overrides.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING",
  fragmentationLabel: overrides.fragmentationLabel ?? "FAMILY_REFRESHED_COMPARABLE_PAIR_EXISTS",
  matcherCandidate: overrides.matcherCandidate ?? true,
  sharedNamedCandidates: overrides.sharedNamedCandidates ?? ["abelardo de la espriella", "paloma valencia"],
  excludedOutcomes: overrides.excludedOutcomes ?? [
    { label: "other", reason: "OTHERS_EXCLUDED", venues: ["LIMITLESS", "POLYMARKET"] }
  ],
  notes: overrides.notes ?? []
});

describe("office winner colombia president 2026 matcher", () => {
  it("hard-scopes to LIMITLESS|POLYMARKET and materializes only exact shared candidates", () => {
    const materialized = buildPoliticsOfficeWinnerColombiaPresident2026MatcherMaterialization({
      normalizedTopics: [
        normalizedRow({
          venue: "LIMITLESS",
          venueMarketId: "colombia-presidential-election-1769094546695",
          candidateSet: ["abelardo de la espriella", "paloma valencia", "other"]
        }),
        normalizedRow({
          interpretedContractId: "poly-colombia-1",
          venue: "POLYMARKET",
          venueMarketId: "colombia-presidential-election",
          candidateSet: ["Abelardo de la Espriella", "Paloma Valencia", "Other"]
        })
      ],
      comparabilitySummary: [topicSummary()]
    });

    expect(materialized.venuePair).toBe("LIMITLESS|POLYMARKET");
    expect(materialized.matcherLanes.map((lane) => lane.candidateIdentityKey)).toEqual([
      "abelardo_de_la_espriella",
      "paloma_valencia"
    ]);
    expect(materialized.matcherLanes.every((lane) => lane.routeabilityDecision === "PAIR_REVIEW_REQUIRED")).toBe(true);
    expect(materialized.rejections.some((rejection) => rejection.reason === "OTHERS_EXCLUDED")).toBe(true);
    expect(materialized.rejections.some((rejection) => rejection.reason === "VENUE_NOT_PRESENT_FOR_TOPIC" && rejection.venue === "OPINION")).toBe(true);
    expect(materialized.finalDecision.bestPair).toBe("LIMITLESS|POLYMARKET");
    expect(materialized.finalDecision.overallDecision).toBe("OFFICE_WINNER_COLOMBIA_PRESIDENT_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW");
  });
});
