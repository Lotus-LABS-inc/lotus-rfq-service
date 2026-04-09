import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { PoliticsOfficeWinnerUsPresident2028MatcherFinalDecision } from "../../src/matching/politics/politics-types.js";
import { buildPoliticsOfficeWinnerUsPresident2028LimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/politics-office-winner-us-president-2028-limited-prod-readiness.js";
import { readArtifact } from "../../src/operations/semantic-expansion/shared.js";

describe("office winner usa president 2028 limited-prod readiness", () => {
  it("builds a narrow readiness package from office-winner matcher truth", () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const inputSummary = readArtifact<{
      exactTopic: string;
      refreshedRowsUsed: unknown;
      familyComparabilitySourceArtifacts: Record<string, string>;
      admittedVenues: string[];
      admittedCandidates: string[];
    }>(
      repoRoot,
      "artifacts/politics/office-winner-us-president-2028-matcher/politics-office-winner-us-president-2028-matcher-input-summary.json"
    );
    const lanes = readArtifact<{
      canonicalTopicKey: string;
      bestPair: string | null;
      matcherLanes: {
        venuePair: string;
        candidate: string;
        canonicalTopic: string;
        routeabilityDecision: string;
        rulesDecision: "SEMANTICALLY_COMPATIBLE_REWORDING";
        evidence: {
          venue: string;
          venueMarketId: string;
          rawOutcomeLabel: string;
        }[];
        evidenceNotes: string[];
      }[];
    }>(
      repoRoot,
      "artifacts/politics/office-winner-us-president-2028-matcher/politics-office-winner-us-president-2028-matcher-lanes.json"
    );
    const rejections = readArtifact<{
      rejections: {
        scope: "candidate" | "lane" | "venue";
        reason: string;
        notes: string;
        venue?: string | null;
      }[];
    }>(
      repoRoot,
      "artifacts/politics/office-winner-us-president-2028-matcher/politics-office-winner-us-president-2028-matcher-rejections.json"
    );
    const finalDecision = readArtifact<PoliticsOfficeWinnerUsPresident2028MatcherFinalDecision>(
      repoRoot,
      "artifacts/politics/office-winner-us-president-2028-matcher/politics-office-winner-us-president-2028-matcher-final-decision.json"
    );

    const artifacts = buildPoliticsOfficeWinnerUsPresident2028LimitedProdReadinessArtifacts({
      inputSummary,
      lanes,
      rejections,
      finalDecision
    });

    expect(artifacts.readiness.finalReadinessLabel).toBe("OFFICE_WINNER_US_PRESIDENT_2028_LIMITED_PROD_READY_PENDING_OPERATOR_RULE_REVIEW");
    expect(artifacts.readiness.topicKey).toBe("OFFICE_WINNER|USA|US_PRESIDENT|2028");
    expect(artifacts.readiness.venuePair).toBe("LIMITLESS|POLYMARKET");
    expect(artifacts.readiness.exactSafeCandidates).toEqual([
      "alexandria_ocasio_cortez",
      "donald_trump",
      "gavin_newsom",
      "jd_vance",
      "josh_shapiro",
      "kamala_harris",
      "marco_rubio"
    ]);
    expect(artifacts.readiness.ruleStatus).toBe("SEMANTICALLY_COMPATIBLE_REWORDING");
    expect(artifacts.readiness.operatorRuleReviewRequired).toBe(true);
    expect(artifacts.readiness.exclusionsStillMandatory).toContain("NO_MYRIAD_FOR_THIS_TOPIC");
    expect(artifacts.readiness.exclusionsStillMandatory).toContain("NO_TRI_IMPLICATION");
    expect(artifacts.adminSurfaceSummary.supportedActions).toEqual(["inspect", "hold", "promote", "rollback"]);
    expect(artifacts.adminSurfaceSummary.userConsentCanWidenScope).toBe(false);
    expect(artifacts.readinessVsMatcherDelta.stillBlocked).toContain("operator_rule_review_not_completed");
  });
});
