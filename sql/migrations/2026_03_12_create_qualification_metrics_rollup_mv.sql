CREATE MATERIALIZED VIEW IF NOT EXISTS qualification_metrics_rollup AS
WITH evaluation_source AS (
    SELECT
        sqr.strategy_key,
        sqr.scope_type,
        sqr.scope_id,
        sqr.stage,
        sqr.engine_version,
        sqr.config_version,
        COALESCE(NULLIF(sde.realized_metrics->>'market', ''), NULLIF(sde.counterfactual_metrics->>'market', '')) AS market,
        COALESCE(NULLIF(sde.realized_metrics->>'venuePair', ''), NULLIF(sde.counterfactual_metrics->>'venuePair', '')) AS venue_pair,
        CASE
            WHEN COALESCE(sde.realized_metrics->>'externalNotional', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
                THEN (sde.realized_metrics->>'externalNotional')::numeric
            ELSE NULL
        END AS external_notional,
        CASE
            WHEN COALESCE(sde.realized_metrics->>'internalizedNotional', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
                THEN (sde.realized_metrics->>'internalizedNotional')::numeric
            ELSE NULL
        END AS internalized_notional,
        CASE
            WHEN COALESCE(sde.realized_metrics->>'compressionNotional', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
                THEN (sde.realized_metrics->>'compressionNotional')::numeric
            ELSE NULL
        END AS compression_notional,
        CASE
            WHEN COALESCE(sde.improvement_metrics->>'feeSaved', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
                THEN (sde.improvement_metrics->>'feeSaved')::numeric
            ELSE NULL
        END AS fee_saved,
        CASE
            WHEN COALESCE(sde.improvement_metrics->>'slippageSaved', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
                THEN (sde.improvement_metrics->>'slippageSaved')::numeric
            ELSE NULL
        END AS slippage_saved,
        CASE
            WHEN COALESCE(sde.improvement_metrics->>'priceImprovement', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
                THEN (sde.improvement_metrics->>'priceImprovement')::numeric
            ELSE NULL
        END AS price_improvement,
        CASE
            WHEN COALESCE(sde.realized_metrics->>'adverseSelectionIndicator', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
                THEN (sde.realized_metrics->>'adverseSelectionIndicator')::numeric
            ELSE NULL
        END AS adverse_selection_indicator
    FROM strategy_qualification_runs sqr
    INNER JOIN strategy_decision_evaluations sde
        ON sde.qualification_run_id = sqr.id
)
SELECT
    strategy_key,
    scope_type,
    scope_id,
    stage,
    engine_version,
    config_version,
    market,
    venue_pair,
    COUNT(*)::bigint AS evaluation_count,
    COALESCE(SUM(external_notional), 0)::numeric AS external_notional_total,
    COALESCE(SUM(internalized_notional), 0)::numeric AS internalized_notional_total,
    COALESCE(SUM(compression_notional), 0)::numeric AS compression_notional_total,
    COALESCE(SUM(fee_saved), 0)::numeric AS fee_savings_total,
    COALESCE(SUM(slippage_saved), 0)::numeric AS slippage_savings_total,
    AVG(price_improvement)::numeric AS fill_quality_delta,
    AVG(adverse_selection_indicator)::numeric AS adverse_selection_indicator,
    CASE
        WHEN COALESCE(SUM(external_notional), 0) + COALESCE(SUM(internalized_notional), 0) = 0
            THEN NULL
        ELSE (COALESCE(SUM(internalized_notional), 0)
            / NULLIF(COALESCE(SUM(external_notional), 0) + COALESCE(SUM(internalized_notional), 0), 0))::numeric
    END AS internalization_rate,
    CASE
        WHEN COALESCE(SUM(external_notional), 0) + COALESCE(SUM(internalized_notional), 0) = 0
            THEN NULL
        ELSE (COALESCE(SUM(compression_notional), 0)
            / NULLIF(COALESCE(SUM(external_notional), 0) + COALESCE(SUM(internalized_notional), 0), 0))::numeric
    END AS compression_ratio
FROM evaluation_source
WHERE market IS NOT NULL
  AND venue_pair IS NOT NULL
GROUP BY
    strategy_key,
    scope_type,
    scope_id,
    stage,
    engine_version,
    config_version,
    market,
    venue_pair;

CREATE UNIQUE INDEX IF NOT EXISTS idx_qualification_metrics_rollup_grouping
    ON qualification_metrics_rollup (
        strategy_key,
        scope_type,
        scope_id,
        stage,
        engine_version,
        config_version,
        market,
        venue_pair
    );

CREATE INDEX IF NOT EXISTS idx_qualification_metrics_rollup_strategy_scope
    ON qualification_metrics_rollup (strategy_key, scope_type, scope_id);

CREATE INDEX IF NOT EXISTS idx_qualification_metrics_rollup_stage_market
    ON qualification_metrics_rollup (stage, market, venue_pair);
