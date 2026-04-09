import type { Pool, QueryResultRow } from "pg";

import type { CuratedCanonicalGraphSeed } from "../../canonical/curated-canonical-graph.js";
import type { SemanticExpansionInventoryRow } from "./shared.js";
import { toCuratedSeed } from "./shared.js";

export type PromotionSeedHydrationSource =
  | "existing_executable_membership"
  | "persisted_profile_hydration"
  | "inventory_fallback";

export interface HydratedPromotionSeed {
  seed: CuratedCanonicalGraphSeed;
  hydrationSource: PromotionSeedHydrationSource;
  usedFallback: boolean;
  venue: CuratedCanonicalGraphSeed["venue"];
  venueMarketId: string;
}

interface ExistingCanonicalSeedRow extends QueryResultRow {
  canonical_event_id: string;
  venue: CuratedCanonicalGraphSeed["venue"];
  venue_market_id: string;
  title: string;
  description: string | null;
  market_type: string | null;
  market_class: string | null;
  outcomes: unknown;
  outcome_schema: unknown;
  topics: unknown;
  canonical_category: string | null;
  published_at: Date | null;
  expires_at: Date | null;
  resolves_at: Date | null;
  fees: unknown;
  fee_model: string | null;
  resolution_source: string | null;
  resolution_title: string | null;
  resolution_rules_text: string | null;
  network: string | null;
  chain: string | null;
  raw_source_payload: unknown;
  normalized_payload: unknown;
  mapping_lineage: unknown;
  confidence_score: string | null;
  source_metadata_version: string;
  normalized_resolution_authority_type: string | null;
  rule_text: string | null;
  source_hierarchy: unknown;
  dispute_window_hours: string | null;
  ambiguous_time_boundary: boolean | null;
  ambiguous_source_reference: boolean | null;
  ambiguous_jurisdiction_or_scope: boolean | null;
  settlement_type: string | null;
  settlement_lag_hours: string | null;
  finality_lag_hours: string | null;
  payout_timing_hours: string | null;
  fee_on_entry: boolean | null;
  fee_on_exit: boolean | null;
  time_sensitive_fee_behavior: string | null;
  requires_conservative_anchor: boolean | null;
}

const asStringArray = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const inferPersistedSettlementType = (
  row: ExistingCanonicalSeedRow
): NonNullable<CuratedCanonicalGraphSeed["settlementType"]> | null => {
  const settlementType = row.settlement_type ?? null;
  if (settlementType && settlementType !== "unknown") {
    return settlementType as NonNullable<CuratedCanonicalGraphSeed["settlementType"]>;
  }
  if (row.venue === "POLYMARKET") {
    return "onchain";
  }
  return settlementType as NonNullable<CuratedCanonicalGraphSeed["settlementType"]> | null;
};

const graphRowToSeed = (
  row: ExistingCanonicalSeedRow,
  target: { canonicalEventId: string; canonicalMarketId: string }
): CuratedCanonicalGraphSeed => ({
  canonicalEventId: target.canonicalEventId,
  canonicalMarketId: target.canonicalMarketId,
  canonicalCategory: row.canonical_category ?? "OTHER",
  venue: row.venue,
  venueMarketId: row.venue_market_id,
  title: row.title,
  description: row.description,
  marketType: row.market_type,
  marketClass: row.market_class,
  outcomes: Array.isArray(row.outcomes)
    ? (row.outcomes as NonNullable<CuratedCanonicalGraphSeed["outcomes"]>)
    : [],
  outcomeSchema: asRecord(row.outcome_schema),
  topics: asStringArray(row.topics),
  publishedAt: row.published_at,
  expiresAt: row.expires_at,
  resolvesAt: row.resolves_at,
  fees: asRecord(row.fees),
  feeModel: row.fee_model,
  resolutionSource: row.resolution_source,
  resolutionTitle: row.resolution_title,
  resolutionRulesText: row.resolution_rules_text ?? row.rule_text,
  resolutionAuthorityType: row.normalized_resolution_authority_type,
  sourceHierarchy: asRecord(row.source_hierarchy),
  disputeWindowHours: row.dispute_window_hours,
  ambiguousTimeBoundary: row.ambiguous_time_boundary ?? false,
  ambiguousSourceReference: row.ambiguous_source_reference ?? false,
  ambiguousJurisdictionOrScope: row.ambiguous_jurisdiction_or_scope ?? false,
  settlementType: inferPersistedSettlementType(row),
  settlementLagHours: row.settlement_lag_hours,
  finalityLagHours: row.finality_lag_hours,
  payoutTimingHours: row.payout_timing_hours,
  feeOnEntry: row.fee_on_entry ?? false,
  feeOnExit: row.fee_on_exit ?? false,
  timeSensitiveFeeBehavior: row.time_sensitive_fee_behavior,
  requiresConservativeAnchor: row.requires_conservative_anchor ?? false,
  network: row.network,
  chain: row.chain,
  rawSourcePayload: asRecord(row.raw_source_payload),
  normalizedPayload: asRecord(row.normalized_payload),
  mappingLineage: asStringArray(row.mapping_lineage),
  ...(row.confidence_score !== null ? { confidenceScore: row.confidence_score } : {}),
  sourceMetadataVersion: row.source_metadata_version
});

