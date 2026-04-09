import { describe, expect, it } from "vitest";

import { buildPoliticsPartyControlBalanceOfPower2026LimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/politics-party-control-balance-of-power-2026-limited-prod-readiness.js";

describe("party-control balance of power 2026 limited-prod readiness", () => {
  it("keeps exact tri scope locked and preserves the exact pair fallback as a separate lane", () => {
    const artifacts = buildPoliticsPartyControlBalanceOfPower2026LimitedProdReadinessArtifacts({
      inputSummary: {
        exactTopic: "PARTY_CONTROL|USA|CONGRESS|2026|BALANCE_OF_POWER",
        refreshedRowsUsed: [],
        familyComparabilitySourceArtifacts: {},
        admittedVenues: ["OPINION", "POLYMARKET", "PREDICT"],
        admittedOutcomes: ["D_SENATE_R_HOUSE", "DEMOCRATS_SWEEP", "R_SENATE_D_HOUSE", "REPUBLICANS_SWEEP"]
      },
      pairLanes: {
        canonicalTopicKey: "PARTY_CONTROL|USA|CONGRESS|2026|BALANCE_OF_POWER",
        matcherLanes: [
          {
            venuePair: "POLYMARKET|PREDICT",
            outcome: "D_SENATE_R_HOUSE",
            canonicalTopic: "PARTY_CONTROL|USA|CONGRESS|2026|BALANCE_OF_POWER",
            routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
            rulesDecision: "EXACT_RULE_COMPATIBLE",
            evidence: [],
            evidenceNotes: []
          },
          {
            venuePair: "POLYMARKET|PREDICT",
            outcome: "DEMOCRATS_SWEEP",
            canonicalTopic: "PARTY_CONTROL|USA|CONGRESS|2026|BALANCE_OF_POWER",
            routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
            rulesDecision: "EXACT_RULE_COMPATIBLE",
            evidence: [],
            evidenceNotes: []
          },
          {
            venuePair: "POLYMARKET|PREDICT",
            outcome: "R_SENATE_D_HOUSE",
            canonicalTopic: "PARTY_CONTROL|USA|CONGRESS|2026|BALANCE_OF_POWER",
            routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
            rulesDecision: "EXACT_RULE_COMPATIBLE",
            evidence: [],
            evidenceNotes: []
          },
          {
            venuePair: "POLYMARKET|PREDICT",
            outcome: "REPUBLICANS_SWEEP",
            canonicalTopic: "PARTY_CONTROL|USA|CONGRESS|2026|BALANCE_OF_POWER",
            routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE",
            rulesDecision: "EXACT_RULE_COMPATIBLE",
            evidence: [],
            evidenceNotes: []
          }
        ]
      },
      triLanes: {
        canonicalTopicKey: "PARTY_CONTROL|USA|CONGRESS|2026|BALANCE_OF_POWER",
        venueSet: "OPINION|POLYMARKET|PREDICT",
        matcherLanes: [
          {
            venueSet: "OPINION|POLYMARKET|PREDICT",
            outcome: "D_SENATE_R_HOUSE",
            canonicalTopic: "PARTY_CONTROL|USA|CONGRESS|2026|BALANCE_OF_POWER",
            routeabilityDecision: "TRI_EXACT_AUTO_ROUTEABLE",
            rulesDecision: "EXACT_RULE_COMPATIBLE",
            evidence: [],
            evidenceNotes: []
          },
          {
            venueSet: "OPINION|POLYMARKET|PREDICT",
            outcome: "DEMOCRATS_SWEEP",
            canonicalTopic: "PARTY_CONTROL|USA|CONGRESS|2026|BALANCE_OF_POWER",
            routeabilityDecision: "TRI_EXACT_AUTO_ROUTEABLE",
            rulesDecision: "EXACT_RULE_COMPATIBLE",
            evidence: [],
            evidenceNotes: []
          },
          {
            venueSet: "OPINION|POLYMARKET|PREDICT",
            outcome: "REPUBLICANS_SWEEP",
            canonicalTopic: "PARTY_CONTROL|USA|CONGRESS|2026|BALANCE_OF_POWER",
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
            scope: "outcome",
            reason: "OTHERS_EXCLUDED",
            notes: "other excluded"
          },
          {
            scope: "outcome",
            outcomeIdentityKey: "R_SENATE_D_HOUSE",
            normalizedOutcomeName: "R_SENATE_D_HOUSE",
            venueSet: "OPINION|POLYMARKET|PREDICT",
            reason: "TRI_EDGE_MISSING",
            notes: "pair only"
          }
        ]
      },
      finalDecision: {
        overallDecision: "PARTY_CONTROL_BALANCE_OF_POWER_2026_TRI_READY_BUT_PAIR_FIRST",
        bestPair: "POLYMARKET|PREDICT",
        bestTriIfAny: "OPINION|POLYMARKET|PREDICT",
        pairMatcherReady: true,
        triMatcherReady: true,
        pairStillPreferred: true,
        exactSafePairCandidateCount: 4,
        exactSafeTriCandidateCount: 3,
        ruleStatus: "EXACT_RULE_COMPATIBLE",
        operatorCredible: true,
        matcherFollowUpJustified: true,
        singleBestNextAction: "review"
      }
    });

    expect(artifacts.readiness.finalReadinessLabel).toBe(
      "PARTY_CONTROL_BALANCE_OF_POWER_2026_LIMITED_PROD_READY_FOR_REVIEW"
    );
    expect(artifacts.readiness.triVenueSet).toBe("OPINION|POLYMARKET|PREDICT");
    expect(artifacts.readiness.exactSafeTriOutcomes).toEqual([
      "D_SENATE_R_HOUSE",
      "DEMOCRATS_SWEEP",
      "REPUBLICANS_SWEEP"
    ]);
    expect(artifacts.readiness.saferPairFallback.venuePair).toBe("POLYMARKET|PREDICT");
    expect(artifacts.readiness.operatorRuleReviewRequired).toBe(false);
    expect(artifacts.readiness.readinessReviewJustified).toBe(true);
    expect(artifacts.pairReadiness.finalReadinessLabel).toBe(
      "PARTY_CONTROL_BALANCE_OF_POWER_2026_LIMITED_PROD_READY_FOR_REVIEW"
    );
    expect(artifacts.pairReadiness.venuePair).toBe("POLYMARKET|PREDICT");
    expect(artifacts.pairReadiness.exactSafeOutcomes).toContain("R_SENATE_D_HOUSE");
    expect(artifacts.pairReadiness.readinessReviewJustified).toBe(true);
    expect(artifacts.adminSurfaceSummary.currentReadinessDecision).toBe("READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION");
    expect(artifacts.pairAdminSurfaceSummary.currentReadinessDecision).toBe("READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION");
  });
});
