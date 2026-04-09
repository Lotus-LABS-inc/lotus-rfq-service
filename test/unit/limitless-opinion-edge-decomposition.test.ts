import { describe, expect, it } from "vitest";

import { classifyLimitlessOpinionRootCause } from "../../src/operations/semantic-expansion/limitless-opinion-edge-decomposition.js";
import { parseStructuredProposition } from "../../src/simulation/proposition-matching.js";

describe("limitless-opinion-edge-decomposition", () => {
  it("classifies cross-asset crypto ATH candidates as true inventory mismatch", () => {
    const seed = parseStructuredProposition({
      category: "CRYPTO",
      title: "Bitcoin all time high by March 31, 2026?",
      rules: "Resolves YES if Bitcoin reaches a new all time high by March 31, 2026.",
      boundaryReferenceAt: new Date("2026-03-31T12:00:00Z")
    });
    const candidate = parseStructuredProposition({
      category: "CRYPTO",
      title: "BNB all time high by March 31?",
      rules: null,
      boundaryReferenceAt: new Date("2026-03-31T12:00:00Z")
    });

    expect(classifyLimitlessOpinionRootCause({
      category: "CRYPTO",
      seed,
      candidate,
      failedDimensions: ["subjectEntityMatch"],
      candidateTitle: "BNB all time high by March 31?"
    })).toEqual(expect.objectContaining({
      rootCauseClass: "true_inventory_mismatch",
      rationale: "different_crypto_asset"
    }));
  });

  it("classifies same-asset ATH cutoff drift as normalization gap", () => {
    const seed = parseStructuredProposition({
      category: "CRYPTO",
      title: "Bitcoin all time high by March 31, 2026?",
      rules: "Resolves YES if Bitcoin reaches a new all time high by March 31, 2026.",
      boundaryReferenceAt: new Date("2026-03-31T12:00:00Z")
    });
    const candidate = parseStructuredProposition({
      category: "CRYPTO",
      title: "BTC all time high by March 31?",
      rules: null,
      boundaryReferenceAt: new Date("2026-03-31T12:00:00Z")
    });

    expect(classifyLimitlessOpinionRootCause({
      category: "CRYPTO",
      seed,
      candidate,
      failedDimensions: ["timeBoundaryMatch"],
      candidateTitle: "BTC all time high by March 31?"
    })).toEqual(expect.objectContaining({
      rootCauseClass: "normalization_gap"
    }));
  });

  it("classifies championship versus matchup sports candidates as true inventory mismatch", () => {
    const seed = parseStructuredProposition({
      category: "SPORTS",
      title: "Will OKC win the NBA Finals?",
      rules: "Resolves YES if Oklahoma City Thunder wins the NBA Finals."
    });
    const candidate = parseStructuredProposition({
      category: "SPORTS",
      title: "NBA: Thunder vs Celtics (Mar. 25 7:30PM ET)",
      rules: null,
      boundaryReferenceAt: new Date("2026-03-25T23:30:00Z")
    });

    expect(classifyLimitlessOpinionRootCause({
      category: "SPORTS",
      seed,
      candidate,
      failedDimensions: ["conditionActionMatch", "timeBoundaryMatch", "competitionContextMatch"],
      candidateTitle: "NBA: Thunder vs Celtics (Mar. 25 7:30PM ET)"
    })).toEqual(expect.objectContaining({
      rootCauseClass: "true_inventory_mismatch",
      rationale: "championship_vs_match_winner_contract_family"
    }));
  });
});
