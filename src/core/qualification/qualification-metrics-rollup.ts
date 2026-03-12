import Decimal from "decimal.js";
import type { Pool, QueryResult } from "pg";
import {
    qualificationRollupRefreshDurationMs,
    qualificationRollupRefreshTotal
} from "../../observability/metrics.js";

interface QualificationMetricsRollupRowRecord {
    strategy_key: string;
    scope_type: string;
    scope_id: string;
    stage: string;
    engine_version: string;
    config_version: string;
    market: string;
    venue_pair: string;
    evaluation_count: string | number;
    external_notional_total: string | null;
    internalized_notional_total: string | null;
    compression_notional_total: string | null;
    fee_savings_total: string | null;
    slippage_savings_total: string | null;
    fill_quality_delta: string | null;
    adverse_selection_indicator: string | null;
    internalization_rate: string | null;
    compression_ratio: string | null;
}

export interface PromotionReadinessMetricConfig {
    weight: number;
    max: string;
}

export interface PromotionReadinessScoreConfig {
    version: string;
    internalizationRate: PromotionReadinessMetricConfig;
    compressionRatio: PromotionReadinessMetricConfig;
    feeSavings: PromotionReadinessMetricConfig;
    slippageSavings: PromotionReadinessMetricConfig;
    fillQualityDelta: PromotionReadinessMetricConfig;
    adverseSelectionIndicator: PromotionReadinessMetricConfig;
}

export interface QualificationMetricsRollupConfig {
    promotionReadiness: PromotionReadinessScoreConfig;
}

export interface QualificationRollupFilters {
    strategyKey?: string;
    scopeType?: string;
    scopeId?: string;
    stage?: string;
    engineVersion?: string;
    configVersion?: string;
    market?: string;
    venuePair?: string;
}

export interface QualificationRollupRow {
    strategyKey: string;
    scopeType: string;
    scopeId: string;
    stage: string;
    engineVersion: string;
    configVersion: string;
    market: string;
    venuePair: string;
    evaluationCount: number;
    externalNotionalTotal: string;
    internalizedNotionalTotal: string;
    compressionNotionalTotal: string;
    feeSavings: string;
    slippageSavings: string;
    fillQualityDelta: string | null;
    adverseSelectionIndicator: string | null;
    internalizationRate: string | null;
    compressionRatio: string | null;
}

export interface PromotionReadinessComponent {
    metric: "internalizationRate" | "compressionRatio" | "feeSavings" | "slippageSavings" | "fillQualityDelta" | "adverseSelectionIndicator";
    observed: string | null;
    normalized: number;
    weightedContribution: number;
}

export interface QualificationRollupResult extends QualificationRollupRow {
    promotionReadinessScore: number;
    promotionReadinessScoreVersion: string;
    promotionReadinessComponents: readonly PromotionReadinessComponent[];
}

export class QualificationMetricsRollupError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "QualificationMetricsRollupError";
    }
}

const MATERIALIZED_VIEW_NAME = "qualification_metrics_rollup";

const decimalOrZero = (value: string | null) => new Decimal(value ?? "0");

const decimalToString = (value: string | null): string | null => (value === null ? null : new Decimal(value).toString());

const roundScore = (value: number): number => Math.round(value * 10000) / 10000;

const normalizePositiveMetric = (observed: ReturnType<typeof decimalOrZero>, config: PromotionReadinessMetricConfig): number => {
    const cap = new Decimal(config.max);
    if (cap.lte(0)) {
        throw new QualificationMetricsRollupError("Promotion readiness metric max must be greater than zero.");
    }
    if (observed.lte(0)) {
        return 0;
    }
    return Decimal.min(observed.dividedBy(cap), 1).toNumber();
};

const normalizePenaltyMetric = (observed: ReturnType<typeof decimalOrZero>, config: PromotionReadinessMetricConfig): number => {
    const cap = new Decimal(config.max);
    if (cap.lte(0)) {
        throw new QualificationMetricsRollupError("Promotion readiness metric max must be greater than zero.");
    }
    if (observed.lte(0)) {
        return 0;
    }
    return Decimal.min(observed.dividedBy(cap), 1).toNumber();
};

const mapRow = (row: QualificationMetricsRollupRowRecord): QualificationRollupRow => ({
    strategyKey: row.strategy_key,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    stage: row.stage,
    engineVersion: row.engine_version,
    configVersion: row.config_version,
    market: row.market,
    venuePair: row.venue_pair,
    evaluationCount: Number(row.evaluation_count),
    externalNotionalTotal: decimalOrZero(row.external_notional_total).toString(),
    internalizedNotionalTotal: decimalOrZero(row.internalized_notional_total).toString(),
    compressionNotionalTotal: decimalOrZero(row.compression_notional_total).toString(),
    feeSavings: decimalOrZero(row.fee_savings_total).toString(),
    slippageSavings: decimalOrZero(row.slippage_savings_total).toString(),
    fillQualityDelta: decimalToString(row.fill_quality_delta),
    adverseSelectionIndicator: decimalToString(row.adverse_selection_indicator),
    internalizationRate: decimalToString(row.internalization_rate),
    compressionRatio: decimalToString(row.compression_ratio)
});

