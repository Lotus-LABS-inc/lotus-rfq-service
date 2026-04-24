import { describe, expect, it } from "vitest";

import { buildCryptoBtcFirstToThresholdByDateLimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/crypto-btc-first-to-threshold-by-date-limited-prod-readiness.js";
import { buildCryptoEthFirstToThresholdByDateLimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/crypto-eth-first-to-threshold-by-date-limited-prod-readiness.js";
import { buildCryptoSolFirstToThresholdByDateLimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/crypto-sol-first-to-threshold-by-date-limited-prod-readiness.js";

const cases = [
  {
    asset: "BTC",
    familyKey: "CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|BTC|60000|80000|2027-01-01",
    laneId: "CRYPTO_BTC_FIRST_TO_THRESHOLD_BY_DATE_PAIR_POLYMARKET_PREDICT",
    decisionPrefix: "CRYPTO_BTC_FIRST_TO_THRESHOLD_BY_DATE",
    build: buildCryptoBtcFirstToThresholdByDateLimitedProdReadinessArtifacts,
    outcomes: ["$60k first", "$80k first"]
  },
  {
    asset: "ETH",
    familyKey: "CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|ETH|1000|3000|2027-01-01",
    laneId: "CRYPTO_ETH_FIRST_TO_THRESHOLD_BY_DATE_PAIR_POLYMARKET_PREDICT",
    decisionPrefix: "CRYPTO_ETH_FIRST_TO_THRESHOLD_BY_DATE",
    build: buildCryptoEthFirstToThresholdByDateLimitedProdReadinessArtifacts,
    outcomes: ["$1,000 first", "$3,000 first"]
  },
  {
    asset: "SOL",
    familyKey: "CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|SOL|60|140|2027-01-01",
    laneId: "CRYPTO_SOL_FIRST_TO_THRESHOLD_BY_DATE_PAIR_POLYMARKET_PREDICT",
    decisionPrefix: "CRYPTO_SOL_FIRST_TO_THRESHOLD_BY_DATE",
    build: buildCryptoSolFirstToThresholdByDateLimitedProdReadinessArtifacts,
    outcomes: ["$60 first", "$140 first"]
  }
] as const;

describe("crypto first-to-threshold-by-date limited-prod readiness", () => {
  it.each(cases)("keeps POLYMARKET|PREDICT explicit for $asset and review-gated on the binary outcome core", ({ build, familyKey, laneId, decisionPrefix, outcomes }) => {
    const artifacts = build({
      inputSummary: {
        exactFamily: familyKey,
        targetPair: "POLYMARKET|PREDICT",
        refreshedRowsUsed: [],
        familyComparabilitySourceArtifacts: {},
        admittedVenues: ["POLYMARKET", "PREDICT"],
        admittedTopicKeys: [familyKey]
      },
      pairLanes: {
        matcherLanes: [{
          venuePair: "POLYMARKET|PREDICT",
          canonicalTopicKey: familyKey,
          exactOutcomeLabels: outcomes,
          lowerThreshold: "0",
          higherThreshold: "0",
          routeabilityDecision: "PAIR_REVIEW_REQUIRED",
          rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING" as const,
          operatorReviewRequiredReasons: ["tie_handling_unspecified"],
          evidenceNotes: []
        }]
      },
      rejections: {
        rejections: [
          {
            scope: "family",
            canonicalTopicKey: familyKey,
            reason: "TIE_HANDLING_AMBIGUOUS",
            notes: "Tie handling is unspecified."
          }
        ]
      },
      finalDecision: {
        overallDecision: `${decisionPrefix}_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW`,
        bestPair: "POLYMARKET|PREDICT",
        pairMatcherReady: true,
        exactSafePairCandidateCount: 2,
        ruleStatus: "SEMANTICALLY_COMPATIBLE_REWORDING" as const,
        operatorCredible: true,
        matcherFollowUpJustified: true,
        singleBestNextAction: "next"
      }
    });

    expect(artifacts.readiness.finalReadinessLabel).toBe(
      `${decisionPrefix}_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW`
    );
    expect(artifacts.readiness.laneId).toBe(laneId);
    expect(artifacts.readiness.exactSafeOutcomeLabels).toEqual(outcomes);
    expect(artifacts.adminSurfaceSummary.currentReadinessDecision).toBe(
      "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
    );
  });
});
