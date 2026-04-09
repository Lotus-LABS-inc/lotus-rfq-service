import { describe, expect, it } from "vitest";

import { classifyCryptoFamily } from "../../src/matching/crypto/crypto-family-classifier.js";
import { buildCryptoStructuralFingerprint } from "../../src/matching/crypto/crypto-structural-fingerprint.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";

describe("crypto structural fingerprint", () => {
  it("normalizes BTC threshold, date, and cutoff fields", () => {
    const market = buildMatchingMarket({
      interpretedContractId: "btc-threshold",
      venue: "LIMITLESS",
      venueMarketId: "lt-1",
      category: "CRYPTO",
      title: "BTC above $69.82k on Mar 19, 20:00 UTC?"
    });
    const fingerprint = buildCryptoStructuralFingerprint(market, classifyCryptoFamily(market));

    expect(fingerprint.fingerprint.asset).toBe("BTC");
    expect(fingerprint.fingerprint.threshold).toBe("69820");
    expect(fingerprint.fingerprint.comparator).toBe("ABOVE");
    expect(fingerprint.fingerprint.dateKey).toBe("2026-03-19");
    expect(fingerprint.fingerprint.timezoneNormalizedCutoffKey).toBe("2026-03-19T20:00:00.000Z");
  });

  it("normalizes ET cutoff into UTC for daily directional BTC markets", () => {
    const market = buildMatchingMarket({
      interpretedContractId: "btc-daily",
      venue: "OPINION",
      venueMarketId: "op-daily",
      category: "CRYPTO",
      title: "Bitcoin Up or Down on March 21?(12:00 ET)"
    });
    const fingerprint = buildCryptoStructuralFingerprint(market, classifyCryptoFamily(market));

    expect(fingerprint.fingerprint.family).toBe("SAME_DAY_DIRECTIONAL");
    expect(fingerprint.fingerprint.timezoneNormalizedCutoffKey).toBe("2026-03-21T16:00:00.000Z");
    expect(fingerprint.fingerprint.binaryStructure).toBe("YES_NO_BINARY");
  });
});

