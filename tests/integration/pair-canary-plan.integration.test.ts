import { describe, expect, it } from "vitest";

import { buildPairCanaryLaunchPlan } from "../../src/operations/semantic-expansion/pair-canary-launch-plan.js";

describe("pair canary launch plan", () => {
  it("only emits a launch plan for route classes that have actually passed canary readiness", async () => {
    const adminService = {
      listPairRoutes: async () => [
        {
          routeClassId: "PAIR_PM_LIMITLESS",
          definition: {
            canaryAllowedFamilies: ["CRYPTO:ATH_BY_DATE"]
          },
          blockedFamilies: ["CRYPTO:SAME_DAY_DIRECTIONAL"]
        },
        {
          routeClassId: "PAIR_PM_OPINION",
          definition: {
            canaryAllowedFamilies: ["CRYPTO:SAME_DAY_DIRECTIONAL"]
          },
          blockedFamilies: ["CRYPTO:ATH_BY_DATE"]
        }
      ],
      getCanaryReadiness: async (routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION") => ({
        recommendation: routeClass === "PAIR_PM_OPINION" ? "CANARY_APPROVED_PENDING_OPERATOR_ACTION" : "REMAIN_SHADOW"
      })
    };

    const plan = await buildPairCanaryLaunchPlan(adminService as never);

    expect(plan.eligibleRoutes).toHaveLength(1);
    expect(plan.eligibleRoutes[0]?.routeClass).toBe("PAIR_PM_OPINION");
    expect(plan.eligibleRoutes[0]?.scopePromoted).toBe("btc_exact_slice_only");
  });
});

