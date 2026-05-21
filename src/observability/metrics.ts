import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics
} from "prom-client";

const registry = new Registry();
collectDefaultMetrics({ register: registry });

const counterConfig = {
  registers: [registry]
};

const histogramConfig = {
  registers: [registry]
};

const gaugeConfig = {
  registers: [registry]
};

export const rfqCreatedTotal = new Counter({
  name: "rfq_created_total",
  help: "Total number of RFQs created.",
  ...counterConfig
});

export const rfqExpiredTotal = new Counter({
  name: "rfq_expired_total",
  help: "Total number of RFQs expired.",
  ...counterConfig
});

export const quoteReceivedTotal = new Counter({
  name: "quote_received_total",
  help: "Total number of quotes received.",
  ...counterConfig
});

export const rfqResolutionSafePoolTotal = new Counter({
  name: "rfq_resolution_safe_pool_total",
  help: "Total number of SAFE_EQUIVALENT RFQ venue lanes created.",
  ...counterConfig
});

export const rfqResolutionSeparatedTotal = new Counter({
  name: "rfq_resolution_separated_total",
  help: "Total number of RFQ venues separated into non-pooled caution lanes.",
  ...counterConfig
});

export const rfqResolutionBlockedTotal = new Counter({
  name: "rfq_resolution_blocked_total",
  help: "Total number of RFQ venue profiles or quotes blocked by resolution-risk policy.",
  ...counterConfig
});

export const executionSuccessTotal = new Counter({
  name: "execution_success_total",
  help: "Total number of successful executions.",
  ...counterConfig
});

export const executionFailureTotal = new Counter({
  name: "execution_failure_total",
  help: "Total number of failed executions.",
  ...counterConfig
});

export const quoteLatencyMs = new Histogram({
  name: "quote_latency_ms",
  help: "Quote processing latency in milliseconds.",
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000],
  ...histogramConfig
});

export const rankingDurationMs = new Histogram({
  name: "ranking_duration_ms",
  help: "Ranking duration in milliseconds.",
  buckets: [0.1, 0.5, 1, 5, 10, 25, 50, 100, 250, 500],
  ...histogramConfig
});

export const executionLatencyMs = new Histogram({
  name: "execution_latency_ms",
  help: "Execution attempt latency in milliseconds.",
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  ...histogramConfig
});

export const hotPathLatencyMs = new Histogram({
  name: "lotus_hot_path_latency_ms",
  help: "Latency for RFQ, route preview, preflight, and execution hot-path stages in milliseconds.",
  labelNames: ["stage", "endpoint", "route_type", "execution_mode", "external", "cache"],
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 25, 50, 75, 100, 250, 500, 1000, 2500, 5000, 10000],
  ...histogramConfig
});

export const hotPathBlockerTotal = new Counter({
  name: "lotus_hot_path_blocker_total",
  help: "Total fail-closed, preflight, quote, and route blocker observations by hot-path stage.",
  labelNames: ["stage", "category"],
  ...counterConfig
});

export const lockWaitTimeMs = new Histogram({
  name: "lock_wait_time_ms",
  help: "Time spent waiting for execution lock acquisition in milliseconds.",
  buckets: [0.1, 0.5, 1, 5, 10, 25, 50, 100, 250, 500, 1000],
  ...histogramConfig
});

export const activeRFQSessions = new Gauge({
  name: "active_rfq_sessions",
  help: "Estimated number of active RFQ sessions.",
  ...gaugeConfig
});

export const wsConnectionsActive = new Gauge({
  name: "ws_connections_active",
  help: "Number of active WebSocket client connections.",
  ...gaugeConfig
});

export const lpReliabilityBonusTotal = new Counter({
  name: "lp_reliability_bonus_total",
  help: "Cumulative reliability bonus applied to quotes.",
  ...counterConfig
});

export const lpLatencyBonusTotal = new Counter({
  name: "lp_latency_bonus_total",
  help: "Cumulative latency bonus applied to quotes.",
  ...counterConfig
});

export const lpFailurePenaltyTotal = new Counter({
  name: "lp_failure_penalty_total",
  help: "Cumulative failure penalty applied to quotes.",
  ...counterConfig
});

