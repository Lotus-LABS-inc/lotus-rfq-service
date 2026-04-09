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
  venuesPresent: overrides.venuesPresent ?? ["LIMITLESS", "POLYMARKET"],
  comparablePairCount: overrides.comparablePairCount ?? 1,
  strictTriPresent: overrides.strictTriPresent ?? false,
  strictTriVenueSets: overrides.strictTriVenueSets ?? [],
  ruleCompatibilityClassification: overrides.ruleCompatibilityClassification ?? "UNKNOWN_RULE_MEANING",
  fragmentationLabel: overrides.fragmentationLabel ?? "FAMILY_REFRESHED_COMPARABLE_PAIR_EXISTS",
  matcherCandidate: overrides.matcherCandidate ?? true,
  notes: overrides.notes ?? []
});

describe("office-exit netanyahu 2026 tri policy", () => {
  it("fails closed on missing tri edge or unknown rule meaning", () => {
    const materialized = buildPoliticsOfficeExitNetanyahu2026MatcherMaterialization({
      normalizedTopics: [
        normalizedRow({ venue: "LIMITLESS", venueMarketId: "limitless-netanyahu" }),
        normalizedRow({ interpretedContractId: "poly-netanyahu", venue: "POLYMARKET", venueMarketId: "netanyahu-out-before-2027" })
      ],
      comparabilitySummary: [topicSummary()]
    });

    expect(materialized.triLanes).toHaveLength(0);
    expect(materialized.finalDecision.triMatcherReady).toBe(false);
    expect(materialized.finalDecision.overallDecision).toBe("OFFICE_EXIT_NETANYAHU_2026_MATCHER_NOT_READY");
    expect(materialized.rejections.some((rejection) => rejection.reason === "PAIR_EDGE_MISSING" && rejection.venuePair === "LIMITLESS|PREDICT")).toBe(true);
    expect(materialized.rejections.some((rejection) => rejection.reason === "TRI_EDGE_MISSING")).toBe(true);
  });
});
