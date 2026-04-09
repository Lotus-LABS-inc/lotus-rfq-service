import { describe, expect, it } from "vitest";

import type { HistoricalRouteCuration } from "../../src/simulation/historical-route-catalog-manifest.js";
import {
  buildAcceptedImpact,
  evaluateOpinionCandidate,
  selectHybridFourSeeds,
  type OpinionExactMatchCandidateSnapshot
} from "../../src/simulation/opinion-exact-match-curation.js";

const makeCuration = (): HistoricalRouteCuration => ({
  version: 1,
  observedAt: "2026-03-27T00:00:00.000Z",
  policy: {
    exactMatchRule: "exact_semantic_equivalence_only",
    approvalMode: "checked_in_curated_manifest",
    catalogScope: "historical_simulation"
  },
  routes: [
    {
      historicalCanonicalEventId: "event-politics",
      historicalCanonicalMarketId: "market-politics",
      canonicalCategory: "POLITICS",
      title: "Will Gavin Newsom win the 2028 Democratic presidential nomination?",
      decision: {
        status: "accepted",
        reasonCode: "accepted",
        reason: "accepted"
      },
      discoveredFrom: [],
      venueProfiles: [
        {
          venue: "POLYMARKET",
          venueMarketId: "poly-1",
          title: "Will Gavin Newsom win the 2028 Democratic presidential nomination?",
          historySource: "predexon_polymarket",
          historyWindow: {
            start: "2026-03-01T00:00:00.000Z",
            end: "2026-03-20T00:00:00.000Z"
          }
        },
        {
          venue: "LIMITLESS",
          venueMarketId: "limitless-1",
          title: "Gavin Newsom",
          historySource: "predexon_limitless",
          historyWindow: {
            start: "2026-03-02T00:00:00.000Z",
            end: "2026-03-19T00:00:00.000Z"
          }
        }
      ],
      acceptedAssessments: []
    }
  ]
});

const makeCandidate = (overrides: Partial<OpinionExactMatchCandidateSnapshot> = {}): OpinionExactMatchCandidateSnapshot => ({
  marketId: "123",
  title: "Will Gavin Newsom win the 2028 Democratic presidential nomination?",
  slug: "gavin-newsom-2028",
  status: "Activated",
  labels: ["Politics"],
  rules: "This market resolves YES if Gavin Newsom wins the 2028 Democratic presidential nomination.",
  yesLabel: "Yes",
  noLabel: "No",
  quoteToken: null,
  chainId: "56",
  questionId: null,
  createdAt: "2026-03-01T00:00:00.000Z",
  cutoffAt: "2026-03-19T00:00:00.000Z",
  resolvedAt: null,
  category: "POLITICS",
  metadataVersion: "test-v1",
  ...overrides
});

const buildSeeds = () =>
  selectHybridFourSeeds({
    curation: makeCuration(),
    liveOpinionSeeds: [
      {
        category: "CRYPTO",
        canonicalEventId: "live-crypto",
        canonicalMarketId: "live-market-crypto",
        title: "Bitcoin ATH fallback",
        venueMarketId: "10593"
      },
      {
        category: "SPORTS",
        canonicalEventId: "live-sports",
        canonicalMarketId: "live-market-sports",
        title: "Sports fallback",
        venueMarketId: "10466"
      },
      {
        category: "ESPORTS",
        canonicalEventId: "live-esports",
        canonicalMarketId: "live-market-esports",
        title: "Esports fallback",
        venueMarketId: "10562"
      }
    ]
  });

describe("opinion exact-match curation helpers", () => {
  it("prefers historical seeds and falls back to live Opinion seeds when needed", () => {
    const seeds = selectHybridFourSeeds({
      curation: makeCuration(),
      liveOpinionSeeds: [
        {
          category: "POLITICS",
          canonicalEventId: "live-politics",
          canonicalMarketId: "live-market-politics",
          title: "Politics fallback",
          venueMarketId: "8454"
        },
        {
          category: "CRYPTO",
          canonicalEventId: "live-crypto",
          canonicalMarketId: "live-market-crypto",
          title: "Crypto fallback",
          venueMarketId: "10593"
        },
        {
          category: "SPORTS",
          canonicalEventId: "live-sports",
          canonicalMarketId: "live-market-sports",
          title: "Sports fallback",
          venueMarketId: "10466"
        },
        {
          category: "ESPORTS",
          canonicalEventId: "live-esports",
          canonicalMarketId: "live-market-esports",
          title: "Esports fallback",
          venueMarketId: "10562"
        }
      ]
    });

    expect(seeds).toHaveLength(4);
    expect(seeds.find((seed) => seed.category === "POLITICS")?.basis).toBe("historical");
    expect(seeds.find((seed) => seed.category === "CRYPTO")?.basis).toBe("live");
  });

  it("classifies a deterministic historical exact when history is present", () => {
    const seed = buildSeeds().find((entry) => entry.category === "POLITICS")!;

    const evaluation = evaluateOpinionCandidate({
      seed,
      candidate: makeCandidate(),
      historyPassed: true
    });

    expect(evaluation.comparison.classification).toBe("semantic_exact_historical_qualified");
    expect(evaluation.historicalQualification.passed).toBe(true);
    expect(evaluation.comparison.failedDimensions).toEqual([]);
  });

  it("downgrades a semantic exact to live-only when history is absent", () => {
    const seed = buildSeeds().find((entry) => entry.category === "POLITICS")!;

    const evaluation = evaluateOpinionCandidate({
      seed,
      candidate: makeCandidate(),
      historyPassed: false
    });

    expect(evaluation.comparison.classification).toBe("semantic_exact_live_only");
    expect(evaluation.historicalQualification.required).toBe(true);
    expect(evaluation.historicalQualification.passed).toBe(false);
  });

  it("classifies close candidates as near-exact when only the subject changes", () => {
    const seed = buildSeeds().find((entry) => entry.category === "POLITICS")!;

    const evaluation = evaluateOpinionCandidate({
      seed,
      candidate: makeCandidate({
        marketId: "6808",
        title: "Will Jon Ossoff win the 2028 Democratic presidential nomination?",
        rules: "This market resolves YES if Jon Ossoff wins the 2028 Democratic presidential nomination."
      }),
      historyPassed: true
    });

    expect(evaluation.comparison.classification).toBe("semantic_near_exact");
    expect(evaluation.comparison.failedDimensions).toContain("subjectEntityMatch");
  });

  it("treats proxies as mismatches", () => {
    const seed = buildSeeds().find((entry) => entry.category === "POLITICS")!;

    const evaluation = evaluateOpinionCandidate({
      seed,
      candidate: makeCandidate({
        marketId: "8454",
        title: "Will another country strike Iran by March 31?",
        rules: "This market resolves YES if another country strikes Iran by March 31."
      }),
      historyPassed: true
    });

    expect(evaluation.comparison.classification).toBe("proxy_or_mismatch");
  });

  it("marks live exact overlaps as non-historical in projection impact", () => {
    const seed = buildSeeds().find((entry) => entry.category === "POLITICS")!;
    expect(
      buildAcceptedImpact({
        seed,
        classification: "semantic_exact_live_only"
      })
    ).toEqual({
      liveExactOverlap: true,
      historicalPairEligible: false,
      triRoutePotential: true
    });
  });
});