export const lpStatsUpdateTotal = new Counter({
  name: "lp_stats_update_total",
  help: "Total updates to LP reliability statistics.",
  labelNames: ["update_type"],
  ...counterConfig
});

export const riskValidationRejectedTotal = new Counter({
  name: "risk_validation_rejected_total",
  help: "Total number of RFQs or executions rejected by the risk engine.",
  labelNames: ["reason"],
  ...counterConfig
});

export const riskExposureUpdatesTotal = new Counter({
  name: "risk_exposure_updates_total",
  help: "Total number of exposure updates performed.",
  ...counterConfig
});

export const riskReconcileMismatchesTotal = new Counter({
  name: "risk_reconcile_mismatches_total",
  help: "Total number of risk exposure mismatches found during reconciliation.",
  ...counterConfig
});

export const riskReservationsActive = new Gauge({
  name: "risk_reservations_active",
  help: "Number of active risk reservations currently held.",
  ...gaugeConfig
});

export const riskInternalErrorTotal = new Counter({
  name: "risk_internal_error_total",
  help: "Total number of internal errors in the risk engine.",
  labelNames: ["operation"],
  ...counterConfig
});

export const riskExposureCurrent = new Gauge({
  name: "risk_exposure_current",
  help: "Current active exposure across users and markets.",
  labelNames: ["user_id", "market_id", "side"],
  ...gaugeConfig
});

export const riskTotalGrossExposure = new Gauge({
  name: "risk_total_gross_exposure",
  help: "Total gross exposure across all users and markets.",
  ...gaugeConfig
});

export const riskTotalNetExposure = new Gauge({
  name: "risk_total_net_exposure",
  help: "Total net exposure across all users and markets.",
  ...gaugeConfig
});

export const riskReconciliationDiffTotal = new Gauge({
  name: "risk_reconciliation_diff_total",
  help: "Total discrepancy found during risk reconciliation.",
  ...gaugeConfig
});

export const adminRiskActionsTotal = new Counter({
  name: "admin_risk_actions_total",
  help: "Total number of administrative risk actions performed.",
  labelNames: ["action"],
  ...counterConfig
});

export const riskValidationLatencyMs = new Histogram({
  name: "risk_validation_latency_ms",
  help: "Latency of risk validation operations.",
  buckets: [1, 5, 10, 25, 50, 100, 250, 500],
  ...histogramConfig
});

export const riskLockWaitTimeMs = new Histogram({
  name: "risk_lock_wait_time_ms",
  help: "Time spent waiting for risk locks.",
  buckets: [0.1, 0.5, 1, 5, 10, 25, 50, 100],
  ...histogramConfig
});

// ─── Combo Engine Counters ────────────────────────────────────────────────────

export const comboCreatedTotal = new Counter({
  name: "combo_created_total",
  help: "Total number of Combo RFQs created.",
  labelNames: ["acceptance_policy"],
  ...counterConfig
});

export const comboQuoteReceivedTotal = new Counter({
  name: "combo_quote_received_total",
  help: "Total number of LP combo quotes received and normalized.",
  labelNames: ["lp_id", "is_combo_quote"],
  ...counterConfig
});

export const comboExecutionSuccessTotal = new Counter({
  name: "combo_execution_success_total",
  help: "Total number of fully successful combo executions.",
  labelNames: ["acceptance_policy"],
  ...counterConfig
});

export const comboExecutionFailureTotal = new Counter({
  name: "combo_execution_failure_total",
  help: "Total number of failed combo executions (including unwound ALL_OR_NONE).",
  labelNames: ["acceptance_policy", "reason"],
  ...counterConfig
});

export const comboPartialFillTotal = new Counter({
  name: "combo_partial_fill_total",
  help: "Total number of combos that settled with a partial fill (PARTIAL_ALLOWED policy).",
  ...counterConfig
});

export const comboUnwindAttemptsTotal = new Counter({
  name: "combo_unwind_attempts_total",
  help: "Total number of combo leg unwind attempts triggered after ALL_OR_NONE failure.",
  labelNames: ["outcome"],  // "success" | "failed"
  ...counterConfig
});

export const comboInternalNetAttemptTotal = new Counter({
  name: "combo_internal_net_attempt_total",
  help: "Total number of combo internal netting attempts before external execution.",
  ...counterConfig
});

