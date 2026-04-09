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
  candidateSet: overrides.candidateSet ?? ["oh se hoon", "na kyung won", "park ju min"],
  candidateSetType: overrides.candidateSetType ?? "FIELD",
  dateBounded: overrides.dateBounded ?? true,
  interpretationConfidence: overrides.interpretationConfidence ?? "HIGH",
  interpretationNotes: overrides.interpretationNotes ?? [],
  rejectionReason: overrides.rejectionReason ?? null
});

const topicSummary = (overrides: Partial<PoliticsOfficeWinnerComparabilityTopicSummary> = {}): PoliticsOfficeWinnerComparabilityTopicSummary => ({
  canonicalTopicKey: overrides.canonicalTopicKey ?? "OFFICE_WINNER|SEOUL|MAYOR|2026",
  venuesPresent: overrides.venuesPresent ?? ["LIMITLESS", "OPINION", "POLYMARKET"],
  pairSharedNamedOutcomesCount: overrides.pairSharedNamedOutcomesCount ?? 3,
  triSharedNamedOutcomesCount: overrides.triSharedNamedOutcomesCount ?? 2,
  excludedOutcomesCount: overrides.excludedOutcomesCount ?? 2,
  ruleCompatibilityClassification: overrides.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING",
  fragmentationLabel: overrides.fragmentationLabel ?? "FAMILY_REFRESHED_COMPARABLE_TRI_EXISTS",
  matcherCandidate: overrides.matcherCandidate ?? true,
  sharedNamedCandidates: overrides.sharedNamedCandidates ?? ["na kyung won", "oh se hoon", "park ju min"],
  excludedOutcomes: overrides.excludedOutcomes ?? [
    { label: "other", reason: "OTHERS_EXCLUDED", venues: ["LIMITLESS"] },
    { label: "chong won oh", reason: "NOT_SHARED", venues: ["LIMITLESS", "OPINION"] }
  ],
  notes: overrides.notes ?? []
});

describe("office winner seoul mayor 2026 tri", () => {
  it("enforces strict 3-venue intersection and review-gates semantic-compatible tri", () => {
    const materialized = buildPoliticsOfficeWinnerSeoulMayor2026MatcherMaterialization({
      normalizedTopics: [
        normalizedRow({
          venue: "LIMITLESS",
          venueMarketId: "limitless-seoul",
          candidateSet: ["na kyung won", "oh se hoon", "park ju min", "chong won oh", "other"]
        }),
        normalizedRow({
          interpretedContractId: "opinion-seoul",
          venue: "OPINION",
          venueMarketId: "493237",
          candidateSet: ["na kyung won", "oh se hoon", "park ju min", "chong won oh"]
        }),
        normalizedRow({
          interpretedContractId: "poly-seoul",
          venue: "POLYMARKET",
          venueMarketId: "2026-seoul-mayoral-election-winner",
          candidateSet: ["na kyung won", "oh se hoon", "park ju min"]
        })
      ],
      comparabilitySummary: [topicSummary()]
    });

    expect(materialized.admittedVenues).toEqual(["LIMITLESS", "OPINION", "POLYMARKET"]);
    expect(materialized.triLanes.map((lane) => lane.candidateIdentityKey)).toEqual([
      "na_kyung_won",
      "oh_se_hoon",
      "park_ju_min"
    ]);
    expect(materialized.triLanes.every((lane) => lane.routeabilityDecision === "TRI_REVIEW_REQUIRED")).toBe(true);
    expect(materialized.finalDecision.overallDecision).toBe("OFFICE_WINNER_SEOUL_MAYOR_2026_TRI_REVIEW_REQUIRED");
  });
});
