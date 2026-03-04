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

export const metricsRegistry = registry;
