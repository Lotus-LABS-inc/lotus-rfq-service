import { describe, expect, it } from "vitest";

import { buildPoliticsOfficeWinnerBusanMayor2026MatcherMaterialization } from "../../src/matching/politics/politics-office-winner-busan-mayor-2026-matcher.js";
import type {
  PoliticsOfficeWinnerComparabilityTopicSummary,
  PoliticsOfficeWinnerNormalizedTopicRow
} from "../../src/matching/politics/politics-office-winner-family-pass.js";

const normalizedRow = (overrides: Partial<PoliticsOfficeWinnerNormalizedTopicRow>): PoliticsOfficeWinnerNormalizedTopicRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "LIMITLESS",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  title: overrides.title ?? "2026 Busan Mayoral Election Winner",
  canonicalFamily: "OFFICE_WINNER",
  canonicalTopicKey: overrides.canonicalTopicKey ?? "OFFICE_WINNER|BUSAN|MAYOR|2026",
  canonicalSubject: overrides.canonicalSubject ?? "cho kuk",
  canonicalJurisdiction: overrides.canonicalJurisdiction ?? "busan",
  canonicalCycle: overrides.canonicalCycle ?? "2026",
  canonicalOffice: overrides.canonicalOffice ?? "mayor",
  canonicalOfficeLevel: overrides.canonicalOfficeLevel ?? "local",
  canonicalElectionType: overrides.canonicalElectionType ?? null,
  canonicalTemporalBasis: overrides.canonicalTemporalBasis ?? "DATE_BOUND",
  electionRound: overrides.electionRound ?? null,
  officeScope: overrides.officeScope ?? "local",
  jurisdictionScope: overrides.jurisdictionScope ?? "busan",
  candidateSet: overrides.candidateSet ?? ["cho kuk", "chun jae soo", "park heong joon", "other"],
  candidateSetType: overrides.candidateSetType ?? "FIELD",
  dateBounded: overrides.dateBounded ?? true,
  interpretationConfidence: overrides.interpretationConfidence ?? "HIGH",
  interpretationNotes: overrides.interpretationNotes ?? [],
  rejectionReason: overrides.rejectionReason ?? null
});

const topicSummary = (overrides: Partial<PoliticsOfficeWinnerComparabilityTopicSummary> = {}): PoliticsOfficeWinnerComparabilityTopicSummary => ({
  canonicalTopicKey: overrides.canonicalTopicKey ?? "OFFICE_WINNER|BUSAN|MAYOR|2026",
  venuesPresent: overrides.venuesPresent ?? ["LIMITLESS", "POLYMARKET"],
  pairSharedNamedOutcomesCount: overrides.pairSharedNamedOutcomesCount ?? 3,
  triSharedNamedOutcomesCount: overrides.triSharedNamedOutcomesCount ?? 0,
  excludedOutcomesCount: overrides.excludedOutcomesCount ?? 2,
  ruleCompatibilityClassification: overrides.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING",
  fragmentationLabel: overrides.fragmentationLabel ?? "FAMILY_REFRESHED_COMPARABLE_PAIR_EXISTS",
  matcherCandidate: overrides.matcherCandidate ?? true,
  sharedNamedCandidates: overrides.sharedNamedCandidates ?? ["cho kuk", "chun jae soo", "park heong joon"],
  excludedOutcomes: overrides.excludedOutcomes ?? [
    { label: "other", reason: "OTHERS_EXCLUDED", venues: ["LIMITLESS", "POLYMARKET"] }
  ],
  notes: overrides.notes ?? []
});

describe("office winner busan mayor 2026 matcher", () => {
  it("hard-scopes to LIMITLESS|POLYMARKET and materializes only exact shared candidates", () => {
    const materialized = buildPoliticsOfficeWinnerBusanMayor2026MatcherMaterialization({
      normalizedTopics: [
        normalizedRow({
          venue: "LIMITLESS",
          venueMarketId: "limitless-busan-2026",
          candidateSet: ["cho kuk", "chun jae soo", "park heong joon", "other"]
        }),
        normalizedRow({
          interpretedContractId: "poly-busan-1",
          venue: "POLYMARKET",
          venueMarketId: "2026-busan-mayoral-election-winner",
          candidateSet: ["Cho Kuk", "Chun Jae-soo", "Park Heong-joon", "Other"]
        })
      ],
      comparabilitySummary: [topicSummary()]
    });

    expect(materialized.venuePair).toBe("LIMITLESS|POLYMARKET");
    expect(materialized.matcherLanes.map((lane) => lane.candidateIdentityKey)).toEqual([
      "cho_kuk",
      "chun_jae_soo",
      "park_heong_joon"
    ]);
    expect(materialized.matcherLanes.every((lane) => lane.routeabilityDecision === "PAIR_REVIEW_REQUIRED")).toBe(true);
    expect(materialized.rejections.some((rejection) => rejection.reason === "OTHERS_EXCLUDED")).toBe(true);
    expect(materialized.rejections.some((rejection) => rejection.reason === "VENUE_NOT_PRESENT_FOR_TOPIC" && rejection.venue === "OPINION")).toBe(true);
    expect(materialized.finalDecision.bestPair).toBe("LIMITLESS|POLYMARKET");
    expect(materialized.finalDecision.overallDecision).toBe("OFFICE_WINNER_BUSAN_MAYOR_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW");
  });
});
