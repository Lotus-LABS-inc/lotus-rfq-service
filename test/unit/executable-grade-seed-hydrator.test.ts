import { describe, expect, it, vi } from "vitest";

import {
  hydrateInventoryRowToExecutableSeed,
  loadHydratedCanonicalMarketSeeds
} from "../../src/operations/semantic-expansion/executable-grade-seed-hydrator.js";
import type { SemanticExpansionInventoryRow } from "../../src/operations/semantic-expansion/shared.js";

const buildInventoryRow = (
  overrides: Partial<SemanticExpansionInventoryRow> & Pick<SemanticExpansionInventoryRow, "venue" | "venueMarketId" | "title">
): SemanticExpansionInventoryRow => ({
  venueMarketProfileId: overrides.venueMarketProfileId ?? `vmp:${overrides.venue}:${overrides.venueMarketId}`,
  canonicalEventId: overrides.canonicalEventId ?? "event-1",
  canonicalMarketId: overrides.canonicalMarketId ?? "market-1",
  currentExecutableMemberCount: overrides.currentExecutableMemberCount ?? 1,
  canonicalCategory: overrides.canonicalCategory ?? "POLITICS",
  semanticCategory: overrides.semanticCategory ?? "POLITICS",
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

const buildGraphRow = (overrides: Record<string, unknown> = {}) => ({
  canonical_event_id: "event-existing",
  venue: "POLYMARKET",
  venue_market_id: "pm-1",
  title: "Rich Market",
  description: "rich description",
  market_type: "BINARY",
  market_class: "BINARY",
  outcomes: [{ id: "YES", label: "Yes" }, { id: "NO", label: "No" }],
  outcome_schema: { yesLabel: "Yes", noLabel: "No", marketShape: "binary" },
  topics: ["politics"],
  canonical_category: "POLITICS",
  published_at: new Date("2026-03-01T00:00:00.000Z"),
  expires_at: new Date("2026-03-20T00:00:00.000Z"),
  resolves_at: new Date("2026-03-20T00:00:00.000Z"),
  fees: { settlementFeeBps: "10" },
  fee_model: "maker-taker",
  resolution_source: "POLYMARKET",
  resolution_title: "Rich Market",
  resolution_rules_text: null,
  network: "POLYGON",
  chain: "POLYGON",
  raw_source_payload: { source: "db" },
  normalized_payload: { normalized: true },
  mapping_lineage: ["seed"],
  confidence_score: "0.9",
  source_metadata_version: "predexon-v2",
  normalized_resolution_authority_type: "CENTRAL",
  rule_text: "full rules",
  source_hierarchy: { primary: "rules" },
  dispute_window_hours: "12",
  ambiguous_time_boundary: false,
  ambiguous_source_reference: false,
  ambiguous_jurisdiction_or_scope: false,
  settlement_type: "unknown",
  settlement_lag_hours: "2",
  finality_lag_hours: "4",
  payout_timing_hours: "6",
  fee_on_entry: false,
  fee_on_exit: true,
  time_sensitive_fee_behavior: "exit_only",
  requires_conservative_anchor: true,
  ...overrides
});

describe("executable-grade-seed-hydrator", () => {
  it("hydrates existing canonical market members with executable-grade metadata", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          buildGraphRow({ venue: "LIMITLESS", venue_market_id: "lm-1", title: "Limitless Market" }),
          buildGraphRow({ venue: "POLYMARKET", venue_market_id: "pm-1", title: "Polymarket Market" })
        ]
      })
    } as unknown as Parameters<typeof loadHydratedCanonicalMarketSeeds>[0];

    const hydrated = await loadHydratedCanonicalMarketSeeds(pool, "shared-market", {
      canonicalEventId: "target-event",
      canonicalMarketId: "target-market"
    });

    expect(hydrated).toHaveLength(2);
    expect(hydrated[0]).toMatchObject({
      hydrationSource: "existing_executable_membership",
      usedFallback: false
    });
    expect(hydrated.find((entry) => entry.venue === "POLYMARKET")?.seed).toMatchObject({
      canonicalEventId: "target-event",
      canonicalMarketId: "target-market",
      resolutionRulesText: "full rules",
      settlementType: "onchain",
      settlementLagHours: "2",
      finalityLagHours: "4"
    });
  });

  it("hydrates a candidate row from persisted profile data before falling back", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [buildGraphRow({ venue: "OPINION", venue_market_id: "8454", title: "Opinion Market" })]
      })
    } as unknown as Parameters<typeof hydrateInventoryRowToExecutableSeed>[0];

    const hydrated = await hydrateInventoryRowToExecutableSeed(
      pool,
      buildInventoryRow({
        venue: "OPINION",
        venueMarketId: "8454",
        venueMarketProfileId: "vmp-opinion-8454",
        title: "Thin Opinion Market",
        resolutionRulesText: null
      }),
      {
        canonicalEventId: "target-event",
        canonicalMarketId: "target-market",
        classification: "live_only_exact_overlap"
      }
    );

    expect(hydrated).toMatchObject({
      hydrationSource: "persisted_profile_hydration",
      usedFallback: false
    });
    expect(hydrated.seed.title).toBe("Opinion Market");
    expect(hydrated.seed.resolutionRulesText).toBe("full rules");
  });

  it("falls back to inventory hydration when no persisted profile exists", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] })
    } as unknown as Parameters<typeof hydrateInventoryRowToExecutableSeed>[0];

    const hydrated = await hydrateInventoryRowToExecutableSeed(
      pool,
      buildInventoryRow({
        venue: "PREDICT",
        venueMarketId: "392",
        title: "Predict Market",
        resolutionRulesText: "inventory rules",
        outcomes: [{ id: "YES", label: "Yes" }]
      }),
      {
        canonicalEventId: "target-event",
        canonicalMarketId: "target-market",
        classification: "historical_qualified_exact_overlap"
      }
    );

    expect(hydrated).toMatchObject({
      hydrationSource: "inventory_fallback",
      usedFallback: true
    });
    expect(hydrated.seed.title).toBe("Predict Market");
    expect(hydrated.seed.resolutionRulesText).toBe("inventory rules");
  });
});
