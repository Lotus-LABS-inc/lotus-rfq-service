import { describe, expect, it } from "vitest";
import type {
    BucketState,
    ControlPlaneOverride,
    PlannerShardState
} from "../../src/core/replay/control-plane.types.js";

describe("control plane domain types", () => {
    it("keeps planner shard numeric latency nullable and string-backed", () => {
        const state: PlannerShardState = {
            shardId: "planner-a",
            mode: "ACTIVE",
            activePlans: 4,
            activeBuckets: 3,
            staleReservations: 1,
            avgPlannerLatencyMs: "12.5000",
            updatedAt: new Date("2026-03-11T10:00:00.000Z")
        };

        expect(typeof state.avgPlannerLatencyMs).toBe("string");
    });

    it("keeps bucket graph density nullable and string-backed", () => {
        const state: BucketState = {
            bucketId: "bucket-a",
            bucketType: "CLEARING",
            mode: "DEGRADED",
            entityCount: 12,
            graphDensity: null,
            degradationReason: "planner_guardrail",
            updatedAt: new Date("2026-03-11T10:05:00.000Z")
        };

        expect(state.graphDensity).toBeNull();
    });

    it("keeps override payload structured and expiresAt nullable", () => {
        const override: ControlPlaneOverride = {
            id: "override-1",
            scopeType: "bucket",
            scopeId: "bucket-a",
            overrideType: "force_mode",
            payload: { mode: "READ_ONLY", reason: "ops" },
            createdBy: "ops@example.com",
            createdAt: new Date("2026-03-11T10:10:00.000Z"),
            expiresAt: null
        };

        expect(override.payload).toEqual({ mode: "READ_ONLY", reason: "ops" });
        expect(override.expiresAt).toBeNull();
    });
});
