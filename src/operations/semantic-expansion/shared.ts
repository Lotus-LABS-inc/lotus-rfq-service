import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Pool, QueryResultRow } from "pg";

import type {
  CanonicalCategory,
  CanonicalFeeProfile,
  CanonicalOutcomeDefinition,
  CanonicalMarketClass,
  CanonicalVenue,
  CompatibilityClass
} from "../../canonical/canonicalization-types.js";
import {
  buildStableTextId,
  buildStableUuid,
  normalizeCategory
} from "../../canonical/canonicalization-types.js";
import type { CuratedCanonicalGraphSeed } from "../../canonical/curated-canonical-graph.js";
import type { SemanticsRulepackMetricsSummary } from "../../canonical/semantics-rulepack-metrics.js";
import type { SemanticRule, SemanticDiscoveryCategory } from "../../simulation/semantic-rulepack.js";
import { DEFAULT_SEMANTICS_RULEPACK_VERSION } from "../../canonical/semantics-rulepack-versioning.js";

export type SemanticEvidenceLabel =
  | "historical"
  | "current_state"
  | "recorder"
  | "fallback"
  | "live_inventory_only";

export type CrossVenueMatchClass =
  | "semantic_exact_historical_qualified"
  | "semantic_exact_live_only"
  | "semantic_near_exact"
  | "proxy_or_mismatch"
  | "blocked_by_compatibility";

export interface SemanticExpansionInventoryRow {
  venueMarketProfileId: string;
  canonicalEventId: string;
  canonicalMarketId: string | null;
  currentExecutableMemberCount: number;
  canonicalCategory: CanonicalCategory;
  semanticCategory: SemanticDiscoveryCategory;
  venue: CanonicalVenue;
  venueMarketId: string;
  title: string;
  description: string | null;
  rules: string | null;
  marketType: string | null;
  marketClass: CanonicalMarketClass;
  outcomes: readonly unknown[];
  outcomeSchema: Record<string, unknown>;
  topics: readonly string[];
  publishedAt: string | null;
  expiresAt: string | null;
  resolvesAt: string | null;
  fees: Record<string, unknown>;
  feeModel: string | null;
  resolutionSource: string | null;
  resolutionTitle: string | null;
  resolutionRulesText: string | null;
  resolutionAuthorityType: string | null;
  sourceHierarchy: Record<string, unknown>;
  disputeWindowHours: string | null;
  ambiguousTimeBoundary: boolean;
  ambiguousSourceReference: boolean;
  ambiguousJurisdictionOrScope: boolean;
  settlementType: string | null;
  settlementLagHours: string | null;
  finalityLagHours: string | null;
  payoutTimingHours: string | null;
  feeOnEntry: boolean;
  feeOnExit: boolean;
  timeSensitiveFeeBehavior: string | null;
  requiresConservativeAnchor: boolean;
  network: string | null;
  chain: string | null;
  rawSourcePayload: Record<string, unknown>;
  normalizedPayload: Record<string, unknown>;
  mappingLineage: readonly string[];
  confidenceScore: number | null;
  sourceMetadataVersion: string;
  historicalRowCount: number;
  latestHistoricalTimestamp: string | null;
  evidenceLabel: SemanticEvidenceLabel;
}

export interface CrossVenueReportMatchEntry {
  matchId: string;
  category: SemanticDiscoveryCategory;
  venueSet: readonly CanonicalVenue[];
  seed: SemanticExpansionMatchRef;
  candidate: SemanticExpansionMatchRef;
  matchClass: CrossVenueMatchClass;
  exactPromotionEligible: boolean;
  historicalQualified: boolean;
  compatibilityDecisionClass: CompatibilityClass | null;
  blockReason: string | null;
  baseConfidence: number;
  finalConfidence: number;
  semanticValidation: Record<string, unknown>;
  semanticProvenance: Record<string, unknown>;
}

