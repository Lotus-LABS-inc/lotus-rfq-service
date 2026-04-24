import { describe, expect, it } from "vitest";

import { buildCryptoBtcAthByDateMatcherMaterialization } from "../../src/matching/crypto/crypto-btc-ath-by-date-matcher.js";
import type {
  CryptoBtcAthByDateComparabilityTopicSummary,
  CryptoBtcAthByDateNormalizedTopicRow
} from "../../src/matching/crypto/crypto-btc-ath-by-date-family-pass.js";

const buildRow = (
  overrides: Partial<CryptoBtcAthByDateNormalizedTopicRow>
): CryptoBtcAthByDateNormalizedTopicRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "POLYMARKET",
  venueMarketId: overrides.venueMarketId ?? "bitcoin-all-time-high-by-june-30-2026",
  title: overrides.title ?? "Bitcoin all time high by June 30, 2026?",
  canonicalFamily: "ATH_BY_DATE",
  canonicalTopicKey: overrides.canonicalTopicKey ?? "CRYPTO|ATH_BY_DATE|BTC|2026-06-30",
  canonicalAsset: "BTC",
  canonicalDateKey: overrides.canonicalDateKey ?? "2026-06-30",
  interpretationNotes: overrides.interpretationNotes ?? [],
  rejectionReason: overrides.rejectionReason ?? null
});

const topicSummary = (
  overrides: Partial<CryptoBtcAthByDateComparabilityTopicSummary> = {}
): CryptoBtcAthByDateComparabilityTopicSummary => ({
  canonicalTopicKey: overrides.canonicalTopicKey ?? "CRYPTO|ATH_BY_DATE|BTC|2026-06-30",
  canonicalDateKey: overrides.canonicalDateKey ?? "2026-06-30",
  venuesPresent: overrides.venuesPresent ?? ["LIMITLESS", "POLYMARKET"],
  ruleCompatibilityClassification: overrides.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING",
  fragmentationLabel: overrides.fragmentationLabel ?? "FAMILY_REFRESHED_SHARED_DATE_BUCKETS_EXIST",
  matcherCandidate: overrides.matcherCandidate ?? true,
  notes: overrides.notes ?? []
});

describe("crypto btc ath by date matcher", () => {
  it("keeps the shared June/September/December buckets and rejects the March-only tail", () => {
    const normalizedTopics: CryptoBtcAthByDateNormalizedTopicRow[] = [
      buildRow({ interpretedContractId: "pm-mar", venue: "POLYMARKET", venueMarketId: "bitcoin-all-time-high-by-march-31-2026", canonicalTopicKey: "CRYPTO|ATH_BY_DATE|BTC|2026-03-31", canonicalDateKey: "2026-03-31", title: "Bitcoin all time high by March 31, 2026?" }),
      buildRow({ interpretedContractId: "pm-jun", venue: "POLYMARKET", venueMarketId: "bitcoin-all-time-high-by-june-30-2026", canonicalTopicKey: "CRYPTO|ATH_BY_DATE|BTC|2026-06-30", canonicalDateKey: "2026-06-30", title: "Bitcoin all time high by June 30, 2026?" }),
      buildRow({ interpretedContractId: "pm-sep", venue: "POLYMARKET", venueMarketId: "bitcoin-all-time-high-by-september-30-2026", canonicalTopicKey: "CRYPTO|ATH_BY_DATE|BTC|2026-09-30", canonicalDateKey: "2026-09-30", title: "Bitcoin all time high by September 30, 2026?" }),
      buildRow({ interpretedContractId: "pm-dec", venue: "POLYMARKET", venueMarketId: "bitcoin-all-time-high-by-december-31-2026", canonicalTopicKey: "CRYPTO|ATH_BY_DATE|BTC|2026-12-31", canonicalDateKey: "2026-12-31", title: "Bitcoin all time high by December 31, 2026?" }),
      buildRow({ interpretedContractId: "ll-jun", venue: "LIMITLESS", venueMarketId: "june-30-2026-1775135445337", canonicalTopicKey: "CRYPTO|ATH_BY_DATE|BTC|2026-06-30", canonicalDateKey: "2026-06-30", title: "Bitcoin all time high by June 30, 2026?" }),
      buildRow({ interpretedContractId: "ll-sep", venue: "LIMITLESS", venueMarketId: "september-30-2026-1775135445352", canonicalTopicKey: "CRYPTO|ATH_BY_DATE|BTC|2026-09-30", canonicalDateKey: "2026-09-30", title: "Bitcoin all time high by September 30, 2026?" }),
      buildRow({ interpretedContractId: "ll-dec", venue: "LIMITLESS", venueMarketId: "december-31-2026-1775135445358", canonicalTopicKey: "CRYPTO|ATH_BY_DATE|BTC|2026-12-31", canonicalDateKey: "2026-12-31", title: "Bitcoin all time high by December 31, 2026?" })
    ];

    const materialized = buildCryptoBtcAthByDateMatcherMaterialization({
      normalizedTopics,
      comparabilitySummary: [
        topicSummary({ canonicalTopicKey: "CRYPTO|ATH_BY_DATE|BTC|2026-03-31", canonicalDateKey: "2026-03-31", venuesPresent: ["POLYMARKET"], matcherCandidate: false }),
        topicSummary({ canonicalTopicKey: "CRYPTO|ATH_BY_DATE|BTC|2026-06-30", canonicalDateKey: "2026-06-30" }),
        topicSummary({ canonicalTopicKey: "CRYPTO|ATH_BY_DATE|BTC|2026-09-30", canonicalDateKey: "2026-09-30" }),
        topicSummary({ canonicalTopicKey: "CRYPTO|ATH_BY_DATE|BTC|2026-12-31", canonicalDateKey: "2026-12-31" })
      ]
    });

    expect(materialized.admittedVenues).toEqual(["LIMITLESS", "POLYMARKET"]);
    expect(materialized.finalDecision.bestPair).toBe("LIMITLESS|POLYMARKET");
    expect(materialized.finalDecision.exactSafePairCandidateCount).toBe(3);
    expect(materialized.pairLanes.map((lane) => lane.exactDateKey)).toEqual(["2026-06-30", "2026-09-30", "2026-12-31"]);
    expect(materialized.rejections.find((entry) => entry.exactDateKey === "2026-03-31")?.reason).toBe("NOT_SHARED");
    expect(materialized.finalDecision.overallDecision).toBe("CRYPTO_BTC_ATH_BY_DATE_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW");
  });
});
