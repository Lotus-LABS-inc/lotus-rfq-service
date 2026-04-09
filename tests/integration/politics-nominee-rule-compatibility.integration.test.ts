import { describe, expect, it } from "vitest";

import { buildNominee2028RuleCompatibility } from "../../src/matching/politics/politics-nominee-2028-shared-core.js";
import type { PoliticsNomineeSharedCoreMarketRow } from "../../src/matching/politics/politics-types.js";

const market = (
  venue: PoliticsNomineeSharedCoreMarketRow["venue"],
  resolutionMeaning: PoliticsNomineeSharedCoreMarketRow["canonicalResolutionMeaning"],
  title: string
): PoliticsNomineeSharedCoreMarketRow => ({
  interpretedContractId: `${venue}-${title}`,
  venue,
  venueMarketId: `${venue}-${title}`,
  title,
  topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
  canonicalFamily: "NOMINEE_WINNER",
  canonicalOffice: "US_PRESIDENT",
  canonicalJurisdiction: "USA",
  canonicalCycle: "2028",
  canonicalParty: "REPUBLICAN",
  canonicalTopicLabel: "Republican Presidential Nominee 2028",
  canonicalResolutionMeaning: resolutionMeaning,
  canonicalResolutionSourceType: "TITLE_AND_RULES",
  interpretationConfidence: "HIGH",
  interpretationNotes: [],
  ruleCompatibilityClass: "EXACT_RULE_COMPATIBLE",
  rejectionReason: null,
  candidateMenuType: "FIELD_MULTI_CANDIDATE",
  hasOthersBucket: false,
  fullMenuKnown: true,
  fullMenuComparable: true,
  partialMenuComparable: false,
  reviewRequired: false,
  materiallyIncompatible: false
});

describe("politics nominee rule compatibility", () => {
  it("classifies nominee rewording as semantically compatible", () => {
    const result = buildNominee2028RuleCompatibility([
      market("POLYMARKET", "PRESIDENTIAL_NOMINEE_WINNER", "Who will win the Republican presidential nomination in 2028?"),
      market("OPINION", "PRESIDENTIAL_NOMINEE_WINNER", "Who will be the Republican nominee for U.S. president in 2028 and accept the nomination?")
    ]);

    expect(result.markets.every((entry) =>
      entry.ruleCompatibilityClass === "SEMANTICALLY_COMPATIBLE_REWORDING"
      || entry.ruleCompatibilityClass === "EXACT_RULE_COMPATIBLE"
    )).toBe(true);
  });

  it("flags primary-winner variance for review instead of auto-rejecting", () => {
    const result = buildNominee2028RuleCompatibility([
      market("POLYMARKET", "PRESIDENTIAL_NOMINEE_WINNER", "Who will be the Republican nominee for president in 2028?"),
      market("LIMITLESS", "PRIMARY_WINNER", "Who will win the 2028 Republican presidential primary?")
    ]);

    expect(result.markets.some((entry) => entry.ruleCompatibilityClass === "REVIEW_REQUIRED_RULE_VARIANCE")).toBe(true);
  });

  it("marks materially incompatible meanings as incompatible", () => {
    const result = buildNominee2028RuleCompatibility([
      market("POLYMARKET", "PRESIDENTIAL_NOMINEE_WINNER", "Who will be the Democratic nominee for president in 2028?"),
      market("OPINION", "INCOMPATIBLE_POLITICAL_MARKET", "Who will win the 2028 U.S. presidential election?")
    ]);

    expect(result.markets.every((entry) => entry.ruleCompatibilityClass === "RULES_MATERIALLY_INCOMPATIBLE")).toBe(true);
  });

  it("fails closed when rule meaning is unknown", () => {
    const result = buildNominee2028RuleCompatibility([
      market("POLYMARKET", null, "Democratic 2028 market")
    ]);

    expect(result.markets[0]?.ruleCompatibilityClass).toBe("UNKNOWN_RULE_MEANING");
  });
});