const loadProfileRowsForMembers = async (
  pool: Pool,
  whereSql: string,
  params: readonly unknown[]
): Promise<readonly ExistingCanonicalSeedRow[]> => {
  const result = await pool.query<ExistingCanonicalSeedRow>(
    `SELECT
        vmp.canonical_event_id,
        vmp.venue,
        vmp.venue_market_id,
        vmp.title,
        vmp.description,
        vmp.market_type,
        vmp.market_class,
        vmp.outcomes,
        vmp.outcome_schema,
        vmp.topics,
        vmp.canonical_category,
        vmp.published_at,
        vmp.expires_at,
        vmp.resolves_at,
        vmp.fees,
        vmp.fee_model,
        vmp.resolution_source,
        vmp.resolution_title,
        vmp.resolution_rules_text,
        vmp.network,
        vmp.chain,
        vmp.raw_source_payload,
        vmp.normalized_payload,
        vmp.mapping_lineage,
        vmp.confidence_score,
        vmp.source_metadata_version,
        vrp.normalized_resolution_authority_type,
        vrp.rule_text,
        vrp.source_hierarchy,
        vrp.dispute_window_hours,
        vrp.ambiguous_time_boundary,
        vrp.ambiguous_source_reference,
        vrp.ambiguous_jurisdiction_or_scope,
        vsp.settlement_type,
        vsp.settlement_lag_hours,
        vsp.finality_lag_hours,
        vsp.payout_timing_hours,
        vsp.fee_on_entry,
        vsp.fee_on_exit,
        vsp.time_sensitive_fee_behavior,
        vsp.requires_conservative_anchor
       FROM venue_market_profiles vmp
       LEFT JOIN venue_resolution_profiles vrp
         ON vrp.venue_market_profile_id = vmp.id
       LEFT JOIN venue_settlement_profiles vsp
         ON vsp.venue_market_profile_id = vmp.id
      ${whereSql}
      ORDER BY vmp.venue, vmp.venue_market_id`,
    [...params]
  );

  return result.rows;
};

export const loadHydratedCanonicalMarketSeeds = async (
  pool: Pool,
  canonicalMarketId: string,
  target: { canonicalEventId: string; canonicalMarketId: string }
): Promise<readonly HydratedPromotionSeed[]> => {
  const rows = await loadProfileRowsForMembers(
    pool,
    `JOIN canonical_executable_market_members members
       ON members.venue_market_profile_id = vmp.id
     WHERE members.canonical_executable_market_id = $1`,
    [canonicalMarketId]
  );

  return rows.map((row) => ({
    seed: graphRowToSeed(row, target),
    hydrationSource: "existing_executable_membership" as const,
    usedFallback: false,
    venue: row.venue,
    venueMarketId: row.venue_market_id
  }));
};

export const hydrateInventoryRowToExecutableSeed = async (
  pool: Pool,
  row: SemanticExpansionInventoryRow,
  target: {
    canonicalEventId: string;
    canonicalMarketId: string;
    classification: "historical_qualified_exact_overlap" | "live_only_exact_overlap";
  }
): Promise<HydratedPromotionSeed> => {
  const rows = await loadProfileRowsForMembers(
    pool,
    "WHERE vmp.id = $1",
    [row.venueMarketProfileId]
  );

  const matched = rows[0];
  if (matched) {
    return {
      seed: graphRowToSeed(matched, target),
      hydrationSource: "persisted_profile_hydration",
      usedFallback: false,
      venue: row.venue,
      venueMarketId: row.venueMarketId
    };
  }

  return {
    seed: toCuratedSeed(row, target),
    hydrationSource: "inventory_fallback",
    usedFallback: true,
    venue: row.venue,
    venueMarketId: row.venueMarketId
  };
};
