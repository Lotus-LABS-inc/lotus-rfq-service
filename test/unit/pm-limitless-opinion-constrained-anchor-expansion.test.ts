import { describe, expect, it } from "vitest";

import type { CrossVenueMatchReport, SemanticExpansionInventoryRow } from "../../src/operations/semantic-expansion/shared.js";
import type { ExactSeedDefinition } from "../../src/operations/semantic-expansion/exact-seed-shared.js";
import { buildOpinionConstrainedAnchorSeedsFromInputs } from "../../src/operations/semantic-expansion/pm-limitless-opinion-constrained-anchor-expansion.js";

const buildSeed = (overrides: Partial<ExactSeedDefinition>): ExactSeedDefinition => ({
  seedReference: overrides.seedReference ?? "baseline-seed",
  canonicalEventId: overrides.canonicalEventId ?? "event-1",
  canonicalMarketId: overrides.canonicalMarketId ?? "market-1",
  canonicalCategory: overrides.canonicalCategory ?? "CRYPTO",
  title: overrides.title ?? "Bitcoin all time high by March 31, 2026?",
  sourceText: overrides.sourceText ?? "Bitcoin all time high by March 31, 2026?",
  memberVenues: overrides.memberVenues ?? ["LIMITLESS", "POLYMARKET"],
  memberVenueMarketIds: overrides.memberVenueMarketIds ?? ["LIMITLESS:lm-1", "POLYMARKET:pm-1"],
  targetPairFamilies: overrides.targetPairFamilies ?? ["POLYMARKET_OPINION", "LIMITLESS_OPINION"],
  exactDateSearch: overrides.exactDateSearch ?? null,
  boundaryReferenceAt: overrides.boundaryReferenceAt ?? "2026-03-31T00:00:00.000Z"
});

const buildInventoryRow = (overrides: Partial<SemanticExpansionInventoryRow>): SemanticExpansionInventoryRow => ({
  venueMarketProfileId: overrides.venueMarketProfileId ?? "profile",
  canonicalEventId: overrides.canonicalEventId ?? "event-2",
  canonicalMarketId: overrides.canonicalMarketId ?? "market-2",
  currentExecutableMemberCount: overrides.currentExecutableMemberCount ?? 0,
  canonicalCategory: overrides.canonicalCategory ?? "CRYPTO",
  semanticCategory: overrides.semanticCategory ?? "CRYPTO",
  venue: overrides.venue ?? "POLYMARKET",
  venueMarketId: overrides.venueMarketId ?? "pm-2",
  title: overrides.title ?? "Bitcoin all time high by April 30, 2026?",
  description: overrides.description ?? null,
  rules: overrides.rules ?? "Resolves YES if BTC reaches a new all time high by April 30, 2026.",
  marketType: overrides.marketType ?? "BINARY",
  marketClass: overrides.marketClass ?? "BINARY",
  outcomes: overrides.outcomes ?? [],
  outcomeSchema: overrides.outcomeSchema ?? {},
  topics: overrides.topics ?? [],
  publishedAt: overrides.publishedAt ?? null,
  expiresAt: overrides.expiresAt ?? "2026-04-30T00:00:00.000Z",
  resolvesAt: overrides.resolvesAt ?? "2026-04-30T00:00:00.000Z",
  fees: overrides.fees ?? {},
  feeModel: overrides.feeModel ?? null,
  resolutionSource: overrides.resolutionSource ?? null,
  resolutionTitle: overrides.resolutionTitle ?? null,
  resolutionRulesText: overrides.resolutionRulesText ?? null,
  resolutionAuthorityType: overrides.resolutionAuthorityType ?? null,
  sourceHierarchy: overrides.sourceHierarchy ?? {},
  disputeWindowHours: overrides.disputeWindowHours ?? null,
  ambiguousTimeBoundary: overrides.ambiguousTimeBoundary ?? false,
  ambiguousSourceReference: overrides.ambiguousSourceReference ?? false,
  ambiguousJurisdictionOrScope: overrides.ambiguousJurisdictionOrScope ?? false,
  settlementType: overrides.settlementType ?? null,
  settlementLagHours: overrides.settlementLagHours ?? null,
  finalityLagHours: overrides.finalityLagHours ?? null,
  payoutTimingHours: overrides.payoutTimingHours ?? null,
  feeOnEntry: overrides.feeOnEntry ?? false,
  feeOnExit: overrides.feeOnExit ?? false,
  timeSensitiveFeeBehavior: overrides.timeSensitiveFeeBehavior ?? null,
  requiresConservativeAnchor: overrides.requiresConservativeAnchor ?? false,
  network: overrides.network ?? null,
  chain: overrides.chain ?? null,
  rawSourcePayload: overrides.rawSourcePayload ?? {},
  normalizedPayload: overrides.normalizedPayload ?? {},
  mappingLineage: overrides.mappingLineage ?? [],
  confidenceScore: overrides.confidenceScore ?? null,
  sourceMetadataVersion: overrides.sourceMetadataVersion ?? "test",
  historicalRowCount: overrides.historicalRowCount ?? 0,
  latestHistoricalTimestamp: overrides.latestHistoricalTimestamp ?? null,
  evidenceLabel: overrides.evidenceLabel ?? "historical"
});

