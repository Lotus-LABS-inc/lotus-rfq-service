import { describe, expect, it } from "vitest";

import { buildPairShadowRuntimeCollectionSummary } from "../../src/operations/semantic-expansion/pair-shadow-runtime-collection-summary.js";

describe("pair canary rerun inputs", () => {
  it("separates runtime observations from bootstrap counts for both route classes", async () => {
    const adminService = {
      listPairRoutes: async () => [
        {
          routeClassId: "PAIR_PM_LIMITLESS",
          safeSubsetMarkets: [{}, {}],
          runnableMarkets: [{}, {}],
          blockedFamilies: ["A"]
        },
        {
          routeClassId: "PAIR_PM_OPINION",
          safeSubsetMarkets: [{}],
          runnableMarkets: [],
          blockedFamilies: ["B", "C"]
        }
      ],
      listShadowObservations: async (routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION") =>
        routeClass === "PAIR_PM_LIMITLESS"
          ? [
              { sourceKind: "RUNTIME_OBSERVATION", scopeKind: "SAFE_EXACT_SUBSET", metadata: {} },
              { sourceKind: "RUNTIME_OBSERVATION", scopeKind: "SHADOW_ONLY_SUBSET", metadata: {} },
              { sourceKind: "RUNTIME_OBSERVATION", scopeKind: "SAFE_EXACT_SUBSET", metadata: { verification: true } }
            ]
          : [
              { sourceKind: "RUNTIME_OBSERVATION", scopeKind: "SAFE_EXACT_SUBSET", metadata: {} },
              { sourceKind: "BOOTSTRAP_ARTIFACT", scopeKind: "SAFE_EXACT_SUBSET", metadata: {} }
            ],
      getPromotionBlockers: async (routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION") =>
        routeClass === "PAIR_PM_LIMITLESS" ? ["minimumExactSafeObservations"] : []
    };

    const summary = await buildPairShadowRuntimeCollectionSummary(adminService as never);
    const limitless = summary.routes.find((entry) => entry.routeClass === "PAIR_PM_LIMITLESS");
    const opinion = summary.routes.find((entry) => entry.routeClass === "PAIR_PM_OPINION");

    expect(limitless?.runtimeObservationCount).toBe(2);
    expect(limitless?.runtimeExactSafeObservationCount).toBe(1);
    expect(limitless?.bootstrapObservationCount).toBe(5);
    expect(opinion?.runtimeObservationCount).toBe(1);
    expect(opinion?.runtimeExactSafeObservationCount).toBe(1);
    expect(opinion?.bootstrapObservationCount).toBe(3);
  });
});