export const comboInternalNetSuccessTotal = new Counter({
  name: "combo_internal_net_success_total",
  help: "Total number of combos fully filled by internal netting.",
  ...counterConfig
});

export const comboInternalNetPartialTotal = new Counter({
  name: "combo_internal_net_partial_total",
  help: "Total number of combos partially filled by internal netting before residual external routing.",
  ...counterConfig
});

export const comboInternalNetResidualRoutedTotal = new Counter({
  name: "combo_internal_net_residual_routed_total",
  help: "Total number of internally netted combos whose residual was routed externally.",
  ...counterConfig
});

export const comboInternalNetKillSwitchTotal = new Counter({
  name: "combo_internal_net_kill_switch_total",
  help: "Total number of combo internal-netting suppressions due to kill switch.",
  labelNames: ["mode"],
  ...counterConfig
});

export const comboInternalNetShadowTotal = new Counter({
  name: "combo_internal_net_shadow_total",
  help: "Total combo internal-netting shadow or canary evaluations.",
  labelNames: ["mode", "sampled"],
  ...counterConfig
});

export const comboInternalNetShadowMatchTotal = new Counter({
  name: "combo_internal_net_shadow_match_total",
  help: "Total matching combo internal-netting shadow comparisons.",
  labelNames: ["dimension"],
  ...counterConfig
});

export const comboInternalNetShadowDivergenceTotal = new Counter({
  name: "combo_internal_net_shadow_divergence_total",
  help: "Total divergent combo internal-netting shadow comparisons.",
  labelNames: ["reason"],
  ...counterConfig
});

export const comboInternalNetShadowNettedSize = new Histogram({
  name: "combo_internal_net_shadow_netted_size",
  help: "Shadow-evaluated combo internal-netting size distribution.",
  buckets: [0, 1, 5, 10, 25, 50, 100, 250, 500, 1000],
  ...histogramConfig
});

export const comboInternalNetEnabledState = new Gauge({
  name: "combo_internal_net_enabled_state",
  help: "Current runtime combo internal-netting enablement state (1 enabled, 0 disabled).",
  ...gaugeConfig
});

export const clearingRoundAttemptsTotal = new Counter({
  name: "clearing_round_attempts_total",
  help: "Total number of authoritative Phase 2B clearing round attempts.",
  ...counterConfig
});

export const clearingRoundSuccessTotal = new Counter({
  name: "clearing_round_success_total",
  help: "Total number of Phase 2B clearing rounds that fully satisfied the current entity.",
  ...counterConfig
});

export const clearingRoundPartialTotal = new Counter({
  name: "clearing_round_partial_total",
  help: "Total number of Phase 2B clearing rounds that partially satisfied the current entity.",
  ...counterConfig
});

export const clearingResidualRoutedTotal = new Counter({
  name: "clearing_residual_routed_total",
  help: "Total number of Phase 2B clearing attempts whose residual was routed externally.",
  ...counterConfig
});

export const comboInternalClearingKillSwitchTotal = new Counter({
  name: "combo_internal_clearing_kill_switch_total",
  help: "Total number of combo internal-clearing suppressions due to kill switch.",
  labelNames: ["mode"],
  ...counterConfig
});

export const comboInternalClearingShadowTotal = new Counter({
  name: "combo_internal_clearing_shadow_total",
  help: "Total combo internal-clearing shadow or canary evaluations.",
  labelNames: ["mode", "sampled"],
  ...counterConfig
});

export const comboInternalClearingShadowMatchTotal = new Counter({
  name: "combo_internal_clearing_shadow_match_total",
  help: "Total matching combo internal-clearing shadow comparisons.",
  labelNames: ["dimension"],
  ...counterConfig
});

export const comboInternalClearingShadowDivergenceTotal = new Counter({
  name: "combo_internal_clearing_shadow_divergence_total",
  help: "Total divergent combo internal-clearing shadow comparisons.",
  labelNames: ["reason"],
  ...counterConfig
});

export const comboInternalClearingEnabledState = new Gauge({
  name: "combo_internal_clearing_enabled_state",
  help: "Current runtime combo internal-clearing enablement state (1 enabled, 0 disabled).",
  ...gaugeConfig
});

