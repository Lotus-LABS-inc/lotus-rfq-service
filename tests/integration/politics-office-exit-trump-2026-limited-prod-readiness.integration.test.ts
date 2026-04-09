import { describe, expect, it } from "vitest";

import { buildPoliticsOfficeExitTrump2026LimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/politics-office-exit-trump-2026-limited-prod-readiness.js";

describe("office-exit Trump 2026 limited-prod readiness", () => {
  it("keeps exact tri scope locked and preserves LIMITLESS|POLYMARKET as a peer pair route", () => {
    const artifacts = buildPoliticsOfficeExitTrump2026LimitedProdReadinessArtifacts({
      inputSummary: {
        exactTopic: "OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31",
        refreshedRowsUsed: [],
        familyComparabilitySourceArtifacts: {},
        admittedVenues: ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"],
        admittedProposition: "trump_out_before_2027"
      },
      pairLanes: {
        canonicalTopicKey: "OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31",
        matcherLanes: [
          {
            venuePair: "LIMITLESS|OPINION",
            proposition: "TRUMP_OUT_BEFORE_2027",
            canonicalTopic: "OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31",
            routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
            rulesDecision: "EXACT_RULE_COMPATIBLE",
            evidence: [],
            evidenceNotes: []
          },
          {
            venuePair: "LIMITLESS|POLYMARKET",
            proposition: "TRUMP_OUT_BEFORE_2027",
            canonicalTopic: "OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31",
            routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
            rulesDecision: "EXACT_RULE_COMPATIBLE",
            evidence: [],
            evidenceNotes: []
          },
          {
            venuePair: "LIMITLESS|PREDICT",
            proposition: "TRUMP_OUT_BEFORE_2027",
            canonicalTopic: "OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31",
            routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
            rulesDecision: "EXACT_RULE_COMPATIBLE",
            evidence: [],
            evidenceNotes: []
          },
          {
            venuePair: "OPINION|POLYMARKET",
            proposition: "TRUMP_OUT_BEFORE_2027",
            canonicalTopic: "OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31",
            routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
            rulesDecision: "EXACT_RULE_COMPATIBLE",
            evidence: [],
            evidenceNotes: []
          },
          {
            venuePair: "OPINION|PREDICT",
            proposition: "TRUMP_OUT_BEFORE_2027",
            canonicalTopic: "OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31",
            routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
            rulesDecision: "EXACT_RULE_COMPATIBLE",
            evidence: [],
            evidenceNotes: []
          },
          {
            venuePair: "POLYMARKET|PREDICT",
            proposition: "TRUMP_OUT_BEFORE_2027",
            canonicalTopic: "OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31",
            routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
            rulesDecision: "EXACT_RULE_COMPATIBLE",
            evidence: [],
            evidenceNotes: []
          }
        ]
      },
      triLanes: {
        canonicalTopicKey: "OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31",
        venueSet: "LIMITLESS|OPINION|POLYMARKET",
        matcherLanes: [
          {
            venueSet: "LIMITLESS|OPINION|POLYMARKET",
            proposition: "TRUMP_OUT_BEFORE_2027",
            canonicalTopic: "OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31",
            routeabilityDecision: "TRI_EXACT_AUTO_ROUTEABLE",
            rulesDecision: "EXACT_RULE_COMPATIBLE",
            evidence: [],
            evidenceNotes: []
          }
        ]
      },
      rejections: {
        rejections: [
          {
            scope: "venue",
            venue: "MYRIAD",
            reason: "VENUE_NOT_PRESENT_FOR_TOPIC",
            notes: "myriad absent"
          }
        ]
      },
      finalDecision: {
        overallDecision: "OFFICE_EXIT_TRUMP_2026_TRI_READY_BUT_PAIR_FIRST",
        bestPair: "LIMITLESS|POLYMARKET",
        bestTriIfAny: "LIMITLESS|OPINION|POLYMARKET",
        pairMatcherReady: true,
        triMatcherReady: true,
        pairStillPreferred: true,
        exactSafePairCandidateCount: 1,
        exactSafeTriCandidateCount: 1,
        ruleStatus: "EXACT_RULE_COMPATIBLE",
        operatorCredible: true,
        matcherFollowUpJustified: true,
        singleBestNextAction: "review"
      }
    });

    expect(artifacts.readiness.finalReadinessLabel).toBe("OFFICE_EXIT_TRUMP_2026_LIMITED_PROD_READY_FOR_REVIEW");
    expect(artifacts.readiness.triVenueSet).toBe("LIMITLESS|OPINION|POLYMARKET");
    expect(artifacts.readiness.exactSafeTriPropositions).toEqual(["TRUMP_OUT_BEFORE_2027"]);
    expect(artifacts.readiness.peerPairRoute.venuePair).toBe("LIMITLESS|POLYMARKET");
    expect(artifacts.readiness.operatorRuleReviewRequired).toBe(false);
    expect(artifacts.pairReadiness.finalReadinessLabel).toBe("OFFICE_EXIT_TRUMP_2026_LIMITED_PROD_READY_FOR_REVIEW");
    expect(artifacts.pairReadiness.venuePair).toBe("LIMITLESS|POLYMARKET");
    expect(artifacts.pairReadiness.exactSafePropositions).toEqual(["TRUMP_OUT_BEFORE_2027"]);
    expect(artifacts.adminSurfaceSummary.currentReadinessDecision).toBe("READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION");
    expect(artifacts.pairAdminSurfaceSummary.currentReadinessDecision).toBe("READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION");
  });
});
