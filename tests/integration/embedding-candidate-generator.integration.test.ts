import { describe, expect, it } from "vitest";

import { classifyContractFamily } from "../../src/matching/contract-family-classifier.js";
import { TokenJaccardEmbeddingCandidateGenerator } from "../../src/matching/embedding-candidate-generator.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";

describe("embedding candidate generator", () => {
  it("shortlists only weak-structure event candidates above threshold", () => {
    const left = buildMatchingMarket({
      interpretedContractId: "ic-ev-1",
      venue: "POLYMARKET",
      venueMarketId: "pm-ev-1",
      category: "OTHER",
      title: "Will Company X launch a new device by June 2026?"
    });
    const right = buildMatchingMarket({
      interpretedContractId: "ic-ev-2",
      venue: "PREDICT",
      venueMarketId: "pr-ev-2",
      category: "OTHER",
      title: "Will Company X release a new device by June 2026?"
    });

    const generator = new TokenJaccardEmbeddingCandidateGenerator();
    const result = generator.shortlist({
      leftMarket: left,
      rightMarket: right,
      leftFamily: classifyContractFamily(left),
      rightFamily: classifyContractFamily(right)
    });

    expect(result.shortlisted).toBe(true);
    expect(Number.parseFloat(result.similarityScore)).toBeGreaterThan(0.72);
  });
});
