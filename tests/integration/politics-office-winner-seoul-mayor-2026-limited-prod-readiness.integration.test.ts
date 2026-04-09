import { describe, expect, it } from "vitest";

import { buildPoliticsOfficeWinnerSeoulMayor2026LimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/politics-office-winner-seoul-mayor-2026-limited-prod-readiness.js";

describe("office winner Seoul mayor 2026 limited-prod readiness", () => {
  it("keeps exact tri scope locked and preserves the safer pair fallback", () => {
    const artifacts = buildPoliticsOfficeWinnerSeoulMayor2026LimitedProdReadinessArtifacts({
      inputSummary: {
        exactTopic: "OFFICE_WINNER|SEOUL|MAYOR|2026",
        refreshedRowsUsed: [],
        familyComparabilitySourceArtifacts: {},
        admittedVenues: ["LIMITLESS", "OPINION", "POLYMARKET"],
        admittedCandidates: ["chong_won_oh", "na_kyung_won", "oh_se_hoon", "park_ju_min"]
      },
      pairLanes: {
        canonicalTopicKey: "OFFICE_WINNER|SEOUL|MAYOR|2026",
        matcherLanes: [
          {
            venuePair: "LIMITLESS|POLYMARKET",
            candidate: "chong_won_oh",
            canonicalTopic: "OFFICE_WINNER|SEOUL|MAYOR|2026",
            routeabilityDecision: "PAIR_REVIEW_REQUIRED",
            rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING",
            evidence: [],
            evidenceNotes: []
          },
          {
            venuePair: "LIMITLESS|POLYMARKET",
            candidate: "na_kyung_won",
            canonicalTopic: "OFFICE_WINNER|SEOUL|MAYOR|2026",
            routeabilityDecision: "PAIR_REVIEW_REQUIRED",
            rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING",
            evidence: [],
            evidenceNotes: []
          },
          {
            venuePair: "LIMITLESS|POLYMARKET",
            candidate: "oh_se_hoon",
            canonicalTopic: "OFFICE_WINNER|SEOUL|MAYOR|2026",
            routeabilityDecision: "PAIR_REVIEW_REQUIRED",
            rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING",
            evidence: [],
            evidenceNotes: []
          },
          {
            venuePair: "LIMITLESS|POLYMARKET",
            candidate: "park_ju_min",
            canonicalTopic: "OFFICE_WINNER|SEOUL|MAYOR|2026",
            routeabilityDecision: "PAIR_REVIEW_REQUIRED",
            rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING",
            evidence: [],
            evidenceNotes: []
          },
          {
            venuePair: "LIMITLESS|POLYMARKET",
            candidate: "ahn_cheol_soo",
            canonicalTopic: "OFFICE_WINNER|SEOUL|MAYOR|2026",
            routeabilityDecision: "PAIR_REVIEW_REQUIRED",
            rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING",
            evidence: [],
            evidenceNotes: []
          }
        ]
      },
      triLanes: {
        canonicalTopicKey: "OFFICE_WINNER|SEOUL|MAYOR|2026",
        venueSet: "LIMITLESS|OPINION|POLYMARKET",
        matcherLanes: [
          {
            venueSet: "LIMITLESS|OPINION|POLYMARKET",
            candidate: "chong_won_oh",
            canonicalTopic: "OFFICE_WINNER|SEOUL|MAYOR|2026",
            routeabilityDecision: "TRI_REVIEW_REQUIRED",
            rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING",
            evidence: [],
            evidenceNotes: []
          },
          {
            venueSet: "LIMITLESS|OPINION|POLYMARKET",
            candidate: "na_kyung_won",
            canonicalTopic: "OFFICE_WINNER|SEOUL|MAYOR|2026",
            routeabilityDecision: "TRI_REVIEW_REQUIRED",
            rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING",
            evidence: [],
            evidenceNotes: []
          },
          {
            venueSet: "LIMITLESS|OPINION|POLYMARKET",
            candidate: "oh_se_hoon",
            canonicalTopic: "OFFICE_WINNER|SEOUL|MAYOR|2026",
            routeabilityDecision: "TRI_REVIEW_REQUIRED",
            rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING",
            evidence: [],
            evidenceNotes: []
          },
          {
            venueSet: "LIMITLESS|OPINION|POLYMARKET",
            candidate: "park_ju_min",
            canonicalTopic: "OFFICE_WINNER|SEOUL|MAYOR|2026",
            routeabilityDecision: "TRI_REVIEW_REQUIRED",
            rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING",
            evidence: [],
            evidenceNotes: []
          }
        ]
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
            venue: "MYRIAD",
            venueSet: "LIMITLESS|OPINION|POLYMARKET",
            reason: "VENUE_NOT_PRESENT_FOR_TOPIC",
            notes: "myriad absent"
          }
        ]
      },
      finalDecision: {
        overallDecision: "OFFICE_WINNER_SEOUL_MAYOR_2026_TRI_REVIEW_REQUIRED",
        bestPair: "LIMITLESS|POLYMARKET",
        bestTriIfAny: "LIMITLESS|OPINION|POLYMARKET",
        pairMatcherReady: true,
        triMatcherReady: true,
        pairStillPreferred: true,
        exactSafePairCandidateCount: 4,
        exactSafeTriCandidateCount: 4,
        ruleStatus: "SEMANTICALLY_COMPATIBLE_REWORDING",
        operatorCredible: true,
        matcherFollowUpJustified: true,
        singleBestNextAction: "review"
      }
    });

    expect(artifacts.readiness.finalReadinessLabel).toBe(
      "OFFICE_WINNER_SEOUL_MAYOR_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
    );
    expect(artifacts.readiness.triVenueSet).toBe("LIMITLESS|OPINION|POLYMARKET");
    expect(artifacts.readiness.exactSafeTriCandidates).toEqual([
      "chong_won_oh",
      "na_kyung_won",
      "oh_se_hoon",
      "park_ju_min"
    ]);
    expect(artifacts.readiness.saferPairFallback.venuePair).toBe("LIMITLESS|POLYMARKET");
    expect(artifacts.readiness.operatorRuleReviewRequired).toBe(true);
    expect(artifacts.readiness.readinessReviewJustified).toBe(true);
    expect(artifacts.pairReadiness.finalReadinessLabel).toBe(
      "OFFICE_WINNER_SEOUL_MAYOR_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
    );
    expect(artifacts.pairReadiness.venuePair).toBe("LIMITLESS|POLYMARKET");
    expect(artifacts.pairReadiness.exactSafeCandidates).toContain("ahn_cheol_soo");
    expect(artifacts.pairReadiness.readinessReviewJustified).toBe(true);
    expect(artifacts.reviewPackage.reviewState).toBe("READY_PENDING_OPERATOR_REVIEW");
    expect(artifacts.pairReviewPackage.reviewState).toBe("READY_PENDING_OPERATOR_REVIEW");
    expect(artifacts.reviewPackage.saferPairFallback.venuePair).toBe("LIMITLESS|POLYMARKET");
    expect(artifacts.adminSurfaceSummary.currentReadinessDecision).toBe("READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION");
    expect(artifacts.pairAdminSurfaceSummary.currentReadinessDecision).toBe("READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION");
  });
});
