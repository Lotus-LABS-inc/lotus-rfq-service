import { describe, expect, it } from "vitest";

import { PairPromotionDecisionLog } from "../../src/rollout/pair-promotion-decision-log.js";
import { PairPromotionDecisionRepository } from "../../src/rollout/pair-promotion-decision-repository.js";
import { PairShadowObservationService } from "../../src/shadow/pair-shadow-observation.js";
import { PairShadowObservationRepository } from "../../src/shadow/pair-shadow-observation-repository.js";
import type {
  CreatePairPromotionDecisionInput,
  CreatePairShadowObservationInput
} from "../../src/shadow/pair-shadow-observation-types.js";

class FakePool {
  public observations: any[] = [];
  public decisions: any[] = [];

  public async query<T>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    if (sql.includes("INSERT INTO pair_shadow_observations")) {
      const row = {
        id: params[0] ?? `obs-${this.observations.length + 1}`,
        route_class: params[1],
        route_mode: params[2],
        source_kind: params[3],
        scope_kind: params[4],
        scope_key: params[5],
        route_family: params[6],
        canonical_event_id: params[7],
        canonical_market_id: params[8],
        basis_mode: params[9],
        decision_timestamp: new Date(String(params[10])),
        candidate_venues: params[11],
        chosen_shadow_route: params[12],
        baseline_comparator: params[13],
        confidence_state: params[14],
        compatibility_state: params[15],
        exactness_class: params[16],
        expected_net_price: params[17],
        expected_effective_cost: params[18],
        expected_slippage: params[19],
        expected_fillability: params[20],
        blocked_reason: params[21],
        stale_data: params[22],
        mixed_basis: params[23],
        insufficient_basis: params[24],
        insufficient_evidence: params[25],
        live_data_clean: params[26],
        execution_boundary_healthy: params[27],
        venue_health_healthy: params[28],
        reproducibility_hash: params[29],
        replay_envelope_id: params[30],
        metadata: JSON.parse(String(params[31])),
        created_at: params[32] ? new Date(String(params[32])) : new Date("2026-03-29T00:00:00.000Z")
      };
      this.observations.push(row);
      return { rows: [row as T] };
    }
    if (sql.includes("FROM pair_shadow_observations")) {
      const routeClass = params[0];
      const rows = routeClass ? this.observations.filter((row) => row.route_class === routeClass) : this.observations;
      return { rows: rows as T[] };
    }
    if (sql.includes("INSERT INTO pair_promotion_decisions")) {
      const row = {
        id: params[0] ?? `decision-${this.decisions.length + 1}`,
        route_class: params[1],
        scope_promoted: params[2],
        evidence_window_start: new Date(String(params[3])),
        evidence_window_end: new Date(String(params[4])),
        metrics_snapshot: JSON.parse(String(params[5])),
        thresholds_evaluated: JSON.parse(String(params[6])),
        pass: params[7],
        operator_identity: params[8],
        previous_rollout_state: params[9],
        new_rollout_state: params[10],
        rollback_reference: params[11],
        metadata: JSON.parse(String(params[12])),
        created_at: params[13] ? new Date(String(params[13])) : new Date("2026-03-29T00:00:00.000Z")
      };
      this.decisions.push(row);
      return { rows: [row as T] };
    }
    if (sql.includes("FROM pair_promotion_decisions")) {
      const routeClass = params[0];
      const rows = routeClass ? this.decisions.filter((row) => row.route_class === routeClass) : this.decisions;
      return { rows: rows as T[] };
    }
    throw new Error(`Unhandled SQL in fake pool: ${sql}`);
  }
}

describe("pair shadow observation persistence", () => {
  it("persists runtime observations and promotion decision lineage", async () => {
    const pool = new FakePool();
    const repository = new PairShadowObservationRepository(pool as never);
    const service = new PairShadowObservationService(repository);
    const recorded = await service.recordRuntimeObservation({
      routeClass: "PAIR_PM_OPINION",
      routeMode: "POLYMARKET_OPINION",
      scopeKind: "SAFE_EXACT_SUBSET",
      scopeKey: "btc-mar-21",
      routeFamily: "CRYPTO:SAME_DAY_DIRECTIONAL",
      canonicalEventId: "evt-btc-mar-21",
      canonicalMarketId: "mkt-btc-mar-21",
      basisMode: "LIVE_ONLY",
      decisionTimestamp: "2026-03-29T12:00:00.000Z",
      candidateVenues: ["POLYMARKET", "OPINION"],
      chosenShadowRoute: "POLYMARKET_OPINION",
      baselineComparator: "pm_only",
      confidenceState: "HIGH",
      compatibilityState: "EXACT",
      exactnessClass: "semantic_exact_live_only",
      expectedNetPrice: 1.01,
      expectedEffectiveCost: 0.99,
      expectedSlippage: 0.01,
      expectedFillability: 0.98,
      blockedReason: null,
      staleData: false,
      mixedBasis: false,
      insufficientBasis: false,
      insufficientEvidence: false,
      liveDataClean: true,
      executionBoundaryHealthy: true,
      venueHealthHealthy: true,
      replayEnvelopeId: "replay-1",
      metadata: { operatorOverride: false }
    });

    expect(recorded.sourceKind).toBe("RUNTIME_OBSERVATION");
    expect(recorded.reproducibilityHash).toHaveLength(64);
    expect((await repository.listObservations("PAIR_PM_OPINION")).length).toBe(1);

    const decisionRepository = new PairPromotionDecisionRepository(repository);
    const decisionLog = new PairPromotionDecisionLog(decisionRepository);
    await decisionLog.record({
      routeClass: "PAIR_PM_OPINION",
      scopePromoted: "btc_exact_slice",
      evidence: {
        routeClass: "PAIR_PM_OPINION",
        routeMode: "POLYMARKET_OPINION",
        currentStage: "SHADOW",
        window: {
          windowStart: "2026-03-20T00:00:00.000Z",
          windowEnd: "2026-03-29T00:00:00.000Z",
          freshnessObservedAt: "2026-03-29T00:00:00.000Z"
        },
        routeOverall: {} as never,
        exactSafeSubset: {} as never,
        shadowOnlySubset: {} as never,
        runtimeOverall: {} as never,
        runtimeExactSafeSubset: {} as never,
        runtimeShadowOnlySubset: {} as never,
        countableRuntimeExactSafeSubset: {} as never,
        evidenceFresh: true,
        sourceBreakdown: {
          BOOTSTRAP_ARTIFACT: 1,
          RUNTIME_OBSERVATION: 1
        },
        qualityBreakdown: {
          CANARY_COUNTABLE: 1,
          SHADOW_ONLY_NOT_COUNTABLE: 0,
          MIXED_BASIS_REJECTED: 0,
          STALE_REJECTED: 0,
          OUT_OF_SCOPE_REJECTED: 0,
          POLICY_BLOCKED: 0
        }
      },
      canaryReadiness: {
        routeClass: "PAIR_PM_OPINION",
        thresholds: {} as never,
        thresholdResults: [],
        blockerReasons: [],
        recommendation: "CANARY_APPROVED_PENDING_OPERATOR_ACTION"
      },
      operatorIdentity: "admin-user",
      previousRolloutState: "SHADOW",
      newRolloutState: "CANARY",
      rollbackReference: "revert:PAIR_PM_OPINION:shadow_only"
    });

    const decisions = await repository.listPromotionDecisions("PAIR_PM_OPINION");
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.scopePromoted).toBe("btc_exact_slice");
    expect(decisions[0]?.pass).toBe(true);
  });
});
