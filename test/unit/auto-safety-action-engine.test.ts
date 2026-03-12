import { describe, expect, it, vi } from "vitest";
import type { Pool, QueryResult, QueryResultRow } from "pg";

import {
    AutoSafetyActionEngine,
    AutoSafetyActionEngineError,
    type AutoSafetyActionConfig,
    type AutoSafetyEvaluationInput
} from "../../src/core/qualification/auto-safety-action-engine.js";
import { AutoSafetyActionType, QualificationStage } from "../../src/core/qualification/qualification.types.js";

const makeQueryResult = <T extends QueryResultRow>(rows: T[]): QueryResult<T> => ({
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows
});

const baseConfig: AutoSafetyActionConfig = {
    version: "phase3b-auto-safety-v1",
    thresholds: {
        replayDiffSpike: { maxDiffRate: 0.02, maxErrorRate: 0.005, minBreachedWindows: 3, minDurationMs: 30000 },
        reconciliationMismatchSpike: {
            maxMismatchCount: 0,
            maxMismatchRate: 0,
            maxInfraErrorCount: 0,
            maxLockConflictCount: 0,
            minBreachedWindows: 2,
            minDurationMs: 20000
        },
        plannerLatencyBreach: { maxP95Ms: 250, maxP99Ms: 400, minBreachedWindows: 4, minDurationMs: 60000 },
        negativeEconomicQuality: {
            minPriceImprovement: "0",
            minSlippageSaved: "0",
            minFeeSaved: "0",
            minExternalNotionalAvoided: "0",
            minInternalizationGain: "0",
            minCompressionGain: "0",
            minBreachedWindows: 3,
            minDurationMs: 30000
        },
        staleReservationGrowth: {
            maxStaleReservationCount: 10,
            maxGrowthRate: 0.25,
            minBreachedWindows: 2,
            minDurationMs: 30000
        },
        internalizationFailureSpike: {
            maxFailureCount: 2,
            maxFailureRate: 0.1,
            minBreachedWindows: 2,
            minDurationMs: 20000
        }
    },
    actions: {
        replay_diff_spike: AutoSafetyActionType.DISABLE_PHASE2B,
        reconciliation_mismatch_spike: AutoSafetyActionType.DISABLE_PHASE2A_AND_2B,
        planner_latency_breach_sustained: AutoSafetyActionType.FORCE_SOR_ONLY,
        negative_economic_quality_sustained: AutoSafetyActionType.DEMOTE_STAGE,
        stale_reservation_growth: AutoSafetyActionType.PAUSE_SCOPE,
        internalization_failure_spike: AutoSafetyActionType.DISABLE_RESOLUTION_POOLING
    },
    cooldownMs: 60000,
    resolutionPoolingOverrideTtlMs: 300000,
    sorOnlyOverrideTtlMs: 120000
};

const baseInput = (overrides?: Partial<AutoSafetyEvaluationInput>): AutoSafetyEvaluationInput => ({
    strategyKey: "strategy.phase3b",
    scopeType: "bucket",
    scopeId: "bucket-1",
    shardId: "shard-1",
    bucketId: "bucket-1",
    currentStage: QualificationStage.CANARY,
    signals: {
        replayDiffSpike: { diffRate: 0.001, errorRate: 0, breachedWindows: 0, sustainedDurationMs: 0 },
        reconciliationMismatchSpike: {
            mismatchCount: 0,
            mismatchRate: 0,
            infraErrorCount: 0,
            lockConflictCount: 0,
            breachedWindows: 0,
            sustainedDurationMs: 0
        },
        plannerLatencyBreach: { p95Ms: 100, p99Ms: 150, breachedWindows: 0, sustainedDurationMs: 0 },
        negativeEconomicQuality: {
            priceImprovement: "0.1",
            slippageSaved: "0.1",
            feeSaved: "0.1",
            externalNotionalAvoided: "1",
            internalizationGain: "1",
            compressionGain: "1",
            breachedWindows: 0,
            sustainedDurationMs: 0
        },
        staleReservationGrowth: {
            staleReservationCount: 1,
            growthRate: 0.05,
            breachedWindows: 0,
            sustainedDurationMs: 0
        },
        internalizationFailureSpike: {
            failureCount: 0,
            failureRate: 0,
            breachedWindows: 0,
            sustainedDurationMs: 0
        }
    },
    ...(overrides ?? {})
});

