import { describe, expect, it } from "vitest";

import {
  buildMarketDiscoveryCandidates,
  buildMarketDiscoveryCandidatesFromSnapshots,
  normalizeInventoryRowForDiscovery
} from "../../src/market-discovery/market-discovery-clustering.js";
import { buildMarketDiscoveryTopicBundles } from "../../src/market-discovery/market-discovery-topic-bundles.js";
import { extractMarketSemanticHints } from "../../src/market-discovery/semantic-core-extraction.js";
import { normalizeGammaEventList, normalizeGammaMarketList, type PolymarketGammaEvent } from "../../src/integrations/polymarket/polymarket-gamma-client.js";
import { UpstreamMarketDiscoveryCollector } from "../../src/market-discovery/upstream-market-discovery-collector.js";
import type { VenueMarketDiscoverySnapshot } from "../../src/market-discovery/market-discovery-types.js";
import type { SemanticExpansionInventoryRow } from "../../src/operations/semantic-expansion/shared.js";

const baseRow = (overrides: Partial<SemanticExpansionInventoryRow>): SemanticExpansionInventoryRow => ({
  venueMarketProfileId: `${overrides.venue ?? "POLYMARKET"}:${overrides.venueMarketId ?? "default"}`,
  canonicalEventId: "00000000-0000-5000-8000-000000000001",
  canonicalMarketId: null,
  currentExecutableMemberCount: 0,
  canonicalCategory: "SPORTS",
  semanticCategory: "SPORTS",
  venue: "POLYMARKET",
  venueMarketId: "default",
  title: "Chelsea vs Crystal Palace",
  description: null,
  rules: "Settlement follows official match result.",
  marketType: null,
  marketClass: "BINARY",
  outcomes: [{ label: "Yes" }, { label: "No" }],
  outcomeSchema: {},
  topics: [],
  publishedAt: null,
  expiresAt: "2026-08-30T12:00:00.000Z",
  resolvesAt: "2026-08-30T12:00:00.000Z",
  fees: {},
  feeModel: null,
  resolutionSource: "Venue",
  resolutionTitle: "Chelsea vs Crystal Palace",
  resolutionRulesText: "Settlement follows official match result.",
  resolutionAuthorityType: null,
  sourceHierarchy: {},
  disputeWindowHours: null,
  ambiguousTimeBoundary: false,
  ambiguousSourceReference: false,
  ambiguousJurisdictionOrScope: false,
  settlementType: null,
  settlementLagHours: null,
  finalityLagHours: null,
  payoutTimingHours: null,
  feeOnEntry: false,
  feeOnExit: false,
  timeSensitiveFeeBehavior: null,
  requiresConservativeAnchor: false,
  network: null,
  chain: null,
  rawSourcePayload: {},
  normalizedPayload: {},
  mappingLineage: [],
  confidenceScore: 0.9,
  sourceMetadataVersion: "test-current",
  historicalRowCount: 0,
  latestHistoricalTimestamp: null,
  evidenceLabel: "current_state",
  ...overrides
});

const baseSnapshot = (overrides: Partial<VenueMarketDiscoverySnapshot>): VenueMarketDiscoverySnapshot => ({
  id: `${overrides.venue ?? "POLYMARKET"}:${overrides.venueMarketId ?? "snapshot"}`,
  venue: "POLYMARKET",
  venueMarketId: "snapshot",
  active: true,
  title: "Will Bitcoin hit $200k by 2026-12-31?",
  normalizedTitle: "will bitcoin hit 200k by 2026 12 31",
  category: "CRYPTO",
  marketClass: "BINARY",
  outcomes: ["Yes", "No"],
  semanticBoundaryKey: "2026-12-31",
  expiresAt: new Date("2026-12-31T00:00:00.000Z"),
  resolvesAt: new Date("2026-12-31T00:00:00.000Z"),
  rulesText: "Resolves yes if Bitcoin reaches the threshold by the deadline.",
  resolutionSource: "venue",
  slug: null,
  sourceUrl: null,
  tokenIds: ["token-yes", "token-no"],
  quoteReady: true,
  executionReady: true,
  sourceHash: "hash",
  sourceKind: "UPSTREAM_VENUE",
  rawSummary: {},
  ...overrides
});

