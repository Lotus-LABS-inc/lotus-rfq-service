import { describe, expect, it } from "vitest";

import { buildPoliticsGeopoliticalTrumpVisitChina20260430LimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/politics-geopolitical-trump-visit-china-2026-04-30-limited-prod-readiness.js";

describe("geopolitical trump visit china 2026-04-30 limited-prod readiness", () => {
  it("keeps the exact tri scope locked and exposes all three pair lanes as first-class routes", () => {
    const artifacts = buildPoliticsGeopoliticalTrumpVisitChina20260430LimitedProdReadinessArtifacts({
      inputSummary: {
        exactTopic: "GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-04-30",
        refreshedRowsUsed: [],
        familyComparabilitySourceArtifacts: {},
        admittedVenues: ["OPINION", "POLYMARKET", "PREDICT"],
        admittedProposition: "trump_visit_china_by_2026_04_30"
      },
      pairLanes: {
        canonicalTopicKey: "GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-04-30",
        matcherLanes: [
          {
            venuePair: "OPINION|POLYMARKET",
            proposition: "TRUMP_VISIT_CHINA_BY_2026_04_30",
            canonicalTopic: "GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-04-30",
            routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
            rulesDecision: "EXACT_RULE_COMPATIBLE",
            evidence: [],
            evidenceNotes: []
          },
          {
            venuePair: "OPINION|PREDICT",
            proposition: "TRUMP_VISIT_CHINA_BY_2026_04_30",
            canonicalTopic: "GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-04-30",
            routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
            rulesDecision: "EXACT_RULE_COMPATIBLE",
            evidence: [],
            evidenceNotes: []
          },
          {
            venuePair: "POLYMARKET|PREDICT",
            proposition: "TRUMP_VISIT_CHINA_BY_2026_04_30",
            canonicalTopic: "GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-04-30",
            routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
            rulesDecision: "EXACT_RULE_COMPATIBLE",
            evidence: [],
            evidenceNotes: []
          }
        ]
      },
      triLanes: {
        canonicalTopicKey: "GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-04-30",
        venueSet: "OPINION|POLYMARKET|PREDICT",
        matcherLanes: [
          {
            venueSet: "OPINION|POLYMARKET|PREDICT",
            proposition: "TRUMP_VISIT_CHINA_BY_2026_04_30",
            canonicalTopic: "GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA|2026-04-30",
            routeabilityDecision: "TRI_EXACT_AUTO_ROUTEABLE",
            rulesDecision: "EXACT_RULE_COMPATIBLE",
            evidence: [],
            evidenceNotes: []
          }
        ]
      },
      rejections: {
        rejections: [
          { scope: "venue", venue: "LIMITLESS", reason: "VENUE_NOT_PRESENT_FOR_TOPIC", notes: "limitless absent" },
          { scope: "venue", venue: "MYRIAD", reason: "VENUE_NOT_PRESENT_FOR_TOPIC", notes: "myriad absent" }
        ]
      },
      finalDecision: {
        overallDecision: "GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_TRI_READY_BUT_PAIR_FIRST",
        bestPair: "OPINION|POLYMARKET",
        bestTriIfAny: "OPINION|POLYMARKET|PREDICT",
        pairMatcherReady: true,
        triMatcherReady: true,
        pairStillPreferred: true,
        exactSafePairCandidateCount: 3,
        exactSafeTriCandidateCount: 1,
        ruleStatus: "EXACT_RULE_COMPATIBLE",
        operatorCredible: true,
        matcherFollowUpJustified: true,
        singleBestNextAction: "review"
      }
    });

    expect(artifacts.readiness.finalReadinessLabel).toBe("GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_LIMITED_PROD_READY_FOR_REVIEW");
    expect(artifacts.readiness.triVenueSet).toBe("OPINION|POLYMARKET|PREDICT");
    expect(artifacts.readiness.exactSafeTriPropositions).toEqual(["TRUMP_VISIT_CHINA_BY_2026_04_30"]);
    expect(artifacts.readiness.peerPairRoutes.map((route) => route.venuePair)).toEqual([
      "OPINION|POLYMARKET",
      "OPINION|PREDICT",
      "POLYMARKET|PREDICT"
    ]);
    expect(artifacts.readiness.operatorRuleReviewRequired).toBe(false);
    expect(artifacts.pairReadinessByVenuePair["OPINION|POLYMARKET"].finalReadinessLabel).toBe("GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_LIMITED_PROD_READY_FOR_REVIEW");
    expect(artifacts.pairReadinessByVenuePair["OPINION|PREDICT"].finalReadinessLabel).toBe("GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_LIMITED_PROD_READY_FOR_REVIEW");
    expect(artifacts.pairReadinessByVenuePair["POLYMARKET|PREDICT"].finalReadinessLabel).toBe("GEOPOLITICAL_TRUMP_VISIT_CHINA_2026_04_30_LIMITED_PROD_READY_FOR_REVIEW");
    expect(artifacts.adminSurfaceSummary.currentReadinessDecision).toBe("READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION");
    expect(artifacts.pairAdminSurfaceSummaries["OPINION|POLYMARKET"].currentReadinessDecision).toBe("READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION");
    expect(artifacts.pairAdminSurfaceSummaries["OPINION|PREDICT"].currentReadinessDecision).toBe("READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION");
    expect(artifacts.pairAdminSurfaceSummaries["POLYMARKET|PREDICT"].currentReadinessDecision).toBe("READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION");
  });
});
