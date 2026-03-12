import { describe, expect, it } from "vitest";

import { NoInternalizationBaselineBuilder } from "../../src/core/qualification/baselines/no-internalization-baseline.js";
import { CounterfactualBaselineError } from "../../src/core/qualification/baselines/shared.js";

describe("NoInternalizationBaselineBuilder", () => {
    it("strips crossing, netting, and clearing contributions completely and remains deterministic", () => {
        const builder = new NoInternalizationBaselineBuilder();
        const input = {
            selectedQuote: {
                quantity: "20",
                arrivalPrice: "0.95"
            },
            routeCandidates: [
                {
                    candidateId: "cand-a",
                    providerId: "venue-a",
                    quotedPrice: "0.96",
                    availableSize: "20",
                    fees: { protocol_fee: 0.05 }
                }
            ],
            internalCrossSnapshot: { filledSize: "8" },
            phase2ANettingSnapshot: { nettedSize: "6" },
            phase2BClearingSnapshot: { clearedSize: "6" },
            realizedExecution: {
                timeToFillMs: 450
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
        expect(first.metadata).toMatchObject({
            strippedInternalization: {
                internalCrossProvided: true,
                phase2ANettingProvided: true,
                phase2BClearingProvided: true
            }
        });
    });

    it("fails closed when route candidates are missing", () => {
        const builder = new NoInternalizationBaselineBuilder();

        expect(() =>
            builder.build({
                selectedQuote: {
                    quantity: "20",
                    arrivalPrice: "0.95"
                },
                routeCandidates: []
            })
        ).toThrowError(CounterfactualBaselineError);
    });
});
