import { describe, expect, it } from "vitest";

import { buildPairFamilyExactnessReportFromInputs } from "../../src/operations/semantic-expansion/pair-family-exactness-report.js";
import type { ExactSeedDefinition } from "../../src/operations/semantic-expansion/exact-seed-shared.js";
import type {
  CrossVenueMatchReport,
  SemanticExpansionInventoryRow
} from "../../src/operations/semantic-expansion/shared.js";

const buildInventoryRow = (
  overrides: Partial<SemanticExpansionInventoryRow> & Pick<SemanticExpansionInventoryRow, "venue" | "venueMarketId" | "title">
): SemanticExpansionInventoryRow => ({
  venueMarketProfileId: `${overrides.venue}:${overrides.venueMarketId}`,
  canonicalEventId: overrides.canonicalEventId ?? `event-${overrides.venueMarketId}`,
  canonicalMarketId: overrides.canonicalMarketId ?? `market-${overrides.venueMarketId}`,
  currentExecutableMemberCount: overrides.currentExecutableMemberCount ?? 1,
  canonicalCategory: overrides.canonicalCategory ?? "CRYPTO",
  semanticCategory: overrides.semanticCategory ?? "CRYPTO",
  venue: overrides.venue,
  venueMarketId: overrides.venueMarketId,
  title: overrides.title,
  description: overrides.description ?? null,
  rules: overrides.rules ?? null,
  marketType: overrides.marketType ?? "BINARY",
  marketClass: overrides.marketClass ?? "BINARY",
  outcomes: overrides.outcomes ?? [],
  outcomeSchema: overrides.outcomeSchema ?? {},
  topics: overrides.topics ?? [],
  publishedAt: overrides.publishedAt ?? null,
  expiresAt: overrides.expiresAt ?? null,
  resolvesAt: overrides.resolvesAt ?? null,
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
  confidenceScore: overrides.confidenceScore ?? 0.8,
  sourceMetadataVersion: overrides.sourceMetadataVersion ?? "test-v1",
  historicalRowCount: overrides.historicalRowCount ?? 1,
  latestHistoricalTimestamp: overrides.latestHistoricalTimestamp ?? null,
  evidenceLabel: overrides.evidenceLabel ?? "historical"
});