export interface SemanticExpansionMatchRef {
  venue: CanonicalVenue;
  venueMarketId: string;
  title: string;
  canonicalEventId: string;
  canonicalMarketId: string | null;
  evidenceLabel: SemanticEvidenceLabel;
  historicalRowCount: number;
}

export interface SemanticPromotionCandidate {
  promotionId: string;
  category: SemanticDiscoveryCategory;
  promotionClass: "historical_qualified_exact_overlap" | "live_only_exact_overlap";
  targetMode: "existing_market_extension" | "new_exact_overlap";
  targetCanonicalEventId: string;
  targetCanonicalMarketId: string;
  memberRefs: readonly SemanticExpansionMatchRef[];
  exactClique: boolean;
  blockReason: string | null;
}

export interface CrossVenueMatchReport {
  observedAt: string;
  afterRulepackRefresh: boolean;
  semanticsRulepackVersion: string;
  inventorySummary: {
    totalMarkets: number;
    categories: Record<string, number>;
    venues: Record<CanonicalVenue, number>;
    evidenceLabels: Record<SemanticEvidenceLabel, number>;
  };
  matches: readonly CrossVenueReportMatchEntry[];
  promotionCandidates: readonly SemanticPromotionCandidate[];
  summary: {
    exactHistoricalQualified: number;
    exactLiveOnly: number;
    nearExact: number;
    proxyOrMismatch: number;
    blockedByCompatibility: number;
  };
  metrics: SemanticsRulepackMetricsSummary;
}

export interface SemanticSuggestion {
  suggestionId: string;
  category: SemanticDiscoveryCategory;
  targetField: "subject" | "actionOrCondition" | "threshold" | "deadlineOrSeason" | "competitionOrContext" | "resolutionSourceType";
  canonical: string;
  variants: readonly string[];
  evidenceCount: number;
  evidence: readonly string[];
}

export interface SemanticSuggestionReport {
  observedAt: string;
  sourceMatchReportPath: string;
  mismatchFamilies: readonly {
    category: SemanticDiscoveryCategory;
    failedDimension: string;
    count: number;
  }[];
  suggestions: readonly SemanticSuggestion[];
}

interface InventoryRow extends QueryResultRow {
  venue_market_profile_id: string;
  canonical_event_id: string;
  canonical_market_id: string | null;
  executable_member_count: number | null;
  canonical_category: string | null;
  venue: CanonicalVenue;
  venue_market_id: string;
  title: string;
  description: string | null;
  rules: string | null;
  market_type: string | null;
  market_class: string | null;
  outcomes: unknown;
  outcome_schema: unknown;
  topics: unknown;
  published_at: Date | null;
  expires_at: Date | null;
  resolves_at: Date | null;
  fees: unknown;
  fee_model: string | null;
  resolution_source: string | null;
  resolution_title: string | null;
  resolution_rules_text: string | null;
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
  network: string | null;
  chain: string | null;
  raw_source_payload: unknown;
  normalized_payload: unknown;
  mapping_lineage: unknown;
  confidence_score: string | null;
  source_metadata_version: string;
  historical_row_count: string;
  latest_historical_timestamp: Date | null;
}

interface CompatibilityLookupRow extends QueryResultRow {
  left_key: string;
  right_key: string;
  equivalence_class: string;
}

const CANONICAL_TO_SEMANTIC_CATEGORY: Record<CanonicalCategory, SemanticDiscoveryCategory> = {
  POLITICS: "POLITICS",
  CRYPTO: "CRYPTO",
  SPORTS: "SPORTS",
  ESPORTS: "ESPORTS",
  POP_CULTURE: "CULTURE",
  ECONOMICS: "OTHER",
  OTHER: "OTHER"
};

export const semanticExpansionVenues = [
  "POLYMARKET",
  "LIMITLESS",
  "OPINION",
  "PREDICT"
] as const satisfies readonly CanonicalVenue[];

