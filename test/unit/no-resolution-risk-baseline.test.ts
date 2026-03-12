import { describe, expect, it } from "vitest";

import { NoResolutionRiskBaselineBuilder } from "../../src/core/qualification/baselines/no-resolution-risk-baseline.js";
import { CounterfactualBaselineError } from "../../src/core/qualification/baselines/shared.js";

describe("NoResolutionRiskBaselineBuilder", () => {
    it("ignores resolution-risk penalties and uses deterministic tie-breaking for the same snapshot", () => {
        const builder = new NoResolutionRiskBaselineBuilder();
        const input = {
            selectedQuote: {
                quantity: "10",
                arrivalPrice: "1.00"
            },
            routeCandidates: [
                {
                    candidateId: "cand-z",
                    providerId: "venue-z",
                    quotedPrice: "1.01",
                    availableSize: "10",
                    totalExpectedCost: "10.60",
                    resolutionRiskPenalty: "0.55",
                    fees: {}
                },
                {
                    candidateId: "cand-a",
                    providerId: "venue-a",
                    quotedPrice: "1.02",
                    availableSize: "10",
                    totalExpectedCost: "10.25",
                    resolutionRiskPenalty: "0.05",
                    fees: {}
                },
                {
                    candidateId: "cand-b",
                    providerId: "venue-b",
                    quotedPrice: "1.02",
                    availableSize: "10",
                    totalExpectedCost: "10.25",
                    resolutionRiskPenalty: "0.05",
                    fees: {}
                }
            ],
            fallbackCandidateOrdering: ["cand-z", "cand-a", "cand-b"],
            rfqGroupingSnapshot: {
                grouped: true
            }
        };

        const first = builder.build(input);
        const second = builder.build(input);

        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
        expect(first.fillPrice).toBe("1.01");
        expect(first.metadata).toMatchObject({
            neutralizedResolutionRisk: true,
            rfqGroupingSnapshotPresent: true
        });
    });

    it("falls back deterministically to provider and candidate id when neutralized costs tie", () => {
        const builder = new NoResolutionRiskBaselineBuilder();

        const snapshot = builder.build({
            selectedQuote: {
                quantity: "10",
                arrivalPrice: "1.00"
            },
            routeCandidates: [
                {
                    candidateId: "cand-b",
                    providerId: "venue-b",
                    quotedPrice: "1.01",
                    availableSize: "10",
                    totalExpectedCost: "10.15",
                    resolutionRiskPenalty: "0.10",
                    fees: {}
                },
                {
                    candidateId: "cand-a",
                    providerId: "venue-a",
                    quotedPrice: "1.01",
                    availableSize: "10",
                    totalExpectedCost: "10.15",
                    resolutionRiskPenalty: "0.10",
                    fees: {}
                }
            ]
        });

        expect(snapshot.fillPrice).toBe("1.01");
        expect(snapshot.metadata).toMatchObject({
            neutralizedResolutionRisk: true
        });
    });

    it("fails closed on invalid fallback candidate inputs", () => {
        const builder = new NoResolutionRiskBaselineBuilder();

        expect(() =>
            builder.build({
                selectedQuote: {
                    quantity: "10",
                    arrivalPrice: "1.00"
                },
                routeCandidates: [
                    {
                        candidateId: "cand-a",
                        providerId: "venue-a",
                        quotedPrice: "bad-price",
                        availableSize: "10",
                        fees: {}
                    }
                ]
            })
        ).toThrowError(CounterfactualBaselineError);
    });
});
