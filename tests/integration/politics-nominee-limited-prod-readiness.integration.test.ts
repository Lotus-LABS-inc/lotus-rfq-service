import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildPoliticsNomineeLimitedProdArtifacts } from "../../src/operations/semantic-expansion/politics-nominee-limited-prod-readiness.js";

describe("politics nominee limited-prod readiness", () => {
  it("marks Republican pair and tri ready, and promotes the Democratic pair lane once a dedicated matcher artifact exists", () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const artifacts = buildPoliticsNomineeLimitedProdArtifacts(repoRoot);

    expect(artifacts.readinessSummary.overallReadinessPosture).toBe(
      "POLITICS_NOMINEE_LIMITED_PROD_NARROW_READY_PAIR_PREFERRED"
    );

    const republicanPair = artifacts.readinessSummary.lanes.find(
      (lane) => lane.laneId === "POLITICS_NOMINEE_REPUBLICAN_PAIR_LIMITLESS_POLYMARKET"
    );
    const republicanTri = artifacts.readinessSummary.lanes.find(
      (lane) => lane.laneId === "POLITICS_NOMINEE_REPUBLICAN_TRI_LIMITLESS_OPINION_POLYMARKET"
    );
    const democraticPair = artifacts.readinessSummary.lanes.find(
      (lane) => lane.laneId === "POLITICS_NOMINEE_DEMOCRATIC_PAIR_LIMITLESS_POLYMARKET"
    );

    expect(republicanPair?.readinessDecision).toBe("READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION");
    expect(republicanTri?.readinessDecision).toBe("READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION");
    expect(democraticPair?.readinessDecision).toBe("READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION");
    expect(democraticPair?.venueSet).toBe("LIMITLESS|POLYMARKET");
    expect(democraticPair?.triAllowed).toBe(false);
    expect(democraticPair?.candidateSet).toEqual([
      "alexandria_ocasio_cortez",
      "andy_beshear",
      "gavin_newsom",
      "josh_shapiro",
      "kamala_harris",
      "pete_buttigieg"
    ]);
    expect(democraticPair?.blockers).toEqual([]);
  });
});
