import { describe, expect, it, vi } from "vitest";

import { FeasibilityFilter } from "../../src/routing/feasibility-filter.js";
import type { RouteCandidate } from "../../src/core/sor/types.js";

const candidate: RouteCandidate = {
    id: "11111111-1111-4111-8111-111111111111",
    leg_id: "22222222-2222-4222-8222-222222222222",
    provider_type: "VENUE",
    provider_id: "venue-a",
    available_size: 10,
    quoted_price: 0.55,
    fees: {},
    latency_ms: 1,
    fill_prob: 1,
    metadata: {
        compatibility_decision_id: "decision-1"
    }
};

describe("FeasibilityFilter", () => {
    it("rejects candidates when an override is ambiguous", async () => {
        const compatibilityOverrideService = {
            resolveEffectiveDecision: vi.fn(async () => ({
                baseDecision: {
                    id: "decision-1",
                    compatibilityVersionId: "version-1"
                },
                effectiveClass: "DO_NOT_POOL",
                activeOverride: null,
                overrideAmbiguous: true
            }))
        } as any;

        const result = await new FeasibilityFilter(compatibilityOverrideService).filter([candidate]);
        expect(result.acceptedCandidates).toHaveLength(0);
        expect(result.rejectedCandidates[0]?.reasonCode).toBe("COMPATIBILITY_OVERRIDE_AMBIGUOUS");
        expect(result.compatibilityDecisionIds).toEqual(["decision-1"]);
        expect(result.compatibilityVersionIds).toEqual(["version-1"]);
    });
});
