import { describe, expect, it } from "vitest";

import { prefilterCandidatePair } from "../../src/matching/candidate-prefilter.js";
import { classifyContractFamily } from "../../src/matching/contract-family-classifier.js";
import { buildStructuralFingerprint } from "../../src/matching/structural-fingerprint.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";

describe("candidate prefilter", () => {
  it("rejects crypto pairs with asset mismatch before classification", () => {
    const left = buildMatchingMarket({
      interpretedContractId: "ic-btc",
      venue: "POLYMARKET",
      venueMarketId: "pm-btc",
      category: "CRYPTO",
      title: "Will Bitcoin be above $120k by March 31, 2026?"
    });
    const right = buildMatchingMarket({
      interpretedContractId: "ic-eth",
      venue: "LIMITLESS",
      venueMarketId: "lt-eth",
      category: "CRYPTO",
      title: "Will Ethereum be above $120k by March 31, 2026?"
    });

    const leftFamily = classifyContractFamily(left);
    const rightFamily = classifyContractFamily(right);
    const result = prefilterCandidatePair({
      leftMarket: left,
      rightMarket: right,
      leftFamily,
      rightFamily,
      leftFingerprint: buildStructuralFingerprint(left, leftFamily),
      rightFingerprint: buildStructuralFingerprint(right, rightFamily)
    });

    expect(result.accepted).toBe(false);
    expect(result.reasons).toContain("ASSET_MISMATCH");
  });
});
