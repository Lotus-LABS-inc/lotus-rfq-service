import { describe, expect, it } from "vitest";

import { prefilterCryptoCandidatePair } from "../../src/matching/crypto/crypto-candidate-prefilter.js";
import { classifyCryptoFamily } from "../../src/matching/crypto/crypto-family-classifier.js";
import { buildCryptoStructuralFingerprint } from "../../src/matching/crypto/crypto-structural-fingerprint.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";

describe("crypto candidate prefilter", () => {
  it("rejects cross-family BTC pairs before classification", () => {
    const ath = buildMatchingMarket({
      interpretedContractId: "btc-ath",
      venue: "POLYMARKET",
      venueMarketId: "pm-ath",
      category: "CRYPTO",
      title: "Bitcoin all time high by March 31, 2026?"
    });
    const sameDay = buildMatchingMarket({
      interpretedContractId: "btc-daily",
      venue: "OPINION",
      venueMarketId: "op-daily",
      category: "CRYPTO",
      title: "Bitcoin Up or Down on March 31?(12:00 ET)"
    });

    const result = prefilterCryptoCandidatePair({
      leftFingerprint: buildCryptoStructuralFingerprint(ath, classifyCryptoFamily(ath)),
      rightFingerprint: buildCryptoStructuralFingerprint(sameDay, classifyCryptoFamily(sameDay))
    });

    expect(result.accepted).toBe(false);
    expect(result.reasons).toContain("FAMILY_MISMATCH");
  });

  it("rejects daily versus hourly directional markets", () => {
    const daily = buildMatchingMarket({
      interpretedContractId: "btc-daily",
      venue: "POLYMARKET",
      venueMarketId: "pm-daily",
      category: "CRYPTO",
      title: "Bitcoin Up or Down on March 29?"
    });
    const hourly = buildMatchingMarket({
      interpretedContractId: "btc-hourly",
      venue: "OPINION",
      venueMarketId: "op-hourly",
      category: "CRYPTO",
      title: "BTC Up or Down - Hourly (Mar 29, 2026 12:00 UTC Close)"
    });

    const result = prefilterCryptoCandidatePair({
      leftFingerprint: buildCryptoStructuralFingerprint(daily, classifyCryptoFamily(daily)),
      rightFingerprint: buildCryptoStructuralFingerprint(hourly, classifyCryptoFamily(hourly))
    });

    expect(result.accepted).toBe(false);
    expect(result.reasons).toContain("FAMILY_MISMATCH");
  });
});

