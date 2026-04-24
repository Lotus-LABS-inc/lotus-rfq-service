import { describe, expect, it } from "vitest";

import { buildCryptoSolAthByDateLimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/crypto-sol-ath-by-date-limited-prod-readiness.js";

describe("crypto sol ath by date limited-prod readiness", () => {
  it("keeps LIMITLESS|POLYMARKET explicit on shared SOL buckets", () => {
    const artifacts = buildCryptoSolAthByDateLimitedProdReadinessArtifacts({
      inputSummary: { exactFamily: "CRYPTO|ATH_BY_DATE|SOL", targetPair: "LIMITLESS|POLYMARKET", refreshedRowsUsed: [], familyComparabilitySourceArtifacts: {}, admittedVenues: ["LIMITLESS", "POLYMARKET"], admittedTopicKeys: ["CRYPTO|ATH_BY_DATE|SOL|2026-06-30", "CRYPTO|ATH_BY_DATE|SOL|2026-09-30", "CRYPTO|ATH_BY_DATE|SOL|2026-12-31"] },
      pairLanes: { matcherLanes: ["2026-06-30", "2026-09-30", "2026-12-31"].map((exactDateKey) => ({ venuePair: "LIMITLESS|POLYMARKET", canonicalTopicKey: `CRYPTO|ATH_BY_DATE|SOL|${exactDateKey}`, exactDateKey, routeabilityDecision: "PAIR_REVIEW_REQUIRED", rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING" as const, evidenceNotes: [] })) },
      rejections: { rejections: [] },
      finalDecision: { overallDecision: "CRYPTO_SOL_ATH_BY_DATE_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW", bestPair: "LIMITLESS|POLYMARKET", pairMatcherReady: true, exactSafePairCandidateCount: 3, ruleStatus: "SEMANTICALLY_COMPATIBLE_REWORDING", operatorCredible: true, matcherFollowUpJustified: true, singleBestNextAction: "next" }
    });

    expect(artifacts.readiness.laneId).toBe("CRYPTO_SOL_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET");
  });
});
