import { describe, expect, it } from "vitest";

import { QualificationStage } from "../../src/core/qualification/qualification.types.js";
import { evaluatePairRouteGate } from "../../src/rollout/pair-route-gating.js";

describe("pair route gating", () => {
  it("fails closed for canary when live-only pair readiness is absent", () => {
    const result = evaluatePairRouteGate({
      targetStage: QualificationStage.CANARY,
      category: "CRYPTO",
      family: "CRYPTO:ATH_BY_DATE",
      qualification: {
        routeClassId: "PAIR_PM_LIMITLESS",
        readinessState: "SHADOW_READY",
        liveQualification: { routeableMarketCount: 0, eventCount: 0, exactLiveOnlyCount: 0, basisClean: false }
      } as never
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("readiness_below_canary");
  });
});

