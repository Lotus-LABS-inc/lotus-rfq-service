import { describe, expect, it } from "vitest";

import { buildPoliticsOfficeExitNetanyahu2026LimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/politics-office-exit-netanyahu-2026-limited-prod-readiness.js";

describe("office-exit netanyahu 2026 limited-prod readiness", () => {
  it("keeps exact tri scope locked and preserves LIMITLESS|POLYMARKET as the explicit pair fallback", () => {
    const artifacts = buildPoliticsOfficeExitNetanyahu2026LimitedProdReadinessArtifacts({
      inputSummary: {
        exactTopic: "OFFICE_EXIT_BY_DATE|ISRAEL|PRIME_MINISTER|BENJAMIN_NETANYAHU|2026-12-31",
        refreshedRowsUsed: [],
        familyComparabilitySourceArtifacts: {},
        admittedVenues: ["LIMITLESS", "POLYMARKET", "PREDICT"],
        admittedProposition: "netanyahu_out_before_2027"
      },
      pairLanes: {
        canonicalTopicKey: "OFFICE_EXIT_BY_DATE|ISRAEL|PRIME_MINISTER|BENJAMIN_NETANYAHU|2026-12-31",
        matcherLanes: [
          {
            venuePair: "LIMITLESS|POLYMARKET",
            proposition: "NETANYAHU_OUT_BEFORE_2027",
            canonicalTopic: "OFFICE_EXIT_BY_DATE|ISRAEL|PRIME_MINISTER|BENJAMIN_NETANYAHU|2026-12-31",
            routeabilityDecision: "PAIR_REVIEW_REQUIRED",
            rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING",
            evidence: [],
            evidenceNotes: []
          },
          {
            venuePair: "LIMITLESS|PREDICT",
            proposition: "NETANYAHU_OUT_BEFORE_2027",
            canonicalTopic: "OFFICE_EXIT_BY_DATE|ISRAEL|PRIME_MINISTER|BENJAMIN_NETANYAHU|2026-12-31",
            routeabilityDecision: "PAIR_REVIEW_REQUIRED",
            rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING",
            evidence: [],
            evidenceNotes: []
          },
          {
            venuePair: "POLYMARKET|PREDICT",
            proposition: "NETANYAHU_OUT_BEFORE_2027",
            canonicalTopic: "OFFICE_EXIT_BY_DATE|ISRAEL|PRIME_MINISTER|BENJAMIN_NETANYAHU|2026-12-31",
            routeabilityDecision: "PAIR_REVIEW_REQUIRED",
            rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING",
            evidence: [],
            evidenceNotes: []
          }
        ]
      },
      triLanes: {
        canonicalTopicKey: "OFFICE_EXIT_BY_DATE|ISRAEL|PRIME_MINISTER|BENJAMIN_NETANYAHU|2026-12-31",
        venueSet: "LIMITLESS|POLYMARKET|PREDICT",
        matcherLanes: [
          {
            venueSet: "LIMITLESS|POLYMARKET|PREDICT",
            proposition: "NETANYAHU_OUT_BEFORE_2027",
            canonicalTopic: "OFFICE_EXIT_BY_DATE|ISRAEL|PRIME_MINISTER|BENJAMIN_NETANYAHU|2026-12-31",
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
            scope: "venue",
            venue: "OPINION",
            reason: "VENUE_NOT_PRESENT_FOR_TOPIC",
            notes: "opinion absent"
          },
          {
            scope: "venue",
            venue: "MYRIAD",
            reason: "VENUE_NOT_PRESENT_FOR_TOPIC",
            notes: "myriad absent"
          }
        ]
      },
      finalDecision: {
        overallDecision: "OFFICE_EXIT_NETANYAHU_2026_TRI_REVIEW_REQUIRED",
        bestPair: "LIMITLESS|POLYMARKET",
        bestTriIfAny: "LIMITLESS|POLYMARKET|PREDICT",
        pairMatcherReady: true,
        triMatcherReady: true,
        pairStillPreferred: true,
        exactSafePairCandidateCount: 3,
        exactSafeTriCandidateCount: 1,
        ruleStatus: "SEMANTICALLY_COMPATIBLE_REWORDING",
        operatorCredible: true,
        matcherFollowUpJustified: true,
        singleBestNextAction: "review"
      }
    });

    expect(artifacts.readiness.finalReadinessLabel).toBe(
      "OFFICE_EXIT_NETANYAHU_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
    );
    expect(artifacts.readiness.triVenueSet).toBe("LIMITLESS|POLYMARKET|PREDICT");
    expect(artifacts.readiness.exactSafeTriPropositions).toEqual(["NETANYAHU_OUT_BEFORE_2027"]);
    expect(artifacts.readiness.saferPairFallback.venuePair).toBe("LIMITLESS|POLYMARKET");
    expect(artifacts.readiness.operatorRuleReviewRequired).toBe(true);
    expect(artifacts.readiness.readinessReviewJustified).toBe(true);
    expect(artifacts.pairReadiness.finalReadinessLabel).toBe(
      "OFFICE_EXIT_NETANYAHU_2026_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW"
    );
    expect(artifacts.pairReadiness.venuePair).toBe("LIMITLESS|POLYMARKET");
    expect(artifacts.pairReadiness.exactSafePropositions).toEqual(["NETANYAHU_OUT_BEFORE_2027"]);
    expect(artifacts.adminSurfaceSummary.currentReadinessDecision).toBe("READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION");
    expect(artifacts.pairAdminSurfaceSummary.currentReadinessDecision).toBe("READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION");
  });
});
