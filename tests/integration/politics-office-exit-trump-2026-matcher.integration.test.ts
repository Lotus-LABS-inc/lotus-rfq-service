import { describe, expect, it } from "vitest";

import { buildPoliticsOfficeExitTrump2026MatcherMaterialization } from "../../src/matching/politics/politics-office-exit-trump-2026-matcher.js";
import type {
  PoliticsOfficeExitByDateComparabilityTopicSummary,
  PoliticsOfficeExitByDateNormalizedTopicRow
} from "../../src/matching/politics/politics-office-exit-by-date-family-pass.js";

const normalizedRow = (overrides: Partial<PoliticsOfficeExitByDateNormalizedTopicRow>): PoliticsOfficeExitByDateNormalizedTopicRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "LIMITLESS",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  title: overrides.title ?? "Trump out before 2027",
  canonicalFamily: "OFFICE_EXIT_BY_DATE",
  canonicalTopicKey: overrides.canonicalTopicKey ?? "OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31",
  canonicalSubjectKey: overrides.canonicalSubjectKey ?? "DONALD_TRUMP",
  canonicalJurisdiction: overrides.canonicalJurisdiction ?? "usa",
  canonicalOffice: overrides.canonicalOffice ?? "us_president",
  canonicalDeadlineDate: overrides.canonicalDeadlineDate ?? "2026-12-31",
  canonicalRuleMeaning: overrides.canonicalRuleMeaning ?? "OUT_OF_OFFICE_ANY_REASON_BY_DATE",
  interpretationConfidence: overrides.interpretationConfidence ?? "HIGH",
  interpretationNotes: overrides.interpretationNotes ?? [],
  rejectionReason: overrides.rejectionReason ?? null
});

const topicSummary = (overrides: Partial<PoliticsOfficeExitByDateComparabilityTopicSummary> = {}): PoliticsOfficeExitByDateComparabilityTopicSummary => ({
  canonicalTopicKey: overrides.canonicalTopicKey ?? "OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31",
  venuesPresent: overrides.venuesPresent ?? ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"],
  comparablePairCount: overrides.comparablePairCount ?? 6,
  strictTriPresent: overrides.strictTriPresent ?? true,
  strictTriVenueSets: overrides.strictTriVenueSets ?? ["LIMITLESS|OPINION|POLYMARKET"],
  ruleCompatibilityClassification: overrides.ruleCompatibilityClassification ?? "EXACT_RULE_COMPATIBLE",
  fragmentationLabel: overrides.fragmentationLabel ?? "FAMILY_REFRESHED_COMPARABLE_TRI_EXISTS",
  matcherCandidate: overrides.matcherCandidate ?? true,
  notes: overrides.notes ?? []
});

describe("office-exit Trump 2026 matcher", () => {
  it("materializes all admitted pair lanes and the strict tri lane", () => {
    const materialized = buildPoliticsOfficeExitTrump2026MatcherMaterialization({
      normalizedTopics: [
        normalizedRow({ venue: "LIMITLESS", venueMarketId: "limitless-trump" }),
        normalizedRow({ interpretedContractId: "opinion-trump", venue: "OPINION", venueMarketId: "trump-out-as-president-before-2027" }),
        normalizedRow({ interpretedContractId: "poly-trump", venue: "POLYMARKET", venueMarketId: "trump-out-as-president-before-2027" }),
        normalizedRow({ interpretedContractId: "predict-trump", venue: "PREDICT", venueMarketId: "30939" })
      ],
      comparabilitySummary: [topicSummary()]
    });

    expect(materialized.admittedVenues).toEqual(["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"]);
    expect(materialized.pairLanes.map((lane) => lane.venuePair)).toEqual([
      "LIMITLESS|OPINION",
      "LIMITLESS|POLYMARKET",
      "LIMITLESS|PREDICT",
      "OPINION|POLYMARKET",
      "OPINION|PREDICT",
      "POLYMARKET|PREDICT"
    ]);
    expect(materialized.triLanes.map((lane) => lane.canonicalTriVenueSet)).toEqual([
      "LIMITLESS|OPINION|POLYMARKET"
    ]);
    expect(materialized.finalDecision.bestPair).toBe("LIMITLESS|POLYMARKET");
    expect(materialized.finalDecision.bestTriIfAny).toBe("LIMITLESS|OPINION|POLYMARKET");
    expect(materialized.finalDecision.overallDecision).toBe("OFFICE_EXIT_TRUMP_2026_TRI_READY_BUT_PAIR_FIRST");
    expect(materialized.finalDecision.ruleStatus).toBe("EXACT_RULE_COMPATIBLE");
    expect(materialized.rejections.some((rejection) => rejection.reason === "VENUE_NOT_PRESENT_FOR_TOPIC" && rejection.venue === "MYRIAD")).toBe(true);
  });
});
