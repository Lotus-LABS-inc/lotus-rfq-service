import { describe, expect, it } from "vitest";

import { buildCryptoXrpAthByDateLimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/crypto-xrp-ath-by-date-limited-prod-readiness.js";

describe("crypto xrp ath by date limited-prod readiness", () => {
  it("keeps LIMITLESS|POLYMARKET explicit on shared XRP buckets", () => {
    const artifacts = buildCryptoXrpAthByDateLimitedProdReadinessArtifacts({
      inputSummary: { exactFamily: "CRYPTO|ATH_BY_DATE|XRP", targetPair: "LIMITLESS|POLYMARKET", refreshedRowsUsed: [], familyComparabilitySourceArtifacts: {}, admittedVenues: ["LIMITLESS", "POLYMARKET"], admittedTopicKeys: ["CRYPTO|ATH_BY_DATE|XRP|2026-06-30", "CRYPTO|ATH_BY_DATE|XRP|2026-09-30", "CRYPTO|ATH_BY_DATE|XRP|2026-12-31"] },
      pairLanes: { matcherLanes: ["2026-06-30", "2026-09-30", "2026-12-31"].map((exactDateKey) => ({ venuePair: "LIMITLESS|POLYMARKET", canonicalTopicKey: `CRYPTO|ATH_BY_DATE|XRP|${exactDateKey}`, exactDateKey, routeabilityDecision: "PAIR_REVIEW_REQUIRED", rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING" as const, evidenceNotes: [] })) },
      rejections: { rejections: [] },
      finalDecision: { overallDecision: "CRYPTO_XRP_ATH_BY_DATE_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW", bestPair: "LIMITLESS|POLYMARKET", pairMatcherReady: true, exactSafePairCandidateCount: 3, ruleStatus: "SEMANTICALLY_COMPATIBLE_REWORDING", operatorCredible: true, matcherFollowUpJustified: true, singleBestNextAction: "next" }
    });

    expect(artifacts.readiness.laneId).toBe("CRYPTO_XRP_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET");
  });
});
