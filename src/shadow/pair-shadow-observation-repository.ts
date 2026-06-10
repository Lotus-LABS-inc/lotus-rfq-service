import crypto from "node:crypto";

import type { Pool, QueryResultRow } from "pg";

import type {
  CreatePairPromotionDecisionInput,
  CreatePairShadowObservationInput,
  PairPromotionDecisionRecord,
  PairShadowObservation
} from "./pair-shadow-observation-types.js";

interface PairShadowObservationRow extends QueryResultRow {
  id: string;
  route_class: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION" | "PAIR_PM_PREDICTFUN";
  route_mode: "POLYMARKET_LIMITLESS" | "POLYMARKET_OPINION" | "POLYMARKET_PREDICT_FUN";
  source_kind: "BOOTSTRAP_ARTIFACT" | "RUNTIME_OBSERVATION";
  scope_kind: "SAFE_EXACT_SUBSET" | "SHADOW_ONLY_SUBSET" | "BLOCKED_FAMILY";
  scope_key: string;
  route_family: string;
  canonical_event_id: string | null;
  canonical_market_id: string | null;
  basis_mode: "HISTORICAL_ONLY" | "LIVE_ONLY" | "MIXED_BASIS_DIAGNOSTIC";
  decision_timestamp: Date;
  candidate_venues: string[];
  chosen_shadow_route: string | null;
  baseline_comparator: string | null;
  confidence_state: "HIGH" | "MEDIUM" | "LOW";
  compatibility_state: "EXACT" | "NEAR_EXACT" | "BLOCKED";
  exactness_class: string;
  expected_net_price: string | null;
  expected_effective_cost: string | null;
  expected_slippage: string | null;
  expected_fillability: string | null;
  blocked_reason: string | null;
  stale_data: boolean;
  mixed_basis: boolean;
  insufficient_basis: boolean;
  insufficient_evidence: boolean;
  live_data_clean: boolean;
  execution_boundary_healthy: boolean;
  venue_health_healthy: boolean;
  reproducibility_hash: string;
  replay_envelope_id: string | null;
  created_at: Date;
  metadata: Record<string, unknown>;
}

interface PairPromotionDecisionRow extends QueryResultRow {
  id: string;
  route_class: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION" | "PAIR_PM_PREDICTFUN";
  scope_promoted: string;
  evidence_window_start: Date;
  evidence_window_end: Date;
  metrics_snapshot: Record<string, unknown>;
  thresholds_evaluated: Record<string, unknown>;
  pass: boolean;
  operator_identity: string;
  previous_rollout_state: string;
  new_rollout_state: string;
  rollback_reference: string | null;
  created_at: Date;
  metadata: Record<string, unknown>;
}

const isMissingTableError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: string }).code === "42P01";

const mapObservationRow = (row: PairShadowObservationRow): PairShadowObservation => ({
  id: row.id,
  routeClass: row.route_class,
  routeMode: row.route_mode,
  sourceKind: row.source_kind,
  scopeKind: row.scope_kind,
  scopeKey: row.scope_key,
  routeFamily: row.route_family,
  canonicalEventId: row.canonical_event_id,
  canonicalMarketId: row.canonical_market_id,
  basisMode: row.basis_mode,
  decisionTimestamp: row.decision_timestamp.toISOString(),
  candidateVenues: row.candidate_venues,
  chosenShadowRoute: row.chosen_shadow_route,
  baselineComparator: row.baseline_comparator,
  confidenceState: row.confidence_state,
  compatibilityState: row.compatibility_state,
  exactnessClass: row.exactness_class as PairShadowObservation["exactnessClass"],
  expectedNetPrice: row.expected_net_price === null ? null : Number(row.expected_net_price),
  expectedEffectiveCost: row.expected_effective_cost === null ? null : Number(row.expected_effective_cost),
  expectedSlippage: row.expected_slippage === null ? null : Number(row.expected_slippage),
  expectedFillability: row.expected_fillability === null ? null : Number(row.expected_fillability),
  blockedReason: row.blocked_reason,
  staleData: row.stale_data,
  mixedBasis: row.mixed_basis,
  insufficientBasis: row.insufficient_basis,
  insufficientEvidence: row.insufficient_evidence,
  liveDataClean: row.live_data_clean,
  executionBoundaryHealthy: row.execution_boundary_healthy,
  venueHealthHealthy: row.venue_health_healthy,
  reproducibilityHash: row.reproducibility_hash,
  replayEnvelopeId: row.replay_envelope_id,
  createdAt: row.created_at.toISOString(),
  metadata: row.metadata
});

const mapDecisionRow = (row: PairPromotionDecisionRow): PairPromotionDecisionRecord => ({
  id: row.id,
  routeClass: row.route_class,
  scopePromoted: row.scope_promoted,
  evidenceWindowStart: row.evidence_window_start.toISOString(),
  evidenceWindowEnd: row.evidence_window_end.toISOString(),
  metricsSnapshot: row.metrics_snapshot,
  thresholdsEvaluated: row.thresholds_evaluated,
  pass: row.pass,
  operatorIdentity: row.operator_identity,
  previousRolloutState: row.previous_rollout_state,
  newRolloutState: row.new_rollout_state,
  rollbackReference: row.rollback_reference,
  createdAt: row.created_at.toISOString(),
  metadata: row.metadata
});

