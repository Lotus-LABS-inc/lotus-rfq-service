import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { PoliticsNomineeDemocraticPairMatcherFinalDecision } from "../../src/matching/politics/politics-types.js";
import { readArtifact } from "../../src/operations/semantic-expansion/shared.js";
import { buildPoliticsNominee2028DemocraticLimitedProdReadinessArtifacts } from "../../src/operations/semantic-expansion/politics-nominee-2028-democratic-limited-prod-readiness.js";

describe("politics nominee 2028 democratic limited-prod readiness", () => {
  it("builds a narrow readiness package from the democratic matcher truth", () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const inputSummary = readArtifact<{
      topicKey: string;
      refreshedRowsUsed: unknown;
      admittedVenues: string[];
      admittedCandidates: string[];
    }>(
      repoRoot,
      "artifacts/politics/nominee-2028-democratic-pair-matcher/politics-nominee-2028-democratic-pair-matcher-input-summary.json"
    );
    const lanes = readArtifact<{
      topicKey: string;
      bestPair: string | null;
      matcherLanes: {
        venuePair: string;
        candidate: string;
        canonicalTopic: string;
        routeabilityDecision: string;
        rulesDecision: "EXACT_RULE_COMPATIBLE";
        evidence: {
          venue: string;
          venueMarketId: string;
          rawOutcomeLabel: string;
        }[];
        evidenceNotes: string[];
      }[];
    }>(
      repoRoot,
      "artifacts/politics/nominee-2028-democratic-pair-matcher/politics-nominee-2028-democratic-pair-matcher-lanes.json"
    );
    const rejections = readArtifact<{
      rejections: {
        scope: "candidate" | "lane";
        reason: string;
        notes: string;
      }[];
    }>(
      repoRoot,
      "artifacts/politics/nominee-2028-democratic-pair-matcher/politics-nominee-2028-democratic-pair-matcher-rejections.json"
    );
    const finalDecision = readArtifact<PoliticsNomineeDemocraticPairMatcherFinalDecision>(
      repoRoot,
      "artifacts/politics/nominee-2028-democratic-pair-matcher/politics-nominee-2028-democratic-pair-matcher-final-decision.json"
    );

    const artifacts = buildPoliticsNominee2028DemocraticLimitedProdReadinessArtifacts({
      inputSummary,
      lanes,
      rejections,
      finalDecision
    });

    expect(artifacts.readiness.finalReadinessLabel).toBe("DEMOCRATIC_PAIR_LIMITED_PROD_READY_FOR_REVIEW");
    expect(artifacts.readiness.topicKey).toBe("NOMINEE|US_PRESIDENT|2028|DEMOCRATIC");
    expect(artifacts.readiness.venuePair).toBe("LIMITLESS|POLYMARKET");
    expect(artifacts.readiness.ruleStatus).toBe("EXACT_RULE_COMPATIBLE");
    expect(artifacts.readiness.exactSafeCandidates).toEqual([
      "alexandria_ocasio_cortez",
      "andy_beshear",
      "gavin_newsom",
      "josh_shapiro",
      "kamala_harris",
      "pete_buttigieg"
    ]);
    expect(artifacts.readiness.exclusionsStillMandatory).toContain("NO_DEMOCRATIC_TRI_IMPLICATION");
    expect(artifacts.adminSurfaceSummary.supportedActions).toEqual(["inspect", "hold", "promote", "rollback"]);
    expect(artifacts.adminSurfaceSummary.userConsentCanWidenScope).toBe(false);
    expect(artifacts.readinessVsMatcherDelta.intentionallyUnchanged).toContain("no_opinion_democratic_lane_promotion");
  });
});