export const toSemanticCategory = (category: string | null | undefined): SemanticDiscoveryCategory =>
  CANONICAL_TO_SEMANTIC_CATEGORY[normalizeCategory(category)] ?? "OTHER";

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const asArray = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];

const asStringArray = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const toIsoOrNull = (value: Date | null): string | null => value ? value.toISOString() : null;

const parseConfidenceOrNull = (value: string | null): number | null => {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(6)) : null;
};

export const detectEvidenceLabel = (input: {
  sourceMetadataVersion: string;
  historicalRowCount: number;
}): SemanticEvidenceLabel => {
  const version = input.sourceMetadataVersion.toLowerCase();
  if (version.includes("fallback")) {
    return "fallback";
  }
  if (version.includes("recorder")) {
    return "recorder";
  }
  if (version.includes("current")) {
    return input.historicalRowCount > 0 ? "current_state" : "live_inventory_only";
  }
  if (input.historicalRowCount > 0) {
    return "historical";
  }
  return "live_inventory_only";
};

const mapInventoryRow = (row: InventoryRow): SemanticExpansionInventoryRow => {
  const canonicalCategory = normalizeCategory(row.canonical_category);
  const historicalRowCount = Number.parseInt(row.historical_row_count, 10);
  return {
    venueMarketProfileId: row.venue_market_profile_id,
    canonicalEventId: row.canonical_event_id,
    canonicalMarketId: row.canonical_market_id,
    currentExecutableMemberCount: row.executable_member_count ?? 0,
    canonicalCategory,
    semanticCategory: toSemanticCategory(canonicalCategory),
    venue: row.venue,
    venueMarketId: row.venue_market_id,
    title: row.title,
    description: row.description,
    rules: row.rules,
    marketType: row.market_type,
    marketClass: (row.market_class?.toUpperCase() as CanonicalMarketClass | undefined) ?? "UNKNOWN",
    outcomes: asArray(row.outcomes),
    outcomeSchema: asRecord(row.outcome_schema),
    topics: asStringArray(row.topics),
    publishedAt: toIsoOrNull(row.published_at),
    expiresAt: toIsoOrNull(row.expires_at),
    resolvesAt: toIsoOrNull(row.resolves_at),
    fees: asRecord(row.fees),
    feeModel: row.fee_model,
    resolutionSource: row.resolution_source,
    resolutionTitle: row.resolution_title,
    resolutionRulesText: row.resolution_rules_text,
    resolutionAuthorityType: row.normalized_resolution_authority_type,
    sourceHierarchy: asRecord(row.source_hierarchy),
    disputeWindowHours: row.dispute_window_hours,
    ambiguousTimeBoundary: row.ambiguous_time_boundary ?? false,
    ambiguousSourceReference: row.ambiguous_source_reference ?? false,
    ambiguousJurisdictionOrScope: row.ambiguous_jurisdiction_or_scope ?? false,
    settlementType: row.settlement_type,
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
    confidenceScore: parseConfidenceOrNull(row.confidence_score),
    sourceMetadataVersion: row.source_metadata_version,
    historicalRowCount,
    latestHistoricalTimestamp: toIsoOrNull(row.latest_historical_timestamp),
    evidenceLabel: detectEvidenceLabel({
      sourceMetadataVersion: row.source_metadata_version,
      historicalRowCount
    })
  };
};

