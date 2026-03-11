import { describe, expect, it } from "vitest";
import { ResolutionRiskPresentationFormatter } from "../../src/core/rfq-engine/resolution-risk-presentation.js";
import type { ResolutionRiskAssessment } from "../../src/core/rfq-engine/resolution-risk.types.js";

const buildAssessment = (overrides: Partial<ResolutionRiskAssessment> = {}): ResolutionRiskAssessment => ({
    id: "11111111-1111-4111-8111-111111111111",
    canonicalEventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    marketAProfileId: "22222222-2222-4222-8222-222222222222",
    marketBProfileId: "33333333-3333-4333-8333-333333333333",
    riskScore: "0.18",
    confidenceScore: "0.84",
    equivalenceClass: "SAFE_EQUIVALENT",
    factorBreakdown: {
        oracleMismatch: { score: 0, confidence: 1 },
    },
    reasons: [],
    version: "resolution-risk-v1",
    computedAt: new Date("2026-03-11T00:00:00.000Z"),
    ...overrides,
});

describe("ResolutionRiskPresentationFormatter", () => {
    it("maps labels and recommended actions for all equivalence classes", () => {
        const formatter = new ResolutionRiskPresentationFormatter();

        expect(formatter.format(buildAssessment({ equivalenceClass: "SAFE_EQUIVALENT" }))).toMatchObject({
            label: "Safe equivalent",
            recommendedAction: "Poolable",
        });
        expect(formatter.format(buildAssessment({ equivalenceClass: "CAUTION" }))).toMatchObject({
            label: "Caution",
            recommendedAction: "Pool with caution",
        });
        expect(formatter.format(buildAssessment({ equivalenceClass: "HIGH_RISK" }))).toMatchObject({
            label: "High risk",
            recommendedAction: "Isolate execution",
        });
        expect(formatter.format(buildAssessment({ equivalenceClass: "DO_NOT_POOL" }))).toMatchObject({
            label: "Do not pool",
            recommendedAction: "Do not pool",
        });
    });

    it("formats short reasons deterministically", () => {
        const formatter = new ResolutionRiskPresentationFormatter();
        const formatted = formatter.format(
            buildAssessment({
                reasons: ["  first  ", "", "second", "first", "third", "fourth"],
            }),
        );

        expect(formatted.shortReasons).toEqual(["first", "second", "third"]);
    });

    it("preserves input ordering in formatMany", () => {
        const formatter = new ResolutionRiskPresentationFormatter();
        const assessments = [
            buildAssessment({ equivalenceClass: "CAUTION", riskScore: "0.2" }),
            buildAssessment({
                id: "44444444-4444-4444-8444-444444444444",
                equivalenceClass: "HIGH_RISK",
                riskScore: "0.5",
            }),
        ];

        expect(formatter.formatMany(assessments).map((assessment) => assessment.riskScore)).toEqual(["0.2", "0.5"]);
    });

    it("fails closed on malformed assessments", () => {
        const formatter = new ResolutionRiskPresentationFormatter();

        expect(() =>
            formatter.format(buildAssessment({ riskScore: "" })),
        ).toThrow("riskScore");

        expect(() =>
            formatter.format({
                ...buildAssessment(),
                reasons: ["valid", 1 as unknown as string],
            }),
        ).toThrow("reasons");
    });
});
