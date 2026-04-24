import { describe, expect, it } from "vitest";

import { buildCryptoBnbThresholdByDateMatcherMaterialization } from "../../src/matching/crypto/crypto-bnb-threshold-by-date-matcher.js";
import { buildCryptoBtcThresholdByDateMatcherMaterialization } from "../../src/matching/crypto/crypto-btc-threshold-by-date-matcher.js";
import { buildCryptoEthThresholdByDateMatcherMaterialization } from "../../src/matching/crypto/crypto-eth-threshold-by-date-matcher.js";
import { buildCryptoSolThresholdByDateMatcherMaterialization } from "../../src/matching/crypto/crypto-sol-threshold-by-date-matcher.js";
import type {
  CryptoThresholdByDateComparabilityTopicSummary,
  CryptoThresholdByDateNormalizedTopicRow
} from "../../src/matching/crypto/crypto-threshold-by-date-shared.js";

const buildRow = (
  overrides: Partial<CryptoThresholdByDateNormalizedTopicRow>
): CryptoThresholdByDateNormalizedTopicRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "POLYMARKET",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  title: overrides.title ?? "Will Bitcoin reach $100,000 in April?",
  canonicalFamily: "THRESHOLD_BY_DATE",
  canonicalTopicKey: overrides.canonicalTopicKey ?? "CRYPTO|THRESHOLD_BY_DATE|BTC|2026-04-30|ABOVE|100000",
  canonicalAsset: overrides.canonicalAsset ?? "BTC",
  canonicalDateKey: overrides.canonicalDateKey ?? "2026-04-30",
  canonicalThresholdValue: overrides.canonicalThresholdValue ?? "100000",
  canonicalComparator: overrides.canonicalComparator ?? "ABOVE",
  canonicalThresholdLabel: overrides.canonicalThresholdLabel ?? "↑ 100,000",
  interpretationNotes: overrides.interpretationNotes ?? [],
  rejectionReason: overrides.rejectionReason ?? null
});

const topicSummary = (
  overrides: Partial<CryptoThresholdByDateComparabilityTopicSummary> = {}
): CryptoThresholdByDateComparabilityTopicSummary => ({
  canonicalTopicKey: overrides.canonicalTopicKey ?? "CRYPTO|THRESHOLD_BY_DATE|BTC|2026-04-30|ABOVE|100000",
  canonicalDateKey: overrides.canonicalDateKey ?? "2026-04-30",
  canonicalThresholdValue: overrides.canonicalThresholdValue ?? "100000",
  canonicalComparator: overrides.canonicalComparator ?? "ABOVE",
  canonicalThresholdLabel: overrides.canonicalThresholdLabel ?? "↑ 100,000",
  venuesPresent: overrides.venuesPresent ?? ["POLYMARKET", "PREDICT"],
  ruleCompatibilityClassification: overrides.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING",
  fragmentationLabel: overrides.fragmentationLabel ?? "FAMILY_REFRESHED_SHARED_THRESHOLD_BUCKETS_EXIST",
  matcherCandidate: overrides.matcherCandidate ?? true,
  notes: overrides.notes ?? []
});

