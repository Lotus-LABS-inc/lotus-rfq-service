import { describe, expect, it } from "vitest";

import { classifyCryptoFamily } from "../../src/matching/crypto/crypto-family-classifier.js";
import { runCryptoStructuralMatcher } from "../../src/matching/crypto/crypto-structural-matcher.js";
import { buildCryptoStructuralFingerprint } from "../../src/matching/crypto/crypto-structural-fingerprint.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";

describe("crypto structural matcher", () => {
  it("auto-resolves exact BTC ATH pairs", () => {
    const left = buildMatchingMarket({
      interpretedContractId: "btc-ath-left",
      venue: "POLYMARKET",
      venueMarketId: "pm-ath",
      category: "CRYPTO",
      title: "Bitcoin all time high by March 31, 2026?"
    });
    const right = buildMatchingMarket({
      interpretedContractId: "btc-ath-right",
      venue: "LIMITLESS",
      venueMarketId: "lt-ath",
      category: "CRYPTO",
      title: "Bitcoin all time high by March 31?"
    });

    const result = runCryptoStructuralMatcher({
      leftFingerprint: buildCryptoStructuralFingerprint(left, classifyCryptoFamily(left)),
      rightFingerprint: buildCryptoStructuralFingerprint(right, classifyCryptoFamily(right))
    });

    expect(result.outcome).toBe("EXACT");
    expect(result.matchedDimensions).toContain("dateKey");
  });

  it("rejects wrong-date BTC daily directionals as exact-safe", () => {
    const left = buildMatchingMarket({
      interpretedContractId: "btc-daily-left",
      venue: "POLYMARKET",
      venueMarketId: "pm-daily",
      category: "CRYPTO",
      title: "Bitcoin Up or Down on March 21?"
    });
    const right = buildMatchingMarket({
      interpretedContractId: "btc-daily-right",
      venue: "OPINION",
      venueMarketId: "op-daily",
      category: "CRYPTO",
      title: "Bitcoin Up or Down on March 22?(12:00 ET)"
    });

    const result = runCryptoStructuralMatcher({
      leftFingerprint: buildCryptoStructuralFingerprint(left, classifyCryptoFamily(left)),
      rightFingerprint: buildCryptoStructuralFingerprint(right, classifyCryptoFamily(right))
    });

    expect(result.outcome).toBe("REJECTED");
    expect(result.mismatchedDimensions).toContain("dateKey");
  });
});

