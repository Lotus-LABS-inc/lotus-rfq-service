import { describe, expect, it } from "vitest";

import { buildCryptoSolAthByDateFamilyArtifacts } from "../../src/matching/crypto/crypto-sol-ath-by-date-family-pass.js";

describe("crypto sol ath by date family pass", () => {
  it("builds shared matcher candidates for SOL", () => {
    const artifacts = buildCryptoSolAthByDateFamilyArtifacts([
      { interpretedContractId: "pm-mar", venue: "POLYMARKET", venueMarketId: "solana-all-time-high-by-march-31-2026", sourceUrl: "https://example.com", title: "Solana all time high by March 31, 2026?", rulesText: "This market resolves to Yes if Solana makes a new all-time high at any point on or before March 31, 2026. Otherwise it resolves to No.", exactDateLabel: "March 31, 2026" },
      { interpretedContractId: "pm-jun", venue: "POLYMARKET", venueMarketId: "solana-all-time-high-by-june-30-2026", sourceUrl: "https://example.com", title: "Solana all time high by June 30, 2026?", rulesText: "This market resolves to Yes if Solana makes a new all-time high at any point on or before June 30, 2026. Otherwise it resolves to No.", exactDateLabel: "June 30, 2026" },
      { interpretedContractId: "pm-sep", venue: "POLYMARKET", venueMarketId: "solana-all-time-high-by-september-30-2026", sourceUrl: "https://example.com", title: "Solana all time high by September 30, 2026?", rulesText: "This market resolves to Yes if Solana makes a new all-time high at any point on or before September 30, 2026. Otherwise it resolves to No.", exactDateLabel: "September 30, 2026" },
      { interpretedContractId: "pm-dec", venue: "POLYMARKET", venueMarketId: "solana-all-time-high-by-december-31-2026", sourceUrl: "https://example.com", title: "Solana all time high by December 31, 2026?", rulesText: "This market resolves to Yes if Solana makes a new all-time high at any point on or before December 31, 2026. Otherwise it resolves to No.", exactDateLabel: "December 31, 2026" },
      { interpretedContractId: "ll-jun", venue: "LIMITLESS", venueMarketId: "june-30-2026-sol", sourceUrl: "https://example.com", title: "Solana all time high by June 30, 2026?", rulesText: "This market resolves to Yes if Solana makes a new all-time high at any point on or before June 30, 2026. Otherwise it resolves to No.", exactDateLabel: "June 30, 2026" },
      { interpretedContractId: "ll-sep", venue: "LIMITLESS", venueMarketId: "september-30-2026-sol", sourceUrl: "https://example.com", title: "Solana all time high by September 30, 2026?", rulesText: "This market resolves to Yes if Solana makes a new all-time high at any point on or before September 30, 2026. Otherwise it resolves to No.", exactDateLabel: "September 30, 2026" },
      { interpretedContractId: "ll-dec", venue: "LIMITLESS", venueMarketId: "december-31-2026-sol", sourceUrl: "https://example.com", title: "Solana all time high by December 31, 2026?", rulesText: "This market resolves to Yes if Solana makes a new all-time high at any point on or before December 31, 2026. Otherwise it resolves to No.", exactDateLabel: "December 31, 2026" }
    ]);

    expect(artifacts.finalDecision.sharedCandidateTopicKeys).toEqual([
      "CRYPTO|ATH_BY_DATE|SOL|2026-06-30",
      "CRYPTO|ATH_BY_DATE|SOL|2026-09-30",
      "CRYPTO|ATH_BY_DATE|SOL|2026-12-31"
    ]);
  });
});
