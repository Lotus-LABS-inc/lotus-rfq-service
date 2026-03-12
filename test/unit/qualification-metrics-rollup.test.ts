import { describe, expect, it, vi } from "vitest";

import {
    QualificationMetricsRollup,
    QualificationMetricsRollupError,
    type QualificationMetricsRollupConfig
} from "../../src/core/qualification/qualification-metrics-rollup.js";

const config: QualificationMetricsRollupConfig = {
    promotionReadiness: {
        version: "rollup-v1",
        internalizationRate: { weight: 0.2, max: "0.5" },
        compressionRatio: { weight: 0.2, max: "0.4" },
        feeSavings: { weight: 0.2, max: "5" },
        slippageSavings: { weight: 0.15, max: "5" },
        fillQualityDelta: { weight: 0.15, max: "1" },
        adverseSelectionIndicator: { weight: 0.1, max: "0.5" }
    }
};

describe("QualificationMetricsRollup", () => {
    it("computes rollup formulas and readiness score deterministically", async () => {
        const pool = {
            query: vi.fn(async () => ({
                rows: [
                    {
                        strategy_key: "strategy-1",
                        scope_type: "MARKET",
                        scope_id: "market-1",
                        stage: "SHADOW",
                        engine_version: "eng-v1",
                        config_version: "cfg-v1",
                        market: "market-1",
                        venue_pair: "venue-a->venue-b",
                        evaluation_count: "2",
                        external_notional_total: "70",
                        internalized_notional_total: "30",
                        compression_notional_total: "20",
                        fee_savings_total: "3",
                        slippage_savings_total: "2",
                        fill_quality_delta: "0.4",
                        adverse_selection_indicator: "0.05",
                        internalization_rate: "0.3",
                        compression_ratio: "0.2"
                    }
                ]
            }))
        };

        const rollup = new QualificationMetricsRollup(pool as never, config);
        const rows = await rollup.list({ strategyKey: "strategy-1", market: "market-1" });

        expect(pool.query).toHaveBeenCalledTimes(1);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            internalizationRate: "0.3",
            compressionRatio: "0.2",
            feeSavings: "3",
            slippageSavings: "2",
            fillQualityDelta: "0.4"
        });
        expect(rows[0]?.promotionReadinessScoreVersion).toBe("rollup-v1");
        expect(rows[0]?.promotionReadinessScore).toBeGreaterThan(0);
        expect(rows[0]?.promotionReadinessComponents).toHaveLength(6);
    });

    it("applies adverse-selection penalty to readiness score", async () => {
        const pool = {
            query: vi.fn(async () => ({
                rows: [
                    {
                        strategy_key: "strategy-1",
                        scope_type: "MARKET",
                        scope_id: "market-1",
                        stage: "SHADOW",
                        engine_version: "eng-v1",
                        config_version: "cfg-v1",
                        market: "market-1",
                        venue_pair: "venue-a->venue-b",
                        evaluation_count: "1",
                        external_notional_total: "80",
                        internalized_notional_total: "20",
                        compression_notional_total: "10",
                        fee_savings_total: "2",
                        slippage_savings_total: "1",
                        fill_quality_delta: "0.5",
                        adverse_selection_indicator: "0.4",
                        internalization_rate: "0.2",
                        compression_ratio: "0.1"
                    }
                ]
            }))
        };

        const rollup = new QualificationMetricsRollup(pool as never, config);
        const [row] = await rollup.list({});
        const adverseComponent = row?.promotionReadinessComponents.find(
            (component) => component.metric === "adverseSelectionIndicator"
        );

        expect(adverseComponent?.weightedContribution).toBeLessThan(0);
        expect(row?.promotionReadinessScore).toBeLessThan(100);
    });

    it("returns null when no rollup rows match", async () => {
        const pool = { query: vi.fn(async () => ({ rows: [] })) };
        const rollup = new QualificationMetricsRollup(pool as never, config);

        await expect(rollup.get({ strategyKey: "missing" })).resolves.toBeNull();
    });

    it("fails closed when get() is ambiguous", async () => {
        const pool = {
            query: vi.fn(async () => ({
                rows: [
                    {
                        strategy_key: "strategy-1",
                        scope_type: "MARKET",
                        scope_id: "market-1",
                        stage: "SHADOW",
                        engine_version: "eng-v1",
                        config_version: "cfg-v1",
                        market: "market-1",
                        venue_pair: "venue-a->venue-b",
                        evaluation_count: "1",
                        external_notional_total: "10",
                        internalized_notional_total: "0",
                        compression_notional_total: "0",
                        fee_savings_total: "0",
                        slippage_savings_total: "0",
                        fill_quality_delta: "0",
                        adverse_selection_indicator: null,
                        internalization_rate: "0",
                        compression_ratio: "0"
                    },
                    {
                        strategy_key: "strategy-1",
                        scope_type: "MARKET",
                        scope_id: "market-1",
                        stage: "CANARY",
                        engine_version: "eng-v1",
                        config_version: "cfg-v1",
                        market: "market-1",
                        venue_pair: "venue-a->venue-c",
                        evaluation_count: "1",
                        external_notional_total: "10",
                        internalized_notional_total: "0",
                        compression_notional_total: "0",
                        fee_savings_total: "0",
                        slippage_savings_total: "0",
                        fill_quality_delta: "0",
                        adverse_selection_indicator: null,
                        internalization_rate: "0",
                        compression_ratio: "0"
                    }
                ]
            }))
        };

        const rollup = new QualificationMetricsRollup(pool as never, config);

        await expect(rollup.get({ strategyKey: "strategy-1" })).rejects.toBeInstanceOf(QualificationMetricsRollupError);
    });

    it("refreshes the materialized view", async () => {
        const pool = {
            query: vi.fn(async () => ({ rows: [] }))
        };
        const rollup = new QualificationMetricsRollup(pool as never, config);

        await rollup.refresh();

        expect(pool.query).toHaveBeenCalledWith("REFRESH MATERIALIZED VIEW qualification_metrics_rollup");
    });
});
