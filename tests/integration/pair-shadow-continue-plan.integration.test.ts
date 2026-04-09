import { describe, expect, it } from "vitest";

import { buildPairShadowContinuePlan } from "../../src/operations/semantic-expansion/pair-shadow-continue-plan.js";

describe("pair shadow continue plan", () => {
  it("explains exact failing metrics and next observation targets when canary remains blocked", async () => {
    const adminService = {
      listPairRoutes: async () => [
        { routeClassId: "PAIR_PM_LIMITLESS" },
        { routeClassId: "PAIR_PM_OPINION" }
      ],
      getShadowEvidence: async (routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION") => ({
        runtimeExactSafeSubset: {
          exactSafeObservationCount: routeClass === "PAIR_PM_LIMITLESS" ? 0 : 0
        },
        countableRuntimeExactSafeSubset: {
          exactSafeObservationCount: routeClass === "PAIR_PM_LIMITLESS" ? 2 : 1
        }
      }),
      getCanaryReadiness: async (routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION") => ({
        blockerReasons: ["minimumExactSafeObservations"],
        thresholdResults: [
          {
            metric: "minimumExactSafeObservations",
            pass: false,
            actual: routeClass === "PAIR_PM_LIMITLESS" ? 2 : 1,
            threshold: routeClass === "PAIR_PM_LIMITLESS" ? 5 : 3,
            comparator: ">="
          }
        ]
      })
    };

    const artifact = await buildPairShadowContinuePlan(adminService as never);
    const limitless = artifact.routes.find((entry) => entry.routeClass === "PAIR_PM_LIMITLESS");
    const opinion = artifact.routes.find((entry) => entry.routeClass === "PAIR_PM_OPINION");

    expect(limitless?.blockerMetrics[0]?.actual).toBe(2);
    expect(limitless?.totalCountableExactSafeObservationCount).toBe(2);
    expect(opinion?.blockerMetrics[0]?.target).toBe(3);
    expect(limitless?.recommendedOperatorAction).toContain("Remain shadow");
    expect(opinion?.nextObservationTarget).toContain("reach 3");
  });
});
