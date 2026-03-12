import { describe, expect, it } from "vitest";

import {
    CounterfactualBaselineType,
    EconomicQualityEngine
} from "../../src/core/qualification/economic-quality-engine.js";
import { ExternalOnlyBaselineBuilder } from "../../src/core/qualification/baselines/external-only-baseline.js";
import { CounterfactualBaselineError } from "../../src/core/qualification/baselines/shared.js";

describe("ExternalOnlyBaselineBuilder", () => {
    it("produces byte-equivalent output for the same snapshot and zeroes internalization fields", () => {
        const builder = new ExternalOnlyBaselineBuilder();
        const input = {
            selectedQuote: {
                quantity: "10",
                arrivalPrice: "1.02"
            },
            routeCandidates: [
                {
                    candidateId: "cand-b",
                    providerId: "venue-b",
                    quotedPrice: "1.03",
                    availableSize: "10",
                    fees: { provider_fee: 0.1 }
                },
                {
                    candidateId: "cand-a",
                    providerId: "venue-a",
                    quotedPrice: "1.01",
                    availableSize: "10",
                    fees: { provider_fee: 0.2 }
                }
            ],
            realizedExecution: {
                timeToFillMs: 900
            }
        };

        const first = builder.build(input);
        const second = builder.build(input);

        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
        expect(first.internalizedNotional).toBe("0");
        expect(first.crossedNotional).toBe("0");
        expect(first.nettedNotional).toBe("0");
        expect(first.clearedNotional).toBe("0");
        expect(first.compressionNotional).toBe("0");
        expect(first.externalNotional).toBe(first.fillNotional);
    });

    it("returns an economic snapshot valid for EconomicQualityEngine", () => {
        const builder = new ExternalOnlyBaselineBuilder();
        const snapshot = builder.build({
            selectedQuote: {
                quantity: "5",
                arrivalPrice: "1.00"
            },
            routeCandidates: [
                {
                    candidateId: "cand-a",
                    providerId: "venue-a",
                    quotedPrice: "1.01",
                    availableSize: "5",
                    fees: {}
                }
            ]
        });

        const engine = new EconomicQualityEngine();
        const evaluation = engine.evaluate({
            realized: snapshot,
            baselines: {
                [CounterfactualBaselineType.BEST_EXTERNAL_ONLY]: snapshot
            },
            primaryBaseline: CounterfactualBaselineType.BEST_EXTERNAL_ONLY
        });

        expect(evaluation.realized.realizedFillPrice).toBe("1.01");
    });

    it("fails closed on malformed candidate input", () => {
        const builder = new ExternalOnlyBaselineBuilder();

        expect(() =>
            builder.build({
                selectedQuote: {
                    quantity: "5",
                    arrivalPrice: "1.00"
                },
                routeCandidates: [
                    {
                        candidateId: "",
                        providerId: "venue-a",
                        quotedPrice: "1.01",
                        availableSize: "5"
                    }
                ]
            })
        ).toThrowError(CounterfactualBaselineError);
    });
});