const asNumericString = (value: number | null): string | null => value === null ? null : value.toString();

export class PairShadowObservationRepository {
  public constructor(private readonly pool: Pool) {}

  public async createObservation(input: CreatePairShadowObservationInput): Promise<PairShadowObservation> {
    const result = await this.pool.query<PairShadowObservationRow>(
      `INSERT INTO pair_shadow_observations (
          id, route_class, route_mode, source_kind, scope_kind, scope_key, route_family,
          canonical_event_id, canonical_market_id, basis_mode, decision_timestamp, candidate_venues,
          chosen_shadow_route, baseline_comparator, confidence_state, compatibility_state, exactness_class,
          expected_net_price, expected_effective_cost, expected_slippage, expected_fillability, blocked_reason,
          stale_data, mixed_basis, insufficient_basis, insufficient_evidence, live_data_clean,
          execution_boundary_healthy, venue_health_healthy, reproducibility_hash, replay_envelope_id, metadata, created_at
      ) VALUES (
          COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11::timestamptz, $12::text[],
          $13, $14, $15, $16, $17,
          $18, $19, $20, $21, $22,
          $23, $24, $25, $26, $27,
          $28, $29, $30, $31, $32::jsonb, COALESCE($33::timestamptz, now())
      )
      RETURNING *`,
      [
        input.id ?? null,
        input.routeClass,
        input.routeMode,
        input.sourceKind,
        input.scopeKind,
        input.scopeKey,
        input.routeFamily,
        input.canonicalEventId,
        input.canonicalMarketId,
        input.basisMode,
        input.decisionTimestamp,
        input.candidateVenues,
        input.chosenShadowRoute,
        input.baselineComparator,
        input.confidenceState,
        input.compatibilityState,
        input.exactnessClass,
        asNumericString(input.expectedNetPrice),
        asNumericString(input.expectedEffectiveCost),
        asNumericString(input.expectedSlippage),
        asNumericString(input.expectedFillability),
        input.blockedReason,
        input.staleData,
        input.mixedBasis,
        input.insufficientBasis,
        input.insufficientEvidence,
        input.liveDataClean,
        input.executionBoundaryHealthy,
        input.venueHealthHealthy,
        input.reproducibilityHash,
        input.replayEnvelopeId,
        JSON.stringify(input.metadata ?? {}),
        input.createdAt ?? null
      ]
    );
    return mapObservationRow(result.rows[0]!);
  }

  public async listObservations(routeClass?: PairShadowObservation["routeClass"]): Promise<readonly PairShadowObservation[]> {
    try {
      const result = routeClass
        ? await this.pool.query<PairShadowObservationRow>(
            `SELECT * FROM pair_shadow_observations WHERE route_class = $1 ORDER BY decision_timestamp DESC, created_at DESC`,
            [routeClass]
          )
        : await this.pool.query<PairShadowObservationRow>(
            `SELECT * FROM pair_shadow_observations ORDER BY decision_timestamp DESC, created_at DESC`
          );
      return result.rows.map(mapObservationRow);
    } catch (error) {
      if (isMissingTableError(error)) {
        return [];
      }
      throw error;
    }
  }

  public async createPromotionDecision(input: CreatePairPromotionDecisionInput): Promise<PairPromotionDecisionRecord> {
    const result = await this.pool.query<PairPromotionDecisionRow>(
      `INSERT INTO pair_promotion_decisions (
          id, route_class, scope_promoted, evidence_window_start, evidence_window_end, metrics_snapshot,
          thresholds_evaluated, pass, operator_identity, previous_rollout_state, new_rollout_state,
          rollback_reference, metadata, created_at
      ) VALUES (
          COALESCE($1, gen_random_uuid()), $2, $3, $4::timestamptz, $5::timestamptz, $6::jsonb,
          $7::jsonb, $8, $9, $10, $11, $12, $13::jsonb, COALESCE($14::timestamptz, now())
      )
      RETURNING *`,
      [
        input.id ?? null,
        input.routeClass,
        input.scopePromoted,
        input.evidenceWindowStart,
        input.evidenceWindowEnd,
        JSON.stringify(input.metricsSnapshot),
        JSON.stringify(input.thresholdsEvaluated),
        input.pass,
        input.operatorIdentity,
        input.previousRolloutState,
        input.newRolloutState,
        input.rollbackReference,
        JSON.stringify(input.metadata ?? {}),
        input.createdAt ?? null
      ]
    );
    return mapDecisionRow(result.rows[0]!);
  }

  public async listPromotionDecisions(routeClass?: PairPromotionDecisionRecord["routeClass"]): Promise<readonly PairPromotionDecisionRecord[]> {
    try {
      const result = routeClass
        ? await this.pool.query<PairPromotionDecisionRow>(
            `SELECT * FROM pair_promotion_decisions WHERE route_class = $1 ORDER BY created_at DESC, id DESC`,
            [routeClass]
          )
        : await this.pool.query<PairPromotionDecisionRow>(
            `SELECT * FROM pair_promotion_decisions ORDER BY created_at DESC, id DESC`
          );
      return result.rows.map(mapDecisionRow);
    } catch (error) {
      if (isMissingTableError(error)) {
        return [];
      }
      throw error;
    }
  }

  public static buildReproducibilityHash(payload: Record<string, unknown>): string {
    return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }
}
