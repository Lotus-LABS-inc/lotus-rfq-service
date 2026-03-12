import { describe, expect, it } from "vitest";

import { PromotionGateEvaluator, type PromotionGateConfig, type PromotionGateEvaluationInput } from "../../src/core/qualification/promotion-gate-evaluator.js";
import { QualificationStage } from "../../src/core/qualification/qualification.types.js";

const baseConfig: PromotionGateConfig = {
    version: "phase3b-promotion-v1",
    transitions: {
        INTERNAL_ONLY_TO_SHADOW: {
            fromStage: QualificationStage.INTERNAL_ONLY,
            toStage: QualificationStage.SHADOW,
            replayStability: { minMatchRate: 0.99, maxDiffRate: 0.01, maxErrorRate: 0.001, minConsecutiveStableRuns: 5 },
            reconciliationHealth: { maxMismatchCount: 0, maxMismatchRate: 0, maxInfraErrorCount: 0, maxLockConflictCount: 0 },
            plannerLatency: { maxP95Ms: 200, maxP99Ms: 300 },
            economicQuality: {
                minPriceImprovement: "0",
                minSlippageSaved: "0",
                minFeeSaved: "0",
                minExternalNotionalAvoided: "0",
                minInternalizationGain: "0",
                minCompressionGain: "0"
            },
            incidentCount: { maxIncidents: 0, maxUnresolvedIncidents: 0 },
            adverseSelection: { maxAdverseFillRate: 0.05, maxPostTradeMarkoutLoss: "0.10", maxLossRate: 0.05 }
        },
        SHADOW_TO_CANARY: {
            fromStage: QualificationStage.SHADOW,
            toStage: QualificationStage.CANARY,
            replayStability: { minMatchRate: 0.995, maxDiffRate: 0.005, maxErrorRate: 0.0005, minConsecutiveStableRuns: 10 },
            reconciliationHealth: { maxMismatchCount: 0, maxMismatchRate: 0, maxInfraErrorCount: 0, maxLockConflictCount: 0 },
            plannerLatency: { maxP95Ms: 150, maxP99Ms: 250 },
            economicQuality: {
                minPriceImprovement: "0.01",
                minSlippageSaved: "0.01",
                minFeeSaved: "0.01",
                minExternalNotionalAvoided: "1",
                minInternalizationGain: "1",
                minCompressionGain: "0.5"
            },
            incidentCount: { maxIncidents: 0, maxUnresolvedIncidents: 0 },
            adverseSelection: { maxAdverseFillRate: 0.04, maxPostTradeMarkoutLoss: "0.05", maxLossRate: 0.03 }
        },
        CANARY_TO_LIMITED_PROD: {
            fromStage: QualificationStage.CANARY,
            toStage: QualificationStage.LIMITED_PROD,
            replayStability: { minMatchRate: 0.997, maxDiffRate: 0.003, maxErrorRate: 0.0005, minConsecutiveStableRuns: 20 },
            reconciliationHealth: { maxMismatchCount: 0, maxMismatchRate: 0, maxInfraErrorCount: 0, maxLockConflictCount: 0 },
            plannerLatency: { maxP95Ms: 140, maxP99Ms: 220 },
            economicQuality: {
                minPriceImprovement: "0.02",
                minSlippageSaved: "0.02",
                minFeeSaved: "0.01",
                minExternalNotionalAvoided: "2",
                minInternalizationGain: "2",
                minCompressionGain: "1"
            },
            incidentCount: { maxIncidents: 0, maxUnresolvedIncidents: 0 },
            adverseSelection: { maxAdverseFillRate: 0.03, maxPostTradeMarkoutLoss: "0.04", maxLossRate: 0.02 }
        },
        LIMITED_PROD_TO_BROAD_PROD: {
            fromStage: QualificationStage.LIMITED_PROD,
            toStage: QualificationStage.BROAD_PROD,
            replayStability: { minMatchRate: 0.999, maxDiffRate: 0.001, maxErrorRate: 0.0001, minConsecutiveStableRuns: 30 },
            reconciliationHealth: { maxMismatchCount: 0, maxMismatchRate: 0, maxInfraErrorCount: 0, maxLockConflictCount: 0 },
            plannerLatency: { maxP95Ms: 120, maxP99Ms: 200 },
            economicQuality: {
                minPriceImprovement: "0.03",
                minSlippageSaved: "0.03",
                minFeeSaved: "0.02",
                minExternalNotionalAvoided: "3",
                minInternalizationGain: "3",
                minCompressionGain: "1.5"
            },
            incidentCount: { maxIncidents: 0, maxUnresolvedIncidents: 0 },
            adverseSelection: { maxAdverseFillRate: 0.02, maxPostTradeMarkoutLoss: "0.03", maxLossRate: 0.01 }
        }
    }
};

