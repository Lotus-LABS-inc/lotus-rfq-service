import { describe, expect, it } from "vitest";

import { buildPromotionCandidates } from "../../src/operations/semantic-expansion/cross-venue-match-report.js";
import type {
  CrossVenueReportMatchEntry,
  SemanticExpansionInventoryRow
} from "../../src/operations/semantic-expansion/shared.js";

const buildInventoryRow = (
  overrides: Partial<SemanticExpansionInventoryRow> & Pick<SemanticExpansionInventoryRow, "venue" | "venueMarketId" | "title">
): SemanticExpansionInventoryRow => ({
  venueMarketProfileId: `${overrides.venue}:${overrides.venueMarketId}`,
  canonicalEventId: overrides.canonicalEventId ?? `event-${overrides.venueMarketId}`,
  canonicalMarketId: overrides.canonicalMarketId ?? `market-${overrides.venueMarketId}`,
  currentExecutableMemberCount: overrides.currentExecutableMemberCount ?? 1,
  canonicalCategory: overrides.canonicalCategory ?? "SPORTS",
  semanticCategory: overrides.semanticCategory ?? "SPORTS",
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
  confidenceScore: overrides.confidenceScore ?? 0.6,
  sourceMetadataVersion: overrides.sourceMetadataVersion ?? "test-v1",
  historicalRowCount: overrides.historicalRowCount ?? 1,
  latestHistoricalTimestamp: overrides.latestHistoricalTimestamp ?? null,
  evidenceLabel: overrides.evidenceLabel ?? "historical"
});

const buildMatch = (
  seed: SemanticExpansionInventoryRow,
  candidate: SemanticExpansionInventoryRow,
  matchClass: CrossVenueReportMatchEntry["matchClass"]
): CrossVenueReportMatchEntry => ({
  matchId: `${seed.venue}-${seed.venueMarketId}-${candidate.venue}-${candidate.venueMarketId}`,
  category: "SPORTS",
  venueSet: [seed.venue, candidate.venue].sort((left, right) => left.localeCompare(right)),
  seed: {
    venue: seed.venue,
    venueMarketId: seed.venueMarketId,
    title: seed.title,
    canonicalEventId: seed.canonicalEventId,
    canonicalMarketId: seed.canonicalMarketId,
    evidenceLabel: seed.evidenceLabel,
    historicalRowCount: seed.historicalRowCount
  },
  candidate: {
    venue: candidate.venue,
    venueMarketId: candidate.venueMarketId,
    title: candidate.title,
    canonicalEventId: candidate.canonicalEventId,
    canonicalMarketId: candidate.canonicalMarketId,
    evidenceLabel: candidate.evidenceLabel,
    historicalRowCount: candidate.historicalRowCount
  },
  matchClass,
  exactPromotionEligible: matchClass === "semantic_exact_historical_qualified" || matchClass === "semantic_exact_live_only",
  historicalQualified: matchClass === "semantic_exact_historical_qualified",
  compatibilityDecisionClass: null,
  blockReason: null,
  failedDimensions: [],
  baseConfidence: 0.6,
  finalConfidence: 0.8,
  semanticValidation: {},
  semanticProvenance: {}
});

describe("buildPromotionCandidates", () => {
  it("extends an existing grouped market when an exact clique is found", () => {
    const polymarket = buildInventoryRow({
      venue: "POLYMARKET",
      venueMarketId: "pm-1",
      title: "Market A",
      canonicalMarketId: "shared-market",
      canonicalEventId: "shared-event",
      currentExecutableMemberCount: 2
    });
    const limitless = buildInventoryRow({
      venue: "LIMITLESS",
      venueMarketId: "lm-1",
      title: "Market A",
      canonicalMarketId: "shared-market",
      canonicalEventId: "shared-event",
      currentExecutableMemberCount: 2
    });
    const opinion = buildInventoryRow({
      venue: "OPINION",
      venueMarketId: "op-1",
      title: "Market A",
      canonicalMarketId: "solo-opinion",
      canonicalEventId: "solo-event",
      currentExecutableMemberCount: 1,
      historicalRowCount: 0,
      evidenceLabel: "current_state"
    });

    const inventoryByKey = new Map([
      [`${polymarket.venue}:${polymarket.venueMarketId}`, polymarket],
      [`${limitless.venue}:${limitless.venueMarketId}`, limitless],
      [`${opinion.venue}:${opinion.venueMarketId}`, opinion]
    ]);

    const candidates = buildPromotionCandidates(
      [
        buildMatch(polymarket, limitless, "semantic_exact_historical_qualified"),
        buildMatch(polymarket, opinion, "semantic_exact_live_only"),
        buildMatch(limitless, opinion, "semantic_exact_live_only")
      ],
      inventoryByKey
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      targetMode: "existing_market_extension",
      targetCanonicalMarketId: "shared-market",
      promotionClass: "live_only_exact_overlap",
      exactClique: true,
      blockReason: null
    });
  });
});
