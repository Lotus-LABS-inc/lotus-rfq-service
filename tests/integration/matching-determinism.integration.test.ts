import { describe, expect, it } from "vitest";

import { classifyContractFamily } from "../../src/matching/contract-family-classifier.js";
import { OfflineHeuristicPairClassifier } from "../../src/matching/pair-classifier.js";
import { buildStructuralFingerprint } from "../../src/matching/structural-fingerprint.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";

describe("matching determinism", () => {
  it("produces stable family, fingerprint, and classifier outputs for identical inputs", () => {
    const left = buildMatchingMarket({
      interpretedContractId: "ic-1",
      venue: "POLYMARKET",
      venueMarketId: "pm-1",
      category: "CRYPTO",
      title: "Will Bitcoin be above $120k by March 31, 2026?"
    });
    const right = buildMatchingMarket({
      interpretedContractId: "ic-2",
      venue: "LIMITLESS",
      venueMarketId: "lt-1",
      category: "CRYPTO",
      title: "Bitcoin above $120k by March 31, 2026?"
    });

    const classifier = new OfflineHeuristicPairClassifier();
    const firstLeftFamily = classifyContractFamily(left);
    const firstRightFamily = classifyContractFamily(right);
    const firstLeftFingerprint = buildStructuralFingerprint(left, firstLeftFamily);
    const firstRightFingerprint = buildStructuralFingerprint(right, firstRightFamily);
    const firstResult = classifier.classify({
      leftMarket: left,
      rightMarket: right,
      leftFamily: firstLeftFamily,
      rightFamily: firstRightFamily,
      leftFingerprint: firstLeftFingerprint,
      rightFingerprint: firstRightFingerprint
    });

    const secondLeftFamily = classifyContractFamily(left);
    const secondRightFamily = classifyContractFamily(right);
    const secondLeftFingerprint = buildStructuralFingerprint(left, secondLeftFamily);
    const secondRightFingerprint = buildStructuralFingerprint(right, secondRightFamily);
    const secondResult = classifier.classify({
      leftMarket: left,
      rightMarket: right,
      leftFamily: secondLeftFamily,
      rightFamily: secondRightFamily,
      leftFingerprint: secondLeftFingerprint,
      rightFingerprint: secondRightFingerprint
    });

    expect(firstLeftFamily).toEqual(secondLeftFamily);
    expect(firstRightFamily).toEqual(secondRightFamily);
    expect(firstLeftFingerprint).toEqual(secondLeftFingerprint);
    expect(firstRightFingerprint).toEqual(secondRightFingerprint);
    expect(firstResult).toEqual(secondResult);
  });
});