export const loadSemanticExpansionInventory = async (
  pool: Pool
): Promise<readonly SemanticExpansionInventoryRow[]> => {
  const result = await pool.query<InventoryRow>(
    `WITH historical_counts AS (
        SELECT venue, venue_market_id, COUNT(*)::text AS historical_row_count, MAX("timestamp") AS latest_historical_timestamp
          FROM historical_market_states
         GROUP BY venue, venue_market_id
      ),
      executable_counts AS (
        SELECT canonical_executable_market_id, COUNT(*)::int AS executable_member_count
          FROM canonical_executable_market_members
         GROUP BY canonical_executable_market_id
      )
      SELECT
        vmp.id AS venue_market_profile_id,
        vmp.canonical_event_id,
        members.canonical_executable_market_id AS canonical_market_id,
        executable_counts.executable_member_count,
        vmp.canonical_category,
        vmp.venue,
        vmp.venue_market_id,
        vmp.title,
        vmp.description,
        COALESCE(vrp.rule_text, vmp.resolution_rules_text, vmp.description) AS rules,
        vmp.market_type,
        vmp.market_class,
        vmp.outcomes,
        vmp.outcome_schema,
        vmp.topics,
        vmp.published_at,
        vmp.expires_at,
        vmp.resolves_at,
        vmp.fees,
        vmp.fee_model,
        vmp.resolution_source,
        vmp.resolution_title,
        vmp.resolution_rules_text,
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
        vsp.requires_conservative_anchor,
        vmp.network,
        vmp.chain,
        vmp.raw_source_payload,
        vmp.normalized_payload,
        vmp.mapping_lineage,
        vmp.confidence_score,
        vmp.source_metadata_version,
        COALESCE(historical_counts.historical_row_count, '0') AS historical_row_count,
        historical_counts.latest_historical_timestamp
       FROM venue_market_profiles vmp
       LEFT JOIN canonical_executable_market_members members
         ON members.venue_market_profile_id = vmp.id
       LEFT JOIN executable_counts
         ON executable_counts.canonical_executable_market_id = members.canonical_executable_market_id
       LEFT JOIN venue_resolution_profiles vrp
         ON vrp.venue_market_profile_id = vmp.id
       LEFT JOIN venue_settlement_profiles vsp
         ON vsp.venue_market_profile_id = vmp.id
       LEFT JOIN historical_counts
         ON historical_counts.venue = vmp.venue
        AND historical_counts.venue_market_id = vmp.venue_market_id
      WHERE vmp.venue IN ('POLYMARKET', 'LIMITLESS', 'OPINION', 'PREDICT')
      ORDER BY vmp.canonical_category ASC, vmp.venue ASC, vmp.venue_market_id ASC`
  );

  return result.rows.map(mapInventoryRow);
};

export const loadCompatibilityLookup = async (
  pool: Pool
): Promise<ReadonlyMap<string, CompatibilityClass>> => {
  const result = await pool.query<CompatibilityLookupRow>(
    `SELECT
        LEAST(rp_a.venue || ':' || rp_a.venue_market_id, rp_b.venue || ':' || rp_b.venue_market_id) AS left_key,
        GREATEST(rp_a.venue || ':' || rp_a.venue_market_id, rp_b.venue || ':' || rp_b.venue_market_id) AS right_key,
        rra.equivalence_class
       FROM resolution_risk_assessments rra
       JOIN resolution_profiles rp_a
         ON rp_a.id = rra.market_a_profile_id
       JOIN resolution_profiles rp_b
         ON rp_b.id = rra.market_b_profile_id`
  );

  const mapped = new Map<string, CompatibilityClass>();
  for (const row of result.rows) {
    const raw = row.equivalence_class.toUpperCase();
    const normalized: CompatibilityClass | null =
      raw === "SAFE_EQUIVALENT" ? "EQUIVALENT"
      : raw === "EQUIVALENT_WITH_LAG" ? "COMPATIBLE_WITH_CAUTION"
      : raw === "CAUTION" ? "COMPATIBLE_WITH_CAUTION"
      : raw === "DISTINCT" || raw === "HIGH_RISK" ? "DISTINCT"
      : raw === "DO_NOT_POOL" ? "DO_NOT_POOL"
      : null;

    if (normalized !== null) {
      mapped.set(`${row.left_key}|${row.right_key}`, normalized);
    }
  }

  return mapped;
};

