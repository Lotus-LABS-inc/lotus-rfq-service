import { describe, expect, it } from "vitest";

import { buildStagingShadowNextStepDecisionArtifact } from "../../src/operations/semantic-expansion/staging-shadow-next-step-decision.js";

describe("pair shadow next-step decision", () => {
  it("reports clear shadow vs canary-review decisions from updated runtime evidence", async () => {
    const adminService = {
      listPairRoutes: async () => [
        { routeClassId: "PAIR_PM_LIMITLESS" },
        { routeClassId: "PAIR_PM_OPINION" }
      ],
      getCanaryReadiness: async (routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION") => ({
        recommendation: routeClass === "PAIR_PM_OPINION" ? "CANARY_APPROVED_PENDING_OPERATOR_ACTION" : "REMAIN_SHADOW",
        blockerReasons: routeClass === "PAIR_PM_OPINION" ? [] : ["minimumExactSafeObservations"],
        thresholdResults: [
          {
            metric: "minimumExactSafeObservations",
            threshold: routeClass === "PAIR_PM_OPINION" ? 3 : 5
          }
        ]
      }),
      getShadowEvidence: async (routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION") => ({
        runtimeExactSafeSubset: {
          exactSafeObservationCount: routeClass === "PAIR_PM_OPINION" ? 3 : 2
        },
        countableRuntimeExactSafeSubset: {
          exactSafeObservationCount: routeClass === "PAIR_PM_OPINION" ? 3 : 2
        }
      })
    };

    const artifact = await buildStagingShadowNextStepDecisionArtifact(adminService as never);
    const limitless = artifact.routes.find((entry) => entry.routeClass === "PAIR_PM_LIMITLESS");
    const opinion = artifact.routes.find((entry) => entry.routeClass === "PAIR_PM_OPINION");

    expect(limitless?.decision).toBe("REMAIN_SHADOW__INSUFFICIENT_RUNTIME_EXACT_SAFE_EVIDENCE");
    expect(limitless?.thresholdTarget).toBe(5);
    expect(opinion?.decision).toBe("CANARY_APPROVED_PENDING_OPERATOR_ACTION");
    expect(opinion?.nextAction).toContain("Prepare the narrow canary launch plan");
  });
});
