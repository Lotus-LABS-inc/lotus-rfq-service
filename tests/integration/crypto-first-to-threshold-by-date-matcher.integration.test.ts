import { describe, expect, it } from "vitest";

import { buildCryptoBtcFirstToThresholdByDateMatcherMaterialization } from "../../src/matching/crypto/crypto-btc-first-to-threshold-by-date-matcher.js";
import { buildCryptoEthFirstToThresholdByDateMatcherMaterialization } from "../../src/matching/crypto/crypto-eth-first-to-threshold-by-date-matcher.js";
import { buildCryptoSolFirstToThresholdByDateMatcherMaterialization } from "../../src/matching/crypto/crypto-sol-first-to-threshold-by-date-matcher.js";
import type {
  CryptoFirstToThresholdComparabilityTopicSummary,
  CryptoFirstToThresholdByDateNormalizedTopicRow
} from "../../src/matching/crypto/crypto-first-to-threshold-by-date-shared.js";

const buildRow = (
  overrides: Partial<CryptoFirstToThresholdByDateNormalizedTopicRow>
): CryptoFirstToThresholdByDateNormalizedTopicRow => ({
  interpretedContractId: overrides.interpretedContractId ?? "row-1",
  venue: overrides.venue ?? "POLYMARKET",
  venueMarketId: overrides.venueMarketId ?? "market-1",
  title: overrides.title ?? "first-to-threshold",
  canonicalFamily: "FIRST_TO_THRESHOLD_BY_DATE",
  canonicalTopicKey: overrides.canonicalTopicKey ?? "CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|BTC|60000|80000|2027-01-01",
  canonicalAsset: overrides.canonicalAsset ?? "BTC",
  canonicalLowerThreshold: overrides.canonicalLowerThreshold ?? "60000",
  canonicalHigherThreshold: overrides.canonicalHigherThreshold ?? "80000",
  canonicalDeadlineDateKey: overrides.canonicalDeadlineDateKey ?? "2027-01-01",
  priceSource: overrides.priceSource ?? "BINANCE:BTC/USDT",
  hitBasis: overrides.hitBasis ?? "INTRADAY_HIT",
  fallbackIfNeither: overrides.fallbackIfNeither ?? "SPLIT_50_50",
  tieHandling: overrides.tieHandling ?? "UNSPECIFIED",
  exactOutcomeLabels: overrides.exactOutcomeLabels ?? ["$60k first", "$80k first"],
  interpretationConfidence: overrides.interpretationConfidence ?? "HIGH",
  interpretationNotes: overrides.interpretationNotes ?? [],
  rejectionReason: overrides.rejectionReason ?? null
});

const topicSummary = (
  overrides: Partial<CryptoFirstToThresholdComparabilityTopicSummary> = {}
): CryptoFirstToThresholdComparabilityTopicSummary => ({
  canonicalTopicKey: overrides.canonicalTopicKey ?? "CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|BTC|60000|80000|2027-01-01",
  canonicalAsset: overrides.canonicalAsset ?? "BTC",
  canonicalLowerThreshold: overrides.canonicalLowerThreshold ?? "60000",
  canonicalHigherThreshold: overrides.canonicalHigherThreshold ?? "80000",
  canonicalDeadlineDateKey: overrides.canonicalDeadlineDateKey ?? "2027-01-01",
  priceSource: overrides.priceSource ?? "BINANCE:BTC/USDT",
  hitBasis: overrides.hitBasis ?? "INTRADAY_HIT",
  fallbackIfNeither: overrides.fallbackIfNeither ?? "SPLIT_50_50",
  tieHandling: overrides.tieHandling ?? "UNSPECIFIED",
  exactOutcomeLabels: overrides.exactOutcomeLabels ?? ["$60k first", "$80k first"],
  venuesPresent: overrides.venuesPresent ?? ["POLYMARKET", "PREDICT"],
  ruleCompatibilityClassification: overrides.ruleCompatibilityClassification ?? "SEMANTICALLY_COMPATIBLE_REWORDING",
  operatorReviewRequiredReasons: overrides.operatorReviewRequiredReasons ?? ["tie_handling_unspecified"],
  matcherCandidate: overrides.matcherCandidate ?? true,
  notes: overrides.notes ?? []
});

const cases = [
  {
    asset: "BTC",
    decisionPrefix: "CRYPTO_BTC_FIRST_TO_THRESHOLD_BY_DATE",
    build: buildCryptoBtcFirstToThresholdByDateMatcherMaterialization,
    sharedTopicKey: "CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|BTC|60000|80000|2027-01-01",
    outcomes: ["$60k first", "$80k first"]
  },
  {
    asset: "ETH",
    decisionPrefix: "CRYPTO_ETH_FIRST_TO_THRESHOLD_BY_DATE",
    build: buildCryptoEthFirstToThresholdByDateMatcherMaterialization,
    sharedTopicKey: "CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|ETH|1000|3000|2027-01-01",
    outcomes: ["$1,000 first", "$3,000 first"]
  },
  {
    asset: "SOL",
    decisionPrefix: "CRYPTO_SOL_FIRST_TO_THRESHOLD_BY_DATE",
    build: buildCryptoSolFirstToThresholdByDateMatcherMaterialization,
    sharedTopicKey: "CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|SOL|60|140|2027-01-01",
    outcomes: ["$60 first", "$140 first"]
  }
] as const;

describe("crypto first-to-threshold-by-date matcher", () => {
  it.each(cases)("materializes a review-gated POLYMARKET|PREDICT binary pair for $asset", ({ build, sharedTopicKey, outcomes, decisionPrefix, asset }) => {
    const materialized = build({
      normalizedTopics: [
        buildRow({
          interpretedContractId: "pm-shared",
          venue: "POLYMARKET",
          venueMarketId: "pm-shared",
          canonicalTopicKey: sharedTopicKey,
          canonicalAsset: asset,
          exactOutcomeLabels: outcomes
        }),
        buildRow({
          interpretedContractId: "predict-shared",
          venue: "PREDICT",
          venueMarketId: "predict-shared",
          canonicalTopicKey: sharedTopicKey,
          canonicalAsset: asset,
          exactOutcomeLabels: outcomes
        })
      ],
      comparabilitySummary: [
        topicSummary({
          canonicalTopicKey: sharedTopicKey,
          canonicalAsset: asset,
          exactOutcomeLabels: outcomes
        })
      ]
    });

    expect(materialized.admittedVenues).toEqual(["POLYMARKET", "PREDICT"]);
    expect(materialized.finalDecision.bestPair).toBe("POLYMARKET|PREDICT");
    expect(materialized.finalDecision.exactSafePairCandidateCount).toBe(2);
    expect(materialized.pairLanes.map((lane) => lane.exactOutcomeLabels)).toEqual([outcomes]);
    expect(materialized.rejections.find((entry) => entry.reason === "TIE_HANDLING_AMBIGUOUS")).toBeTruthy();
    expect(materialized.finalDecision.overallDecision).toBe(`${decisionPrefix}_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW`);
  });
});
