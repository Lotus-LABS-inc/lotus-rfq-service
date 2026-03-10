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
