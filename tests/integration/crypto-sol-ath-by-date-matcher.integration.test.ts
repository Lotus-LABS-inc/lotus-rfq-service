import { describe, expect, it } from "vitest";

import { buildCryptoSolAthByDateMatcherMaterialization } from "../../src/matching/crypto/crypto-sol-ath-by-date-matcher.js";

describe("crypto sol ath by date matcher", () => {
  it("keeps pair-shared SOL buckets", () => {
    const materialized = buildCryptoSolAthByDateMatcherMaterialization({
      normalizedTopics: [
        { interpretedContractId: "pm-mar", venue: "POLYMARKET", venueMarketId: "solana-all-time-high-by-march-31-2026", title: "Solana all time high by March 31, 2026?", canonicalFamily: "ATH_BY_DATE", canonicalTopicKey: "CRYPTO|ATH_BY_DATE|SOL|2026-03-31", canonicalAsset: "SOL", canonicalDateKey: "2026-03-31", interpretationNotes: [], rejectionReason: null },
        { interpretedContractId: "pm-jun", venue: "POLYMARKET", venueMarketId: "solana-all-time-high-by-june-30-2026", title: "Solana all time high by June 30, 2026?", canonicalFamily: "ATH_BY_DATE", canonicalTopicKey: "CRYPTO|ATH_BY_DATE|SOL|2026-06-30", canonicalAsset: "SOL", canonicalDateKey: "2026-06-30", interpretationNotes: [], rejectionReason: null },
        { interpretedContractId: "pm-sep", venue: "POLYMARKET", venueMarketId: "solana-all-time-high-by-september-30-2026", title: "Solana all time high by September 30, 2026?", canonicalFamily: "ATH_BY_DATE", canonicalTopicKey: "CRYPTO|ATH_BY_DATE|SOL|2026-09-30", canonicalAsset: "SOL", canonicalDateKey: "2026-09-30", interpretationNotes: [], rejectionReason: null },
        { interpretedContractId: "pm-dec", venue: "POLYMARKET", venueMarketId: "solana-all-time-high-by-december-31-2026", title: "Solana all time high by December 31, 2026?", canonicalFamily: "ATH_BY_DATE", canonicalTopicKey: "CRYPTO|ATH_BY_DATE|SOL|2026-12-31", canonicalAsset: "SOL", canonicalDateKey: "2026-12-31", interpretationNotes: [], rejectionReason: null },
        { interpretedContractId: "ll-jun", venue: "LIMITLESS", venueMarketId: "june-30-2026-sol", title: "Solana all time high by June 30, 2026?", canonicalFamily: "ATH_BY_DATE", canonicalTopicKey: "CRYPTO|ATH_BY_DATE|SOL|2026-06-30", canonicalAsset: "SOL", canonicalDateKey: "2026-06-30", interpretationNotes: [], rejectionReason: null },
        { interpretedContractId: "ll-sep", venue: "LIMITLESS", venueMarketId: "september-30-2026-sol", title: "Solana all time high by September 30, 2026?", canonicalFamily: "ATH_BY_DATE", canonicalTopicKey: "CRYPTO|ATH_BY_DATE|SOL|2026-09-30", canonicalAsset: "SOL", canonicalDateKey: "2026-09-30", interpretationNotes: [], rejectionReason: null },
        { interpretedContractId: "ll-dec", venue: "LIMITLESS", venueMarketId: "december-31-2026-sol", title: "Solana all time high by December 31, 2026?", canonicalFamily: "ATH_BY_DATE", canonicalTopicKey: "CRYPTO|ATH_BY_DATE|SOL|2026-12-31", canonicalAsset: "SOL", canonicalDateKey: "2026-12-31", interpretationNotes: [], rejectionReason: null }
      ],
      comparabilitySummary: [
        { canonicalTopicKey: "CRYPTO|ATH_BY_DATE|SOL|2026-03-31", canonicalDateKey: "2026-03-31", venuesPresent: ["POLYMARKET"], ruleCompatibilityClassification: "SEMANTICALLY_COMPATIBLE_REWORDING", fragmentationLabel: "FAMILY_REFRESHED_SINGLE_VENUE_ONLY", matcherCandidate: false, notes: [] },
        { canonicalTopicKey: "CRYPTO|ATH_BY_DATE|SOL|2026-06-30", canonicalDateKey: "2026-06-30", venuesPresent: ["LIMITLESS", "POLYMARKET"], ruleCompatibilityClassification: "SEMANTICALLY_COMPATIBLE_REWORDING", fragmentationLabel: "FAMILY_REFRESHED_SHARED_DATE_BUCKETS_EXIST", matcherCandidate: true, notes: [] },
        { canonicalTopicKey: "CRYPTO|ATH_BY_DATE|SOL|2026-09-30", canonicalDateKey: "2026-09-30", venuesPresent: ["LIMITLESS", "POLYMARKET"], ruleCompatibilityClassification: "SEMANTICALLY_COMPATIBLE_REWORDING", fragmentationLabel: "FAMILY_REFRESHED_SHARED_DATE_BUCKETS_EXIST", matcherCandidate: true, notes: [] },
        { canonicalTopicKey: "CRYPTO|ATH_BY_DATE|SOL|2026-12-31", canonicalDateKey: "2026-12-31", venuesPresent: ["LIMITLESS", "POLYMARKET"], ruleCompatibilityClassification: "SEMANTICALLY_COMPATIBLE_REWORDING", fragmentationLabel: "FAMILY_REFRESHED_SHARED_DATE_BUCKETS_EXIST", matcherCandidate: true, notes: [] }
      ]
    });

    expect(materialized.pairLanes.map((lane) => lane.exactDateKey)).toEqual(["2026-06-30", "2026-09-30", "2026-12-31"]);
  });
});