// ─── Combo Engine Histograms ──────────────────────────────────────────────────

export const comboRankingDurationMs = new Histogram({
  name: "combo_ranking_duration_ms",
  help: "Time taken to rank incoming LP combo quotes in milliseconds.",
  buckets: [0.5, 1, 2, 5, 10, 25, 50, 100, 250],
  ...histogramConfig
});

export const comboExecutionDurationMs = new Histogram({
  name: "combo_execution_duration_ms",
  help: "Total end-to-end execution duration for a combo plan in milliseconds.",
  labelNames: ["acceptance_policy"],
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  ...histogramConfig
});

export const comboPriceComputeMs = new Histogram({
  name: "combo_price_compute_ms",
  help: "Time to compute theoretical combo price (payout-vector or linear approx) in milliseconds.",
  buckets: [0.1, 0.5, 1, 2, 5, 10, 25, 50],
  ...histogramConfig
});

export const sorPlanBuildLatencyMs = new Histogram({
  name: "sor_plan_build_latency_ms",
  help: "Time spent building SOR execution plans in milliseconds.",
  labelNames: ["acceptance_policy"],
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  ...histogramConfig
});

export const sorCandidatesEvaluatedCount = new Gauge({
  name: "sor_candidates_evaluated_count",
  help: "Number of candidates evaluated during SOR plan build.",
  labelNames: ["rfq_id"],
  ...gaugeConfig
});

export const sorAvgSplitsPerLeg = new Gauge({
  name: "sor_avg_splits_per_leg",
  help: "Average number of splits allocated per leg in SOR plan build.",
  labelNames: ["rfq_id"],
  ...gaugeConfig
});

export const sorPlanSuccessTotal = new Counter({
  name: "sor_plan_success_total",
  help: "Total number of successful SOR plans.",
  labelNames: ["status"],
  ...counterConfig
});

export const sorPlanFailureTotal = new Counter({
  name: "sor_plan_failure_total",
  help: "Total number of failed or unwound SOR plans.",
  labelNames: ["status", "reason"],
  ...counterConfig
});

export const sorStepRetriesTotal = new Counter({
  name: "sor_step_retries_total",
  help: "Total number of SOR step retries.",
  labelNames: ["provider_type", "provider_id"],
  ...counterConfig
});

export const sorStepFallbackTotal = new Counter({
  name: "sor_step_fallback_total",
  help: "Total number of SOR fallback step creations.",
  labelNames: ["from_provider_id", "to_provider_id", "leg_id"],
  ...counterConfig
});

export const sorPlanUnwindTotal = new Counter({
  name: "sor_plan_unwind_total",
  help: "Total number of SOR unwind operations.",
  labelNames: ["reason"],
  ...counterConfig
});

export const sorAvgFillRate5mSnapshot = new Gauge({
  name: "sor_avg_fill_rate_5m_snapshot",
  help: "Approximate rolling fill rate snapshot for SOR plans.",
  ...gaugeConfig
});

export const sorShadowTotal = new Counter({
  name: "sor_shadow_total",
  help: "Total shadow comparison evaluations for SOR canary mode.",
  labelNames: ["mode", "sampled"],
  ...counterConfig
});

export const sorShadowMatchTotal = new Counter({
  name: "sor_shadow_match_total",
  help: "Total matches between SOR and legacy shadow decisions.",
  labelNames: ["dimension"],
  ...counterConfig
});

export const sorShadowDivergenceTotal = new Counter({
  name: "sor_shadow_divergence_total",
  help: "Total divergences between SOR and legacy shadow decisions.",
  labelNames: ["reason"],
  ...counterConfig
});

export const sorShadowPriceDeltaBps = new Histogram({
  name: "sor_shadow_price_delta_bps",
  help: "Absolute price delta between SOR and legacy decisions in basis points.",
  buckets: [0, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500],
  ...histogramConfig
});

export const sorEnabledState = new Gauge({
  name: "sor_enabled_state",
  help: "Current runtime SOR enablement state (1 enabled, 0 disabled).",
  ...gaugeConfig
});

export const resolutionRiskPenaltyAppliedTotal = new Counter({
  name: "resolution_risk_penalty_applied_total",
  help: "Total number of additive resolution-risk penalties applied during pooled routing decisions.",
  ...counterConfig
});