describe("market discovery clustering", () => {
  it("clusters matching active venue markets into an ingested candidate", () => {
    const rows = [
      baseRow({ venue: "POLYMARKET", venueMarketId: "pm-1" }),
      baseRow({ venue: "LIMITLESS", venueMarketId: "lim-1" }),
      baseRow({ venue: "OPINION", venueMarketId: "op-1" })
    ];

    const result = buildMarketDiscoveryCandidates(rows, new Date("2026-06-01T00:00:00.000Z"));

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.state).toBe("INGESTED");
    expect(result.candidates[0]?.venues).toEqual(["LIMITLESS", "OPINION", "POLYMARKET"]);
    expect(result.candidates[0]?.sharedOutcomes).toEqual(["no", "yes"]);
    expect(result.candidates[0]?.reasonCodes).toContain("OUTCOME_OVERLAP");
  });

  it("keeps title/date matches with mismatched outcomes in discovered review state", () => {
    const rows = [
      baseRow({
        venue: "POLYMARKET",
        venueMarketId: "pm-1",
        outcomes: [{ label: "Chelsea" }, { label: "Draw" }, { label: "Crystal Palace" }]
      }),
      baseRow({
        venue: "LIMITLESS",
        venueMarketId: "lim-1",
        outcomes: [{ label: "Chelsea win by 2+" }, { label: "Any other result" }]
      })
    ];

    const result = buildMarketDiscoveryCandidates(rows, new Date("2026-06-01T00:00:00.000Z"));

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.state).toBe("DISCOVERED");
    expect(result.candidates[0]?.candidateType).toBe("LOW_CONFIDENCE");
    expect(result.candidates[0]?.matchDimensions.eventTitle).toBe(true);
    expect(result.candidates[0]?.matchDimensions.outcomes).toBe(false);
    expect(result.candidates[0]?.reasonCodes).toContain("OUTCOME_REVIEW_REQUIRED");
  });

  it("does not treat generic yes/no as outcome overlap when named outcomes are present", () => {
    const rows = [
      baseRow({
        venue: "POLYMARKET",
        venueMarketId: "pm-1",
        outcomes: [{ label: "Yes" }, { label: "No" }, { label: "Democrats sweep" }]
      }),
      baseRow({
        venue: "PREDICT",
        venueMarketId: "predict-1",
        outcomes: [{ label: "Yes" }, { label: "No" }, { label: "D Senate R House" }]
      })
    ];

    const result = buildMarketDiscoveryCandidates(rows, new Date("2026-06-01T00:00:00.000Z"));

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.sharedOutcomes).toEqual([]);
    expect(result.candidates[0]?.state).toBe("DISCOVERED");
    expect(result.candidates[0]?.candidateType).toBe("LOW_CONFIDENCE");
  });

  it("excludes expired and inactive venue rows before clustering", () => {
    const rows = [
      baseRow({ venue: "POLYMARKET", venueMarketId: "pm-1", resolvesAt: "2026-01-01T00:00:00.000Z" }),
      baseRow({ venue: "LIMITLESS", venueMarketId: "lim-1" })
    ];

    const result = buildMarketDiscoveryCandidates(rows, new Date("2026-06-01T00:00:00.000Z"));

    expect(result.activeRows).toHaveLength(1);
    expect(result.candidates).toHaveLength(0);
  });

  it("uses ISO dates in titles as semantic boundaries when venue dates are missing", () => {
    const row = normalizeInventoryRowForDiscovery(
      baseRow({
        title: "Ath By Date Btc 2026-09-30",
        resolutionTitle: "Ath By Date Btc 2026-09-30",
        venueMarketId: "LIMITLESS:september-30-2026:CRYPTO|ATH_BY_DATE|BTC|2026-09-30",
        resolvesAt: null,
        expiresAt: null
      }),
      new Date("2026-06-01T00:00:00.000Z")
    );

    expect(row?.semanticBoundaryKey).toBe("2026-09-30");
  });

  it("excludes title-dated markets when the derived boundary has already passed", () => {
    const rows = [
      baseRow({
        venue: "POLYMARKET",
        venueMarketId: "pm-past",
        title: "USA China Trump Visit China 2026-04-30",
        resolutionTitle: "USA China Trump Visit China 2026-04-30",
        resolvesAt: null,
        expiresAt: null
      }),
      baseRow({
        venue: "LIMITLESS",
        venueMarketId: "lim-future",
        title: "USA China Trump Visit China 2026-08-30",
        resolutionTitle: "USA China Trump Visit China 2026-08-30",
        resolvesAt: null,
        expiresAt: null
      })
    ];

    const result = buildMarketDiscoveryCandidates(rows, new Date("2026-06-13T00:00:00.000Z"));

    expect(result.activeRows).toHaveLength(1);
    expect(result.activeRows[0]?.semanticBoundaryKey).toBe("2026-08-30");
    expect(result.candidates).toHaveLength(0);
  });

  it("does not cluster same-title markets with different date boundaries", () => {
    const rows = [
      baseRow({ venue: "POLYMARKET", venueMarketId: "pm-1", resolvesAt: "2026-08-30T12:00:00.000Z" }),
      baseRow({ venue: "LIMITLESS", venueMarketId: "lim-1", resolvesAt: "2026-09-30T12:00:00.000Z" })
    ];

    const result = buildMarketDiscoveryCandidates(rows, new Date("2026-06-01T00:00:00.000Z"));

    expect(result.candidates).toHaveLength(0);
  });

  it("normalizes Predict.fun venue aliases and source URL metadata", () => {
    const row = normalizeInventoryRowForDiscovery(
      baseRow({
        venue: "PREDICT",
        venueMarketId: "predict-1",
        normalizedPayload: { sourceUrl: "https://predict.fun/market/example" }
      }),
      new Date("2026-06-01T00:00:00.000Z")
    );

    expect(row?.venue).toBe("PREDICT");
    expect(row?.sourceUrl).toBe("https://predict.fun/market/example");
  });

  it("does not group BTC ATH and ETH ATH as one upstream discovery", () => {
    const result = buildMarketDiscoveryCandidatesFromSnapshots([
      baseSnapshot({
        venue: "POLYMARKET",
        venueMarketId: "btc-ath",
        title: "Bitcoin all time high by 2026-12-31",
        normalizedTitle: "bitcoin all time high by 2026 12 31",
        rulesText: "Resolves yes if Bitcoin reaches a new all time high by the deadline."
      }),
      baseSnapshot({
        venue: "LIMITLESS",
        venueMarketId: "eth-ath",
        title: "Ethereum all time high by 2026-12-31",
        normalizedTitle: "ethereum all time high by 2026 12 31",
        rulesText: "Resolves yes if Ethereum reaches a new all time high by the deadline."
      })
    ]);

    expect(result.candidates).toHaveLength(0);
  });

  it("does not group ATH markets with token launch markets", () => {
    const result = buildMarketDiscoveryCandidatesFromSnapshots([
      baseSnapshot({
        venue: "POLYMARKET",
        venueMarketId: "btc-ath",
        title: "Bitcoin all time high by 2026-12-31",
        normalizedTitle: "bitcoin all time high by 2026 12 31"
      }),
      baseSnapshot({
        venue: "OPINION",
        venueMarketId: "btc-fdv",
        title: "Bitcoin FDV one day after launch",
        normalizedTitle: "bitcoin fdv one day after launch",
        rulesText: "Resolves yes according to Bitcoin fully diluted valuation one day after launch."
      })
    ]);

    expect(result.candidates).toHaveLength(0);
  });

  it("classifies coherent upstream-only venue matches as a new discovery", () => {
    const result = buildMarketDiscoveryCandidatesFromSnapshots([
      baseSnapshot({ venue: "POLYMARKET", venueMarketId: "pm-btc-200k" }),
      baseSnapshot({ venue: "LIMITLESS", venueMarketId: "lim-btc-200k" })
    ]);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.candidateType).toBe("NEW_DISCOVERY");
    expect(result.candidates[0]?.sourceKind).toBe("UPSTREAM_VENUE");
    expect(result.candidates[0]?.draftSemanticCore?.subject).toBe("BTC_200K");
    expect(result.candidates[0]?.matchDimensions.eventTitle).toBe(true);
    expect(result.candidates[0]?.matchDimensions.outcomes).toBe(true);
    expect(result.candidates[0]?.state).toBe("INGESTED");
  });

  it("classifies existing split canonical rows as merge suggestions, not new discoveries", () => {
    const rows = [
      baseRow({
        venue: "POLYMARKET",
        venueMarketId: "pm-1",
        canonicalEventId: "00000000-0000-5000-8000-000000000001"
      }),
      baseRow({
        venue: "LIMITLESS",
        venueMarketId: "lim-1",
        canonicalEventId: "00000000-0000-5000-8000-000000000002"
      })
    ];

    const result = buildMarketDiscoveryCandidates(rows, new Date("2026-06-01T00:00:00.000Z"));

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.candidateType).toBe("MERGE_SUGGESTION");
  });

  it("does not ingest generic yes/no overlap without subject or condition dimensions", () => {
    const result = buildMarketDiscoveryCandidatesFromSnapshots([
      baseSnapshot({
        venue: "POLYMARKET",
        venueMarketId: "pm-generic",
        title: "Will it happen by 2026-12-31?",
        normalizedTitle: "will it happen by 2026 12 31",
        rulesText: "Resolves according to the venue rule text."
      }),
      baseSnapshot({
        venue: "LIMITLESS",
        venueMarketId: "lim-generic",
        title: "Will it happen by 2026-12-31?",
        normalizedTitle: "will it happen by 2026 12 31",
        rulesText: "Resolves according to the venue rule text."
      })
    ]);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.state).toBe("DISCOVERED");
    expect(result.candidates[0]?.candidateType).toBe("LOW_CONFIDENCE");
    expect(result.candidates[0]?.matchDimensions.subject).toBe(false);
    expect(result.candidates[0]?.matchDimensions.condition).toBe(false);
  });

  it("matches threshold contracts even when venue side labels differ", () => {
    const result = buildMarketDiscoveryCandidatesFromSnapshots([
      baseSnapshot({
        venue: "POLYMARKET",
        venueMarketId: "pm-btc-200k",
        title: "Will Bitcoin hit $200k by 2026-12-31?",
        normalizedTitle: "will bitcoin hit 200k by 2026 12 31",
        outcomes: ["Yes", "No"]
      }),
      baseSnapshot({
        venue: "LIMITLESS",
        venueMarketId: "lim-btc-200k",
        title: "Will Bitcoin hit $200k by 2026-12-31?",
        normalizedTitle: "will bitcoin hit 200k by 2026 12 31",
        outcomes: ["Above threshold", "Below threshold"]
      })
    ]);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.matchDimensions.eventTitle).toBe(true);
    expect(result.candidates[0]?.matchDimensions.outcomes).toBe(true);
    expect(result.candidates[0]?.candidateType).toBe("NEW_DISCOVERY");
    expect(result.candidates[0]?.state).toBe("INGESTED");
    expect(result.candidates[0]?.sharedOutcomes).toEqual(["ABOVE_200000"]);
  });

  it("does not collapse World Cup group markets through broad event title tokens", () => {
    const result = buildMarketDiscoveryCandidatesFromSnapshots([
      baseSnapshot({
        venue: "LIMITLESS",
        venueMarketId: "group-a",
        title: "World Cup: Highest-Scoring Team in Group A (Group Stage)",
        normalizedTitle: "world cup highest scoring team in group a group stage",
        category: "SPORTS",
        semanticBoundaryKey: "2026-07-12"
      }),
      baseSnapshot({
        venue: "LIMITLESS",
        venueMarketId: "group-b",
        title: "World Cup: Highest-Scoring Team in Group B (Group Stage)",
        normalizedTitle: "world cup highest scoring team in group b group stage",
        category: "SPORTS",
        semanticBoundaryKey: "2026-07-12"
      }),
      baseSnapshot({
        venue: "POLYMARKET",
        venueMarketId: "saudi-group-h",
        title: "Will Saudi Arabia finish second in Group H in the 2026 FIFA World Cup Group Stage?",
        normalizedTitle: "will saudi arabia finish second in group h in the 2026 fifa world cup group stage",
        category: "SPORTS",
        semanticBoundaryKey: "2026-07-12"
      })
    ]);

    expect(result.candidates).toHaveLength(0);
  });

  it("uses cross-venue event titles from snapshot summaries for matching", () => {
    const result = buildMarketDiscoveryCandidatesFromSnapshots([
      baseSnapshot({
        venue: "POLYMARKET",
        venueMarketId: "pm-btc-200k",
        title: "Will Bitcoin hit $200k by 2026-12-31?",
        normalizedTitle: "will bitcoin hit 200k by 2026 12 31",
        rawSummary: { eventTitle: "Bitcoin $200k by 2026" }
      }),
      baseSnapshot({
        venue: "LIMITLESS",
        venueMarketId: "lim-btc-200k",
        title: "Bitcoin reaches 200k before 2026-12-31",
        normalizedTitle: "bitcoin reaches 200k before 2026 12 31",
        rawSummary: { eventTitle: "Bitcoin $200k by 2026" }
      })
    ]);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.matchDimensions.eventTitle).toBe(true);
    expect(result.candidates[0]?.candidateType).toBe("NEW_DISCOVERY");
  });

  it("keeps Polymarket Gamma outcome labels even when token ids are missing", () => {
    const markets = normalizeGammaMarketList({
      id: "1",
      conditionId: "0xabc",
      question: "Will Bitcoin hit $200k by 2026-12-31?",
      outcomes: "[\"Yes\",\"No\"]",
      clobTokenIds: "[]",
      active: true,
      closed: false
    });

    expect(markets[0]?.raw.outcomes).toEqual([
      { label: "Yes", token_id: undefined },
      { label: "No", token_id: undefined }
    ]);
  });

  it("extracts threshold-specific semantic subjects", () => {
    const hints = extractMarketSemanticHints({
      eventTitle: "Bitcoin $200k by 2026",
      title: "Will Bitcoin hit $200k by 2026-12-31?",
      rulesText: "Resolves yes if Bitcoin reaches $200k."
    });

    expect(hints.marketFamily).toBe("FIRST_TO_HIT");
    expect(hints.subject).toBe("BTC_200K");
    expect(hints.condition).toBe("PRICE_THRESHOLD");
  });

  it("extracts dynamic FDV subjects and threshold contracts", () => {
    const hints = extractMarketSemanticHints({
      eventTitle: "Aligned Layer FDV above ___ one day after launch?",
      title: "$20M",
      outcomes: ["Yes", "No"]
    });

    expect(hints.marketFamily).toBe("FDV_AFTER_LAUNCH");
    expect(hints.subject).toBe("ALIGNED_LAYER");
    expect(hints.condition).toBe("FDV_AFTER_LAUNCH");
    expect(hints.contractLabel).toBe("$20M");
    expect(hints.contractKey).toBe("ABOVE_20000000");
    expect(hints.sideLabels).toEqual(["no", "yes"]);
  });

  it("extracts IPO company contracts from child labels", () => {
    const hints = extractMarketSemanticHints({
      eventTitle: "IPOs before 2027?",
      title: "OpenAI",
      outcomes: ["Yes", "No"]
    });

    expect(hints.marketFamily).toBe("IPO_BY_DATE");
    expect(hints.subject).toBe("IPO_LISTING");
    expect(hints.condition).toBe("IPO_BY_DATE");
    expect(hints.contractLabel).toBe("OpenAI");
    expect(hints.contractKey).toBe("OPENAI");
  });

  it("extracts token launch subjects and date contracts", () => {
    const hints = extractMarketSemanticHints({
      eventTitle: "Will Base launch a token by ___ ?",
      title: "June 30, 2026",
      outcomes: ["Yes", "No"]
    });

    expect(hints.marketFamily).toBe("TOKEN_LAUNCH_BY_DATE");
    expect(hints.subject).toBe("BASE");
    expect(hints.condition).toBe("TOKEN_LAUNCH_BY_DATE");
    expect(hints.contractKey).toBe("DATE_2026_06_30");
  });

  it("extracts Fed decision action contracts", () => {
    const hints = extractMarketSemanticHints({
      eventTitle: "Fed Decision in June?",
      title: "25 bps decrease",
      outcomes: ["Yes", "No"]
    });

    expect(hints.marketFamily).toBe("FED_DECISION");
    expect(hints.subject).toBe("FED_RATE");
    expect(hints.condition).toBe("FED_DECISION");
    expect(hints.contractKey).toBe("BPS_DECREASE_25");
  });

  it("extracts Fed rate cut count contracts without treating them as price thresholds", () => {
    const hints = extractMarketSemanticHints({
      eventTitle: "How many Fed rate cuts in 2026?",
      title: "3+ cuts",
      outcomes: ["Yes", "No"]
    });

    expect(hints.marketFamily).toBe("FED_RATE_CUT_COUNT");
    expect(hints.subject).toBe("FED_RATE");
    expect(hints.condition).toBe("FED_RATE_CUT_COUNT");
    expect(hints.contractKey).toBe("CUTS_3_PLUS");
  });

  it("extracts party-control balance of power contracts", () => {
    const hints = extractMarketSemanticHints({
      eventTitle: "Balance of Power: 2026 Midterms",
      title: "D Senate, R House",
      venueMarketId: "POLYMARKET:balance-of-power|PARTY_CONTROL|USA|CONGRESS|2026|D_SENATE_R_HOUSE",
      outcomes: ["Yes", "No"]
    });

    expect(hints.marketFamily).toBe("PARTY_CONTROL_BALANCE_OF_POWER");
    expect(hints.subject).toBe("US_CONGRESS_2026");
    expect(hints.condition).toBe("PARTY_CONTROL");
    expect(hints.contractKey).toBe("D_SENATE_R_HOUSE");
  });

  it("extracts AI model ranking company contracts", () => {
    const hints = extractMarketSemanticHints({
      eventTitle: "Which company has best AI model end of June?",
      title: "Will OpenAI have the best AI model at the end of June 2026?",
      outcomes: ["Yes", "No"]
    });

    expect(hints.marketFamily).toBe("AI_MODEL_RANKING");
    expect(hints.subject).toBe("AI_MODEL_LEADERBOARD");
    expect(hints.condition).toBe("AI_MODEL_RANKING");
    expect(hints.contractKey).toBe("OPENAI");
  });

  it("extracts World Cup stat leader contracts", () => {
    const hints = extractMarketSemanticHints({
      eventTitle: "World Cup: Most Assists",
      title: "Lionel Messi",
      category: "SPORTS",
      outcomes: ["Yes", "No"]
    });

    expect(hints.marketFamily).toBe("WORLD_CUP_MOST_ASSISTS");
    expect(hints.subject).toBe("WORLD_CUP_2026");
    expect(hints.condition).toBe("MOST_ASSISTS");
    expect(hints.contractKey).toBe("LIONEL_MESSI");
  });

  it("matches same topic and same threshold contract as a new discovery", () => {
    const result = buildMarketDiscoveryCandidatesFromSnapshots([
      baseSnapshot({
        venue: "POLYMARKET",
        venueMarketId: "aligned-pm-20m",
        title: "Aligned FDV above $20M one day after launch?",
        normalizedTitle: "aligned fdv above 20m one day after launch",
        category: "CRYPTO",
        semanticBoundaryKey: "2028-01-01",
        rawSummary: { eventTitle: "Aligned Layer FDV above ___ one day after launch?" }
      }),
      baseSnapshot({
        venue: "PREDICT",
        venueMarketId: "aligned-predict-20m",
        title: "$20M",
        normalizedTitle: "20m",
        category: "CRYPTO",
        semanticBoundaryKey: "2028-01-01",
        rawSummary: { eventTitle: "Aligned Layer FDV above ___ one day after launch?" }
      })
    ]);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.candidateType).toBe("NEW_DISCOVERY");
    expect(result.candidates[0]?.state).toBe("INGESTED");
    expect(result.candidates[0]?.draftSemanticCore?.subject).toBe("ALIGNED_LAYER");
    expect(result.candidates[0]?.sharedOutcomes).toEqual(["ABOVE_20000000"]);
  });

  it("does not collapse same topic with different threshold contracts", () => {
    const result = buildMarketDiscoveryCandidatesFromSnapshots([
      baseSnapshot({
        venue: "POLYMARKET",
        venueMarketId: "aligned-pm-20m",
        title: "Aligned FDV above $20M one day after launch?",
        normalizedTitle: "aligned fdv above 20m one day after launch",
        category: "CRYPTO",
        semanticBoundaryKey: "2028-01-01",
        rawSummary: { eventTitle: "Aligned Layer FDV above ___ one day after launch?" }
      }),
      baseSnapshot({
        venue: "PREDICT",
        venueMarketId: "aligned-predict-50m",
        title: "$50M",
        normalizedTitle: "50m",
        category: "CRYPTO",
        semanticBoundaryKey: "2028-01-01",
        rawSummary: { eventTitle: "Aligned Layer FDV above ___ one day after launch?" }
      })
    ]);

    expect(result.candidates).toHaveLength(0);
  });

  it("matches same token-launch topic and same date contract only", () => {
    const sameDate = buildMarketDiscoveryCandidatesFromSnapshots([
      baseSnapshot({
        venue: "POLYMARKET",
        venueMarketId: "base-pm-june",
        title: "Will Base launch a token by June 30, 2026?",
        normalizedTitle: "will base launch a token by june 30 2026",
        category: "CRYPTO",
        semanticBoundaryKey: "2026-12-31",
        rawSummary: { eventTitle: "Will Base launch a token by ___ ?" }
      }),
      baseSnapshot({
        venue: "PREDICT",
        venueMarketId: "base-predict-june",
        title: "June 30, 2026",
        normalizedTitle: "june 30 2026",
        category: "CRYPTO",
        semanticBoundaryKey: "2026-12-31",
        rawSummary: { eventTitle: "Will Base launch a token by ___ ?" }
      })
    ]);

    expect(sameDate.candidates).toHaveLength(1);
    expect(sameDate.candidates[0]?.state).toBe("INGESTED");
    expect(sameDate.candidates[0]?.sharedOutcomes).toEqual(["DATE_2026_06_30"]);

    const differentDate = buildMarketDiscoveryCandidatesFromSnapshots([
      baseSnapshot({
        venue: "POLYMARKET",
        venueMarketId: "base-pm-june",
        title: "Will Base launch a token by June 30, 2026?",
        normalizedTitle: "will base launch a token by june 30 2026",
        category: "CRYPTO",
        semanticBoundaryKey: "2026-12-31",
        rawSummary: { eventTitle: "Will Base launch a token by ___ ?" }
      }),
      baseSnapshot({
        venue: "PREDICT",
        venueMarketId: "base-predict-september",
        title: "September 30, 2026",
        normalizedTitle: "september 30 2026",
        category: "CRYPTO",
        semanticBoundaryKey: "2026-12-31",
        rawSummary: { eventTitle: "Will Base launch a token by ___ ?" }
      })
    ]);

    expect(differentDate.candidates).toHaveLength(0);
  });

  it("does not collapse different dynamic FDV subjects with the same threshold contract", () => {
    const result = buildMarketDiscoveryCandidatesFromSnapshots([
      baseSnapshot({
        venue: "POLYMARKET",
        venueMarketId: "decibel-pm-200m",
        title: "Decibel FDV above $200M one day after launch?",
        normalizedTitle: "decibel fdv above 200m one day after launch",
        category: "CRYPTO",
        semanticBoundaryKey: "2028-01-01",
        rawSummary: { eventTitle: "Decibel FDV above ___ one day after launch?" }
      }),
      baseSnapshot({
        venue: "PREDICT",
        venueMarketId: "aligned-predict-200m",
        title: "$200M",
        normalizedTitle: "200m",
        category: "CRYPTO",
        semanticBoundaryKey: "2028-01-01",
        rawSummary: { eventTitle: "Aligned Layer FDV above ___ one day after launch?" }
      })
    ]);

    expect(result.candidates).toHaveLength(0);
  });

  it("groups same-topic threshold contracts into one review bundle", () => {
    const candidates = [
      ...buildMarketDiscoveryCandidatesFromSnapshots([
        baseSnapshot({
          venue: "POLYMARKET",
          venueMarketId: "aligned-pm-20m",
          title: "Aligned FDV above $20M one day after launch?",
          category: "CRYPTO",
          semanticBoundaryKey: "2028-01-01",
          rawSummary: { eventTitle: "Aligned Layer FDV above ___ one day after launch?" }
        }),
        baseSnapshot({
          venue: "PREDICT",
          venueMarketId: "aligned-predict-20m",
          title: "$20M",
          category: "CRYPTO",
          semanticBoundaryKey: "2028-01-01",
          rawSummary: { eventTitle: "Aligned Layer FDV above ___ one day after launch?" }
        })
      ]).candidates,
      ...buildMarketDiscoveryCandidatesFromSnapshots([
        baseSnapshot({
          venue: "POLYMARKET",
          venueMarketId: "aligned-pm-50m",
          title: "Aligned FDV above $50M one day after launch?",
          category: "CRYPTO",
          semanticBoundaryKey: "2028-01-01",
          rawSummary: { eventTitle: "Aligned Layer FDV above ___ one day after launch?" }
        }),
        baseSnapshot({
          venue: "PREDICT",
          venueMarketId: "aligned-predict-50m",
          title: "$50M",
          category: "CRYPTO",
          semanticBoundaryKey: "2028-01-01",
          rawSummary: { eventTitle: "Aligned Layer FDV above ___ one day after launch?" }
        })
      ]).candidates,
      ...buildMarketDiscoveryCandidatesFromSnapshots([
        baseSnapshot({
          venue: "POLYMARKET",
          venueMarketId: "aligned-pm-100m",
          title: "Aligned FDV above $100M one day after launch?",
          category: "CRYPTO",
          semanticBoundaryKey: "2028-01-01",
          rawSummary: { eventTitle: "Aligned Layer FDV above ___ one day after launch?" }
        }),
        baseSnapshot({
          venue: "PREDICT",
          venueMarketId: "aligned-predict-100m",
          title: "$100M",
          category: "CRYPTO",
          semanticBoundaryKey: "2028-01-01",
          rawSummary: { eventTitle: "Aligned Layer FDV above ___ one day after launch?" }
        })
      ]).candidates
    ];

    const bundles = buildMarketDiscoveryTopicBundles(candidates);

    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.topicTitle).toBe("Aligned Layer FDV above ___ one day after launch?");
    expect(bundles[0]?.contractCount).toBe(3);
    expect(bundles[0]?.children.map((child) => child.contractKey).sort()).toEqual([
      "ABOVE_100000000",
      "ABOVE_20000000",
      "ABOVE_50000000"
    ]);
  });

  it("marks same topic and same contract across three venues as tri coverage", () => {
    const result = buildMarketDiscoveryCandidatesFromSnapshots([
      baseSnapshot({
        venue: "POLYMARKET",
        venueMarketId: "aligned-pm-20m",
        title: "Aligned FDV above $20M one day after launch?",
        category: "CRYPTO",
        semanticBoundaryKey: "2028-01-01",
        rawSummary: { eventTitle: "Aligned Layer FDV above ___ one day after launch?" }
      }),
      baseSnapshot({
        venue: "PREDICT",
        venueMarketId: "aligned-predict-20m",
        title: "$20M",
        category: "CRYPTO",
        semanticBoundaryKey: "2028-01-01",
        rawSummary: { eventTitle: "Aligned Layer FDV above ___ one day after launch?" }
      }),
      baseSnapshot({
        venue: "LIMITLESS",
        venueMarketId: "aligned-limitless-20m",
        title: "Aligned Layer FDV over $20M one day after launch",
        category: "CRYPTO",
        semanticBoundaryKey: "2028-01-01",
        rawSummary: { eventTitle: "Aligned Layer FDV above ___ one day after launch?" }
      })
    ]);

    const bundles = buildMarketDiscoveryTopicBundles(result.candidates);

    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.children).toHaveLength(1);
    expect(bundles[0]?.children[0]?.coverageKind).toBe("TRI");
    expect(bundles[0]?.children[0]?.venues).toEqual(["LIMITLESS", "POLYMARKET", "PREDICT"]);
    expect(bundles[0]?.children[0]?.missingVenueEvidence).toEqual([]);
  });

  it("keeps same threshold contracts under different subjects in different bundles", () => {
    const candidates = [
      ...buildMarketDiscoveryCandidatesFromSnapshots([
        baseSnapshot({
          venue: "POLYMARKET",
          venueMarketId: "aligned-pm-20m",
          title: "Aligned FDV above $20M one day after launch?",
          category: "CRYPTO",
          semanticBoundaryKey: "2028-01-01",
          rawSummary: { eventTitle: "Aligned Layer FDV above ___ one day after launch?" }
        }),
        baseSnapshot({
          venue: "PREDICT",
          venueMarketId: "aligned-predict-20m",
          title: "$20M",
          category: "CRYPTO",
          semanticBoundaryKey: "2028-01-01",
          rawSummary: { eventTitle: "Aligned Layer FDV above ___ one day after launch?" }
        })
      ]).candidates,
      ...buildMarketDiscoveryCandidatesFromSnapshots([
        baseSnapshot({
          venue: "POLYMARKET",
          venueMarketId: "decibel-pm-20m",
          title: "Decibel FDV above $20M one day after launch?",
          category: "CRYPTO",
          semanticBoundaryKey: "2028-01-01",
          rawSummary: { eventTitle: "Decibel FDV above ___ one day after launch?" }
        }),
        baseSnapshot({
          venue: "PREDICT",
          venueMarketId: "decibel-predict-20m",
          title: "$20M",
          category: "CRYPTO",
          semanticBoundaryKey: "2028-01-01",
          rawSummary: { eventTitle: "Decibel FDV above ___ one day after launch?" }
        })
      ]).candidates
    ];

    const bundles = buildMarketDiscoveryTopicBundles(candidates);

    expect(bundles).toHaveLength(2);
    expect(bundles.map((bundle) => bundle.subject).sort()).toEqual(["ALIGNED_LAYER", "DECIBEL"]);
  });

  it("does not create a topic bundle child from yes/no-only low-confidence candidates", () => {
    const result = buildMarketDiscoveryCandidatesFromSnapshots([
      baseSnapshot({
        venue: "POLYMARKET",
        venueMarketId: "pm-generic",
        title: "Will it happen by 2026-12-31?",
        normalizedTitle: "will it happen by 2026 12 31",
        rulesText: "Resolves according to the venue rule text."
      }),
      baseSnapshot({
        venue: "LIMITLESS",
        venueMarketId: "lim-generic",
        title: "Will it happen by 2026-12-31?",
        normalizedTitle: "will it happen by 2026 12 31",
        rulesText: "Resolves according to the venue rule text."
      })
    ]);

    expect(result.candidates[0]?.candidateType).toBe("LOW_CONFIDENCE");
    expect(buildMarketDiscoveryTopicBundles(result.candidates)).toHaveLength(0);
  });

  it("collects every Polymarket child market from an event discovery response", async () => {
    const detailMarkets = [
      ...normalizeGammaMarketList({
        id: "pm-20m",
        conditionId: "0x0000000000000000000000000000000000000000000000000000000000000020",
        question: "Decibel FDV above $20M one day after launch?",
        slug: "decibel-fdv-above-20m-one-day-after-launch",
        active: true,
        closed: false,
        archived: false,
        endDate: "2028-01-01T00:00:00.000Z",
        outcomes: "[\"Yes\",\"No\"]",
        clobTokenIds: "[\"yes-20m\",\"no-20m\"]"
      }),
      ...normalizeGammaMarketList({
        id: "pm-200m",
        conditionId: "0x0000000000000000000000000000000000000000000000000000000000000200",
        question: "Decibel FDV above $200M one day after launch?",
        slug: "decibel-fdv-above-200m-one-day-after-launch",
        active: true,
        closed: false,
        archived: false,
        endDate: "2028-01-01T00:00:00.000Z",
        outcomes: "[\"Yes\",\"No\"]",
        clobTokenIds: "[\"yes-200m\",\"no-200m\"]"
      })
    ];
    const event: PolymarketGammaEvent = {
      eventId: "pm-event-decibel",
      eventSlug: "decibel-fdv-above-one-day-after-launch",
      title: "Decibel FDV above ___ one day after launch?",
      raw: {
        id: "pm-event-decibel",
        slug: "decibel-fdv-above-one-day-after-launch",
        title: "Decibel FDV above ___ one day after launch?"
      },
      markets: [
        detailMarkets[1]!
      ]
    };
    const collector = new UpstreamMarketDiscoveryCollector({
      polymarket: {
        gammaClient: {
          listEvents: async () => [event],
          listMarkets: async () => [],
          getEventMarketsBySlug: async () => detailMarkets
        } as never,
        pageSize: 100,
        maxPages: 1
      },
      now: () => new Date("2026-06-13T00:00:00.000Z")
    });

    const result = await (collector as unknown as {
      collectPolymarket: () => Promise<{ snapshots: VenueMarketDiscoverySnapshot[] }>;
    }).collectPolymarket();

    expect(result.snapshots.map((snapshot) => snapshot.title).sort()).toEqual([
      "Decibel FDV above $200M one day after launch?",
      "Decibel FDV above $20M one day after launch?"
    ]);
    expect(result.snapshots.every((snapshot) =>
      snapshot.rawSummary.eventTitle === "Decibel FDV above ___ one day after launch?"
    )).toBe(true);
  });

  it("normalizes wrapped Polymarket event list responses", () => {
    const events = normalizeGammaEventList({
      events: [
        {
          id: "event-1",
          slug: "decibel-fdv-above-one-day-after-launch",
          title: "Decibel FDV above ___ one day after launch?",
          markets: [
            {
              id: "pm-20m",
              conditionId: "0x0000000000000000000000000000000000000000000000000000000000000020",
              question: "Decibel FDV above $20M one day after launch?"
            }
          ]
        }
      ]
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.markets).toHaveLength(1);
    expect(events[0]?.markets[0]?.title).toBe("Decibel FDV above $20M one day after launch?");
  });

  it("expands Polymarket event siblings from a market seed event slug", async () => {
    const detailMarkets = [
      ...normalizeGammaMarketList({
        id: "pm-50m",
        conditionId: "0x0000000000000000000000000000000000000000000000000000000000000050",
        question: "Decibel FDV above $50M one day after launch?",
        slug: "decibel-fdv-above-50m-one-day-after-launch",
        active: true,
        closed: false,
        archived: false,
        endDate: "2028-01-01T00:00:00.000Z",
        outcomes: "[\"Yes\",\"No\"]",
        clobTokenIds: "[\"yes-50m\",\"no-50m\"]"
      }),
      ...normalizeGammaMarketList({
        id: "pm-200m",
        conditionId: "0x0000000000000000000000000000000000000000000000000000000000000200",
        question: "Decibel FDV above $200M one day after launch?",
        slug: "decibel-fdv-above-200m-one-day-after-launch",
        active: true,
        closed: false,
        archived: false,
        endDate: "2028-01-01T00:00:00.000Z",
        outcomes: "[\"Yes\",\"No\"]",
        clobTokenIds: "[\"yes-200m\",\"no-200m\"]"
      })
    ];
    const marketSeed = normalizeGammaMarketList({
      id: "pm-200m",
      conditionId: "0x0000000000000000000000000000000000000000000000000000000000000200",
      question: "Decibel FDV above $200M one day after launch?",
      slug: "decibel-fdv-above-200m-one-day-after-launch",
      active: true,
      closed: false,
      archived: false,
      endDate: "2028-01-01T00:00:00.000Z",
      outcomes: "[\"Yes\",\"No\"]",
      clobTokenIds: "[\"yes-200m\",\"no-200m\"]",
      events: [{ slug: "decibel-fdv-above-one-day-after-launch", title: "Decibel FDV above ___ one day after launch?" }]
    });
    const collector = new UpstreamMarketDiscoveryCollector({
      polymarket: {
        gammaClient: {
          listEvents: async () => [],
          listMarkets: async () => marketSeed,
          getEventMarketsBySlug: async () => detailMarkets
        } as never,
        pageSize: 100,
        maxPages: 1
      },
      now: () => new Date("2026-06-13T00:00:00.000Z")
    });

    const result = await (collector as unknown as {
      collectPolymarket: () => Promise<{ snapshots: VenueMarketDiscoverySnapshot[] }>;
    }).collectPolymarket();

    expect(result.snapshots.map((snapshot) => snapshot.title).sort()).toEqual([
      "Decibel FDV above $200M one day after launch?",
      "Decibel FDV above $50M one day after launch?"
    ]);
  });

  it("carries Limitless yes/no token ids into discovery snapshots", async () => {
    const collector = new UpstreamMarketDiscoveryCollector({
      limitless: {
        client: {
          listCurrentMarkets: async () => ({
            status: "SUCCESS",
            primaryDiscoveryPath: "test",
            warnings: [],
            rows: [{
              venueMarketId: "0xlimitless",
              marketId: "101",
              title: "Metamask FDV above $700M one day after launch?",
              description: "Resolves yes if Metamask FDV is above $700M one day after launch.",
              slug: "metamask-fdv-above-dollar700m-one-day-after-launch",
              status: "FUNDED",
              categories: ["Pre-TGE"],
              tags: ["Weekly"],
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              updatedAt: new Date("2026-01-01T00:00:00.000Z"),
              expiresAt: new Date("2027-01-01T00:00:00.000Z"),
              openInterest: null,
              volume: null,
              liquidity: null,
              marketType: "single",
              sourceRef: "test",
              fetchedAt: new Date("2026-06-13T00:00:00.000Z"),
              canonicalCategory: "CRYPTO",
              family: "FDV_LAUNCH",
              asset: "METAMASK",
              timeBoundary: "2027-01-01",
              threshold: "700000000",
              raw: {
                tokens: {
                  yes: "limitless-yes-token",
                  no: "limitless-no-token"
                }
              }
            }]
          })
        } as never
      },
      now: () => new Date("2026-06-13T00:00:00.000Z")
    });

    const result = await (collector as unknown as {
      collectLimitless: () => Promise<{ snapshots: VenueMarketDiscoverySnapshot[] }>;
    }).collectLimitless();

    expect(result.snapshots[0]?.tokenIds).toEqual(["limitless-yes-token", "limitless-no-token"]);
    expect(result.snapshots[0]?.quoteReady).toBe(true);
    expect(result.snapshots[0]?.executionReady).toBe(true);
  });
});
