import { describe, expect, it } from "vitest";

import { buildPoliticsOfficeWinnerBusanMayor2026LimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/politics-office-winner-busan-mayor-2026-limited-prod-readiness.js";

describe("office winner Busan mayor 2026 limited-prod readiness", () => {
  it("keeps exact pair scope locked for LIMITLESS|POLYMARKET only", () => {
    const artifacts = buildPoliticsOfficeWinnerBusanMayor2026LimitedProdReadinessArtifacts({
      inputSummary: {
        exactTopic: "OFFICE_WINNER|BUSAN|MAYOR|2026",
        refreshedRowsUsed: [],
        familyComparabilitySourceArtifacts: {},
        admittedVenues: ["LIMITLESS", "POLYMARKET"],
        admittedCandidates: [
          "cho_kuk",
          "cho_kyoung_tae",
          "choi_in_ho",
          "chun_jae_soo",
          "hong_soon_heon",
          "kim_do_eup",
          "kim_young_choon",
          "lee_jae_sung",
          "park_heong_joon",
          "park_jae_ho",
          "park_seong_hoon",
          "suh_byung_soo"
        ]
      },
      lanes: {
        canonicalTopicKey: "OFFICE_WINNER|BUSAN|MAYOR|2026",
        bestPair: "LIMITLESS|POLYMARKET",
        matcherLanes: [
          {
            venuePair: "LIMITLESS|POLYMARKET",
            candidate: "cho_kuk",
            canonicalTopic: "OFFICE_WINNER|BUSAN|MAYOR|2026",
            routeabilityDecision: "PAIR_REVIEW_REQUIRED",
            rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING",
            evidence: [],
            evidenceNotes: []
          },
          {
            venuePair: "LIMITLESS|POLYMARKET",
            candidate: "chun_jae_soo",
            canonicalTopic: "OFFICE_WINNER|BUSAN|MAYOR|2026",
            routeabilityDecision: "PAIR_REVIEW_REQUIRED",
            rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING",
            evidence: [],
            evidenceNotes: []
          }
        ] as Array<{
          venuePair: string;
          candidate: string;
          canonicalTopic: string;
          routeabilityDecision: string;
          rulesDecision: "EXACT_RULE_COMPATIBLE" | "SEMANTICALLY_COMPATIBLE_REWORDING" | "REVIEW_REQUIRED_RULE_VARIANCE" | "RULES_MATERIALLY_INCOMPATIBLE" | "UNKNOWN_RULE_MEANING";
          evidence: { venue: string; venueMarketId: string; rawOutcomeLabel: string }[];
          evidenceNotes: string[];
        }>
      },
      rejections: {
        rejections: [
          {
            scope: "candidate",
            reason: "OTHERS_EXCLUDED",
            notes: "other excluded"
          },
          {
            scope: "venue",
            venue: "OPINION",
            venuePair: "LIMITLESS|POLYMARKET",
            reason: "VENUE_NOT_PRESENT_FOR_TOPIC",
            notes: "opinion absent"
          }
        ]
      },
      finalDecision: {
        overallDecision: "OFFICE_WINNER_BUSAN_MAYOR_2026_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW",
        bestPair: "LIMITLESS|POLYMARKET",
        bestStartingCandidates: [
          "cho_kuk",
          "cho_kyoung_tae",
          "choi_in_ho",
          "chun_jae_soo",
          "hong_soon_heon",
          "kim_do_eup",
          "kim_young_choon",
          "lee_jae_sung",
          "park_heong_joon",
          "park_jae_ho",
          "park_seong_hoon",
          "suh_byung_soo"
        ],
        pairMatcherReady: true,
        operatorCredible: true,
        pairPreferred: true,
        exactSafeCandidateCount: 12,
        ruleStatus: "SEMANTICALLY_COMPATIBLE_REWORDING",
        matcherFollowUpJustified: true,
        singleBestNextAction: "review"
      }
    });

    expect(artifacts.readiness.finalReadinessLabel).toBe(
      "OFFICE_WINNER_BUSAN_MAYOR_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
    );
    expect(artifacts.readiness.venuePair).toBe("LIMITLESS|POLYMARKET");
    expect(artifacts.readiness.operatorRuleReviewRequired).toBe(true);
    expect(artifacts.readiness.readinessReviewJustified).toBe(true);
    expect(artifacts.readiness.exclusionsStillMandatory).toContain("NO_OPINION_FOR_THIS_TOPIC");
    expect(artifacts.adminSurfaceSummary.currentReadinessDecision).toBe("READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION");
  });
});
