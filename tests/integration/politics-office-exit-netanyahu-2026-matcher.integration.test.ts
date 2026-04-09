import { describe, expect, it } from "vitest";

import { buildPoliticsOfficeExitNetanyahu2026MatcherMaterialization } from "../../src/matching/politics/politics-office-exit-netanyahu-2026-matcher.js";
import type {
  PoliticsOfficeExitByDateComparabilityTopicSummary,
  PoliticsOfficeExitByDateNormalizedTopicRow
} from "../../src/matching/politics/politics-office-exit-by-date-family-pass.js";

const normalizedRow = (overrides: Partial<PoliticsOfficeExitByDateNormalizedTopicRow>): PoliticsOfficeExitByDateNormalizedTopicRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "LIMITLESS",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  title: overrides.title ?? "Netanyahu out before 2027",
  canonicalFamily: "OFFICE_EXIT_BY_DATE",
  canonicalTopicKey: overrides.canonicalTopicKey ?? "OFFICE_EXIT_BY_DATE|ISRAEL|PRIME_MINISTER|BENJAMIN_NETANYAHU|2026-12-31",
  canonicalSubjectKey: overrides.canonicalSubjectKey ?? "BENJAMIN_NETANYAHU",
  canonicalJurisdiction: overrides.canonicalJurisdiction ?? "israel",
  canonicalOffice: overrides.canonicalOffice ?? "prime_minister",
  canonicalDeadlineDate: overrides.canonicalDeadlineDate ?? "2026-12-31",
  canonicalRuleMeaning: overrides.canonicalRuleMeaning ?? "OUT_OF_OFFICE_ANY_REASON_BY_DATE",
  interpretationConfidence: overrides.interpretationConfidence ?? "HIGH",
  interpretationNotes: overrides.interpretationNotes ?? [],
  rejectionReason: overrides.rejectionReason ?? null
});

const topicSummary = (overrides: Partial<PoliticsOfficeExitByDateComparabilityTopicSummary> = {}): PoliticsOfficeExitByDateComparabilityTopicSummary => ({
  canonicalTopicKey: overrides.canonicalTopicKey ?? "OFFICE_EXIT_BY_DATE|ISRAEL|PRIME_MINISTER|BENJAMIN_NETANYAHU|2026-12-31",
  venuesPresent: overrides.venuesPresent ?? ["LIMITLESS", "POLYMARKET", "PREDICT"],
  comparablePairCount: overrides.comparablePairCount ?? 3,
  strictTriPresent: overrides.strictTriPresent ?? true,
  strictTriVenueSets: overrides.strictTriVenueSets ?? ["LIMITLESS|POLYMARKET|PREDICT"],
  ruleCompatibilityClassification: overrides.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING",
  fragmentationLabel: overrides.fragmentationLabel ?? "FAMILY_REFRESHED_COMPARABLE_TRI_EXISTS",
  matcherCandidate: overrides.matcherCandidate ?? true,
  notes: overrides.notes ?? []
});

describe("office-exit netanyahu 2026 matcher", () => {
  it("materializes all exact venue pair lanes and the strict tri lane", () => {
    const materialized = buildPoliticsOfficeExitNetanyahu2026MatcherMaterialization({
      normalizedTopics: [
        normalizedRow({ venue: "LIMITLESS", venueMarketId: "limitless-netanyahu" }),
        normalizedRow({ interpretedContractId: "poly-netanyahu", venue: "POLYMARKET", venueMarketId: "netanyahu-out-before-2027" }),
        normalizedRow({ interpretedContractId: "predict-netanyahu", venue: "PREDICT", venueMarketId: "19740" })
      ],
      comparabilitySummary: [topicSummary()]
    });

    expect(materialized.admittedVenues).toEqual(["LIMITLESS", "POLYMARKET", "PREDICT"]);
    expect(materialized.pairLanes.map((lane) => lane.venuePair)).toEqual([
      "LIMITLESS|POLYMARKET",
      "LIMITLESS|PREDICT",
      "POLYMARKET|PREDICT"
    ]);
    expect(materialized.triLanes).toHaveLength(1);
    expect(materialized.finalDecision.bestPair).toBe("LIMITLESS|POLYMARKET");
    expect(materialized.finalDecision.bestTriIfAny).toBe("LIMITLESS|POLYMARKET|PREDICT");
    expect(materialized.finalDecision.overallDecision).toBe("OFFICE_EXIT_NETANYAHU_2026_TRI_REVIEW_REQUIRED");
    expect(materialized.rejections.some((rejection) => rejection.reason === "VENUE_NOT_PRESENT_FOR_TOPIC" && rejection.venue === "OPINION")).toBe(true);
    expect(materialized.rejections.some((rejection) => rejection.reason === "VENUE_NOT_PRESENT_FOR_TOPIC" && rejection.venue === "MYRIAD")).toBe(true);
  });
});
