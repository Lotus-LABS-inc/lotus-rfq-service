import { describe, expect, it } from "vitest";

import { buildPoliticsGeopoliticalTrumpAcquireGreenland20261231LimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/politics-geopolitical-trump-acquire-greenland-2026-12-31-limited-prod-readiness.js";

describe("geopolitical trump acquire greenland 2026-12-31 limited-prod readiness", () => {
  it("keeps the exact tri scope locked and exposes all pair lanes as first-class routes", () => {
    const artifacts = buildPoliticsGeopoliticalTrumpAcquireGreenland20261231LimitedProdReadinessArtifacts({
      inputSummary: {
        exactTopic: "GEOPOLITICAL_EVENT_BY_DATE|USA_GREENLAND|TRUMP_ACQUIRE_GREENLAND|2026-12-31",
        refreshedRowsUsed: [],
        familyComparabilitySourceArtifacts: {},
        admittedVenues: ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"],
        admittedProposition: "trump_acquire_greenland_by_2026_12_31"
      },
      pairLanes: {
        canonicalTopicKey: "GEOPOLITICAL_EVENT_BY_DATE|USA_GREENLAND|TRUMP_ACQUIRE_GREENLAND|2026-12-31",
        matcherLanes: [
          { venuePair: "LIMITLESS|POLYMARKET", proposition: "TRUMP_ACQUIRE_GREENLAND_BY_2026_12_31", canonicalTopic: "GEOPOLITICAL_EVENT_BY_DATE|USA_GREENLAND|TRUMP_ACQUIRE_GREENLAND|2026-12-31", routeabilityDecision: "PAIR_REVIEW_REQUIRED", rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING", evidence: [], evidenceNotes: [] },
          { venuePair: "LIMITLESS|OPINION", proposition: "TRUMP_ACQUIRE_GREENLAND_BY_2026_12_31", canonicalTopic: "GEOPOLITICAL_EVENT_BY_DATE|USA_GREENLAND|TRUMP_ACQUIRE_GREENLAND|2026-12-31", routeabilityDecision: "PAIR_REVIEW_REQUIRED", rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING", evidence: [], evidenceNotes: [] },
          { venuePair: "LIMITLESS|PREDICT", proposition: "TRUMP_ACQUIRE_GREENLAND_BY_2026_12_31", canonicalTopic: "GEOPOLITICAL_EVENT_BY_DATE|USA_GREENLAND|TRUMP_ACQUIRE_GREENLAND|2026-12-31", routeabilityDecision: "PAIR_REVIEW_REQUIRED", rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING", evidence: [], evidenceNotes: [] },
          { venuePair: "OPINION|POLYMARKET", proposition: "TRUMP_ACQUIRE_GREENLAND_BY_2026_12_31", canonicalTopic: "GEOPOLITICAL_EVENT_BY_DATE|USA_GREENLAND|TRUMP_ACQUIRE_GREENLAND|2026-12-31", routeabilityDecision: "PAIR_REVIEW_REQUIRED", rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING", evidence: [], evidenceNotes: [] },
          { venuePair: "OPINION|PREDICT", proposition: "TRUMP_ACQUIRE_GREENLAND_BY_2026_12_31", canonicalTopic: "GEOPOLITICAL_EVENT_BY_DATE|USA_GREENLAND|TRUMP_ACQUIRE_GREENLAND|2026-12-31", routeabilityDecision: "PAIR_REVIEW_REQUIRED", rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING", evidence: [], evidenceNotes: [] },
          { venuePair: "POLYMARKET|PREDICT", proposition: "TRUMP_ACQUIRE_GREENLAND_BY_2026_12_31", canonicalTopic: "GEOPOLITICAL_EVENT_BY_DATE|USA_GREENLAND|TRUMP_ACQUIRE_GREENLAND|2026-12-31", routeabilityDecision: "PAIR_REVIEW_REQUIRED", rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING", evidence: [], evidenceNotes: [] }
        ]
      },
      triLanes: {
        canonicalTopicKey: "GEOPOLITICAL_EVENT_BY_DATE|USA_GREENLAND|TRUMP_ACQUIRE_GREENLAND|2026-12-31",
        venueSet: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
        matcherLanes: [
          {
            venueSet: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
            proposition: "TRUMP_ACQUIRE_GREENLAND_BY_2026_12_31",
            canonicalTopic: "GEOPOLITICAL_EVENT_BY_DATE|USA_GREENLAND|TRUMP_ACQUIRE_GREENLAND|2026-12-31",
            routeabilityDecision: "TRI_REVIEW_REQUIRED",
            rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING",
            evidence: [],
            evidenceNotes: []
          }
        ]
      },
      rejections: {
        rejections: [
          { scope: "venue", venue: "MYRIAD", reason: "VENUE_NOT_PRESENT_FOR_TOPIC", notes: "myriad absent" }
        ]
      },
      finalDecision: {
        overallDecision: "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_TRI_REVIEW_REQUIRED",
        bestPair: "LIMITLESS|POLYMARKET",
        bestTriIfAny: "LIMITLESS|OPINION|POLYMARKET|PREDICT",
        pairMatcherReady: true,
        triMatcherReady: true,
        pairStillPreferred: true,
        exactSafePairCandidateCount: 6,
        exactSafeTriCandidateCount: 1,
        ruleStatus: "SEMANTICALLY_COMPATIBLE_REWORDING",
        operatorCredible: true,
        matcherFollowUpJustified: true,
        singleBestNextAction: "review"
      }
    });

    expect(artifacts.readiness.finalReadinessLabel).toBe("GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW");
    expect(artifacts.readiness.triVenueSet).toBe("LIMITLESS|OPINION|POLYMARKET|PREDICT");
    expect(artifacts.readiness.peerPairRoutes).toHaveLength(6);
    expect(artifacts.readiness.operatorRuleReviewRequired).toBe(true);
    expect(artifacts.pairReadinessByVenuePair["LIMITLESS|POLYMARKET"].finalReadinessLabel).toBe("GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_2026_12_31_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW");
    expect(artifacts.pairAdminSurfaceSummaries["LIMITLESS|POLYMARKET"].currentReadinessDecision).toBe("READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION");
  });
});