const cases = [
  {
    asset: "BTC",
    decisionPrefix: "CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026",
    build: buildCryptoBtcThresholdByDateMatcherMaterialization,
    sharedTopicKey: "CRYPTO|THRESHOLD_BY_DATE|BTC|2026-04-30|ABOVE|100000",
    sharedLabel: "↑ 100,000",
    tailTopicKey: "CRYPTO|THRESHOLD_BY_DATE|BTC|2026-04-30|BELOW|70000",
    tailLabel: "↓ 70,000",
    title: "Will Bitcoin reach $100,000 in April?"
  },
  {
    asset: "ETH",
    decisionPrefix: "CRYPTO_ETH_THRESHOLD_BY_DATE_APR_2026",
    build: buildCryptoEthThresholdByDateMatcherMaterialization,
    sharedTopicKey: "CRYPTO|THRESHOLD_BY_DATE|ETH|2026-04-30|ABOVE|5000",
    sharedLabel: "↑ 5,000",
    tailTopicKey: "CRYPTO|THRESHOLD_BY_DATE|ETH|2026-04-30|BELOW|2000",
    tailLabel: "↓ 2,000",
    title: "Will Ethereum reach $5,000 in April?"
  },
  {
    asset: "SOL",
    decisionPrefix: "CRYPTO_SOL_THRESHOLD_BY_DATE_APR_2026",
    build: buildCryptoSolThresholdByDateMatcherMaterialization,
    sharedTopicKey: "CRYPTO|THRESHOLD_BY_DATE|SOL|2026-04-30|ABOVE|300",
    sharedLabel: "↑ 300",
    tailTopicKey: "CRYPTO|THRESHOLD_BY_DATE|SOL|2026-04-30|BELOW|100",
    tailLabel: "↓ 100",
    title: "Will Solana reach $300 in April?"
  },
  {
    asset: "BNB",
    decisionPrefix: "CRYPTO_BNB_THRESHOLD_BY_DATE_APR_2026",
    build: buildCryptoBnbThresholdByDateMatcherMaterialization,
    sharedTopicKey: "CRYPTO|THRESHOLD_BY_DATE|BNB|2026-04-30|ABOVE|1000",
    sharedLabel: "↑ 1,000",
    tailTopicKey: "CRYPTO|THRESHOLD_BY_DATE|BNB|2026-04-30|BELOW|500",
    tailLabel: "↓ 500",
    title: "Will BNB reach $1,000 in April?"
  }
] as const;

describe("crypto threshold by date matcher", () => {
  it.each(cases)("keeps the shared $asset threshold bucket and rejects the venue-only tail", ({ build, sharedTopicKey, sharedLabel, tailTopicKey, tailLabel, title, decisionPrefix, asset }) => {
    const materialized = build({
      normalizedTopics: [
        buildRow({
          interpretedContractId: "pm-shared",
          venue: "POLYMARKET",
          venueMarketId: "pm-shared",
          title,
          canonicalTopicKey: sharedTopicKey,
          canonicalAsset: asset,
          canonicalThresholdValue: sharedLabel.replace(/[^0-9]/g, ""),
          canonicalThresholdLabel: sharedLabel
        }),
        buildRow({
          interpretedContractId: "predict-shared",
          venue: "PREDICT",
          venueMarketId: "predict-shared",
          title,
          canonicalTopicKey: sharedTopicKey,
          canonicalAsset: asset,
          canonicalThresholdValue: sharedLabel.replace(/[^0-9]/g, ""),
          canonicalThresholdLabel: sharedLabel
        }),
        buildRow({
          interpretedContractId: "pm-tail",
          venue: "POLYMARKET",
          venueMarketId: "pm-tail",
          title: `${title} tail`,
          canonicalTopicKey: tailTopicKey,
          canonicalAsset: asset,
          canonicalThresholdValue: tailLabel.replace(/[^0-9]/g, ""),
          canonicalComparator: "BELOW",
          canonicalThresholdLabel: tailLabel
        })
      ],
      comparabilitySummary: [
        topicSummary({
          canonicalTopicKey: sharedTopicKey,
          canonicalThresholdValue: sharedLabel.replace(/[^0-9]/g, ""),
          canonicalThresholdLabel: sharedLabel
        }),
        topicSummary({
          canonicalTopicKey: tailTopicKey,
          canonicalThresholdValue: tailLabel.replace(/[^0-9]/g, ""),
          canonicalComparator: "BELOW",
          canonicalThresholdLabel: tailLabel,
          venuesPresent: ["POLYMARKET"],
          matcherCandidate: false
        })
      ]
    });

    expect(materialized.admittedVenues).toEqual(["POLYMARKET", "PREDICT"]);
    expect(materialized.finalDecision.bestPair).toBe("POLYMARKET|PREDICT");
    expect(materialized.finalDecision.exactSafePairCandidateCount).toBe(1);
    expect(materialized.pairLanes.map((lane) => lane.exactThresholdLabel)).toEqual([sharedLabel]);
    expect(materialized.rejections.find((entry) => entry.canonicalTopicKey === tailTopicKey)?.reason).toBe("NOT_SHARED");
    expect(materialized.finalDecision.overallDecision).toBe(`${decisionPrefix}_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW`);
  });
});
