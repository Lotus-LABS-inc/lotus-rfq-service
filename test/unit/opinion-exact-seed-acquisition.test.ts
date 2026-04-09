import { describe, expect, it } from "vitest";

import type { ExactSeedDefinition } from "../../src/operations/semantic-expansion/exact-seed-shared.js";
import { evaluateSameFamilyCandidate } from "../../src/operations/semantic-expansion/opinion-exact-seed-acquisition.js";
import { parseStructuredProposition } from "../../src/simulation/proposition-matching.js";

const buildSeed = (overrides: Partial<ExactSeedDefinition>): ExactSeedDefinition => ({
  seedReference: overrides.seedReference ?? "seed-1",
  canonicalEventId: overrides.canonicalEventId ?? "event-1",
  canonicalMarketId: overrides.canonicalMarketId ?? "market-1",
  canonicalCategory: overrides.canonicalCategory ?? "CRYPTO",
  title: overrides.title ?? "Bitcoin all time high by March 31, 2026?",
  sourceText: overrides.sourceText ?? "Bitcoin all time high by March 31, 2026?",
  memberVenues: overrides.memberVenues ?? ["POLYMARKET", "LIMITLESS"],
  memberVenueMarketIds: overrides.memberVenueMarketIds ?? ["POLYMARKET:1", "LIMITLESS:1"],
  targetPairFamilies: overrides.targetPairFamilies ?? ["POLYMARKET_OPINION", "LIMITLESS_OPINION"],
  exactDateSearch: overrides.exactDateSearch ?? null,
  boundaryReferenceAt: overrides.boundaryReferenceAt ?? "2026-03-31T12:00:00.000Z"
});

describe("evaluateSameFamilyCandidate", () => {
  it("keeps crypto ATH family separate from directional contracts", () => {
    const seed = buildSeed({});
    const parsedSeed = parseStructuredProposition({
      category: "CRYPTO",
      title: seed.title,
      rules: seed.sourceText,
      boundaryReferenceAt: new Date(seed.boundaryReferenceAt!)
    });

    expect(evaluateSameFamilyCandidate({
      seed,
      parsedSeed,
      familyTemplate: "crypto_all_time_high_by_date",
      candidate: {
        venue: "OPINION",
        venueMarketId: "10045",
        title: "Bitcoin Up or Down on March 22?(12:00 ET)",
        slug: null,
        status: null,
        statusCode: null,
        labels: ["CRYPTO"],
        rules: null,
        yesLabel: "Yes",
        noLabel: "No",
        volume: null,
        volume24h: null,
        volume7d: null,
        quoteToken: null,
        chainId: null,
        questionId: null,
        createdAt: null,
        cutoffAt: new Date("2026-03-22T12:00:00.000Z"),
        resolvedAt: null,
        sourceMetadataVersion: "test-v1",
        raw: {}
      }
    })).toEqual({
      sameFamily: false,
      familyRejectionReason: "different_crypto_contract_family"
    });
  });

  it("rejects championship anchors against matchup winner markets", () => {
    const seed = buildSeed({
      canonicalCategory: "SPORTS",
      title: "Will OKC win the NBA Finals?",
      sourceText: "Resolves YES if Oklahoma City Thunder wins the NBA Finals."
    });
    const parsedSeed = parseStructuredProposition({
      category: "SPORTS",
      title: seed.title,
      rules: seed.sourceText
    });

    expect(evaluateSameFamilyCandidate({
      seed,
      parsedSeed,
      familyTemplate: "competition_winner",
      candidate: {
        venue: "OPINION",
        venueMarketId: "10278",
        title: "NBA: Thunder vs Celtics (Mar. 25 7:30PM ET)",
        slug: null,
        status: null,
        statusCode: null,
        labels: ["SPORTS", "NBA"],
        rules: null,
        yesLabel: "Yes",
        noLabel: "No",
        volume: null,
        volume24h: null,
        volume7d: null,
        quoteToken: null,
        chainId: null,
        questionId: null,
        createdAt: null,
        cutoffAt: new Date("2026-03-25T23:30:00.000Z"),
        resolvedAt: null,
        sourceMetadataVersion: "test-v1",
        raw: {}
      }
    })).toEqual({
      sameFamily: false,
      familyRejectionReason: "matchup_winner_not_competition_winner"
    });
  });
});
