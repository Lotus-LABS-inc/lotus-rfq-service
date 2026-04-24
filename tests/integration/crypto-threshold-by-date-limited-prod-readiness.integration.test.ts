import { describe, expect, it } from "vitest";

import { buildCryptoBnbThresholdByDateLimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/crypto-bnb-threshold-by-date-limited-prod-readiness.js";
import { buildCryptoBtcThresholdByDateLimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/crypto-btc-threshold-by-date-limited-prod-readiness.js";
import { buildCryptoEthThresholdByDateLimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/crypto-eth-threshold-by-date-limited-prod-readiness.js";
import { buildCryptoSolThresholdByDateLimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/crypto-sol-threshold-by-date-limited-prod-readiness.js";

const cases = [
  {
    asset: "BTC",
    familyKey: "CRYPTO|THRESHOLD_BY_DATE|BTC|2026-04-30",
    laneId: "CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT",
    decisionPrefix: "CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026",
    build: buildCryptoBtcThresholdByDateLimitedProdReadinessArtifacts,
    sharedLabels: ["↑ 100,000", "↓ 70,000"]
  },
  {
    asset: "ETH",
    familyKey: "CRYPTO|THRESHOLD_BY_DATE|ETH|2026-04-30",
    laneId: "CRYPTO_ETH_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT",
    decisionPrefix: "CRYPTO_ETH_THRESHOLD_BY_DATE_APR_2026",
    build: buildCryptoEthThresholdByDateLimitedProdReadinessArtifacts,
    sharedLabels: ["↑ 5,000", "↓ 2,000"]
  },
  {
    asset: "SOL",
    familyKey: "CRYPTO|THRESHOLD_BY_DATE|SOL|2026-04-30",
    laneId: "CRYPTO_SOL_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT",
    decisionPrefix: "CRYPTO_SOL_THRESHOLD_BY_DATE_APR_2026",
    build: buildCryptoSolThresholdByDateLimitedProdReadinessArtifacts,
    sharedLabels: ["↑ 300", "↓ 100"]
  },
  {
    asset: "BNB",
    familyKey: "CRYPTO|THRESHOLD_BY_DATE|BNB|2026-04-30",
    laneId: "CRYPTO_BNB_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT",
    decisionPrefix: "CRYPTO_BNB_THRESHOLD_BY_DATE_APR_2026",
    build: buildCryptoBnbThresholdByDateLimitedProdReadinessArtifacts,
    sharedLabels: ["↑ 1,000", "↓ 500"]
  }
] as const;

describe("crypto threshold by date limited-prod readiness", () => {
  it.each(cases)("keeps POLYMARKET|PREDICT explicit for $asset and review-gated on the shared threshold scope", ({ build, familyKey, laneId, decisionPrefix, sharedLabels }) => {
    const artifacts = build({
      inputSummary: {
        exactFamily: familyKey,
        targetPair: "POLYMARKET|PREDICT",
        refreshedRowsUsed: [],
        familyComparabilitySourceArtifacts: {},
        admittedVenues: ["POLYMARKET", "PREDICT"],
        admittedTopicKeys: [
          `${familyKey}|ABOVE|100000`,
          `${familyKey}|BELOW|70000`
        ]
      },
      pairLanes: {
        matcherLanes: sharedLabels.map((exactThresholdLabel, index) => ({
          venuePair: "POLYMARKET|PREDICT",
          canonicalTopicKey: `${familyKey}|${index === 0 ? "ABOVE" : "BELOW"}|${exactThresholdLabel.replace(/[^0-9]/g, "")}`,
          exactThresholdLabel,
          exactThresholdValue: exactThresholdLabel.replace(/[^0-9]/g, ""),
          comparator: index === 0 ? "ABOVE" as const : "BELOW" as const,
          routeabilityDecision: "PAIR_REVIEW_REQUIRED",
          rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING" as const,
          evidenceNotes: []
        }))
      },
      rejections: {
        rejections: [
          {
            scope: "threshold_bucket",
            canonicalTopicKey: `${familyKey}|ABOVE|250000`,
            exactThresholdLabel: "↑ 250,000",
            reason: "NOT_SHARED",
            notes: "Tail threshold is venue-specific."
          }
        ]
      },
      finalDecision: {
        overallDecision: `${decisionPrefix}_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW`,
        bestPair: "POLYMARKET|PREDICT",
        pairMatcherReady: true,
        exactSafePairCandidateCount: sharedLabels.length,
        ruleStatus: "SEMANTICALLY_COMPATIBLE_REWORDING",
        operatorCredible: true,
        matcherFollowUpJustified: true,
        singleBestNextAction: "next"
      }
    });

    expect(artifacts.readiness.finalReadinessLabel).toBe(
      `${decisionPrefix}_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
    );
    expect(artifacts.readiness.laneId).toBe(laneId);
    expect(artifacts.readiness.exactSafeThresholdBuckets).toEqual(sharedLabels);
    expect(artifacts.adminSurfaceSummary.currentReadinessDecision).toBe(
      "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
    );
  });
});