const buildEngine = (query: ReturnType<typeof vi.fn>, overrides?: Partial<AutoSafetyActionConfig>) => {
    const controlPlaneAdminService = {
        degradeShard: vi.fn(async (input: { targetMode: string }) => ({
            shardId: "shard-1",
            mode: input.targetMode,
            activePlans: 1,
            activeBuckets: 1,
            staleReservations: 0,
            avgPlannerLatencyMs: "100",
            updatedAt: new Date("2026-03-12T12:00:00.000Z")
        })),
        pauseShard: vi.fn(async () => ({
            shardId: "shard-1",
            mode: "PAUSED",
            activePlans: 1,
            activeBuckets: 1,
            staleReservations: 0,
            avgPlannerLatencyMs: "100",
            updatedAt: new Date("2026-03-12T12:00:00.000Z")
        })),
        drainBucket: vi.fn(async () => ({
            bucketId: "bucket-1",
            bucketType: "CLEARING",
            mode: "DRAINING",
            entityCount: 10,
            graphDensity: "0.3",
            degradationReason: "operator_drain",
            updatedAt: new Date("2026-03-12T12:00:00.000Z")
        })),
        createOverride: vi.fn(async (input: { scopeType: string; scopeId: string; overrideType: string; expiresAt?: Date | null }) => ({
            id: "override-1",
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            overrideType: input.overrideType,
            payload: {},
            createdBy: "auto-safety-action-engine",
            createdAt: new Date("2026-03-12T12:00:00.000Z"),
            expiresAt: input.expiresAt ?? null
        }))
    };

    const engine = new AutoSafetyActionEngine({
        pool: { query } as unknown as Pool,
        controlPlaneAdminService,
        config: {
            ...baseConfig,
            ...(overrides ?? {}),
            actions: {
                ...baseConfig.actions,
                ...(overrides?.actions ?? {})
            }
        }
    });

    return { engine, controlPlaneAdminService };
};