export const doNotPoolBlockTotal = new Counter({
  name: "do_not_pool_block_total",
  help: "Total number of pooled routing decisions blocked due to DO_NOT_POOL resolution risk policy.",
  ...counterConfig
});

export const cautionRouteTotal = new Counter({
  name: "caution_route_total",
  help: "Total number of CAUTION-class pooled routes allowed to proceed.",
  ...counterConfig
});

export const resolutionRiskShadowTotal = new Counter({
  name: "resolution_risk_shadow_total",
  help: "Total resolution-risk shadow evaluations by domain and rollout mode.",
  labelNames: ["domain", "mode"],
  ...counterConfig
});

export const resolutionRiskShadowMatchTotal = new Counter({
  name: "resolution_risk_shadow_match_total",
  help: "Total resolution-risk shadow evaluations that matched the enforced outcome.",
  labelNames: ["domain"],
  ...counterConfig
});

export const resolutionRiskShadowDivergenceTotal = new Counter({
  name: "resolution_risk_shadow_divergence_total",
  help: "Total resolution-risk shadow divergences by domain and reason.",
  labelNames: ["domain", "reason"],
  ...counterConfig
});

export const resolutionRiskEnforcementDisabledTotal = new Counter({
  name: "resolution_risk_enforcement_disabled_total",
  help: "Total times resolution-risk enforcement was disabled for a domain.",
  labelNames: ["domain"],
  ...counterConfig
});

export const resolutionRiskInternalExclusionTotal = new Counter({
  name: "resolution_risk_internal_exclusion_total",
  help: "Total internal-execution exclusions implied by resolution-risk policy.",
  labelNames: ["domain", "equivalence_class"],
  ...counterConfig
});

export const replayEnvelopesWrittenTotal = new Counter({
  name: "replay_envelopes_written_total",
  help: "Total replay envelopes persisted successfully.",
  labelNames: ["decision_type", "mode"],
  ...counterConfig
});

export const replayWriteFailuresTotal = new Counter({
  name: "replay_write_failures_total",
  help: "Total replay envelope write failures.",
  labelNames: ["decision_type", "mode"],
  ...counterConfig
});

export const replayExactMatchTotal = new Counter({
  name: "replay_exact_match_total",
  help: "Total replay executions that produced an exact match.",
  labelNames: ["decision_type"],
  ...counterConfig
});

export const replayDiffTotal = new Counter({
  name: "replay_diff_total",
  help: "Total replay executions that produced a diff.",
  labelNames: ["decision_type"],
  ...counterConfig
});

export const replayErrorTotal = new Counter({
  name: "replay_error_total",
  help: "Total replay executions that produced an error.",
  labelNames: ["decision_type"],
  ...counterConfig
});

export const qualificationEvaluationsWrittenTotal = new Counter({
  name: "qualification_evaluations_written_total",
  help: "Total qualification decision evaluations persisted successfully.",
  labelNames: ["decision_type", "strategy_key", "mode"],
  ...counterConfig
});

export const shadowDecisionDiffTotal = new Counter({
  name: "shadow_decision_diff_total",
  help: "Total runtime qualification shadow decision divergences.",
  labelNames: ["decision_type", "reason"],
  ...counterConfig
});

export const pairShadowRuntimeWritesTotal = new Counter({
  name: "pair_shadow_runtime_writes_total",
  help: "Total pair shadow runtime observation write attempts by route class and outcome.",
  labelNames: ["route_class", "outcome"],
  ...counterConfig
});

export const pairShadowRuntimeSkipsTotal = new Counter({
  name: "pair_shadow_runtime_skips_total",
  help: "Total skipped pair shadow runtime observations by reason.",
  labelNames: ["reason"],
  ...counterConfig
});

export const promotionGateFailTotal = new Counter({
  name: "promotion_gate_fail_total",
  help: "Total promotion gate failures by current stage and gate.",
  labelNames: ["stage", "gate"],
  ...counterConfig
});

export const autoSafetyActionsCreatedTotal = new Counter({
  name: "auto_safety_actions_created_total",
  help: "Total auto safety actions created by action type, trigger reason, and scope type.",
  labelNames: ["action_type", "trigger_reason", "scope_type"],
  ...counterConfig
});

