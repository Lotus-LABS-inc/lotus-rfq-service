import { describe, expect, it } from "vitest";

import { classifyCryptoFamily } from "../../src/matching/crypto/crypto-family-classifier.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";

describe("crypto family classifier", () => {
  it("classifies supported BTC families", () => {
    const threshold = classifyCryptoFamily(buildMatchingMarket({
      interpretedContractId: "btc-threshold",
      venue: "LIMITLESS",
      venueMarketId: "lt-btc-threshold",
      category: "CRYPTO",
      title: "BTC above $120k by March 31, 2026?"
    }));
    const ath = classifyCryptoFamily(buildMatchingMarket({
      interpretedContractId: "btc-ath",
      venue: "POLYMARKET",
      venueMarketId: "pm-btc-ath",
      category: "CRYPTO",
      title: "Bitcoin all time high by March 31, 2026?"
    }));
    const sameDay = classifyCryptoFamily(buildMatchingMarket({
      interpretedContractId: "btc-daily",
      venue: "OPINION",
      venueMarketId: "op-btc-daily",
      category: "CRYPTO",
      title: "Bitcoin Up or Down on March 21?(12:00 ET)"
    }));
    const hourly = classifyCryptoFamily(buildMatchingMarket({
      interpretedContractId: "btc-hourly",
      venue: "OPINION",
      venueMarketId: "op-btc-hourly",
      category: "CRYPTO",
      title: "BTC Up or Down - Hourly (Mar 29, 2026 12:00 UTC Close)"
    }));

    expect(threshold.family).toBe("THRESHOLD_BY_DATE");
    expect(ath.family).toBe("ATH_BY_DATE");
    expect(sameDay.family).toBe("SAME_DAY_DIRECTIONAL");
    expect(hourly.family).toBe("GENERIC_DIRECTIONAL");
    expect(sameDay.metadata["normalizedAsset"]).toBe("BTC");
  });

  it("normalizes ETH and SOL into the crypto structural lane", () => {
    const eth = classifyCryptoFamily(buildMatchingMarket({
      interpretedContractId: "eth-threshold",
      venue: "POLYMARKET",
      venueMarketId: "pm-eth-threshold",
      category: "CRYPTO",
      title: "ETH above $4k by March 31, 2026?"
    }));
    const sol = classifyCryptoFamily(buildMatchingMarket({
      interpretedContractId: "sol-ath",
      venue: "OPINION",
      venueMarketId: "op-sol-ath",
      category: "CRYPTO",
      title: "Solana all time high by March 31, 2026?"
    }));

    expect(eth.metadata["normalizedAsset"]).toBe("ETH");
    expect(eth.family).toBe("THRESHOLD_BY_DATE");
    expect(sol.metadata["normalizedAsset"]).toBe("SOL");
    expect(sol.family).toBe("ATH_BY_DATE");
  });

  it("marks structural lane rejection when asset or time boundary is missing", () => {
    const rejected = classifyCryptoFamily(buildMatchingMarket({
      interpretedContractId: "bad-crypto",
      venue: "LIMITLESS",
      venueMarketId: "bad-1",
      category: "CRYPTO",
      title: "Will Bruno Guimarães score or assist vs Sunderland on Mar 22?"
    }));

    expect(rejected.weakStructureLane).toBe(true);
    expect(rejected.ambiguityFlags).toContain("missing_crypto_asset");
  });
});
