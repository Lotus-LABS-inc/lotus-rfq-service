import { describe, expect, it } from "vitest";

import { classifyContractFamily } from "../../src/matching/contract-family-classifier.js";
import { OfflineHeuristicPairClassifier } from "../../src/matching/pair-classifier.js";
import { buildStructuralFingerprint } from "../../src/matching/structural-fingerprint.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";

describe("pair classifier", () => {
  it("labels unresolved but highly aligned pairs as exact or equivalent", () => {
    const left = buildMatchingMarket({
      interpretedContractId: "ic-op-1",
      venue: "POLYMARKET",
      venueMarketId: "pm-op-1",
      category: "SPORTS",
      title: "Lakers vs Celtics winner on March 31, 2026?"
    });
    const right = buildMatchingMarket({
      interpretedContractId: "ic-op-2",
      venue: "OPINION",
      venueMarketId: "op-1",
      category: "SPORTS",
      title: "Who wins Lakers vs Celtics on March 31, 2026?"
    });

    const classifier = new OfflineHeuristicPairClassifier();
    const leftFamily = classifyContractFamily(left);
    const rightFamily = classifyContractFamily(right);
    const result = classifier.classify({
      leftMarket: left,
      rightMarket: right,
      leftFamily,
      rightFamily,
      leftFingerprint: buildStructuralFingerprint(left, leftFamily),
      rightFingerprint: buildStructuralFingerprint(right, rightFamily)
    });

    expect(["EXACT", "EQUIVALENT"]).toContain(result.finalLabel);
    expect(result.policyRecommendation).not.toBe("REJECT");
  });
});