export const autoSafetyActionsResolvedTotal = new Counter({
  name: "auto_safety_actions_resolved_total",
  help: "Total auto safety actions resolved by action type and scope type.",
  labelNames: ["action_type", "scope_type"],
  ...counterConfig
});

export const qualificationRollupRefreshTotal = new Counter({
  name: "qualification_rollup_refresh_total",
  help: "Total qualification rollup materialized-view refresh attempts by status.",
  labelNames: ["status"],
  ...counterConfig
});

export const qualificationRollupRefreshDurationMs = new Histogram({
  name: "qualification_rollup_refresh_duration_ms",
  help: "Duration of qualification rollup materialized-view refreshes in milliseconds.",
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],
  ...histogramConfig
});

export const historicalIngestRunsTotal = new Counter({
  name: "historical_ingest_runs_total",
  help: "Total historical ingestion job runs by venue, mode, and status.",
  labelNames: ["venue", "mode", "status"],
  ...counterConfig
});

export const historicalIngestFailuresTotal = new Counter({
  name: "historical_ingest_failures_total",
  help: "Total historical ingestion failures by venue and stage.",
  labelNames: ["venue", "stage"],
  ...counterConfig
});

export const historicalRowsWrittenTotal = new Counter({
  name: "historical_rows_written_total",
  help: "Total historical market-state rows inserted by venue and mode.",
  labelNames: ["venue", "mode"],
  ...counterConfig
});

export const plannerShardPausedTotal = new Counter({
  name: "planner_shard_paused_total",
  help: "Total successful planner shard pause operations.",
  ...counterConfig
});

export const bucketDrainedTotal = new Counter({
  name: "bucket_drained_total",
  help: "Total successful bucket drain operations.",
  ...counterConfig
});

export const degradedModeActivationsTotal = new Counter({
  name: "degraded_mode_activations_total",
  help: "Total effective execution mode degradations activated by the control plane.",
  labelNames: ["mode", "source", "engine"],
  ...counterConfig
});

export const guardrailModeTransitionsTotal = new Counter({
  name: "guardrail_mode_transitions_total",
  help: "Total engine handling transitions triggered by guardrail evaluation.",
  labelNames: ["engine", "mode", "reason"],
  ...counterConfig
});

export const phase3aGuardrailShadowTotal = new Counter({
  name: "phase3a_guardrail_shadow_total",
  help: "Total Phase 3A guardrail shadow evaluations by engine and enforcement mode.",
  labelNames: ["engine", "mode"],
  ...counterConfig
});

export const phase3aGuardrailShadowWouldDegradeTotal = new Counter({
  name: "phase3a_guardrail_shadow_would_degrade_total",
  help: "Total Phase 3A shadow evaluations that would degrade to a non-full mode.",
  labelNames: ["engine", "mode"],
  ...counterConfig
});

export const phase3aGuardrailShadowDivergenceTotal = new Counter({
  name: "phase3a_guardrail_shadow_divergence_total",
  help: "Total Phase 3A shadow decisions that diverged from enforced full-mode behavior.",
  labelNames: ["engine", "reason"],
  ...counterConfig
});

export const phase3aGuardrailShadowResolutionTotal = new Counter({
  name: "phase3a_guardrail_shadow_resolution_total",
  help: "Total Phase 3A guardrail shadow resolution decisions by engine, source, and enforcement mode.",
  labelNames: ["engine", "source", "enforcement_mode"],
  ...counterConfig
});

export const plannerLatencyBudgetExceededTotal = new Counter({
  name: "planner_latency_budget_exceeded_total",
  help: "Total planner latency guardrail violations detected.",
  labelNames: ["engine", "planner_type"],
  ...counterConfig
});

export const bucketSizeLimitExceededTotal = new Counter({
  name: "bucket_size_limit_exceeded_total",
  help: "Total bucket size guardrail violations detected.",
  labelNames: ["engine", "planner_type"],
  ...counterConfig
});

export const graphDensityLimitExceededTotal = new Counter({
  name: "graph_density_limit_exceeded_total",
  help: "Total graph density guardrail violations detected.",
  labelNames: ["engine", "planner_type"],
  ...counterConfig
});

