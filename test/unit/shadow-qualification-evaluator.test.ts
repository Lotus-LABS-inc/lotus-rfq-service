import { describe, expect, it, vi } from "vitest";

import {
    CounterfactualBaselineType,
    EconomicQualityEngine,
    type EconomicExecutionSnapshot
} from "../../src/core/qualification/economic-quality-engine.js";
import { ShadowQualificationEvaluator, ShadowQualificationEvaluatorError } from "../../src/core/qualification/shadow-qualification-evaluator.js";

const baseEconomicSnapshot = (overrides?: Partial<EconomicExecutionSnapshot>): EconomicExecutionSnapshot => ({
    requestedSize: "10",
    filledSize: "10",
    fillNotional: "10.1",
    effectiveCost: "10.2",
    fees: "0.1",
    fillPrice: "1.01",
    arrivalPrice: "1.00",
    externalNotional: "10.1",
    internalizedNotional: "0",
    crossedNotional: "0",
    nettedNotional: "0",
    clearedNotional: "0",
    compressionNotional: "0",
    timeToFillMs: 1000,
    ...(overrides ?? {})
});

describe("ShadowQualificationEvaluator", () => {
    it("compares live vs shadow route diffs, computes economics, and persists the evaluation", async () => {
        const recordDecisionEvaluation = vi.fn(async (_runId: string, evaluation) => ({
            id: "evaluation-1",
            qualificationRunId: "run-1",
            decisionType: evaluation.decisionType,
            entityId: evaluation.entityId,
            replayEnvelopeId: evaluation.replayEnvelopeId ?? null,
            realizedMetrics: evaluation.realizedMetrics,
            counterfactualMetrics: evaluation.counterfactualMetrics,
            improvementMetrics: evaluation.improvementMetrics,
            createdAt: new Date("2026-03-12T12:00:00.000Z")
        }));

        const evaluator = new ShadowQualificationEvaluator({
            qualificationRunManager: { recordDecisionEvaluation },
            economicQualityEngine: new EconomicQualityEngine()
        });

        const result = await evaluator.evaluate({
            qualificationRunId: "run-1",
            strategyKey: "strategy.sor",
            scopeType: "bucket",
            scopeId: "bucket-1",
            decisionType: "SOR_CONFIG_CHANGE",
            entityId: "rfq-1",
            replayEnvelopeId: "env-1",
            liveDecision: () => ({
                routeIds: ["route-a"],
                providerIds: ["venue-a"],
                allocations: [{ candidateId: "cand-a", providerId: "venue-a", targetSize: "10", targetPrice: "1.01" }]
            }),
            shadowDecision: () => ({
                routeIds: ["route-b"],
                providerIds: ["venue-b"],
                allocations: [{ candidateId: "cand-b", providerId: "venue-b", targetSize: "10", targetPrice: "0.99" }]
            }),
            liveEconomicSnapshot: baseEconomicSnapshot(),
            shadowEconomicSnapshot: baseEconomicSnapshot({
                fillNotional: "9.9",
                effectiveCost: "10.0",
                fees: "0.05",
                fillPrice: "0.99",
                externalNotional: "9.9",
                timeToFillMs: 800
            }),
            economicContext: {
                mode: "direct",
                primaryBaseline: CounterfactualBaselineType.BEST_EXTERNAL_ONLY
            },
            metadata: {
                market: "market-rollup-1"
            }
        });

        expect(result.decisionComparison.matched).toBe(false);
        expect(result.decisionComparison.divergenceReason).toBe("route_choice_changed");
        expect(result.economicComparison?.primaryBaseline).toBe(CounterfactualBaselineType.BEST_EXTERNAL_ONLY);
        expect(recordDecisionEvaluation).toHaveBeenCalledTimes(1);
        expect(recordDecisionEvaluation.mock.calls[0]?.[1].realizedMetrics).toMatchObject({
            market: "market-rollup-1",
            venuePair: "venue-a->venue-b",
            liveVenue: "venue-a",
            shadowVenue: "venue-b"
        });
    });

    it("compares live vs shadow clearing diffs and classifies clearing selection changes", async () => {
        const recordDecisionEvaluation = vi.fn(async (_runId: string, evaluation) => ({
            id: "evaluation-2",
            qualificationRunId: "run-2",
            decisionType: evaluation.decisionType,
            entityId: evaluation.entityId,
            replayEnvelopeId: evaluation.replayEnvelopeId ?? null,
            realizedMetrics: evaluation.realizedMetrics,
            counterfactualMetrics: evaluation.counterfactualMetrics,
            improvementMetrics: evaluation.improvementMetrics,
            createdAt: new Date("2026-03-12T12:05:00.000Z")
        }));

        const evaluator = new ShadowQualificationEvaluator({
            qualificationRunManager: { recordDecisionEvaluation },
            economicQualityEngine: new EconomicQualityEngine()
        });

        const result = await evaluator.evaluate({
            qualificationRunId: "run-2",
            strategyKey: "strategy.phase2b",
            scopeType: "bucket",
            scopeId: "bucket-2",
            decisionType: "PHASE2B_CLEARING_STRATEGY_CHANGE",
            entityId: "bucket-2",
            liveDecision: () => ({
                clearingRoundId: "round-live",
                participantSetHash: "psh-live",
                matchSignatureHash: "sig-live",
                compressionScore: "4",
                residuals: [{ key: "m1:o1", signedResidual: "0" }]
            }),
            shadowDecision: () => ({
                clearingRoundId: "round-shadow",
                participantSetHash: "psh-shadow",
                matchSignatureHash: "sig-shadow",
                compressionScore: "5",
                residuals: [{ key: "m1:o1", signedResidual: "1" }]
            })
        });

        expect(result.decisionComparison.matched).toBe(false);
        expect(result.decisionComparison.divergenceReason).toBe("clearing_selection_changed");
        expect(recordDecisionEvaluation).toHaveBeenCalledTimes(1);
    });

    it("does not mutate live or shadow outputs", async () => {
        const recordDecisionEvaluation = vi.fn(async (_runId: string, evaluation) => ({
            id: "evaluation-3",
            qualificationRunId: "run-3",
            decisionType: evaluation.decisionType,
            entityId: evaluation.entityId,
            replayEnvelopeId: null,
            realizedMetrics: evaluation.realizedMetrics,
            counterfactualMetrics: evaluation.counterfactualMetrics,
            improvementMetrics: evaluation.improvementMetrics,
            createdAt: new Date("2026-03-12T12:10:00.000Z")
        }));

        const liveDecision = Object.freeze({
            routeIds: Object.freeze(["route-a"]),
            providerIds: Object.freeze(["venue-a"]),
            allocations: Object.freeze([{ candidateId: "cand-a", providerId: "venue-a", targetSize: "10", targetPrice: "1.01" }])
        });
        const shadowDecision = Object.freeze({
            routeIds: Object.freeze(["route-a"]),
            providerIds: Object.freeze(["venue-a"]),
            allocations: Object.freeze([{ candidateId: "cand-a", providerId: "venue-a", targetSize: "10", targetPrice: "1.01" }])
        });

        const evaluator = new ShadowQualificationEvaluator({
            qualificationRunManager: { recordDecisionEvaluation },
            economicQualityEngine: new EconomicQualityEngine()
        });

        await evaluator.evaluate({
            qualificationRunId: "run-3",
            strategyKey: "strategy.sor",
            scopeType: "bucket",
            scopeId: "bucket-3",
            decisionType: "SOR_CONFIG_CHANGE",
            entityId: "rfq-3",
            liveDecision: () => liveDecision,
            shadowDecision: () => shadowDecision
        });

        expect(liveDecision.routeIds[0]).toBe("route-a");
        expect(shadowDecision.routeIds[0]).toBe("route-a");
    });

    it("awaits live and shadow decisions in parallel", async () => {
        const recordDecisionEvaluation = vi.fn(async (_runId: string, evaluation) => ({
            id: "evaluation-4",
            qualificationRunId: "run-4",
            decisionType: evaluation.decisionType,
            entityId: evaluation.entityId,
            replayEnvelopeId: null,
            realizedMetrics: evaluation.realizedMetrics,
            counterfactualMetrics: evaluation.counterfactualMetrics,
            improvementMetrics: evaluation.improvementMetrics,
            createdAt: new Date("2026-03-12T12:15:00.000Z")
        }));

        let liveStarted = false;
        let shadowObservedLivePending = false;

        const evaluator = new ShadowQualificationEvaluator({
            qualificationRunManager: { recordDecisionEvaluation },
            economicQualityEngine: new EconomicQualityEngine()
        });

        await evaluator.evaluate({
            qualificationRunId: "run-4",
            strategyKey: "strategy.grouping",
            scopeType: "market",
            scopeId: "market-1",
            decisionType: "RFQ_GROUPING_CHANGE",
            entityId: "rfq-4",
            liveDecision: async () => {
                liveStarted = true;
                await new Promise((resolve) => setTimeout(resolve, 25));
                return {
                    safePools: [["a", "b"]],
                    cautionLanes: [],
                    blockedProfiles: []
                };
            },
            shadowDecision: async () => {
                shadowObservedLivePending = liveStarted;
                return {
                    safePools: [["a", "b"]],
                    cautionLanes: [],
                    blockedProfiles: []
                };
            }
        });

        expect(shadowObservedLivePending).toBe(true);
    });

    it("fails closed when qualificationRunId is missing", async () => {
        const evaluator = new ShadowQualificationEvaluator({
            qualificationRunManager: { recordDecisionEvaluation: vi.fn() },
            economicQualityEngine: new EconomicQualityEngine()
        });

        await expect(
            evaluator.evaluate({
                qualificationRunId: "",
                strategyKey: "strategy.sor",
                scopeType: "bucket",
                scopeId: "bucket-1",
                decisionType: "SOR_CONFIG_CHANGE",
                entityId: "rfq-1",
                liveDecision: () => ({
                    routeIds: [],
                    providerIds: [],
                    allocations: []
                }),
                shadowDecision: () => ({
                    routeIds: [],
                    providerIds: [],
                    allocations: []
                })
            })
        ).rejects.toBeInstanceOf(ShadowQualificationEvaluatorError);
    });

    it("uses a baseline builder when requested and delegates to the economic engine", async () => {
        const recordDecisionEvaluation = vi.fn(async (_runId: string, evaluation) => ({
            id: "evaluation-5",
            qualificationRunId: "run-5",
            decisionType: evaluation.decisionType,
            entityId: evaluation.entityId,
            replayEnvelopeId: null,
            realizedMetrics: evaluation.realizedMetrics,
            counterfactualMetrics: evaluation.counterfactualMetrics,
            improvementMetrics: evaluation.improvementMetrics,
            createdAt: new Date("2026-03-12T12:20:00.000Z")
        }));
        const economicQualityEngine = new EconomicQualityEngine();
        const evaluateSpy = vi.spyOn(economicQualityEngine, "evaluate");
        const externalOnlyBaselineBuilder = {
            build: vi.fn(() =>
                baseEconomicSnapshot({
                    fillNotional: "9.8",
                    effectiveCost: "9.9",
                    fees: "0.02",
                    fillPrice: "0.98",
                    externalNotional: "9.8"
                })
            )
        };

        const evaluator = new ShadowQualificationEvaluator({
            qualificationRunManager: { recordDecisionEvaluation },
            economicQualityEngine,
            externalOnlyBaselineBuilder
        });

        const result = await evaluator.evaluate({
            qualificationRunId: "run-5",
            strategyKey: "strategy.sor",
            scopeType: "bucket",
            scopeId: "bucket-5",
            decisionType: "SOR_CONFIG_CHANGE",
            entityId: "rfq-5",
            liveDecision: () => ({
                routeIds: ["route-a"],
                providerIds: ["venue-a"],
                allocations: [{ candidateId: "cand-a", providerId: "venue-a", targetSize: "10", targetPrice: "1.01" }]
            }),
            shadowDecision: () => ({
                routeIds: ["route-a"],
                providerIds: ["venue-a"],
                allocations: [{ candidateId: "cand-a", providerId: "venue-a", targetSize: "10", targetPrice: "1.01" }]
            }),
            liveEconomicSnapshot: baseEconomicSnapshot(),
            economicContext: {
                mode: "baseline_builder",
                baseline: {
                    baselineType: CounterfactualBaselineType.BEST_EXTERNAL_ONLY,
                    builderInput: {
                        selectedQuote: {
                            quantity: "10",
                            arrivalPrice: "1.00"
                        },
                        routeCandidates: [
                            {
                                candidateId: "cand-a",
                                providerId: "venue-a",
                                quotedPrice: "0.98",
                                availableSize: "10",
                                fees: {}
                            }
                        ]
                    }
                }
            }
        });

        expect(externalOnlyBaselineBuilder.build).toHaveBeenCalledTimes(1);
        expect(evaluateSpy).toHaveBeenCalledTimes(1);
        expect(result.economicComparison).toBeDefined();
    });

    it("persists structural-only payloads when economics are not requested", async () => {
        const recordDecisionEvaluation = vi.fn(async (_runId: string, evaluation) => ({
            id: "evaluation-6",
            qualificationRunId: "run-6",
            decisionType: evaluation.decisionType,
            entityId: evaluation.entityId,
            replayEnvelopeId: null,
            realizedMetrics: evaluation.realizedMetrics,
            counterfactualMetrics: evaluation.counterfactualMetrics,
            improvementMetrics: evaluation.improvementMetrics,
            createdAt: new Date("2026-03-12T12:25:00.000Z")
        }));

        const evaluator = new ShadowQualificationEvaluator({
            qualificationRunManager: { recordDecisionEvaluation },
            economicQualityEngine: new EconomicQualityEngine()
        });

        const result = await evaluator.evaluate({
            qualificationRunId: "run-6",
            strategyKey: "strategy.risk",
            scopeType: "market",
            scopeId: "market-6",
            decisionType: "RESOLUTION_RISK_THRESHOLD_CHANGE",
            entityId: "pair-1",
            liveDecision: () => ({
                intendedDecision: "blocked",
                enforcedDecision: "blocked",
                equivalenceClass: "DO_NOT_POOL",
                reason: "high_divergence"
            }),
            shadowDecision: () => ({
                intendedDecision: "normal",
                enforcedDecision: "normal",
                equivalenceClass: "SAFE_EQUIVALENT",
                reason: "threshold_relaxed"
            })
        });

        expect(result.economicComparison).toBeUndefined();
        expect(recordDecisionEvaluation.mock.calls[0]?.[1].improvementMetrics).toMatchObject({
            divergenceReason: "resolution_threshold_changed"
        });
    });

    it("persists explicit rollup metadata when provided", async () => {
        const recordDecisionEvaluation = vi.fn(async (_runId: string, evaluation) => ({
            id: "evaluation-7",
            qualificationRunId: "run-7",
            decisionType: evaluation.decisionType,
            entityId: evaluation.entityId,
            replayEnvelopeId: null,
            realizedMetrics: evaluation.realizedMetrics,
            counterfactualMetrics: evaluation.counterfactualMetrics,
            improvementMetrics: evaluation.improvementMetrics,
            createdAt: new Date("2026-03-12T12:30:00.000Z")
        }));

        const evaluator = new ShadowQualificationEvaluator({
            qualificationRunManager: { recordDecisionEvaluation },
            economicQualityEngine: new EconomicQualityEngine()
        });

        await evaluator.evaluate({
            qualificationRunId: "run-7",
            strategyKey: "strategy.sor",
            scopeType: "bucket",
            scopeId: "bucket-7",
            decisionType: "SOR_CONFIG_CHANGE",
            entityId: "rfq-7",
            liveDecision: () => ({
                routeIds: ["route-a"],
                providerIds: ["venue-a"],
                allocations: [{ candidateId: "cand-a", providerId: "venue-a", targetSize: "10", targetPrice: "1.01" }]
            }),
            shadowDecision: () => ({
                routeIds: ["route-b"],
                providerIds: ["venue-b"],
                allocations: [{ candidateId: "cand-b", providerId: "venue-b", targetSize: "10", targetPrice: "0.99" }]
            }),
            metadata: {
                market: "market-7",
                venuePair: "venue-a|venue-b",
                liveVenue: "venue-a",
                shadowVenue: "venue-b"
            }
        });

        expect(recordDecisionEvaluation.mock.calls[0]?.[1].realizedMetrics).toMatchObject({
            market: "market-7",
            venuePair: "venue-a|venue-b",
            liveVenue: "venue-a",
            shadowVenue: "venue-b"
        });
        expect(recordDecisionEvaluation.mock.calls[0]?.[1].counterfactualMetrics).toMatchObject({
            market: "market-7",
            venuePair: "venue-a|venue-b",
            liveVenue: "venue-a",
            shadowVenue: "venue-b"
        });
    });
});
