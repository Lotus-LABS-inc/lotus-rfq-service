import { describe, expect, it } from "vitest";

import { classifyCryptoPair } from "../../src/matching/crypto/crypto-pair-classifier.js";
import { classifyCryptoFamily } from "../../src/matching/crypto/crypto-family-classifier.js";
import { buildCryptoStructuralFingerprint } from "../../src/matching/crypto/crypto-structural-fingerprint.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";

describe("crypto pair classifier", () => {
  it("routes unresolved but plausible BTC threshold pairs to equivalent/review", () => {
    const left = buildMatchingMarket({
      interpretedContractId: "btc-threshold-left",
      venue: "POLYMARKET",
      venueMarketId: "pm-threshold",
      category: "CRYPTO",
      title: "Will Bitcoin be above $120k by March 31, 2026?"
    });
    const right = buildMatchingMarket({
      interpretedContractId: "btc-threshold-right",
      venue: "LIMITLESS",
      venueMarketId: "lt-threshold",
      category: "CRYPTO",
      title: "BTC above $121k by March 31, 2026?"
    });

    const result = classifyCryptoPair({
      leftFingerprint: buildCryptoStructuralFingerprint(left, classifyCryptoFamily(left)),
      rightFingerprint: buildCryptoStructuralFingerprint(right, classifyCryptoFamily(right))
    });

    expect(result.finalLabel).toBe("EQUIVALENT");
    expect(result.reviewRequired).toBe(true);
    expect(result.policyRecommendation).toBe("REVIEW");
  });
});