export const buildInventoryPairKey = (left: SemanticExpansionInventoryRow, right: SemanticExpansionInventoryRow): string => {
  const leftKey = `${left.venue}:${left.venueMarketId}`;
  const rightKey = `${right.venue}:${right.venueMarketId}`;
  return leftKey < rightKey ? `${leftKey}|${rightKey}` : `${rightKey}|${leftKey}`;
};

export const getCompatibilityForPair = (
  lookup: ReadonlyMap<string, CompatibilityClass>,
  left: SemanticExpansionInventoryRow,
  right: SemanticExpansionInventoryRow
): CompatibilityClass | null => lookup.get(buildInventoryPairKey(left, right)) ?? null;

export const ensureDocsDirectory = (repoRoot: string): void => {
  mkdirSync(path.resolve(repoRoot, "docs"), { recursive: true });
};

export type CanonicalArtifactCategory = "crypto" | "sports" | "politics" | "shared";
export type CanonicalArtifactBucket = "core" | "optional";

const CORE_ARTIFACT_BASENAMES: Readonly<Record<CanonicalArtifactCategory, ReadonlySet<string>>> = {
  crypto: new Set([
    "crypto-prod-readiness-summary.json",
    "crypto-canary-gates-summary.json",
    "crypto-canary-launch-plan.json",
    "crypto-rollback-plan.json",
    "crypto-final-canary-package-summary.json",
    "crypto-canary-scope-lock.json",
    "crypto-canary-operator-approval.json",
    "crypto-pair-routeability-summary.json",
    "crypto-matching-quality-summary.json"
  ]),
  sports: new Set([
    "sports-targeted-final-decision.json",
    "sports-targeted-pocket-priority.json",
    "sports-targeted-fixture-discovery-summary.json",
    "sports-targeted-overlap-matrix.json",
    "sports-fixture-final-decision.json",
    "sports-targeted-supply-recovery-plan.json",
    "sports-live-window-summary.json",
    "sports-missing-venue-rows-summary.json",
    "sports-fixture-coverage-matrix.json"
  ]),
  politics: new Set([
    "politics-final-decision.json",
    "politics-frontier-comparison-summary.json",
    "politics-inventory-census-summary.json",
    "politics-family-proof-summary.json",
    "politics-family-eligibility-summary.json",
    "politics-match-quality-summary.json",
    "politics-pair-routeability-summary.json",
    "politics-tri-routeability-summary.json",
    "politics-vs-sports-summary.json",
    "politics-nominee-live-inventory-summary.json",
    "politics-nominee-admission-summary.json",
    "politics-nominee-eligibility-decision.json",
    "politics-nominee-prematch-readiness-summary.json",
    "politics-nominee-final-decision.json"
  ]),
  shared: new Set([
    "pair-route-rollout-summary.json",
    "pair-canary-readiness-summary.json",
    "pair-canary-launch-plan.json",
    "pair-graph-routeability-summary.json",
    "matching-quality-summary.json",
    "cross-venue-match-report.json",
    "time-basis-routeability-summary.json",
    "simulation-routeability-summary.json",
    "pair-family-exactness-report.json"
  ])
};

const inferCanonicalArtifactCategory = (basename: string): CanonicalArtifactCategory =>
  basename.startsWith("politics-") ? "politics"
  : basename.startsWith("sports-") || basename.startsWith("nba-") || basename.startsWith("dota2-") ? "sports"
  : basename.startsWith("crypto-")
    || basename.startsWith("btc-")
    || basename.startsWith("limitless-")
    || basename.startsWith("opinion-")
    || basename.startsWith("predict-") ? "crypto"
  : "shared";

const resolveGeneratedMarkdownPath = (repoRoot: string, relativePath: string): string | null => {
  const normalized = relativePath.replace(/\\/g, "/");
  if (!normalized.startsWith("docs/") || !normalized.endsWith(".md")) {
    return null;
  }
  const parts = normalized.split("/");
  if (parts.length !== 2) {
    return null;
  }
  const basename = path.basename(normalized);
  const category = inferCanonicalArtifactCategory(basename);
  return path.resolve(repoRoot, "docs", "generated", category, basename);
};

