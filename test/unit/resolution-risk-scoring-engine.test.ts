import { describe, expect, it } from "vitest";
import {
  ResolutionRiskScoringEngine,
  ResolutionRiskScoringError
} from "../../src/core/rfq-engine/resolution-risk-scoring-engine.js";
import type {
  ResolutionFactorComparison,
  ResolutionFactorComparisonResult
} from "../../src/core/rfq-engine/resolution-risk.types.js";

const makeFactor = (
  score: number,
  confidence: number,
  reason?: string
): ResolutionFactorComparison => ({ score, confidence, ...(reason ? { reason } : {}) });

const makeComparison = (
  overrides: Partial<ResolutionFactorComparisonResult> = {}
): ResolutionFactorComparisonResult => ({
  oracleMismatch: makeFactor(0, 1, "oracle type and name match"),
  ruleMismatch: makeFactor(0, 1, "resolution authority and supplemental rules match"),
  wordingAmbiguity: makeFactor(0, 1, "primary resolution wording matches"),
  disputeWindowMismatch: makeFactor(0, 1, "dispute window matches"),
  settlementLagMismatch: makeFactor(0, 1, "settlement lag matches"),
  structuralMismatch: makeFactor(0, 1, "market type and outcome schema match"),
  historicalDivergence: makeFactor(0, 0.3, "historical divergence is unavailable on both profiles"),
  ...overrides
});

