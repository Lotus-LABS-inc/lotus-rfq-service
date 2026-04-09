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
  venuesPresent: overrides.venuesPresent ?? ["LIMITLESS", "POLYMARKET", "PREDICT"],
  comparablePairCount: overrides.comparablePairCount ?? 3,
  strictTriPresent: overrides.strictTriPresent ?? false,
  strictTriVenueSets: overrides.strictTriVenueSets ?? [],
  ruleCompatibilityClassification: overrides.ruleCompatibilityClassification ?? "EXACT_RULE_COMPATIBLE",
  fragmentationLabel: overrides.fragmentationLabel ?? "FAMILY_REFRESHED_COMPARABLE_PAIR_EXISTS",
  matcherCandidate: overrides.matcherCandidate ?? true,
  notes: overrides.notes ?? []
});

describe("office-exit Trump 2026 tri policy", () => {
  it("fails closed on missing strict tri venue even when other pair lanes exist", () => {
    const materialized = buildPoliticsOfficeExitTrump2026MatcherMaterialization({
      normalizedTopics: [
        normalizedRow({ venue: "LIMITLESS", venueMarketId: "limitless-trump" }),
        normalizedRow({ interpretedContractId: "poly-trump", venue: "POLYMARKET", venueMarketId: "trump-out-as-president-before-2027" }),
        normalizedRow({ interpretedContractId: "predict-trump", venue: "PREDICT", venueMarketId: "30939" })
      ],
      comparabilitySummary: [topicSummary()]
    });

    expect(materialized.triLanes).toHaveLength(0);
    expect(materialized.finalDecision.triMatcherReady).toBe(false);
    expect(materialized.finalDecision.overallDecision).toBe("OFFICE_EXIT_TRUMP_2026_PAIR_MATCHER_READY");
    expect(materialized.rejections.some((rejection) => rejection.reason === "PAIR_EDGE_MISSING" && rejection.venuePair === "LIMITLESS|OPINION")).toBe(true);
    expect(materialized.rejections.some((rejection) => rejection.reason === "TRI_EDGE_MISSING")).toBe(true);
  });
});