describe("buildPairFamilyExactnessReportFromInputs", () => {
  it("groups missing pair families by seed and surfaces exactness status", () => {
    const seed: ExactSeedDefinition = {
      seedReference: "shared-market",
      canonicalEventId: "shared-event",
      canonicalMarketId: "shared-market",
      canonicalCategory: "CRYPTO",
      title: "Bitcoin ATH by March 31",
      sourceText: "Bitcoin ATH by March 31 | Bitcoin all time high by March 31",
      memberVenues: ["POLYMARKET", "LIMITLESS"],
      memberVenueMarketIds: ["POLYMARKET:pm-1", "LIMITLESS:lm-1"],
      targetPairFamilies: ["POLYMARKET_OPINION", "LIMITLESS_OPINION", "POLYMARKET_PREDICT", "LIMITLESS_PREDICT"],
      boundaryReferenceAt: "2026-03-31T00:00:00.000Z",
      exactDateSearch: {
        exactDateKey: "CRYPTO|bitcoin|reach all time high|march 31 2026|YES_NO",
        semanticCategory: "CRYPTO",
        subject: "bitcoin",
        actionOrCondition: "reach all time high",
        exactDayBoundary: "march 31 2026",
        outcomeSchema: "YES_NO",
        targetPairFamilies: ["POLYMARKET_OPINION", "LIMITLESS_OPINION", "POLYMARKET_PREDICT", "LIMITLESS_PREDICT"]
      }
    };

    const opinionRow = buildInventoryRow({
      venue: "OPINION",
      venueMarketId: "op-1",
      title: "Bitcoin all time high by March 31, 2026?",
      normalizedPayload: {
        exactSeedAcquisition: true,
        exactDateAcquisition: true,
        exactDateStatus: "exact_date_found",
        targetPairFamilies: ["POLYMARKET_OPINION", "LIMITLESS_OPINION"]
      },
      mappingLineage: ["opinion-exact-seed-acquisition"],
      sourceMetadataVersion: "opinion-exact-seed-acquisition-v1",
      historicalRowCount: 0,
      evidenceLabel: "current_state"
    });

    const report: CrossVenueMatchReport = {
      observedAt: new Date().toISOString(),
      afterRulepackRefresh: false,
      semanticsRulepackVersion: "semantic-rulepack-v1",
      inventorySummary: {
        totalMarkets: 0,
        categories: {},
        venues: {
          POLYMARKET: 0,
          LIMITLESS: 0,
          OPINION: 0,
          MYRIAD: 0,
          PREDICT: 0
        },
        evidenceLabels: {
          historical: 0,
          current_state: 0,
          recorder: 0,
          fallback: 0,
          live_inventory_only: 0
        }
      },
      matches: [
        {
          matchId: "m1",
          category: "CRYPTO",
          venueSet: ["LIMITLESS", "OPINION"],
          seed: {
            venue: "LIMITLESS",
            venueMarketId: "lm-1",
            title: "Bitcoin ATH by March 31",
            canonicalEventId: "shared-event",
            canonicalMarketId: "shared-market",
            evidenceLabel: "historical",
            historicalRowCount: 10
          },
          candidate: {
            venue: "OPINION",
            venueMarketId: "op-1",
            title: "Bitcoin all time high by March 31, 2026?",
            canonicalEventId: "op-event",
            canonicalMarketId: "op-market",
            evidenceLabel: "current_state",
            historicalRowCount: 0
          },
          matchClass: "semantic_exact_live_only",
          exactPromotionEligible: true,
          historicalQualified: false,
          compatibilityDecisionClass: null,
          blockReason: null,
          baseConfidence: 0.7,
          finalConfidence: 0.92,
          semanticValidation: {
            failedDimensions: []
          },
          semanticProvenance: {}
        }
      ],
      promotionCandidates: [],
      summary: {
        exactHistoricalQualified: 0,
        exactLiveOnly: 1,
        nearExact: 0,
        proxyOrMismatch: 0,
        blockedByCompatibility: 0
      },
      metrics: {
        semantic_candidate_matches_total: 1,
        semantic_rules_fired_total: 0,
        semantic_confidence_uplift_total: 0,
        semantic_match_downgraded_total: 0,
        semantic_match_blocked_by_compatibility_total: 0,
        semantic_false_positive_review_total: 0,
        semantic_candidate_to_equivalent_conversion_rate: 0,
        semantic_candidate_to_distinct_rate: 0,
        safeDiscoveryLift: 1,
        cautionDiscoveryLift: 0,
        blockedUnsafeExpansionRate: 0,
        lowConfidenceSemanticRate: 0
      }
    };

    const built = buildPairFamilyExactnessReportFromInputs({
      report,
      seeds: [seed],
      inventoryByKey: new Map([["OPINION:op-1", opinionRow]]),
      predictReadinessByMarketId: new Map(),
      sourceMatchReportPath: "docs/cross-venue-match-report.json"
    });

    const limitlessOpinion = built.families.find((family) => family.pairFamily === "LIMITLESS_OPINION");
    expect(limitlessOpinion).toBeDefined();
    expect(limitlessOpinion?.exactLiveOnlyCount).toBe(1);
    expect(limitlessOpinion?.seeds[0]).toMatchObject({
      seedReference: "shared-market",
      status: "semantic_exact_live_only",
      oneEdgeAwayFromTriEligibility: true
    });
    expect(limitlessOpinion?.seeds[0]?.selectedCandidates[0]?.acquisitionProvenance).toMatchObject({
      exactSeedAcquisition: true,
      exactDateAcquisition: true,
      exactDateStatus: "exact_date_found",
      sourceMetadataVersion: "opinion-exact-seed-acquisition-v1"
    });
    expect(limitlessOpinion?.exactDateSummary.exactDateFoundCount).toBe(1);
    expect(limitlessOpinion?.seeds[0]).toMatchObject({
      exactDateSearchable: true,
      exactDateStatus: "exact_date_found"
    });
  });
});
