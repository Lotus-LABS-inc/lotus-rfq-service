import { describe, expect, it } from "vitest";

import { buildPoliticsOfficeWinnerSeoulMayor2026MatcherMaterialization } from "../../src/matching/politics/politics-office-winner-seoul-mayor-2026-matcher.js";
import type {
  PoliticsOfficeWinnerComparabilityTopicSummary,
  PoliticsOfficeWinnerNormalizedTopicRow
} from "../../src/matching/politics/politics-office-winner-family-pass.js";

const normalizedRow = (overrides: Partial<PoliticsOfficeWinnerNormalizedTopicRow>): PoliticsOfficeWinnerNormalizedTopicRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "LIMITLESS",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  title: overrides.title ?? "2026 Seoul Mayoral Election Winner",
  canonicalFamily: "OFFICE_WINNER",
  canonicalTopicKey: overrides.canonicalTopicKey ?? "OFFICE_WINNER|SEOUL|MAYOR|2026",
  canonicalSubject: overrides.canonicalSubject ?? "oh se hoon",
  canonicalJurisdiction: overrides.canonicalJurisdiction ?? "seoul",
  canonicalCycle: overrides.canonicalCycle ?? "2026",
  canonicalOffice: overrides.canonicalOffice ?? "mayor",
  canonicalOfficeLevel: overrides.canonicalOfficeLevel ?? "local",
  canonicalElectionType: overrides.canonicalElectionType ?? null,
  canonicalTemporalBasis: overrides.canonicalTemporalBasis ?? "DATE_BOUND",
  electionRound: overrides.electionRound ?? null,
  officeScope: overrides.officeScope ?? "local",
  jurisdictionScope: overrides.jurisdictionScope ?? "seoul",
  candidateSet: overrides.candidateSet ?? ["oh se hoon", "na kyung won", "park ju min", "other"],
  candidateSetType: overrides.candidateSetType ?? "FIELD",
  dateBounded: overrides.dateBounded ?? true,
  interpretationConfidence: overrides.interpretationConfidence ?? "HIGH",
  interpretationNotes: overrides.interpretationNotes ?? [],
  rejectionReason: overrides.rejectionReason ?? null
});

const topicSummary = (overrides: Partial<PoliticsOfficeWinnerComparabilityTopicSummary> = {}): PoliticsOfficeWinnerComparabilityTopicSummary => ({
  canonicalTopicKey: overrides.canonicalTopicKey ?? "OFFICE_WINNER|SEOUL|MAYOR|2026",
  venuesPresent: overrides.venuesPresent ?? ["LIMITLESS", "OPINION"],
  pairSharedNamedOutcomesCount: overrides.pairSharedNamedOutcomesCount ?? 4,
  triSharedNamedOutcomesCount: overrides.triSharedNamedOutcomesCount ?? 0,
  excludedOutcomesCount: overrides.excludedOutcomesCount ?? 3,
  ruleCompatibilityClassification: overrides.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING",
  fragmentationLabel: overrides.fragmentationLabel ?? "FAMILY_REFRESHED_COMPARABLE_PAIR_EXISTS",
  matcherCandidate: overrides.matcherCandidate ?? true,
  sharedNamedCandidates: overrides.sharedNamedCandidates ?? ["chong won oh", "na kyung won", "oh se hoon", "park ju min"],
  excludedOutcomes: overrides.excludedOutcomes ?? [
    { label: "other", reason: "OTHERS_EXCLUDED", venues: ["LIMITLESS"] },
    { label: "ahn cheol soo", reason: "NOT_SHARED", venues: ["LIMITLESS"] }
  ],
  notes: overrides.notes ?? []
});

describe("office winner seoul mayor 2026 matcher", () => {
  it("keeps Seoul pair-only when only LIMITLESS and OPINION are admitted", () => {
    const materialized = buildPoliticsOfficeWinnerSeoulMayor2026MatcherMaterialization({
      normalizedTopics: [
        normalizedRow({
          venue: "LIMITLESS",
          venueMarketId: "limitless-seoul",
          candidateSet: ["chong won oh", "na kyung won", "oh se hoon", "park ju min", "other"]
        }),
        normalizedRow({
          interpretedContractId: "opinion-seoul",
          venue: "OPINION",
          venueMarketId: "493237",
          candidateSet: ["chong won oh", "na kyung won", "oh se hoon", "park ju min"]
        })
      ],
      comparabilitySummary: [topicSummary()]
    });

    expect(materialized.admittedVenues).toEqual(["LIMITLESS", "OPINION"]);
    expect(materialized.pairLanes.map((lane) => lane.venuePair)).toEqual([
      "LIMITLESS|OPINION",
      "LIMITLESS|OPINION",
      "LIMITLESS|OPINION",
      "LIMITLESS|OPINION"
    ]);
    expect(materialized.triLanes).toEqual([]);
    expect(materialized.finalDecision.overallDecision).toBe("OFFICE_WINNER_SEOUL_MAYOR_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW");
    expect(materialized.rejections.some((rejection) => rejection.reason === "VENUE_NOT_PRESENT_FOR_TOPIC" && rejection.venue === "PREDICT")).toBe(true);
  });
});
