import { describe, expect, it } from "vitest";

import { buildPoliticsOfficeWinnerUsPresident2028MatcherMaterialization } from "../../src/matching/politics/politics-office-winner-us-president-2028-matcher.js";
import type {
  PoliticsOfficeWinnerComparabilityTopicSummary,
  PoliticsOfficeWinnerNormalizedTopicRow
} from "../../src/matching/politics/politics-office-winner-family-pass.js";

const normalizedRow = (overrides: Partial<PoliticsOfficeWinnerNormalizedTopicRow>): PoliticsOfficeWinnerNormalizedTopicRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "LIMITLESS",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  title: overrides.title ?? "Presidential Election Winner 2028",
  canonicalFamily: "OFFICE_WINNER",
  canonicalTopicKey: overrides.canonicalTopicKey ?? "OFFICE_WINNER|USA|US_PRESIDENT|2028",
  canonicalSubject: overrides.canonicalSubject ?? "donald trump",
  canonicalJurisdiction: overrides.canonicalJurisdiction ?? "usa",
  canonicalCycle: overrides.canonicalCycle ?? "2028",
  canonicalOffice: overrides.canonicalOffice ?? "president",
  canonicalOfficeLevel: overrides.canonicalOfficeLevel ?? "national",
  canonicalElectionType: overrides.canonicalElectionType ?? null,
  canonicalTemporalBasis: overrides.canonicalTemporalBasis ?? "DATE_BOUND",
  electionRound: overrides.electionRound ?? null,
  officeScope: overrides.officeScope ?? "national",
  jurisdictionScope: overrides.jurisdictionScope ?? "usa",
  candidateSet: overrides.candidateSet ?? ["donald trump", "kamala harris", "other"],
  candidateSetType: overrides.candidateSetType ?? "FIELD",
  dateBounded: overrides.dateBounded ?? true,
  interpretationConfidence: overrides.interpretationConfidence ?? "HIGH",
  interpretationNotes: overrides.interpretationNotes ?? [],
  rejectionReason: overrides.rejectionReason ?? null
});

const topicSummary = (overrides: Partial<PoliticsOfficeWinnerComparabilityTopicSummary> = {}): PoliticsOfficeWinnerComparabilityTopicSummary => ({
  canonicalTopicKey: overrides.canonicalTopicKey ?? "OFFICE_WINNER|USA|US_PRESIDENT|2028",
  venuesPresent: overrides.venuesPresent ?? ["LIMITLESS", "POLYMARKET"],
  pairSharedNamedOutcomesCount: overrides.pairSharedNamedOutcomesCount ?? 2,
  triSharedNamedOutcomesCount: overrides.triSharedNamedOutcomesCount ?? 0,
  excludedOutcomesCount: overrides.excludedOutcomesCount ?? 2,
  ruleCompatibilityClassification: overrides.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING",
  fragmentationLabel: overrides.fragmentationLabel ?? "FAMILY_REFRESHED_COMPARABLE_PAIR_EXISTS",
  matcherCandidate: overrides.matcherCandidate ?? true,
  sharedNamedCandidates: overrides.sharedNamedCandidates ?? ["donald trump", "kamala harris"],
  excludedOutcomes: overrides.excludedOutcomes ?? [
    { label: "other", reason: "OTHERS_EXCLUDED", venues: ["LIMITLESS", "POLYMARKET"] },
    { label: "marco rubio", reason: "NOT_SHARED", venues: ["POLYMARKET"] }
  ],
  notes: overrides.notes ?? []
});

describe("office winner usa president 2028 matcher", () => {
  it("hard-scopes to LIMITLESS|POLYMARKET and materializes only exact shared candidates", () => {
    const materialized = buildPoliticsOfficeWinnerUsPresident2028MatcherMaterialization({
      normalizedTopics: [
        normalizedRow({
          venue: "LIMITLESS",
          venueMarketId: "limitless-2028",
          candidateSet: ["donald trump", "kamala harris", "other"]
        }),
        normalizedRow({
          interpretedContractId: "poly-1",
          venue: "POLYMARKET",
          venueMarketId: "presidential-election-winner-2028",
          title: "Presidential Election Winner 2028",
          candidateSet: ["Donald Trump", "Kamala Harris", "Marco Rubio", "Other"]
        }),
        normalizedRow({
          interpretedContractId: "seoul-opinion",
          venue: "OPINION",
          venueMarketId: "493236",
          canonicalTopicKey: "OFFICE_WINNER|SEOUL|MAYOR|2026",
          title: "2026 Seoul Mayoral Election Winner",
          canonicalSubject: "oh se hoon",
          canonicalJurisdiction: "seoul",
          canonicalCycle: "2026",
          canonicalOffice: "mayor",
          canonicalOfficeLevel: "local",
          officeScope: "local",
          jurisdictionScope: "seoul",
          candidateSet: ["oh se hoon", "park ju min", "other"]
        })
      ],
      comparabilitySummary: [topicSummary()]
    });

    expect(materialized.venuePair).toBe("LIMITLESS|POLYMARKET");
    expect(materialized.matcherLanes.map((lane) => lane.candidateIdentityKey)).toEqual([
      "donald_trump",
      "kamala_harris"
    ]);
    expect(materialized.matcherLanes.every((lane) => lane.routeabilityDecision === "PAIR_REVIEW_REQUIRED")).toBe(true);
    expect(materialized.rejections.some((rejection) => rejection.reason === "OTHERS_EXCLUDED")).toBe(true);
    expect(materialized.rejections.some((rejection) => rejection.reason === "VENUE_NOT_PRESENT_FOR_TOPIC" && rejection.venue === "MYRIAD")).toBe(true);
    expect(materialized.finalDecision.bestPair).toBe("LIMITLESS|POLYMARKET");
    expect(materialized.finalDecision.overallDecision).toBe("OFFICE_WINNER_US_PRESIDENT_2028_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW");
  });
});