describe("ResolutionRiskScoringEngine", () => {
  const engine = new ResolutionRiskScoringEngine();

  it("classifies below the safe threshold as SAFE_EQUIVALENT", () => {
    const result = engine.score({
      canonicalEventId: "f7d8c2c4-41a8-4a87-9ef0-6605dfd8dc72",
      marketAProfileId: "50a3c141-f73b-4b10-9d25-8bff1324b2b4",
      marketBProfileId: "cfe4c609-3e12-4df6-ab54-3d05f89489ef",
      factorComparison: makeComparison(),
      version: "v1"
    });

    expect(result.equivalenceClass).toBe("SAFE_EQUIVALENT");
    expect(result.riskScore).toBe("0");
  });

  it("classifies the caution and high-risk ranges deterministically", () => {
    const caution = engine.score({
      canonicalEventId: "eb24d1c3-b7b5-447a-a4b3-45df29b044b3",
      marketAProfileId: "10fd4c66-87b4-4531-8ea2-83ddf9f2b2d9",
      marketBProfileId: "d09f4a6c-84cc-46b0-b559-5e666818e165",
      factorComparison: makeComparison({
        oracleMismatch: makeFactor(0.5, 1, "oracle type matches but oracle name differs"),
        wordingAmbiguity: makeFactor(0.5, 1, "primary resolution wording partially overlaps"),
        disputeWindowMismatch: makeFactor(0.5, 1, "dispute window differs within 24 hours")
      }),
      version: "v1"
    });

    const highRisk = engine.score({
      canonicalEventId: "90557c84-b2b0-466c-a5e2-2c2f4c88e037",
      marketAProfileId: "f21a2632-b2fb-4645-a57d-915cf8fb8513",
      marketBProfileId: "a59179cb-2caa-44c4-9961-bc2a14223973",
      factorComparison: makeComparison({
        oracleMismatch: makeFactor(0.5, 1, "oracle type matches but oracle name differs"),
        ruleMismatch: makeFactor(0.5, 1, "supplemental rules materially differ"),
        wordingAmbiguity: makeFactor(1, 1, "primary resolution wording materially diverges"),
        disputeWindowMismatch: makeFactor(0.5, 1, "dispute window differs within 24 hours"),
        settlementLagMismatch: makeFactor(0.5, 1, "settlement lag differs within 24 hours")
      }),
      version: "v1"
    });

    expect(caution.equivalenceClass).toBe("CAUTION");
    expect(highRisk.equivalenceClass).toBe("HIGH_RISK");
  });

  it("classifies do-not-pool threshold and hard incompatibility factors", () => {
    const threshold = engine.score({
      canonicalEventId: "7a262e4d-9f79-47af-bb92-5ea27dbaf3cf",
      marketAProfileId: "0d8d7fd4-97c0-4cf9-b31e-338bb62dcac9",
      marketBProfileId: "c2a9b42d-63f5-4126-aafb-a418de050fac",
      factorComparison: makeComparison({
        oracleMismatch: makeFactor(1, 1, "oracle type differs")
      }),
      version: "v1"
    });

    const hardRule = engine.score({
      canonicalEventId: "eb71f9d1-6f0c-409f-8e4c-1cc51b6d6d8e",
      marketAProfileId: "840a4802-b0f0-4bf4-a47a-c52ac7631c1f",
      marketBProfileId: "1f5486fd-a5ec-41cc-9a6d-80d4dbf203dd",
      factorComparison: makeComparison({
        structuralMismatch: makeFactor(1, 1, "market type differs")
      }),
      version: "v1"
    });

    expect(threshold.equivalenceClass).toBe("DO_NOT_POOL");
    expect(hardRule.equivalenceClass).toBe("DO_NOT_POOL");
  });

  it("downgrades low-confidence classifications conservatively", () => {
    const safeToCaution = engine.score({
      canonicalEventId: "69c64ee6-af07-4942-ae63-259ee1a50888",
      marketAProfileId: "a952f37c-d46d-4a89-af15-edcbda41d53a",
      marketBProfileId: "cd615916-f4f0-416c-a014-4fa1f8d2af0b",
      factorComparison: makeComparison({
        oracleMismatch: makeFactor(0, 0.4, "oracle names are missing; compared oracle type only"),
        ruleMismatch: makeFactor(0, 0.4, "supplemental rules are absent on both profiles"),
        wordingAmbiguity: makeFactor(0, 0.4, "primary resolution wording matches"),
        disputeWindowMismatch: makeFactor(0, 0.4, "dispute window metadata missing on one or both profiles"),
        settlementLagMismatch: makeFactor(0, 0.4, "settlement lag metadata missing on one or both profiles"),
        structuralMismatch: makeFactor(0, 0.4, "market type and outcome schema match"),
        historicalDivergence: makeFactor(0, 0.3, "historical divergence is unavailable on both profiles")
      }),
      version: "v1"
    });

    const cautionToHighRisk = engine.score({
      canonicalEventId: "fc0d4c8f-a872-4c35-8981-7db87f6830dd",
      marketAProfileId: "fdd26ae3-fd4b-46e8-afc1-f8ab72b6ab5d",
      marketBProfileId: "1a97212f-4f25-40de-88b6-cce3d0f40f4d",
      factorComparison: makeComparison({
        oracleMismatch: makeFactor(0.5, 0.4, "one oracle name is missing"),
        ruleMismatch: makeFactor(0.5, 0.4, "supplemental rules are missing on one profile"),
        wordingAmbiguity: makeFactor(0, 0.4, "primary resolution wording matches"),
        disputeWindowMismatch: makeFactor(0, 0.4, "dispute window metadata missing on one or both profiles"),
        settlementLagMismatch: makeFactor(0, 0.4, "settlement lag metadata missing on one or both profiles"),
        structuralMismatch: makeFactor(0, 0.4, "market type and outcome schema match"),
        historicalDivergence: makeFactor(0, 0.3, "historical divergence is unavailable on both profiles")
      }),
      version: "v1"
    });

    const highRiskToDoNotPool = engine.score({
      canonicalEventId: "b955912c-4792-43d2-9867-44b4d68daff7",
      marketAProfileId: "1f2e0219-fd1a-4bd8-bcee-301e01fca1f7",
      marketBProfileId: "4a38a00d-3d69-43c2-bb9f-919fdba6aaf3",
      factorComparison: makeComparison({
        oracleMismatch: makeFactor(0.5, 0.4, "one oracle name is missing"),
        ruleMismatch: makeFactor(0.5, 0.4, "supplemental rules are missing on one profile"),
        wordingAmbiguity: makeFactor(1, 0.4, "primary resolution wording materially diverges"),
        disputeWindowMismatch: makeFactor(0.5, 0.4, "dispute window differs within 24 hours"),
        settlementLagMismatch: makeFactor(0.5, 0.4, "settlement lag differs within 24 hours"),
        structuralMismatch: makeFactor(0, 0.4, "market type and outcome schema match"),
        historicalDivergence: makeFactor(0, 0.3, "historical divergence is unavailable on both profiles")
      }),
      version: "v1"
    });

    expect(safeToCaution.equivalenceClass).toBe("CAUTION");
    expect(cautionToHighRisk.equivalenceClass).toBe("HIGH_RISK");
    expect(highRiskToDoNotPool.equivalenceClass).toBe("DO_NOT_POOL");
  });

  it("produces deterministic reasons and factor breakdown", () => {
    const comparison = makeComparison({
      oracleMismatch: makeFactor(0.5, 1, "oracle type matches but oracle name differs"),
      historicalDivergence: makeFactor(0, 0.3, "historical divergence is unavailable on both profiles")
    });

    const result = engine.score({
      canonicalEventId: "8cbf7bc4-d3ef-49d0-9ef2-0829245d2431",
      marketAProfileId: "f0a00b46-79f4-4bcf-9040-416bb5097a89",
      marketBProfileId: "5ea89ce3-bd00-4249-a69c-7da2147668d6",
      factorComparison: comparison,
      version: "v1"
    });

    expect(result.factorBreakdown).toEqual(comparison);
    expect(result.reasons).toEqual([
      "oracleMismatch: oracle type matches but oracle name differs",
      "historicalDivergence: historical divergence is unavailable on both profiles"
    ]);
  });

  it("fails closed on invalid scoring input and factor values", () => {
    expect(() =>
      engine.score({
        canonicalEventId: "74cc1f2a-b8af-4f3e-bf87-95f537f6633f",
        marketAProfileId: "same-id",
        marketBProfileId: "same-id",
        factorComparison: makeComparison(),
        version: "v1"
      })
    ).toThrowError(new ResolutionRiskScoringError("invalid_scoring_input"));

    expect(() =>
      engine.score({
        canonicalEventId: "74cc1f2a-b8af-4f3e-bf87-95f537f6633f",
        marketAProfileId: "dbeb01de-e09b-43f7-b779-8ee3510b6d12",
        marketBProfileId: "72a4af85-81df-4595-942f-608ff7c3b1e0",
        factorComparison: makeComparison({
          oracleMismatch: makeFactor(1.5, 1, "bad")
        }),
        version: "v1"
      })
    ).toThrowError(new ResolutionRiskScoringError("invalid_factor_comparison"));

    expect(() =>
      engine.score({
        canonicalEventId: "74cc1f2a-b8af-4f3e-bf87-95f537f6633f",
        marketAProfileId: "dbeb01de-e09b-43f7-b779-8ee3510b6d12",
        marketBProfileId: "72a4af85-81df-4595-942f-608ff7c3b1e0",
        factorComparison: makeComparison({
          oracleMismatch: makeFactor(0.5, 1.5, "bad confidence")
        }),
        version: "v1"
      })
    ).toThrowError(new ResolutionRiskScoringError("invalid_factor_comparison"));

    expect(() =>
      engine.score({
        canonicalEventId: "",
        marketAProfileId: "dbeb01de-e09b-43f7-b779-8ee3510b6d12",
        marketBProfileId: "72a4af85-81df-4595-942f-608ff7c3b1e0",
        factorComparison: makeComparison(),
        version: "v1"
      })
    ).toThrowError(new ResolutionRiskScoringError("invalid_scoring_input"));

    expect(() =>
      engine.score({
        canonicalEventId: "74cc1f2a-b8af-4f3e-bf87-95f537f6633f",
        marketAProfileId: "dbeb01de-e09b-43f7-b779-8ee3510b6d12",
        marketBProfileId: "72a4af85-81df-4595-942f-608ff7c3b1e0",
        factorComparison: makeComparison(),
        version: ""
      })
    ).toThrowError(new ResolutionRiskScoringError("invalid_scoring_input"));
  });
});