const resolveCanonicalArtifactPath = (repoRoot: string, relativePath: string): string | null => {
  const normalized = relativePath.replace(/\\/g, "/");
  if (!normalized.startsWith("docs/") || !normalized.endsWith(".json")) {
    return null;
  }
  const basename = path.basename(normalized);
  const category = inferCanonicalArtifactCategory(basename);
  const bucket: CanonicalArtifactBucket = CORE_ARTIFACT_BASENAMES[category].has(basename) ? "core" : "optional";
  return path.resolve(repoRoot, "artifacts", category, bucket, basename);
};

export const writeArtifact = (repoRoot: string, relativePath: string, value: unknown): string => {
  const canonicalPath = resolveCanonicalArtifactPath(repoRoot, relativePath);
  if (canonicalPath) {
    mkdirSync(path.dirname(canonicalPath), { recursive: true });
    writeFileSync(canonicalPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    return canonicalPath;
  }
  const artifactPath = path.resolve(repoRoot, relativePath);
  mkdirSync(path.dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return artifactPath;
};

export const readArtifact = <T>(repoRoot: string, relativePath: string): T => {
  const canonicalPath = resolveCanonicalArtifactPath(repoRoot, relativePath);
  if (canonicalPath) {
    try {
      return JSON.parse(readFileSync(canonicalPath, "utf8")) as T;
    } catch {
      // Fall back to the legacy docs mirror below.
    }
  }
  const artifactPath = path.resolve(repoRoot, relativePath);
  return JSON.parse(readFileSync(artifactPath, "utf8")) as T;
};

export const writeMarkdownArtifact = (repoRoot: string, relativePath: string, content: string): string => {
  const generatedPath = resolveGeneratedMarkdownPath(repoRoot, relativePath);
  if (generatedPath) {
    mkdirSync(path.dirname(generatedPath), { recursive: true });
    writeFileSync(generatedPath, content, "utf8");
    return generatedPath;
  }
  const markdownPath = path.resolve(repoRoot, relativePath);
  mkdirSync(path.dirname(markdownPath), { recursive: true });
  writeFileSync(markdownPath, content, "utf8");
  return markdownPath;
};

export const buildMatchRef = (row: SemanticExpansionInventoryRow): SemanticExpansionMatchRef => ({
  venue: row.venue,
  venueMarketId: row.venueMarketId,
  title: row.title,
  canonicalEventId: row.canonicalEventId,
  canonicalMarketId: row.canonicalMarketId,
  evidenceLabel: row.evidenceLabel,
  historicalRowCount: row.historicalRowCount
});

export const summarizeInventory = (
  inventory: readonly SemanticExpansionInventoryRow[]
): CrossVenueMatchReport["inventorySummary"] => {
  const categories: Record<string, number> = {};
  const venues = Object.fromEntries(
    semanticExpansionVenues.map((venue) => [venue, 0])
  ) as Record<CanonicalVenue, number>;
  const evidenceLabels: Record<SemanticEvidenceLabel, number> = {
    historical: 0,
    current_state: 0,
    recorder: 0,
    fallback: 0,
    live_inventory_only: 0
  };

  for (const row of inventory) {
    categories[row.semanticCategory] = (categories[row.semanticCategory] ?? 0) + 1;
    venues[row.venue] += 1;
    evidenceLabels[row.evidenceLabel] += 1;
  }

  return {
    totalMarkets: inventory.length,
    categories,
    venues,
    evidenceLabels
  };
};

export const toCuratedSeed = (
  row: SemanticExpansionInventoryRow,
  target: {
    canonicalEventId: string;
    canonicalMarketId: string;
    classification: "historical_qualified_exact_overlap" | "live_only_exact_overlap";
  }
): CuratedCanonicalGraphSeed => ({
  canonicalEventId: target.canonicalEventId,
  canonicalMarketId: target.canonicalMarketId,
  canonicalCategory: row.canonicalCategory,
  venue: row.venue,
  venueMarketId: row.venueMarketId,
  title: row.title,
  description: row.description,
  marketType: row.marketType,
  marketClass: row.marketClass,
  outcomes: row.outcomes as readonly CanonicalOutcomeDefinition[],
  outcomeSchema: row.outcomeSchema,
  topics: row.topics,
  publishedAt: row.publishedAt ? new Date(row.publishedAt) : null,
  expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
  resolvesAt: row.resolvesAt ? new Date(row.resolvesAt) : null,
  fees: row.fees as CanonicalFeeProfile,
  feeModel: row.feeModel,
  resolutionSource: row.resolutionSource,
  resolutionTitle: row.resolutionTitle ?? row.title,
  resolutionRulesText: row.resolutionRulesText ?? row.rules,
  resolutionAuthorityType: row.resolutionAuthorityType,
  sourceHierarchy: row.sourceHierarchy,
  disputeWindowHours: row.disputeWindowHours,
  ambiguousTimeBoundary: row.ambiguousTimeBoundary,
  ambiguousSourceReference: row.ambiguousSourceReference,
  ambiguousJurisdictionOrScope: row.ambiguousJurisdictionOrScope,
  settlementType: (row.settlementType as CuratedCanonicalGraphSeed["settlementType"]) ?? null,
  settlementLagHours: row.settlementLagHours,
  finalityLagHours: row.finalityLagHours,
  payoutTimingHours: row.payoutTimingHours,
  feeOnEntry: row.feeOnEntry,
  feeOnExit: row.feeOnExit,
  timeSensitiveFeeBehavior: row.timeSensitiveFeeBehavior,
  requiresConservativeAnchor: row.requiresConservativeAnchor,
  network: row.network,
  chain: row.chain,
  rawSourcePayload: row.rawSourcePayload,
  normalizedPayload: {
    ...row.normalizedPayload,
    semanticExactPromotionClass: target.classification,
    semanticsRulepackVersion: DEFAULT_SEMANTICS_RULEPACK_VERSION
  },
  mappingLineage: [...row.mappingLineage, "semantic-exact-sync"],
  ...(row.confidenceScore !== null ? { confidenceScore: row.confidenceScore.toString() } : {}),
  sourceMetadataVersion: row.sourceMetadataVersion,
  propositionHints: {
    normalizedPropositionText: `${row.title} ${row.rules ?? ""}`.trim(),
    groupingHints: {
      semanticPromotionClass: target.classification
    }
  },
  executableDisplayName: row.title,
  executableMetadata: {
    promotedBy: "semantic-exact-sync",
    promotionClass: target.classification
  }
});

export const buildStablePromotionIds = (memberRefs: readonly SemanticExpansionMatchRef[]): {
  canonicalEventId: string;
  canonicalMarketId: string;
  promotionId: string;
} => {
  const memberKey = memberRefs
    .map((entry) => `${entry.venue}:${entry.venueMarketId}`)
    .sort((left, right) => left.localeCompare(right))
    .join("|");

  return {
    promotionId: buildStableTextId("semprom_", memberKey),
    canonicalEventId: buildStableUuid(`semantic-exact-event:${memberKey}`),
    canonicalMarketId: buildStableTextId("semantic-exact-market-", memberKey)
  };
};

export const mergeRuleSuggestions = (
  suggestions: readonly SemanticSuggestion[]
): readonly SemanticRule[] =>
  suggestions.map((suggestion) => ({
    canonical: suggestion.canonical,
    variants: suggestion.variants,
    categories: [suggestion.category],
    targetField: suggestion.targetField,
    precedence: 35,
    exactnessRequired: false
  }));
