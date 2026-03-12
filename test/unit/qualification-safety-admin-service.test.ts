import { describe, expect, it, vi } from "vitest";

import {
    QualificationSafetyActionNotFoundError,
    QualificationSafetyActionResolveError,
    QualificationSafetyAdminService
} from "../../src/api/admin/qualification-safety-admin-service.js";
import { AutoSafetyActionType } from "../../src/core/qualification/qualification.types.js";

describe("QualificationSafetyAdminService", () => {
    it("lists and gets safety actions", async () => {
        const pool = {
            query: vi
                .fn()
                .mockResolvedValueOnce({
                    rows: [{
                        id: "11111111-1111-4111-8111-111111111111",
                        strategy_key: "strategy.phase3b",
                        scope_type: "bucket",
                        scope_id: "bucket-1",
                        action_type: AutoSafetyActionType.DISABLE_PHASE2B,
                        trigger_reason: "replay_diff_spike",
                        created_at: new Date("2026-03-12T10:00:00.000Z"),
                        resolved_at: null,
                        metadata: {}
                    }]
                })
                .mockResolvedValueOnce({
                    rows: [{
                        id: "11111111-1111-4111-8111-111111111111",
                        strategy_key: "strategy.phase3b",
                        scope_type: "bucket",
                        scope_id: "bucket-1",
                        action_type: AutoSafetyActionType.DISABLE_PHASE2B,
                        trigger_reason: "replay_diff_spike",
                        created_at: new Date("2026-03-12T10:00:00.000Z"),
                        resolved_at: null,
                        metadata: {}
                    }]
                })
        };
        const service = new QualificationSafetyAdminService({
            pool: pool as never,
            autoSafetyActionEngine: { resolveAction: vi.fn() }
        });

        const list = await service.listActions({ resolved: false });
        const action = await service.getAction("11111111-1111-4111-8111-111111111111");

        expect(list).toHaveLength(1);
        expect(action.triggerReason).toBe("replay_diff_spike");
    });

    it("resolves an active action and returns the control-plane note", async () => {
        const resolveAction = vi.fn(async () => ({
            id: "11111111-1111-4111-8111-111111111111",
            strategyKey: "strategy.phase3b",
            scopeType: "bucket",
            scopeId: "bucket-1",
            actionType: AutoSafetyActionType.DISABLE_PHASE2B,
            triggerReason: "replay_diff_spike",
            createdAt: new Date("2026-03-12T10:00:00.000Z"),
            resolvedAt: new Date("2026-03-12T10:05:00.000Z"),
            metadata: {}
        }));
        const pool = {
            query: vi.fn().mockResolvedValue({
                rows: [{
                    id: "11111111-1111-4111-8111-111111111111",
                    strategy_key: "strategy.phase3b",
                    scope_type: "bucket",
                    scope_id: "bucket-1",
                    action_type: AutoSafetyActionType.DISABLE_PHASE2B,
                    trigger_reason: "replay_diff_spike",
                    created_at: new Date("2026-03-12T10:00:00.000Z"),
                    resolved_at: null,
                    metadata: {}
                }]
            })
        };
        const service = new QualificationSafetyAdminService({
            pool: pool as never,
            autoSafetyActionEngine: { resolveAction }
        });

        const result = await service.resolveAction(
            "11111111-1111-4111-8111-111111111111",
            "operator acknowledged",
            "admin@example.com"
        );

        expect(resolveAction).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", {
            resolutionReason: "operator acknowledged",
            resolvedBy: "admin@example.com"
        });
        expect(result.action.resolvedAt).not.toBeNull();
        expect(result.controlPlaneNote).toContain("no automatic rollback");
    });

    it("fails closed on missing or already resolved actions", async () => {
        const missingPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
        const missingService = new QualificationSafetyAdminService({
            pool: missingPool as never,
            autoSafetyActionEngine: { resolveAction: vi.fn() }
        });

        await expect(missingService.getAction("11111111-1111-4111-8111-111111111111")).rejects.toBeInstanceOf(
            QualificationSafetyActionNotFoundError
        );

        const resolvedPool = {
            query: vi.fn().mockResolvedValue({
                rows: [{
                    id: "11111111-1111-4111-8111-111111111111",
                    strategy_key: "strategy.phase3b",
                    scope_type: "bucket",
                    scope_id: "bucket-1",
                    action_type: AutoSafetyActionType.DISABLE_PHASE2B,
                    trigger_reason: "replay_diff_spike",
                    created_at: new Date("2026-03-12T10:00:00.000Z"),
                    resolved_at: new Date("2026-03-12T10:05:00.000Z"),
                    metadata: {}
                }]
            })
        };
        const resolvedService = new QualificationSafetyAdminService({
            pool: resolvedPool as never,
            autoSafetyActionEngine: { resolveAction: vi.fn() }
        });

        await expect(
            resolvedService.resolveAction(
                "11111111-1111-4111-8111-111111111111",
                "operator acknowledged",
                "admin@example.com"
            )
        ).rejects.toBeInstanceOf(QualificationSafetyActionResolveError);
    });
});
