import { describe, expect, it } from "vitest";

import {
    CounterfactualBaselineType,
    EconomicQualityEngine,
    EconomicQualityEngineError,
    type EconomicExecutionSnapshot
} from "../../src/core/qualification/economic-quality-engine.js";

const baseSnapshot = (overrides?: Partial<EconomicExecutionSnapshot>): EconomicExecutionSnapshot => ({
    requestedSize: "100",
    filledSize: "100",
    fillNotional: "101",
    effectiveCost: "101.25",
    fees: "0.25",
    fillPrice: "1.01",
    arrivalPrice: "1.00",
    externalNotional: "101",
    internalizedNotional: "0",
    crossedNotional: "0",
    nettedNotional: "0",
    clearedNotional: "0",
    compressionNotional: "0",
    timeToFillMs: 1200,
    ...(overrides ?? {})
});

describe("EconomicQualityEngine", () => {
    it("keeps pure external routing neutral against the best external baseline", () => {
        const engine = new EconomicQualityEngine();
        const realized = baseSnapshot();

        const result = engine.evaluate({
            realized,
            baselines: {
                [CounterfactualBaselineType.BEST_EXTERNAL_ONLY]: baseSnapshot()
            },
            primaryBaseline: CounterfactualBaselineType.BEST_EXTERNAL_ONLY
        });

        expect(result.realized.realizedFillPrice).toBe("1.01");
        expect(result.realized.partialFillRatio).toBe("1");
        expect(result.improvement).toEqual({
            priceImprovement: "0",
            slippageSaved: "0",
            feeSaved: "0",
            externalNotionalAvoided: "0",
            internalizationGain: "0",
            compressionGain: "0"
        });
    });

    it("captures improvement from internal crossing versus no internal cross", () => {
        const engine = new EconomicQualityEngine();

        const result = engine.evaluate({
            realized: baseSnapshot({
                fillNotional: "100.5",
                effectiveCost: "100.6",
                fees: "0.1",
                externalNotional: "40",
                internalizedNotional: "60",
                crossedNotional: "60",
                timeToFillMs: 300
            }),
            baselines: {
                [CounterfactualBaselineType.NO_INTERNAL_CROSS]: baseSnapshot({
                    fillNotional: "101.2",
                    effectiveCost: "101.5",
                    fees: "0.3",
                    externalNotional: "100",
                    internalizedNotional: "0",
                    crossedNotional: "0",
                    timeToFillMs: 900
                })
            },
            primaryBaseline: CounterfactualBaselineType.NO_INTERNAL_CROSS
        });

        expect(Number(result.improvement.priceImprovement)).toBeGreaterThan(0);
        expect(Number(result.improvement.feeSaved)).toBeGreaterThan(0);
        expect(Number(result.improvement.externalNotionalAvoided)).toBeGreaterThan(0);
        expect(Number(result.improvement.internalizationGain)).toBeGreaterThan(0);
    });

    it("captures phase2a netting improvement against no phase2 clearing", () => {
        const engine = new EconomicQualityEngine();

        const result = engine.evaluate({
            realized: baseSnapshot({
                fillNotional: "100.7",
                effectiveCost: "100.9",
                fees: "0.15",
                externalNotional: "55",
                internalizedNotional: "45",
                nettedNotional: "45",
                compressionNotional: "12"
            }),
            baselines: {
                [CounterfactualBaselineType.NO_PHASE2_CLEARING]: baseSnapshot({
                    fillNotional: "101.4",
                    effectiveCost: "101.7",
                    fees: "0.25",
                    externalNotional: "100",
                    internalizedNotional: "0",
                    nettedNotional: "0",
                    compressionNotional: "0"
                })
            },
            primaryBaseline: CounterfactualBaselineType.NO_PHASE2_CLEARING
        });

        expect(Number(result.improvement.slippageSaved)).toBeGreaterThan(0);
        expect(Number(result.improvement.externalNotionalAvoided)).toBeGreaterThan(0);
        expect(Number(result.improvement.compressionGain)).toBeGreaterThan(0);
    });

    it("captures phase2b clearing improvement against no phase2 clearing", () => {
        const engine = new EconomicQualityEngine();

        const result = engine.evaluate({
            realized: baseSnapshot({
                fillNotional: "100.3",
                effectiveCost: "100.35",
                fees: "0.05",
                externalNotional: "20",
                internalizedNotional: "80",
                clearedNotional: "80",
                compressionNotional: "30",
                timeToFillMs: 250
            }),
            baselines: {
                [CounterfactualBaselineType.NO_PHASE2_CLEARING]: baseSnapshot({
                    fillNotional: "101.8",
                    effectiveCost: "102.1",
                    fees: "0.4",
                    externalNotional: "100",
                    internalizedNotional: "0",
                    clearedNotional: "0",
                    compressionNotional: "0",
                    timeToFillMs: 1400
                })
            },
            primaryBaseline: CounterfactualBaselineType.NO_PHASE2_CLEARING
        });

        expect(Number(result.improvement.compressionGain)).toBeGreaterThan(0);
        expect(Number(result.improvement.externalNotionalAvoided)).toBeGreaterThan(0);
        expect(Number(result.improvement.feeSaved)).toBeGreaterThan(0);
    });

    it("rejects malformed numeric strings", () => {
        const engine = new EconomicQualityEngine();

        expect(() =>
            engine.evaluate({
                realized: baseSnapshot({ effectiveCost: "not-a-number" }),
                baselines: {
                    [CounterfactualBaselineType.BEST_EXTERNAL_ONLY]: baseSnapshot()
                },
                primaryBaseline: CounterfactualBaselineType.BEST_EXTERNAL_ONLY
            })
        ).toThrowError(EconomicQualityEngineError);
    });

    it("rejects filled size above requested size", () => {
        const engine = new EconomicQualityEngine();

        expect(() =>
            engine.evaluate({
                realized: baseSnapshot({ requestedSize: "10", filledSize: "11" }),
                baselines: {
                    [CounterfactualBaselineType.BEST_EXTERNAL_ONLY]: baseSnapshot({ requestedSize: "10", filledSize: "10" })
                },
                primaryBaseline: CounterfactualBaselineType.BEST_EXTERNAL_ONLY
            })
        ).toThrowError(EconomicQualityEngineError);
    });

    it("rejects missing primary baseline", () => {
        const engine = new EconomicQualityEngine();

        expect(() =>
            engine.evaluate({
                realized: baseSnapshot(),
                baselines: {},
                primaryBaseline: CounterfactualBaselineType.NO_INTERNAL_CROSS
            })
        ).toThrowError(EconomicQualityEngineError);
    });

    it("computes partial fill ratio precisely for partial fills", () => {
        const engine = new EconomicQualityEngine();

        const result = engine.evaluate({
            realized: baseSnapshot({
                requestedSize: "100",
                filledSize: "40",
                fillNotional: "40.4",
                effectiveCost: "40.5",
                externalNotional: "40.4"
            }),
            baselines: {
                [CounterfactualBaselineType.BEST_EXTERNAL_ONLY]: baseSnapshot({
                    requestedSize: "100",
                    filledSize: "40",
                    fillNotional: "40.4",
                    effectiveCost: "40.5",
                    externalNotional: "40.4"
                })
            },
            primaryBaseline: CounterfactualBaselineType.BEST_EXTERNAL_ONLY
        });

        expect(result.realized.partialFillRatio).toBe("0.4");
    });
});