const baseInput = (overrides?: Partial<PromotionGateEvaluationInput>): PromotionGateEvaluationInput => ({
    strategyKey: "strategy.phase3b",
    scopeType: "bucket",
    scopeId: "bucket-1",
    currentStage: QualificationStage.SHADOW,
    qualificationRunId: "run-1",
    replayStability: {
        matchRate: 0.999,
        diffRate: 0.001,
        errorRate: 0,
        consecutiveStableRuns: 20
    },
    reconciliationHealth: {
        mismatchCount: 0,
        mismatchRate: 0,
        infraErrorCount: 0,
        lockConflictCount: 0
    },
    plannerLatency: {
        p95Ms: 100,
        p99Ms: 180
    },
    economicQuality: {
        priceImprovement: "0.05",
        slippageSaved: "0.05",
        feeSaved: "0.02",
        externalNotionalAvoided: "3",
        internalizationGain: "3",
        compressionGain: "1"
    },
    incidentCount: {
        incidents: 0,
        unresolvedIncidents: 0
    },
    adverseSelection: {
        adverseFillRate: 0.01,
        postTradeMarkoutLoss: "0.01",
        lossRate: 0.005
    },
    ...(overrides ?? {})
});

describe("PromotionGateEvaluator", () => {
    it("allows promotion when all configured gates pass", () => {
        const evaluator = new PromotionGateEvaluator(baseConfig);

        const result = evaluator.evaluate(baseInput());

        expect(result.promotable).toBe(true);
        expect(result.failedGates).toEqual([]);
        expect(result.recommendedStage).toBe(QualificationStage.CANARY);
        expect(result.reasons).toEqual(["all promotion gates passed"]);
    });

    it("blocks promotion on negative economics", () => {
        const evaluator = new PromotionGateEvaluator(baseConfig);

        const result = evaluator.evaluate(
            baseInput({
                economicQuality: {
                    priceImprovement: "-0.01",
                    slippageSaved: "0.05",
                    feeSaved: "0.02",
                    externalNotionalAvoided: "3",
                    internalizationGain: "3",
                    compressionGain: "1"
                }
            })
        );

        expect(result.promotable).toBe(false);
        expect(result.recommendedStage).toBeUndefined();
        expect(result.failedGates.map((gate) => gate.gate)).toContain("ECONOMIC_QUALITY");
    });

    it("blocks promotion on replay instability", () => {
        const evaluator = new PromotionGateEvaluator(baseConfig);

        const result = evaluator.evaluate(
            baseInput({
                replayStability: {
                    matchRate: 0.90,
                    diffRate: 0.08,
                    errorRate: 0.02,
                    consecutiveStableRuns: 1
                }
            })
        );

        expect(result.promotable).toBe(false);
        expect(result.failedGates.map((gate) => gate.gate)).toContain("REPLAY_STABILITY");
    });

    it("blocks promotion on reconciliation mismatch", () => {
        const evaluator = new PromotionGateEvaluator(baseConfig);

        const result = evaluator.evaluate(
            baseInput({
                reconciliationHealth: {
                    mismatchCount: 2,
                    mismatchRate: 0.01,
                    infraErrorCount: 0,
                    lockConflictCount: 0
                }
            })
        );

        expect(result.promotable).toBe(false);
        expect(result.failedGates.map((gate) => gate.gate)).toContain("RECONCILIATION_HEALTH");
    });

    it("fails closed at BROAD_PROD with no further promotion path", () => {
        const evaluator = new PromotionGateEvaluator(baseConfig);

        const result = evaluator.evaluate(
            baseInput({
                currentStage: QualificationStage.BROAD_PROD
            })
        );

        expect(result.promotable).toBe(false);
        expect(result.recommendedStage).toBeUndefined();
        expect(result.reasons).toEqual(["already_at_highest_stage"]);
    });

    it("returns multiple failed gates in stable order", () => {
        const evaluator = new PromotionGateEvaluator(baseConfig);

        const result = evaluator.evaluate(
            baseInput({
                replayStability: {
                    matchRate: 0.8,
                    diffRate: 0.1,
                    errorRate: 0.05,
                    consecutiveStableRuns: 0
                },
                plannerLatency: {
                    p95Ms: 1000,
                    p99Ms: 1500
                }
            })
        );

        expect(result.promotable).toBe(false);
        expect(result.failedGates.map((gate) => gate.gate)).toEqual([
            "REPLAY_STABILITY",
            "PLANNER_LATENCY"
        ]);
    });
});
