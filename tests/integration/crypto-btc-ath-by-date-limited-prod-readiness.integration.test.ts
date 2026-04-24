import { describe, expect, it } from "vitest";

import { buildCryptoBtcAthByDateLimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/crypto-btc-ath-by-date-limited-prod-readiness.js";

describe("crypto btc ath by date limited-prod readiness", () => {
  it("keeps LIMITLESS|POLYMARKET explicit and review-gated on the shared 3-bucket scope", () => {
    const artifacts = buildCryptoBtcAthByDateLimitedProdReadinessArtifacts({
      inputSummary: {
        exactFamily: "CRYPTO|ATH_BY_DATE|BTC",
        targetPair: "LIMITLESS|POLYMARKET",
        refreshedRowsUsed: [],
        familyComparabilitySourceArtifacts: {},
        admittedVenues: ["LIMITLESS", "POLYMARKET"],
        admittedTopicKeys: [
          "CRYPTO|ATH_BY_DATE|BTC|2026-03-31",
          "CRYPTO|ATH_BY_DATE|BTC|2026-06-30",
          "CRYPTO|ATH_BY_DATE|BTC|2026-09-30",
          "CRYPTO|ATH_BY_DATE|BTC|2026-12-31"
        ]
      },
      pairLanes: {
        matcherLanes: [
          "2026-06-30",
          "2026-09-30",
          "2026-12-31"
        ].map((exactDateKey) => ({
          venuePair: "LIMITLESS|POLYMARKET",
          canonicalTopicKey: `CRYPTO|ATH_BY_DATE|BTC|${exactDateKey}`,
          exactDateKey,
          routeabilityDecision: "PAIR_REVIEW_REQUIRED",
          rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING" as const,
          evidenceNotes: []
        }))
      },
      rejections: {
        rejections: [
          {
            scope: "date_bucket",
            canonicalTopicKey: "CRYPTO|ATH_BY_DATE|BTC|2026-03-31",
            exactDateKey: "2026-03-31",
            reason: "NOT_SHARED",
            notes: "March bucket is Polymarket-only."
          }
        ]
      },
      finalDecision: {
        overallDecision: "CRYPTO_BTC_ATH_BY_DATE_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW",
        bestPair: "LIMITLESS|POLYMARKET",
        pairMatcherReady: true,
        exactSafePairCandidateCount: 3,
        ruleStatus: "SEMANTICALLY_COMPATIBLE_REWORDING",
        operatorCredible: true,
        matcherFollowUpJustified: true,
        singleBestNextAction: "next"
      }
    });

    expect(artifacts.readiness.finalReadinessLabel).toBe(
      "CRYPTO_BTC_ATH_BY_DATE_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
    );
    expect(artifacts.readiness.laneId).toBe("CRYPTO_BTC_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET");
    expect(artifacts.readiness.exactSafeDateBuckets).toEqual([
      "2026-06-30",
      "2026-09-30",
      "2026-12-31"
    ]);
    expect(artifacts.adminSurfaceSummary.currentReadinessDecision).toBe(
      "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION"
    );
  });
});