describe("AutoSafetyActionEngine", () => {
    it("detects replay diff spike and creates a DISABLE_PHASE2B action", async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce(makeQueryResult([]))
            .mockResolvedValueOnce(
                makeQueryResult([
                    {
                        id: "action-1",
                        strategy_key: "strategy.phase3b",
                        scope_type: "bucket",
                        scope_id: "bucket-1",
                        action_type: "DISABLE_PHASE2B",
                        trigger_reason: "replay_diff_spike",
                        created_at: new Date("2026-03-12T12:00:00.000Z"),
                        resolved_at: null,
                        metadata: {}
                    }
                ])
            );
        const { engine, controlPlaneAdminService } = buildEngine(query);

        const result = await engine.evaluate(
            baseInput({
                signals: {
                    ...baseInput().signals,
                    replayDiffSpike: { diffRate: 0.04, errorRate: 0.01, breachedWindows: 4, sustainedDurationMs: 45000 }
                }
            })
        );

        expect(result.triggered).toBe(true);
        expect(result.actionType).toBe(AutoSafetyActionType.DISABLE_PHASE2B);
        expect(controlPlaneAdminService.degradeShard).toHaveBeenCalledWith(
            expect.objectContaining({ targetMode: "DISABLE_PHASE2B" })
        );
    });

    it("detects reconciliation mismatch spike and creates the configured action", async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce(makeQueryResult([]))
            .mockResolvedValueOnce(
                makeQueryResult([
                    {
                        id: "action-2",
                        strategy_key: "strategy.phase3b",
                        scope_type: "bucket",
                        scope_id: "bucket-1",
                        action_type: "DISABLE_PHASE2A_AND_2B",
                        trigger_reason: "reconciliation_mismatch_spike",
                        created_at: new Date("2026-03-12T12:00:00.000Z"),
                        resolved_at: null,
                        metadata: {}
                    }
                ])
            );
        const { engine, controlPlaneAdminService } = buildEngine(query);

        const result = await engine.evaluate(
            baseInput({
                signals: {
                    ...baseInput().signals,
                    reconciliationMismatchSpike: {
                        mismatchCount: 3,
                        mismatchRate: 0.2,
                        infraErrorCount: 1,
                        lockConflictCount: 1,
                        breachedWindows: 3,
                        sustainedDurationMs: 25000
                    }
                }
            })
        );

        expect(result.actionType).toBe(AutoSafetyActionType.DISABLE_PHASE2A_AND_2B);
        expect(controlPlaneAdminService.degradeShard).toHaveBeenCalledWith(
            expect.objectContaining({ targetMode: "DISABLE_PHASE2A_AND_2B" })
        );
    });

    it("detects sustained planner latency breach and forces SOR only", async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce(makeQueryResult([]))
            .mockResolvedValueOnce(
                makeQueryResult([
                    {
                        id: "action-3",
                        strategy_key: "strategy.phase3b",
                        scope_type: "bucket",
                        scope_id: "bucket-1",
                        action_type: "FORCE_SOR_ONLY",
                        trigger_reason: "planner_latency_breach_sustained",
                        created_at: new Date("2026-03-12T12:00:00.000Z"),
                        resolved_at: null,
                        metadata: {}
                    }
                ])
            );
        const { engine, controlPlaneAdminService } = buildEngine(query);

        const result = await engine.evaluate(
            baseInput({
                signals: {
                    ...baseInput().signals,
                    plannerLatencyBreach: { p95Ms: 500, p99Ms: 800, breachedWindows: 5, sustainedDurationMs: 120000 }
                }
            })
        );

        expect(result.actionType).toBe(AutoSafetyActionType.FORCE_SOR_ONLY);
        expect(controlPlaneAdminService.degradeShard).toHaveBeenCalledWith(
            expect.objectContaining({ targetMode: "SOR_ONLY" })
        );
    });

    it("detects sustained negative economic quality and returns DEMOTE_STAGE with target stage", async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce(makeQueryResult([]))
            .mockResolvedValueOnce(
                makeQueryResult([
                    {
                        id: "action-4",
                        strategy_key: "strategy.phase3b",
                        scope_type: "bucket",
                        scope_id: "bucket-1",
                        action_type: "DEMOTE_STAGE",
                        trigger_reason: "negative_economic_quality_sustained",
                        created_at: new Date("2026-03-12T12:00:00.000Z"),
                        resolved_at: null,
                        metadata: {}
                    }
                ])
            );
        const { engine, controlPlaneAdminService } = buildEngine(query);

        const result = await engine.evaluate(
            baseInput({
                currentStage: QualificationStage.CANARY,
                signals: {
                    ...baseInput().signals,
                    negativeEconomicQuality: {
                        priceImprovement: "-0.1",
                        slippageSaved: "-0.1",
                        feeSaved: "-0.1",
                        externalNotionalAvoided: "-1",
                        internalizationGain: "-1",
                        compressionGain: "-1",
                        breachedWindows: 3,
                        sustainedDurationMs: 40000
                    }
                }
            })
        );

        expect(result.actionType).toBe(AutoSafetyActionType.DEMOTE_STAGE);
        expect(result.recommendedStage).toBe(QualificationStage.SHADOW);
        expect(controlPlaneAdminService.createOverride).toHaveBeenCalledWith(
            expect.objectContaining({ overrideType: "EXECUTION_MODE" })
        );
    });

    it("detects stale reservation growth and pauses the bucket scope", async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce(makeQueryResult([]))
            .mockResolvedValueOnce(
                makeQueryResult([
                    {
                        id: "action-5",
                        strategy_key: "strategy.phase3b",
                        scope_type: "bucket",
                        scope_id: "bucket-1",
                        action_type: "PAUSE_SCOPE",
                        trigger_reason: "stale_reservation_growth",
                        created_at: new Date("2026-03-12T12:00:00.000Z"),
                        resolved_at: null,
                        metadata: {}
                    }
                ])
            );
        const { engine, controlPlaneAdminService } = buildEngine(query);

        const result = await engine.evaluate(
            baseInput({
                signals: {
                    ...baseInput().signals,
                    staleReservationGrowth: {
                        staleReservationCount: 50,
                        growthRate: 0.5,
                        breachedWindows: 3,
                        sustainedDurationMs: 60000
                    }
                }
            })
        );

        expect(result.actionType).toBe(AutoSafetyActionType.PAUSE_SCOPE);
        expect(controlPlaneAdminService.drainBucket).toHaveBeenCalledWith("bucket-1", "auto-safety-action-engine");
    });

    it("detects internalization failure spike and chooses resolution pooling disable", async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce(makeQueryResult([]))
            .mockResolvedValueOnce(
                makeQueryResult([
                    {
                        id: "action-6",
                        strategy_key: "strategy.phase3b",
                        scope_type: "bucket",
                        scope_id: "bucket-1",
                        action_type: "DISABLE_RESOLUTION_POOLING",
                        trigger_reason: "internalization_failure_spike",
                        created_at: new Date("2026-03-12T12:00:00.000Z"),
                        resolved_at: null,
                        metadata: {}
                    }
                ])
            );
        const { engine, controlPlaneAdminService } = buildEngine(query);

        const result = await engine.evaluate(
            baseInput({
                signals: {
                    ...baseInput().signals,
                    internalizationFailureSpike: {
                        failureCount: 8,
                        failureRate: 0.4,
                        breachedWindows: 3,
                        sustainedDurationMs: 40000
                    }
                }
            })
        );

        expect(result.actionType).toBe(AutoSafetyActionType.DISABLE_RESOLUTION_POOLING);
        expect(controlPlaneAdminService.createOverride).toHaveBeenCalledWith(
            expect.objectContaining({ overrideType: "GUARDRAIL_ENFORCEMENT" })
        );
    });

    it("does not duplicate unresolved active actions", async () => {
        const query = vi.fn().mockResolvedValueOnce(
            makeQueryResult([
                {
                    id: "action-existing",
                    strategy_key: "strategy.phase3b",
                    scope_type: "bucket",
                    scope_id: "bucket-1",
                    action_type: "DISABLE_PHASE2B",
                    trigger_reason: "replay_diff_spike",
                    created_at: new Date("2026-03-12T12:00:00.000Z"),
                    resolved_at: null,
                    metadata: {}
                }
            ])
        );
        const { engine, controlPlaneAdminService } = buildEngine(query);

        const result = await engine.evaluate(
            baseInput({
                signals: {
                    ...baseInput().signals,
                    replayDiffSpike: { diffRate: 0.03, errorRate: 0.01, breachedWindows: 3, sustainedDurationMs: 45000 }
                }
            })
        );

        expect(result.alreadyActive).toBe(true);
        expect(controlPlaneAdminService.degradeShard).not.toHaveBeenCalled();
    });

    it("chooses the most conservative action when multiple triggers breach", async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce(makeQueryResult([]))
            .mockResolvedValueOnce(
                makeQueryResult([
                    {
                        id: "action-7",
                        strategy_key: "strategy.phase3b",
                        scope_type: "bucket",
                        scope_id: "bucket-1",
                        action_type: "PAUSE_SCOPE",
                        trigger_reason: "stale_reservation_growth",
                        created_at: new Date("2026-03-12T12:00:00.000Z"),
                        resolved_at: null,
                        metadata: {}
                    }
                ])
            );
        const { engine } = buildEngine(query);

        const result = await engine.evaluate(
            baseInput({
                signals: {
                    ...baseInput().signals,
                    replayDiffSpike: { diffRate: 0.03, errorRate: 0.01, breachedWindows: 3, sustainedDurationMs: 45000 },
                    staleReservationGrowth: {
                        staleReservationCount: 25,
                        growthRate: 0.5,
                        breachedWindows: 3,
                        sustainedDurationMs: 40000
                    }
                }
            })
        );

        expect(result.actionType).toBe(AutoSafetyActionType.PAUSE_SCOPE);
    });

    it("fails closed on malformed config", () => {
        const query = vi.fn();

        expect(
            () =>
                new AutoSafetyActionEngine({
                    pool: { query } as unknown as Pool,
                    controlPlaneAdminService: {
                        degradeShard: vi.fn(),
                        pauseShard: vi.fn(),
                        drainBucket: vi.fn(),
                        createOverride: vi.fn()
                    },
                    config: {
                        ...baseConfig,
                        actions: {
                            ...baseConfig.actions,
                            replay_diff_spike: "BAD_ACTION" as AutoSafetyActionType
                        }
                    }
                })
        ).toThrow(AutoSafetyActionEngineError);
    });
});
