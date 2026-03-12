import { describe, expect, it, vi } from "vitest";

import { QualificationRuntimeHook, QualificationRuntimeHookError } from "../../src/core/qualification/runtime-qualification-hook.js";
import { QualificationRunStatus, QualificationStage } from "../../src/core/qualification/qualification.types.js";
import type { StrategyDecisionEvaluation } from "../../src/core/qualification/qualification.types.js";

describe("QualificationRuntimeHook", () => {
    it("writes an evaluation when exactly one active run matches", async () => {
        const findActiveRunsByStrategyScope = vi.fn(async () => [
            {
                id: "run-1",
                strategyKey: "strategy.sor",
                scopeType: "MARKET",
                scopeId: "market-1",
                stage: QualificationStage.SHADOW,
                engineVersion: "eng-v1",
                configVersion: "cfg-v1",
                startedAt: new Date("2026-03-12T00:00:00.000Z"),
                endedAt: null,
                status: QualificationRunStatus.RUNNING,
                metadata: {}
            }
        ]);
        const persistedEvaluation: StrategyDecisionEvaluation = {
            id: "eval-1",
            qualificationRunId: "run-1",
            decisionType: "SOR_CONFIG_CHANGE",
            entityId: "rfq-1",
            replayEnvelopeId: null,
            realizedMetrics: {},
            counterfactualMetrics: {},
            improvementMetrics: {},
            createdAt: new Date("2026-03-12T00:00:01.000Z")
        };
        const evaluate = vi.fn(async () => ({
            decisionComparison: {
                matched: false,
                divergenceReason: "route_choice_changed" as const,
                liveSummary: {},
                shadowSummary: {},
                fieldDiffs: []
            },
            persistedEvaluation,
            nonMutating: true as const
        }));

        const hook = new QualificationRuntimeHook({
            qualificationRunManager: { findActiveRunsByStrategyScope },
            shadowQualificationEvaluator: { evaluate }
        });

        const result = await hook.emitEvaluation({
            strategyKey: "strategy.sor",
            scopeType: "MARKET",
            scopeId: "market-1",
            decisionType: "SOR_CONFIG_CHANGE",
            entityId: "rfq-1",
            mode: "shadow_compare",
            failMode: "INLINE_BEST_EFFORT",
            liveDecision: () => ({
                routeIds: ["route-a"],
                providerIds: ["venue-a"],
                allocations: []
            }),
            shadowDecision: () => ({
                routeIds: ["route-b"],
                providerIds: ["venue-b"],
                allocations: []
            })
        });

        expect(findActiveRunsByStrategyScope).toHaveBeenCalledWith("strategy.sor", "MARKET", "market-1");
        expect(evaluate).toHaveBeenCalledTimes(1);
        expect(result).toBe(persistedEvaluation);
    });

    it("skips when no active run matches", async () => {
        const evaluate = vi.fn();
        const hook = new QualificationRuntimeHook({
            qualificationRunManager: { findActiveRunsByStrategyScope: vi.fn(async () => []) },
            shadowQualificationEvaluator: { evaluate },
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
        });

        await expect(
            hook.emitEvaluation({
                strategyKey: "strategy.sor",
                scopeType: "MARKET",
                scopeId: "market-1",
                decisionType: "SOR_CONFIG_CHANGE",
                entityId: "rfq-1",
                mode: "live_only",
                failMode: "INLINE_BEST_EFFORT",
                liveDecision: () => ({
                    routeIds: ["route-a"],
                    providerIds: ["venue-a"],
                    allocations: []
                })
            })
        ).resolves.toBeNull();

        expect(evaluate).not.toHaveBeenCalled();
    });

    it("fails closed on multiple active runs", async () => {
        const hook = new QualificationRuntimeHook({
            qualificationRunManager: {
                findActiveRunsByStrategyScope: vi.fn(async () => [
                    { id: "run-1" },
                    { id: "run-2" }
                ])
            } as never,
            shadowQualificationEvaluator: { evaluate: vi.fn() }
        });

        await expect(
            hook.emitEvaluation({
                strategyKey: "strategy.sor",
                scopeType: "MARKET",
                scopeId: "market-1",
                decisionType: "SOR_CONFIG_CHANGE",
                entityId: "rfq-1",
                mode: "live_only",
                failMode: "STRICT",
                liveDecision: () => ({
                    routeIds: ["route-a"],
                    providerIds: ["venue-a"],
                    allocations: []
                })
            })
        ).rejects.toBeInstanceOf(QualificationRuntimeHookError);
    });

    it("swallows failures in inline best-effort mode", async () => {
        const hook = new QualificationRuntimeHook({
            qualificationRunManager: {
                findActiveRunsByStrategyScope: vi.fn(async () => [
                    {
                        id: "run-1",
                        strategyKey: "strategy.sor",
                        scopeType: "MARKET",
                        scopeId: "market-1",
                        stage: QualificationStage.SHADOW,
                        engineVersion: "eng-v1",
                        configVersion: "cfg-v1",
                        startedAt: new Date("2026-03-12T00:00:00.000Z"),
                        endedAt: null,
                        status: QualificationRunStatus.RUNNING,
                        metadata: {}
                    }
                ])
            },
            shadowQualificationEvaluator: {
                evaluate: vi.fn(async () => {
                    throw new Error("persist_failed");
                })
            },
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
        });

        await expect(
            hook.emitEvaluation({
                strategyKey: "strategy.sor",
                scopeType: "MARKET",
                scopeId: "market-1",
                decisionType: "SOR_CONFIG_CHANGE",
                entityId: "rfq-1",
                mode: "live_only",
                failMode: "INLINE_BEST_EFFORT",
                liveDecision: () => ({
                    routeIds: ["route-a"],
                    providerIds: ["venue-a"],
                    allocations: []
                })
            })
        ).resolves.toBeNull();
    });
});