export const lockWaitLimitExceededTotal = new Counter({
  name: "lock_wait_limit_exceeded_total",
  help: "Total lock wait guardrail violations detected.",
  labelNames: ["engine", "planner_type"],
  ...counterConfig
});

export const reconciliationV2RunsTotal = new Counter({
  name: "reconciliation_v2_runs_total",
  help: "Total ReconciliationV2 runs by status and dry-run mode.",
  labelNames: ["status", "dry_run"],
  ...counterConfig
});

export const reconciliationV2RunDurationMs = new Histogram({
  name: "reconciliation_v2_run_duration_ms",
  help: "Duration of full ReconciliationV2 runs in milliseconds.",
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000],
  ...histogramConfig
});

export const reconciliationV2LockConflictTotal = new Counter({
  name: "reconciliation_v2_lock_conflict_total",
  help: "Total ReconciliationV2 singleton lock conflicts.",
  ...counterConfig
});

export const reconciliationV2InfraErrorTotal = new Counter({
  name: "reconciliation_v2_infra_error_total",
  help: "Total ReconciliationV2 infrastructure failures by domain and operation.",
  labelNames: ["domain", "operation"],
  ...counterConfig
});

export const reconciliationV2DiscrepanciesTotal = new Counter({
  name: "reconciliation_v2_discrepancies_total",
  help: "Total ReconciliationV2 discrepancies by domain, code, and severity.",
  labelNames: ["domain", "code", "severity"],
  ...counterConfig
});

export const reconciliationMismatchTotal = new Counter({
  name: "reconciliation_mismatch_total",
  help: "Total reconciliation mismatches emitted by ReconciliationV2.",
  labelNames: ["domain", "code", "severity"],
  ...counterConfig
});

export const replayMissingTotal = new Counter({
  name: "replay_missing_total",
  help: "Total missing replay envelopes detected by reconciliation.",
  labelNames: ["decision_type"],
  ...counterConfig
});

export const reconciliationV2FixesTotal = new Counter({
  name: "reconciliation_v2_fixes_total",
  help: "Total Redis-only ReconciliationV2 fixes by domain, code, and result.",
  labelNames: ["domain", "code", "result"],
  ...counterConfig
});

export const internalCrossingTotal = new Counter({
  name: "internal_crossing_total",
  help: "Total number of internal crossing attempts.",
  labelNames: ["market_id", "side", "status"],
  ...counterConfig
});

export const internalCrossingFilledSizeTotal = new Counter({
  name: "internal_crossing_filled_size_total",
  help: "Total filled size from internal crossing.",
  labelNames: ["market_id", "side"],
  ...counterConfig
});

export const sorInternalCrossResultTotal = new Counter({
  name: "sor_internal_cross_result_total",
  help: "Total SOR internal crossing outcomes before external routing.",
  labelNames: ["status"],
  ...counterConfig
});

export const internalCrossKillSwitchTotal = new Counter({
  name: "internal_cross_kill_switch_total",
  help: "Total number of internal crossing suppressions due to kill switch.",
  labelNames: ["mode"],
  ...counterConfig
});

export const internalCrossShadowTotal = new Counter({
  name: "internal_cross_shadow_total",
  help: "Total internal-cross shadow evaluations.",
  labelNames: ["status"],
  ...counterConfig
});

export const internalCrossShadowMatchTotal = new Counter({
  name: "internal_cross_shadow_match_total",
  help: "Total internal-cross shadow evaluations that matched no-action expectations.",
  labelNames: ["dimension"],
  ...counterConfig
});

export const internalCrossShadowDivergenceTotal = new Counter({
  name: "internal_cross_shadow_divergence_total",
  help: "Total internal-cross shadow divergences against external-only routing.",
  labelNames: ["reason"],
  ...counterConfig
});

export const internalCrossRebuildTotal = new Counter({
  name: "internal_cross_rebuild_total",
  help: "Total internal-cross Redis rebuild runs.",
  labelNames: ["result"],
  ...counterConfig
});

export const internalCrossRebuildDiscrepancyTotal = new Counter({
  name: "internal_cross_rebuild_discrepancy_total",
  help: "Total discrepancies found during internal-cross Redis rebuild validation.",
  labelNames: ["discrepancy_type"],
  ...counterConfig
});

export const metricsRegistry = registry;