describe("buildOpinionConstrainedAnchorSeedsFromInputs", () => {
  it("adds only PM+Limitless candidates backed by live Opinion family inventory", () => {
    const baselineSeeds = [buildSeed({})];
    const left = buildInventoryRow({
      venue: "POLYMARKET",
      venueMarketId: "pm-2"
    });
    const right = buildInventoryRow({
      venue: "LIMITLESS",
      venueMarketId: "lm-2"
    });
    const report: CrossVenueMatchReport = {
      observedAt: new Date().toISOString(),
      afterRulepackRefresh: false,
      semanticsRulepackVersion: "test",
      inventorySummary: {
        totalMarkets: 2,
        categories: {},
        venues: { POLYMARKET: 1, LIMITLESS: 1, OPINION: 0, MYRIAD: 0, PREDICT: 0 },
        evidenceLabels: { historical: 2, current_state: 0, recorder: 0, fallback: 0, live_inventory_only: 0 }
      },
      matches: [
        {
          matchId: "match-1",
          category: "CRYPTO",
          venueSet: ["LIMITLESS", "POLYMARKET"],
          seed: {
            venue: "POLYMARKET",
            venueMarketId: "pm-2",
            title: left.title,
            canonicalEventId: left.canonicalEventId,
            canonicalMarketId: left.canonicalMarketId,
            evidenceLabel: "historical",
            historicalRowCount: 0
          },
          candidate: {
            venue: "LIMITLESS",
            venueMarketId: "lm-2",
            title: right.title,
            canonicalEventId: right.canonicalEventId,
            canonicalMarketId: right.canonicalMarketId,
            evidenceLabel: "historical",
            historicalRowCount: 0
          },
          matchClass: "semantic_near_exact",
          exactPromotionEligible: false,
          historicalQualified: false,
          compatibilityDecisionClass: null,
          blockReason: null,
          baseConfidence: 0.5,
          finalConfidence: 0.5,
          semanticValidation: {},
          semanticProvenance: {}
        }
      ],
      promotionCandidates: [],
      summary: {
        exactHistoricalQualified: 0,
        exactLiveOnly: 0,
        nearExact: 1,
        proxyOrMismatch: 0,
        blockedByCompatibility: 0
      },
      metrics: {} as CrossVenueMatchReport["metrics"]
    };

    const result = buildOpinionConstrainedAnchorSeedsFromInputs({
      baselineSeeds,
      report,
      inventoryByKey: new Map([
        ["POLYMARKET:pm-2", left],
        ["LIMITLESS:lm-2", right]
      ]),
      opinionFamilySummary: {
        observedAt: new Date().toISOString(),
        metadataVersion: "test",
        scannedMarketCount: 1,
        countsByCategory: { CRYPTO: 1, SPORTS: 0, ESPORTS: 0, OTHER: 0 },
        countsByFamily: {
          ATH_BY_DATE: 1,
          THRESHOLD_BY_DATE: 0,
          SAME_DAY_DIRECTIONAL: 0,
          PRICE_AT_CLOSE: 0,
          GENERIC_UP_DOWN: 0,
          MATCHUP_WINNER: 0,
          CHAMPIONSHIP_WINNER: 0,
          SEASON_WINNER: 0,
          TOURNAMENT_WINNER: 0,
          SPLIT_WINNER: 0,
          LEAGUE_WINNER: 0,
          OTHER: 0
        },
        families: [{
          category: "CRYPTO",
          familyBucket: "ATH_BY_DATE",
          count: 1,
          representativeExamples: [{ marketId: "1", title: "Bitcoin all time high by April 30, 2026?" }],
          entitiesOrAssets: ["bitcoin"],
          competitionContexts: [],
          timeBoundaryPatterns: ["BY_DATE"]
        }]
      },
      opinionFamilyClassifications: [{
        marketId: "1",
        title: "Bitcoin all time high by April 30, 2026?",
        category: "CRYPTO",
        familyBucket: "ATH_BY_DATE",
        subject: "bitcoin",
        competitionOrContext: null,
        threshold: "all time high",
        deadlineOrSeason: "april 30 2026",
        timeBoundaryPattern: "BY_DATE",
        structureType: "threshold"
      }]
    });

    expect(result.summary.baselineSeedCount).toBe(1);
    expect(result.summary.addedSeedCount).toBe(1);
    expect(result.seeds).toHaveLength(2);
  });
});
