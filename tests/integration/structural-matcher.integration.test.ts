import { describe, expect, it } from "vitest";

import { classifyContractFamily } from "../../src/matching/contract-family-classifier.js";
import { runStructuralMatcher } from "../../src/matching/structural-matcher.js";
import { buildStructuralFingerprint } from "../../src/matching/structural-fingerprint.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";

describe("structural matcher", () => {
  it("auto-resolves exact crypto threshold pairs", () => {
    const left = buildMatchingMarket({
      interpretedContractId: "ic-left",
      venue: "POLYMARKET",
      venueMarketId: "pm-1",
      category: "CRYPTO",
      title: "Will Bitcoin be above $120k by March 31, 2026?",
      rulesText: "Resolves YES if BTC trades above $120k by March 31, 2026."
    });
    const right = buildMatchingMarket({
      interpretedContractId: "ic-right",
      venue: "LIMITLESS",
      venueMarketId: "lt-1",
      category: "CRYPTO",
      title: "Bitcoin above $120k by March 31, 2026?",
      rulesText: "Resolves to YES if Bitcoin trades above $120k by March 31, 2026."
    });

    const leftFamily = classifyContractFamily(left);
    const rightFamily = classifyContractFamily(right);
    const result = runStructuralMatcher({
      leftMarket: left,
      rightMarket: right,
      leftFamily,
      rightFamily,
      leftFingerprint: buildStructuralFingerprint(left, leftFamily),
      rightFingerprint: buildStructuralFingerprint(right, rightFamily)
    });

    expect(result.outcome).toBe("EXACT");
    expect(result.matchedDimensions).toContain("threshold");
    expect(result.matchedDimensions).toContain("date");
  });
});
