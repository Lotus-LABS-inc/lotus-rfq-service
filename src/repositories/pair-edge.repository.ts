import type { Pool, QueryResultRow } from "pg";

import type { CompatibilityDecision } from "../canonical/compatibility-decision.js";
import type { CompatibilityReasonCode } from "../canonical/compatibility-reason-codes.js";
import {
  buildStableTextId,
  buildStableUuid,
  normalizeCategory,
  normalizeMarketClass,
  type CanonicalVenue
} from "../canonical/canonicalization-types.js";
import { classifyHistoricalMetadataVersionBasis } from "../inventory/inventory-basis-classifier.js";
import type {
  ContractFamilyClassification,
  MatchingMarketRecord,
  PairEdgeRecord,
  PairEdgeReviewAction,
  StructuralFingerprint
} from "../matching/matching-types.js";
import type { MatchingVersionRecord } from "../matching/matching-versioning.js";
import type { PairEdgeApprovalState, PairMatchLabel } from "../matching/match-labels.js";
import type { MatchingProvenance } from "../matching/matching-provenance.js";

interface MatchingMarketRow extends QueryResultRow {
  interpreted_contract_id: string;
  venue_market_profile_id: string;
  canonical_event_id: string;
  venue: CanonicalVenue;
  venue_market_id: string;
  title: string;
  description: string | null;
  rules_text: string | null;
  canonical_category: string | null;
  market_class: string | null;
  source_metadata_version: string;
  interpretation_confidence: string;
  proposition_semantics: unknown;
  outcome_semantics: unknown;
  timing_semantics: unknown;
  resolution_semantics: unknown;
  settlement_semantics: unknown;
  ambiguity_flags: unknown;
  raw_lineage_references: unknown;
  published_at: Date | null;
  expires_at: Date | null;
  resolves_at: Date | null;
  outcomes: unknown;
  outcome_schema: unknown;
  historical_row_count: string;
}

interface CompatibilityDecisionRow extends QueryResultRow {
  id: string;
  canonical_event_id: string;
  interpreted_contract_a_id: string;
  interpreted_contract_b_id: string;
  compatibility_version_id: string;
  replay_envelope_id: string | null;
  compatibility_class: CompatibilityDecision["compatibilityClass"];
  reason_codes: CompatibilityReasonCode[];
  hard_blocks: string[];
  caution_conditions: string[];
  soft_penalties: Record<string, unknown>[];
  confidence_score: string;
  factor_breakdown: Record<string, unknown>;
  supporting_reasons: string[];
  reviewer_override_metadata: Record<string, unknown>;
  computed_at: Date;
}

interface PairEdgeRow extends QueryResultRow {
  id: string;
  canonical_event_id: string;
  interpreted_contract_a_id: string;
  interpreted_contract_b_id: string;
  left_venue: CanonicalVenue;
  right_venue: CanonicalVenue;
  family: ContractFamilyClassification["family"];
  label: PairMatchLabel;
  confidence_score: string;
  approval_state: PairEdgeApprovalState;
  reasons: string[];
  rejection_reasons: string[];
  temporal_basis: PairEdgeRecord["temporalBasis"];
  compatibility_decision_id: string | null;
  compatibility_class: string | null;
  matching_version_id: string;
  provenance: MatchingProvenance;
  computed_at: Date;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  review_reason: string | null;
}