const applyFilters = (filters: QualificationRollupFilters): { whereClause: string; values: string[] } => {
    const clauses: string[] = [];
    const values: string[] = [];

    const push = (column: string, value: string | undefined): void => {
        if (value === undefined) {
            return;
        }
        values.push(value);
        clauses.push(`${column} = $${values.length}`);
    };

    push("strategy_key", filters.strategyKey);
    push("scope_type", filters.scopeType);
    push("scope_id", filters.scopeId);
    push("stage", filters.stage);
    push("engine_version", filters.engineVersion);
    push("config_version", filters.configVersion);
    push("market", filters.market);
    push("venue_pair", filters.venuePair);

    return {
        whereClause: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
        values
    };
};

const scoreRollup = (
    row: QualificationRollupRow,
    config: QualificationMetricsRollupConfig
): Pick<QualificationRollupResult, "promotionReadinessScore" | "promotionReadinessScoreVersion" | "promotionReadinessComponents"> => {
    const readiness = config.promotionReadiness;
    const positiveMetrics = [
        {
            metric: "internalizationRate" as const,
            observed: row.internalizationRate,
            config: readiness.internalizationRate
        },
        {
            metric: "compressionRatio" as const,
            observed: row.compressionRatio,
            config: readiness.compressionRatio
        },
        {
            metric: "feeSavings" as const,
            observed: row.feeSavings,
            config: readiness.feeSavings
        },
        {
            metric: "slippageSavings" as const,
            observed: row.slippageSavings,
            config: readiness.slippageSavings
        },
        {
            metric: "fillQualityDelta" as const,
            observed: row.fillQualityDelta,
            config: readiness.fillQualityDelta
        }
    ];

    const components: PromotionReadinessComponent[] = positiveMetrics.map(({ metric, observed, config: metricConfig }) => {
        const normalized = normalizePositiveMetric(decimalOrZero(observed), metricConfig);
        return {
            metric,
            observed,
            normalized: roundScore(normalized),
            weightedContribution: roundScore(normalized * metricConfig.weight * 100)
        };
    });

    const adverseObserved = decimalOrZero(row.adverseSelectionIndicator);
    const adverseNormalized = normalizePenaltyMetric(adverseObserved, readiness.adverseSelectionIndicator);
    components.push({
        metric: "adverseSelectionIndicator",
        observed: row.adverseSelectionIndicator,
        normalized: roundScore(adverseNormalized),
        weightedContribution: roundScore(-adverseNormalized * readiness.adverseSelectionIndicator.weight * 100)
    });

    const rawScore = components.reduce((total, component) => total + component.weightedContribution, 0);
    const promotionReadinessScore = Math.min(100, Math.max(0, roundScore(rawScore)));

    return {
        promotionReadinessScore,
        promotionReadinessScoreVersion: readiness.version,
        promotionReadinessComponents: components
    };
};

export class QualificationMetricsRollup {
    private readonly pool: Pool;
    private readonly config: QualificationMetricsRollupConfig;

    public constructor(pool: Pool, config: QualificationMetricsRollupConfig) {
        this.pool = pool;
        this.config = config;
    }

    public async refresh(): Promise<void> {
        const stopTimer = qualificationRollupRefreshDurationMs.startTimer();
        try {
            await this.pool.query(`REFRESH MATERIALIZED VIEW ${MATERIALIZED_VIEW_NAME}`);
            qualificationRollupRefreshTotal.labels("success").inc();
        } catch (error) {
            qualificationRollupRefreshTotal.labels("error").inc();
            throw error;
        } finally {
            stopTimer();
        }
    }

    public async list(filters: QualificationRollupFilters = {}): Promise<QualificationRollupResult[]> {
        const { whereClause, values } = applyFilters(filters);
        const result: QueryResult<QualificationMetricsRollupRowRecord> = await this.pool.query(
            `SELECT
                strategy_key,
                scope_type,
                scope_id,
                stage,
                engine_version,
                config_version,
                market,
                venue_pair,
                evaluation_count,
                external_notional_total,
                internalized_notional_total,
                compression_notional_total,
                fee_savings_total,
                slippage_savings_total,
                fill_quality_delta,
                adverse_selection_indicator,
                internalization_rate,
                compression_ratio
             FROM ${MATERIALIZED_VIEW_NAME}
             ${whereClause}
             ORDER BY strategy_key ASC, scope_type ASC, scope_id ASC, stage ASC, market ASC, venue_pair ASC`,
            values
        );

        return result.rows.map((row) => {
            const mapped = mapRow(row);
            return {
                ...mapped,
                ...scoreRollup(mapped, this.config)
            };
        });
    }

    public async get(filters: QualificationRollupFilters): Promise<QualificationRollupResult | null> {
        const rows = await this.list(filters);
        if (rows.length === 0) {
            return null;
        }
        if (rows.length > 1) {
            throw new QualificationMetricsRollupError("Qualification rollup get() expected a single row but matched multiple rows.");
        }
        return rows[0] ?? null;
    }
}