interface PairEdgeReviewActionRow extends QueryResultRow {
  id: string;
  pair_edge_id: string;
  action: "APPROVE" | "REJECT";
  reviewer: string;
  reason: string;
  metadata: Record<string, unknown>;
  created_at: Date;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

const asRecordArray = (value: unknown): readonly Readonly<Record<string, unknown>>[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is Readonly<Record<string, unknown>> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    : [];

const asStringArray = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const mapMatchingMarketRow = (row: MatchingMarketRow): MatchingMarketRecord => ({
  interpretedContractId: row.interpreted_contract_id,
  venueMarketProfileId: row.venue_market_profile_id,
  canonicalEventId: row.canonical_event_id,
  venue: row.venue,
  venueMarketId: row.venue_market_id,
  title: row.title,
  description: row.description,
  rulesText: row.rules_text,
  category: normalizeCategory(row.canonical_category),
  marketClass: normalizeMarketClass(row.market_class),
  sourceMetadataVersion: row.source_metadata_version,
  confidenceScore: row.interpretation_confidence,
  propositionSemantics: asRecord(row.proposition_semantics),
  outcomeSemantics: asRecord(row.outcome_semantics),
  timingSemantics: asRecord(row.timing_semantics),
  resolutionSemantics: asRecord(row.resolution_semantics),
  settlementSemantics: asRecord(row.settlement_semantics),
  ambiguityFlags: asRecord(row.ambiguity_flags),
  rawLineageReferences: asRecord(row.raw_lineage_references),
  publishedAt: row.published_at,
  expiresAt: row.expires_at,
  resolvesAt: row.resolves_at,
  outcomes: asRecordArray(row.outcomes),
  outcomeSchema: asRecord(row.outcome_schema),
  historicalRowCount: Number.parseInt(row.historical_row_count, 10),
  inventoryTemporalBasis: classifyHistoricalMetadataVersionBasis(row.source_metadata_version)
});

const mapCompatibilityDecisionRow = (row: CompatibilityDecisionRow): CompatibilityDecision => ({
  id: row.id,
  canonicalEventId: row.canonical_event_id,
  interpretedContractAId: row.interpreted_contract_a_id,
  interpretedContractBId: row.interpreted_contract_b_id,
  compatibilityVersionId: row.compatibility_version_id,
  replayReference: row.replay_envelope_id,
  compatibilityClass: row.compatibility_class,
  reasonCodes: row.reason_codes,
  hardBlocks: row.hard_blocks,
  cautionConditions: row.caution_conditions,
  softPenalties: row.soft_penalties,
  confidenceScore: row.confidence_score,
  factorBreakdown: row.factor_breakdown,
  supportingReasons: row.supporting_reasons,
  reviewerOverrideMetadata: row.reviewer_override_metadata,
  computedAt: new Date(row.computed_at)
});

const mapPairEdgeRow = (row: PairEdgeRow): PairEdgeRecord => ({
  id: row.id,
  canonicalEventId: row.canonical_event_id,
  interpretedContractAId: row.interpreted_contract_a_id,
  interpretedContractBId: row.interpreted_contract_b_id,
  leftVenue: row.left_venue,
  rightVenue: row.right_venue,
  family: row.family,
  label: row.label,
  confidenceScore: row.confidence_score,
  approvalState: row.approval_state,
  reasons: row.reasons,
  rejectionReasons: row.rejection_reasons,
  temporalBasis: row.temporal_basis,
  compatibilityDecisionId: row.compatibility_decision_id,
  compatibilityClass: row.compatibility_class,
  matchingVersionId: row.matching_version_id,
  provenance: row.provenance,
  computedAt: new Date(row.computed_at),
  reviewedBy: row.reviewed_by,
  reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
  reviewReason: row.review_reason
});

const mapReviewActionRow = (row: PairEdgeReviewActionRow): PairEdgeReviewAction => ({
  id: row.id,
  pairEdgeId: row.pair_edge_id,
  action: row.action,
  reviewer: row.reviewer,
  reason: row.reason,
  metadata: row.metadata,
  createdAt: new Date(row.created_at)
});

export class PairEdgeRepository {
  public constructor(private readonly pool: Pool) {}

  public async upsertMatchingVersion(record: MatchingVersionRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO pair_matching_versions (
          id,
          family_classifier_version,
          fingerprint_version,
          prefilter_version,
          structural_matcher_version,
          pair_classifier_version,
          embedding_model_version,
          review_policy_version
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        record.id,
        record.familyClassifierVersion,
        record.fingerprintVersion,
        record.prefilterVersion,
        record.structuralMatcherVersion,
        record.pairClassifierVersion,
        record.embeddingModelVersion,
        record.reviewPolicyVersion
      ]
    );
  }

  public async listMatchingMarkets(): Promise<readonly MatchingMarketRecord[]> {
    const result = await this.pool.query<MatchingMarketRow>(
      `WITH historical_counts AS (
          SELECT venue, venue_market_id, COUNT(*)::text AS historical_row_count
            FROM historical_market_states
           GROUP BY venue, venue_market_id
       )
       SELECT
         ic.id AS interpreted_contract_id,
         ic.venue_market_profile_id,
         ic.canonical_event_id::text,
         ic.venue,
         ic.venue_market_id,
         vmp.title,
         vmp.description,
         COALESCE(vrp.rule_text, vmp.resolution_rules_text, vmp.description) AS rules_text,
         vmp.canonical_category,
         vmp.market_class,
         ic.source_metadata_version,
         ic.interpretation_confidence::text,
         ic.proposition_semantics,
         ic.outcome_semantics,
         ic.timing_semantics,
         ic.resolution_semantics,
         ic.settlement_semantics,
         ic.ambiguity_flags,
         ic.raw_lineage_references,
         vmp.published_at,
         vmp.expires_at,
         vmp.resolves_at,
         vmp.outcomes,
         vmp.outcome_schema,
         COALESCE(historical_counts.historical_row_count, '0') AS historical_row_count
        FROM interpreted_contracts ic
        JOIN venue_market_profiles vmp
          ON vmp.id = ic.venue_market_profile_id
        LEFT JOIN venue_resolution_profiles vrp
          ON vrp.venue_market_profile_id = vmp.id
        LEFT JOIN historical_counts
          ON historical_counts.venue = ic.venue
         AND historical_counts.venue_market_id = ic.venue_market_id
       ORDER BY ic.canonical_event_id, ic.venue, ic.venue_market_id`
    );
    return result.rows.map(mapMatchingMarketRow);
  }

  public async listCompatibilityDecisions(): Promise<readonly CompatibilityDecision[]> {
    const result = await this.pool.query<CompatibilityDecisionRow>(
      `SELECT *
         FROM compatibility_decisions
        ORDER BY computed_at DESC`
    );
    return result.rows.map(mapCompatibilityDecisionRow);
  }

  public async upsertMarketClassification(classification: ContractFamilyClassification): Promise<void> {
    await this.pool.query(
      `INSERT INTO matching_market_classifications (
          interpreted_contract_id,
          family,
          family_confidence,
          classification_reasons,
          rule_ids,
          ambiguity_flags,
          weak_structure_lane,
          classifier_version,
          metadata,
          updated_at
       ) VALUES ($1, $2, $3::numeric, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9::jsonb, now())
       ON CONFLICT (interpreted_contract_id) DO UPDATE SET
         family = EXCLUDED.family,
         family_confidence = EXCLUDED.family_confidence,
         classification_reasons = EXCLUDED.classification_reasons,
         rule_ids = EXCLUDED.rule_ids,
         ambiguity_flags = EXCLUDED.ambiguity_flags,
         weak_structure_lane = EXCLUDED.weak_structure_lane,
         classifier_version = EXCLUDED.classifier_version,
         metadata = EXCLUDED.metadata,
         updated_at = EXCLUDED.updated_at`,
      [
        classification.interpretedContractId,
        classification.family,
        classification.familyConfidence,
        JSON.stringify(classification.classificationReasons),
        JSON.stringify(classification.ruleIds),
        JSON.stringify(classification.ambiguityFlags),
        classification.weakStructureLane,
        classification.classifierVersion,
        JSON.stringify(classification.metadata)
      ]
    );
  }

  public async upsertStructuralFingerprint(fingerprint: StructuralFingerprint): Promise<void> {
    await this.pool.query(
      `INSERT INTO matching_structural_fingerprints (
          interpreted_contract_id,
          fingerprint_hash,
          fingerprint,
          normalized_values,
          unresolved_dimensions,
          provenance,
          fingerprint_version,
          updated_at
       ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7, now())
       ON CONFLICT (interpreted_contract_id) DO UPDATE SET
         fingerprint_hash = EXCLUDED.fingerprint_hash,
         fingerprint = EXCLUDED.fingerprint,
         normalized_values = EXCLUDED.normalized_values,
         unresolved_dimensions = EXCLUDED.unresolved_dimensions,
         provenance = EXCLUDED.provenance,
         fingerprint_version = EXCLUDED.fingerprint_version,
         updated_at = EXCLUDED.updated_at`,
      [
        fingerprint.interpretedContractId,
        fingerprint.fingerprintHash,
        JSON.stringify(fingerprint.fingerprint),
        JSON.stringify(fingerprint.normalizedValues),
        JSON.stringify(fingerprint.unresolvedDimensions),
        JSON.stringify(fingerprint.provenance),
        fingerprint.fingerprintVersion
      ]
    );
  }

  public async upsertPairEdge(edge: PairEdgeRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO pair_edges (
          id,
          canonical_event_id,
          interpreted_contract_a_id,
          interpreted_contract_b_id,
          left_venue,
          right_venue,
          family,
          label,
          confidence_score,
          approval_state,
          reasons,
          rejection_reasons,
          temporal_basis,
          compatibility_decision_id,
          compatibility_class,
          matching_version_id,
          provenance,
          computed_at,
          reviewed_by,
          reviewed_at,
          review_reason
       ) VALUES (
          $1, $2::uuid, $3, $4, $5, $6, $7, $8, $9::numeric, $10, $11::jsonb, $12::jsonb, $13, $14, $15, $16, $17::jsonb, $18, $19, $20, $21
       )
       ON CONFLICT (canonical_event_id, interpreted_contract_a_id, interpreted_contract_b_id, matching_version_id) DO UPDATE SET
         label = EXCLUDED.label,
         confidence_score = EXCLUDED.confidence_score,
         approval_state = EXCLUDED.approval_state,
         reasons = EXCLUDED.reasons,
         rejection_reasons = EXCLUDED.rejection_reasons,
         temporal_basis = EXCLUDED.temporal_basis,
         compatibility_decision_id = EXCLUDED.compatibility_decision_id,
         compatibility_class = EXCLUDED.compatibility_class,
         provenance = EXCLUDED.provenance,
         computed_at = EXCLUDED.computed_at,
         reviewed_by = EXCLUDED.reviewed_by,
         reviewed_at = EXCLUDED.reviewed_at,
         review_reason = EXCLUDED.review_reason`,
      [
        edge.id,
        edge.canonicalEventId,
        edge.interpretedContractAId,
        edge.interpretedContractBId,
        edge.leftVenue,
        edge.rightVenue,
        edge.family,
        edge.label,
        edge.confidenceScore,
        edge.approvalState,
        JSON.stringify(edge.reasons),
        JSON.stringify(edge.rejectionReasons),
        edge.temporalBasis,
        edge.compatibilityDecisionId,
        edge.compatibilityClass,
        edge.matchingVersionId,
        JSON.stringify(edge.provenance),
        edge.computedAt,
        edge.reviewedBy,
        edge.reviewedAt,
        edge.reviewReason
      ]
    );
  }

  public async listPairEdges(filters: {
    canonicalEventId?: string;
    approvalState?: PairEdgeApprovalState;
    label?: PairMatchLabel;
  } = {}): Promise<readonly PairEdgeRecord[]> {
    const clauses: string[] = [];
    const values: Array<string> = [];

    if (filters.canonicalEventId) {
      values.push(filters.canonicalEventId);
      clauses.push(`canonical_event_id = $${values.length}::uuid`);
    }
    if (filters.approvalState) {
      values.push(filters.approvalState);
      clauses.push(`approval_state = $${values.length}`);
    }
    if (filters.label) {
      values.push(filters.label);
      clauses.push(`label = $${values.length}`);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const result = await this.pool.query<PairEdgeRow>(
      `SELECT *
         FROM pair_edges
         ${whereClause}
        ORDER BY canonical_event_id, family, left_venue, right_venue, computed_at DESC`,
      values
    );
    return result.rows.map(mapPairEdgeRow);
  }

  public async getPairEdge(edgeId: string): Promise<PairEdgeRecord | null> {
    const result = await this.pool.query<PairEdgeRow>(
      `SELECT *
         FROM pair_edges
        WHERE id = $1
        LIMIT 1`,
      [edgeId]
    );
    return result.rows[0] ? mapPairEdgeRow(result.rows[0]) : null;
  }

  public async recordReviewAction(input: {
    pairEdgeId: string;
    action: PairEdgeReviewAction["action"];
    reviewer: string;
    reason: string;
    metadata?: Record<string, unknown>;
  }): Promise<PairEdgeReviewAction> {
    const actionId = buildStableUuid(`${input.pairEdgeId}|${input.action}|${input.reviewer}|${input.reason}|${Date.now()}`);
    const result = await this.pool.query<PairEdgeReviewActionRow>(
      `INSERT INTO pair_edge_review_actions (id, pair_edge_id, action, reviewer, reason, metadata)
       VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb)
       RETURNING *`,
      [actionId, input.pairEdgeId, input.action, input.reviewer, input.reason, JSON.stringify(input.metadata ?? {})]
    );
    return mapReviewActionRow(result.rows[0]!);
  }

  public async updatePairEdgeReviewState(input: {
    pairEdgeId: string;
    approvalState: PairEdgeApprovalState;
    reviewer: string;
    reviewReason: string;
  }): Promise<PairEdgeRecord | null> {
    const result = await this.pool.query<PairEdgeRow>(
      `UPDATE pair_edges
          SET approval_state = $2,
              reviewed_by = $3,
              reviewed_at = now(),
              review_reason = $4
        WHERE id = $1
        RETURNING *`,
      [input.pairEdgeId, input.approvalState, input.reviewer, input.reviewReason]
    );
    return result.rows[0] ? mapPairEdgeRow(result.rows[0]) : null;
  }

  public async listReviewActions(edgeId: string): Promise<readonly PairEdgeReviewAction[]> {
    const result = await this.pool.query<PairEdgeReviewActionRow>(
      `SELECT *
         FROM pair_edge_review_actions
        WHERE pair_edge_id = $1
        ORDER BY created_at DESC`,
      [edgeId]
    );
    return result.rows.map(mapReviewActionRow);
  }
}
