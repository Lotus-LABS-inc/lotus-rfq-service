import type { Pool } from "pg";
import type { Logger } from "pino";
import { promotionGateFailTotal } from "../../observability/metrics.js";

import {
    PromotionGateEvaluator,
    type PromotionGateConfig,
    type PromotionGateEvaluationInput,
    type PromotionGateEvaluationResult,
    type ReconciliationHealthSignals,
    type ReplayStabilitySignals,
    type PlannerLatencySignals,
    type IncidentCountSignals,
    type AdverseSelectionSignals
} from "../../core/qualification/promotion-gate-evaluator.js";
import {
    QualificationRunStatus,
    QualificationStage,
    type PromotionEvent,
    type StrategyDecisionEvaluation,
    type StrategyQualificationRun
} from "../../core/qualification/qualification.types.js";

interface StrategyQualificationRunRow {
    id: string;
    strategy_key: string;
    scope_type: string;
    scope_id: string;
    stage: string;
    engine_version: string;
    config_version: string;
    started_at: Date;
    ended_at: Date | null;
    status: string;
    metadata: Record<string, unknown>;
}

interface StrategyDecisionEvaluationRow {
    id: string;
    qualification_run_id: string;
    decision_type: string;
    entity_id: string;
    replay_envelope_id: string | null;
    realized_metrics: Record<string, unknown>;
    counterfactual_metrics: Record<string, unknown>;
    improvement_metrics: Record<string, unknown>;
    created_at: Date;
}

interface PromotionEventRow {
    id: string;
    strategy_key: string;
    scope_type: string;
    scope_id: string;
    from_stage: string;
    to_stage: string;
    reason: string;
    created_by: string;
    created_at: Date;
    metadata: Record<string, unknown>;
}

export interface QualificationRunListFilters {
    stage?: QualificationStage;
    status?: QualificationRunStatus;
    scopeType?: string;
    scopeId?: string;
}

export interface QualificationMetricAggregate {
    count: number;
    numericTotals: Record<string, string>;
}

export interface QualificationRunEvaluationSummary {
    evaluationCount: number;
    countsByDecisionType: Record<string, number>;
    realized: QualificationMetricAggregate;
    counterfactual: QualificationMetricAggregate;
    improvement: QualificationMetricAggregate;
}

export interface QualificationRunDetail {
    run: StrategyQualificationRun;
    summary: QualificationRunEvaluationSummary;
    historicalSimulationSummary: Record<string, unknown> | null;
}

export interface PromoteRunResult {
    run: StrategyQualificationRun;
    gateResult: PromotionGateEvaluationResult;
    promotionEvent: PromotionEvent;
}

export interface DemoteRunResult {
    run: StrategyQualificationRun;
    promotionEvent: PromotionEvent;
}

export interface PauseRunResult {
    run: StrategyQualificationRun;
}

export class QualificationRunNotFoundAdminError extends Error {
    public constructor(runId: string) {
        super(`Qualification run ${runId} not found.`);
        this.name = "QualificationRunNotFoundAdminError";
    }
}

export class QualificationRunAdminTransitionError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "QualificationRunAdminTransitionError";
    }
}

export class QualificationPromotionGateBlockedError extends Error {
    public readonly gateResult: PromotionGateEvaluationResult;

    public constructor(gateResult: PromotionGateEvaluationResult) {
        super("Promotion gate evaluation blocked promotion.");
        this.name = "QualificationPromotionGateBlockedError";
        this.gateResult = gateResult;
    }
}

export class QualificationEvidenceInsufficientError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "QualificationEvidenceInsufficientError";
    }
}

export interface QualificationAdminServiceDeps {
    pool: Pool;
    promotionGateEvaluator: PromotionGateEvaluator;
    logger?: Pick<Logger, "info" | "warn" | "error">;
}

const STAGE_ORDER: readonly QualificationStage[] = [
    QualificationStage.INTERNAL_ONLY,
    QualificationStage.SHADOW,
    QualificationStage.CANARY,
    QualificationStage.LIMITED_PROD,
    QualificationStage.BROAD_PROD
] as const;

const NUMERIC_SUMMARY_KEYS = [
    "realizedFillPrice",
    "realizedEffectiveCost",
    "realizedSlippage",
    "realizedFees",
    "partialFillRatio",
    "externalNotional",
    "internalizedNotional",
    "compressionNotional",
    "priceImprovement",
    "slippageSaved",
    "feeSaved",
    "externalNotionalAvoided",
    "internalizationGain",
    "compressionGain"
] as const;

const mapStrategyQualificationRunRow = (row: StrategyQualificationRunRow): StrategyQualificationRun => ({
    id: row.id,
    strategyKey: row.strategy_key,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    stage: row.stage as QualificationStage,
    engineVersion: row.engine_version,
    configVersion: row.config_version,
    startedAt: new Date(row.started_at),
    endedAt: row.ended_at ? new Date(row.ended_at) : null,
    status: row.status as QualificationRunStatus,
    metadata: row.metadata
});

const mapStrategyDecisionEvaluationRow = (row: StrategyDecisionEvaluationRow): StrategyDecisionEvaluation => ({
    id: row.id,
    qualificationRunId: row.qualification_run_id,
    decisionType: row.decision_type,
    entityId: row.entity_id,
    replayEnvelopeId: row.replay_envelope_id,
    realizedMetrics: row.realized_metrics,
    counterfactualMetrics: row.counterfactual_metrics,
    improvementMetrics: row.improvement_metrics,
    createdAt: new Date(row.created_at)
});

const mapPromotionEventRow = (row: PromotionEventRow): PromotionEvent => ({
    id: row.id,
    strategyKey: row.strategy_key,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    fromStage: row.from_stage as QualificationStage,
    toStage: row.to_stage as QualificationStage,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    metadata: row.metadata
});

const ensureNonEmptyString = (value: string, fieldName: string): void => {
    if (value.trim().length === 0) {
        throw new QualificationRunAdminTransitionError(`${fieldName} must be a non-empty string.`);
    }
};

const nextStageFor = (stage: QualificationStage): QualificationStage | undefined => {
    const index = STAGE_ORDER.indexOf(stage);
    if (index === -1 || index === STAGE_ORDER.length - 1) {
        return undefined;
    }
    return STAGE_ORDER[index + 1];
};

const isLowerStage = (currentStage: QualificationStage, targetStage: QualificationStage): boolean => {
    const currentIndex = STAGE_ORDER.indexOf(currentStage);
    const targetIndex = STAGE_ORDER.indexOf(targetStage);
    return currentIndex !== -1 && targetIndex !== -1 && targetIndex < currentIndex;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const asFiniteNumber = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
};

const buildMetricAggregate = (rows: readonly StrategyDecisionEvaluation[], key: "realizedMetrics" | "counterfactualMetrics" | "improvementMetrics"): QualificationMetricAggregate => {
    const totals = new Map<string, number>();

    for (const row of rows) {
        const payload = row[key];
        for (const metricKey of NUMERIC_SUMMARY_KEYS) {
            const parsed = asFiniteNumber(payload[metricKey]);
            if (parsed === null) {
                continue;
            }
            totals.set(metricKey, (totals.get(metricKey) ?? 0) + parsed);
        }
    }

    return {
        count: rows.length,
        numericTotals: Object.fromEntries(
            [...totals.entries()]
                .sort((left, right) => left[0].localeCompare(right[0]))
                .map(([metricKey, total]) => [metricKey, total.toString()])
        )
    };
};

export const createDefaultPromotionGateConfig = (): PromotionGateConfig => ({
    version: "phase3b-promotion-v1",
    transitions: {
        INTERNAL_ONLY_TO_SHADOW: {
            fromStage: QualificationStage.INTERNAL_ONLY,
            toStage: QualificationStage.SHADOW,
            replayStability: { minMatchRate: 0.99, maxDiffRate: 0.01, maxErrorRate: 0.001, minConsecutiveStableRuns: 5 },
            reconciliationHealth: { maxMismatchCount: 0, maxMismatchRate: 0, maxInfraErrorCount: 0, maxLockConflictCount: 0 },
            plannerLatency: { maxP95Ms: 200, maxP99Ms: 300 },
            economicQuality: {
                minPriceImprovement: "0",
                minSlippageSaved: "0",
                minFeeSaved: "0",
                minExternalNotionalAvoided: "0",
                minInternalizationGain: "0",
                minCompressionGain: "0"
            },
            incidentCount: { maxIncidents: 0, maxUnresolvedIncidents: 0 },
            adverseSelection: { maxAdverseFillRate: 0.05, maxPostTradeMarkoutLoss: "0.10", maxLossRate: 0.05 }
        },
        SHADOW_TO_CANARY: {
            fromStage: QualificationStage.SHADOW,
            toStage: QualificationStage.CANARY,
            replayStability: { minMatchRate: 0.995, maxDiffRate: 0.005, maxErrorRate: 0.0005, minConsecutiveStableRuns: 10 },
            reconciliationHealth: { maxMismatchCount: 0, maxMismatchRate: 0, maxInfraErrorCount: 0, maxLockConflictCount: 0 },
            plannerLatency: { maxP95Ms: 150, maxP99Ms: 250 },
            economicQuality: {
                minPriceImprovement: "0.01",
                minSlippageSaved: "0.01",
                minFeeSaved: "0.01",
                minExternalNotionalAvoided: "1",
                minInternalizationGain: "1",
                minCompressionGain: "0.5"
            },
            incidentCount: { maxIncidents: 0, maxUnresolvedIncidents: 0 },
            adverseSelection: { maxAdverseFillRate: 0.04, maxPostTradeMarkoutLoss: "0.05", maxLossRate: 0.03 }
        },
        CANARY_TO_LIMITED_PROD: {
            fromStage: QualificationStage.CANARY,
            toStage: QualificationStage.LIMITED_PROD,
            replayStability: { minMatchRate: 0.997, maxDiffRate: 0.003, maxErrorRate: 0.0005, minConsecutiveStableRuns: 20 },
            reconciliationHealth: { maxMismatchCount: 0, maxMismatchRate: 0, maxInfraErrorCount: 0, maxLockConflictCount: 0 },
            plannerLatency: { maxP95Ms: 140, maxP99Ms: 220 },
            economicQuality: {
                minPriceImprovement: "0.02",
                minSlippageSaved: "0.02",
                minFeeSaved: "0.01",
                minExternalNotionalAvoided: "2",
                minInternalizationGain: "2",
                minCompressionGain: "1"
            },
            incidentCount: { maxIncidents: 0, maxUnresolvedIncidents: 0 },
            adverseSelection: { maxAdverseFillRate: 0.03, maxPostTradeMarkoutLoss: "0.04", maxLossRate: 0.02 }
        },
        LIMITED_PROD_TO_BROAD_PROD: {
            fromStage: QualificationStage.LIMITED_PROD,
            toStage: QualificationStage.BROAD_PROD,
            replayStability: { minMatchRate: 0.999, maxDiffRate: 0.001, maxErrorRate: 0.0001, minConsecutiveStableRuns: 30 },
            reconciliationHealth: { maxMismatchCount: 0, maxMismatchRate: 0, maxInfraErrorCount: 0, maxLockConflictCount: 0 },
            plannerLatency: { maxP95Ms: 120, maxP99Ms: 200 },
            economicQuality: {
                minPriceImprovement: "0.03",
                minSlippageSaved: "0.03",
                minFeeSaved: "0.02",
                minExternalNotionalAvoided: "3",
                minInternalizationGain: "3",
                minCompressionGain: "1.5"
            },
            incidentCount: { maxIncidents: 0, maxUnresolvedIncidents: 0 },
            adverseSelection: { maxAdverseFillRate: 0.02, maxPostTradeMarkoutLoss: "0.03", maxLossRate: 0.01 }
        }
    }
});

export class QualificationAdminService {
    private readonly pool: Pool;
    private readonly promotionGateEvaluator: PromotionGateEvaluator;
    private readonly logger: Pick<Logger, "info" | "warn" | "error"> | undefined;

    public constructor(deps: QualificationAdminServiceDeps) {
        this.pool = deps.pool;
        this.promotionGateEvaluator = deps.promotionGateEvaluator;
        this.logger = deps.logger;
    }

    public async listRuns(filters: QualificationRunListFilters): Promise<StrategyQualificationRun[]> {
        const clauses: string[] = [];
        const values: string[] = [];

        if (filters.stage) {
            values.push(filters.stage);
            clauses.push(`stage = $${values.length}`);
        }
        if (filters.status) {
            values.push(filters.status);
            clauses.push(`status = $${values.length}`);
        }
        if (filters.scopeType) {
            values.push(filters.scopeType);
            clauses.push(`scope_type = $${values.length}`);
        }
        if (filters.scopeId) {
            values.push(filters.scopeId);
            clauses.push(`scope_id = $${values.length}`);
        }

        const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
        const result = await this.pool.query<StrategyQualificationRunRow>(
            `SELECT id, strategy_key, scope_type, scope_id, stage, engine_version, config_version, started_at, ended_at, status, metadata
             FROM strategy_qualification_runs
             ${whereClause}
             ORDER BY started_at DESC, id DESC`,
            values
        );

        return result.rows.map(mapStrategyQualificationRunRow);
    }

    public async getRun(runId: string): Promise<StrategyQualificationRun> {
        const result = await this.pool.query<StrategyQualificationRunRow>(
            `SELECT id, strategy_key, scope_type, scope_id, stage, engine_version, config_version, started_at, ended_at, status, metadata
             FROM strategy_qualification_runs
             WHERE id = $1
             LIMIT 1`,
            [runId]
        );
        const row = result.rows[0];
        if (!row) {
            throw new QualificationRunNotFoundAdminError(runId);
        }
        return mapStrategyQualificationRunRow(row);
    }

    public async listEvaluations(runId: string): Promise<StrategyDecisionEvaluation[]> {
        await this.getRun(runId);
        const result = await this.pool.query<StrategyDecisionEvaluationRow>(
            `SELECT id, qualification_run_id, decision_type, entity_id, replay_envelope_id, realized_metrics, counterfactual_metrics, improvement_metrics, created_at
             FROM strategy_decision_evaluations
             WHERE qualification_run_id = $1
             ORDER BY created_at DESC, id DESC`,
            [runId]
        );
        return result.rows.map(mapStrategyDecisionEvaluationRow);
    }

    public async getRunDetail(runId: string): Promise<QualificationRunDetail> {
        const [run, evaluations] = await Promise.all([this.getRun(runId), this.listEvaluations(runId)]);
        const countsByDecisionType = evaluations.reduce<Record<string, number>>((acc, evaluation) => {
            acc[evaluation.decisionType] = (acc[evaluation.decisionType] ?? 0) + 1;
            return acc;
        }, {});

        return {
            run,
            summary: {
                evaluationCount: evaluations.length,
                countsByDecisionType: Object.fromEntries(
                    Object.entries(countsByDecisionType).sort((left, right) => left[0].localeCompare(right[0]))
                ),
                realized: buildMetricAggregate(evaluations, "realizedMetrics"),
                counterfactual: buildMetricAggregate(evaluations, "counterfactualMetrics"),
                improvement: buildMetricAggregate(evaluations, "improvementMetrics")
            },
            historicalSimulationSummary: isPlainRecord(run.metadata.historicalSimulationEvidence)
                ? run.metadata.historicalSimulationEvidence
                : null
        };
    }

    public async promoteRun(runId: string, createdBy: string): Promise<PromoteRunResult> {
        ensureNonEmptyString(createdBy, "createdBy");
        const detail = await this.getRunDetail(runId);
        if (detail.run.status !== QualificationRunStatus.RUNNING && detail.run.status !== QualificationRunStatus.PAUSED) {
            throw new QualificationRunAdminTransitionError(`Run ${runId} is not promotable in status ${detail.run.status}.`);
        }

        const gateInput = this.buildPromotionGateInput(detail);
        const gateResult = this.promotionGateEvaluator.evaluate(gateInput);
        if (!gateResult.promotable || !gateResult.recommendedStage) {
            for (const failedGate of gateResult.failedGates) {
                promotionGateFailTotal.labels(detail.run.stage, failedGate.gate).inc();
            }
            throw new QualificationPromotionGateBlockedError(gateResult);
        }

        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const updatedRunResult = await client.query<StrategyQualificationRunRow>(
                `UPDATE strategy_qualification_runs
                 SET stage = $2
                 WHERE id = $1
                 RETURNING id, strategy_key, scope_type, scope_id, stage, engine_version, config_version, started_at, ended_at, status, metadata`,
                [runId, gateResult.recommendedStage]
            );
            const updatedRunRow = updatedRunResult.rows[0];
            if (!updatedRunRow) {
                throw new QualificationRunNotFoundAdminError(runId);
            }

            const promotionEventResult = await client.query<PromotionEventRow>(
                `INSERT INTO strategy_promotion_events (strategy_key, scope_type, scope_id, from_stage, to_stage, reason, created_by, metadata)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
                 RETURNING id, strategy_key, scope_type, scope_id, from_stage, to_stage, reason, created_by, created_at, metadata`,
                [
                    detail.run.strategyKey,
                    detail.run.scopeType,
                    detail.run.scopeId,
                    detail.run.stage,
                    gateResult.recommendedStage,
                    "promotion_gate_passed",
                    createdBy,
                    JSON.stringify({ gateResult })
                ]
            );

            await client.query("COMMIT");
            const run = mapStrategyQualificationRunRow(updatedRunRow);
            const promotionEvent = mapPromotionEventRow(promotionEventResult.rows[0]!);
            this.logger?.info?.({ runId, fromStage: detail.run.stage, toStage: run.stage, createdBy }, "Promoted qualification run.");
            return { run, gateResult, promotionEvent };
        } catch (error) {
            await client.query("ROLLBACK").catch(() => undefined);
            throw error;
        } finally {
            client.release();
        }
    }

    public async demoteRun(runId: string, targetStage: QualificationStage, reason: string, createdBy: string): Promise<DemoteRunResult> {
        ensureNonEmptyString(reason, "reason");
        ensureNonEmptyString(createdBy, "createdBy");
        const run = await this.getRun(runId);
        if (!isLowerStage(run.stage, targetStage)) {
            throw new QualificationRunAdminTransitionError(`Cannot demote run ${runId} from ${run.stage} to ${targetStage}.`);
        }

        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const updatedRunResult = await client.query<StrategyQualificationRunRow>(
                `UPDATE strategy_qualification_runs
                 SET stage = $2
                 WHERE id = $1
                 RETURNING id, strategy_key, scope_type, scope_id, stage, engine_version, config_version, started_at, ended_at, status, metadata`,
                [runId, targetStage]
            );
            const updatedRunRow = updatedRunResult.rows[0];
            if (!updatedRunRow) {
                throw new QualificationRunNotFoundAdminError(runId);
            }

            const promotionEventResult = await client.query<PromotionEventRow>(
                `INSERT INTO strategy_promotion_events (strategy_key, scope_type, scope_id, from_stage, to_stage, reason, created_by, metadata)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
                 RETURNING id, strategy_key, scope_type, scope_id, from_stage, to_stage, reason, created_by, created_at, metadata`,
                [
                    run.strategyKey,
                    run.scopeType,
                    run.scopeId,
                    run.stage,
                    targetStage,
                    reason,
                    createdBy,
                    JSON.stringify({ reason, action: "demote" })
                ]
            );

            await client.query("COMMIT");
            return {
                run: mapStrategyQualificationRunRow(updatedRunRow),
                promotionEvent: mapPromotionEventRow(promotionEventResult.rows[0]!)
            };
        } catch (error) {
            await client.query("ROLLBACK").catch(() => undefined);
            throw error;
        } finally {
            client.release();
        }
    }

    public async pauseRun(runId: string, _reason: string | null, _createdBy: string): Promise<PauseRunResult> {
        const run = await this.getRun(runId);
        if (run.status === QualificationRunStatus.PAUSED) {
            return { run };
        }
        if (run.status === QualificationRunStatus.SUCCEEDED || run.status === QualificationRunStatus.FAILED || run.status === QualificationRunStatus.CANCELLED) {
            throw new QualificationRunAdminTransitionError(`Cannot pause terminal run ${runId}.`);
        }

        const result = await this.pool.query<StrategyQualificationRunRow>(
            `UPDATE strategy_qualification_runs
             SET status = $2
             WHERE id = $1
             RETURNING id, strategy_key, scope_type, scope_id, stage, engine_version, config_version, started_at, ended_at, status, metadata`,
            [runId, QualificationRunStatus.PAUSED]
        );
        const row = result.rows[0];
        if (!row) {
            throw new QualificationRunNotFoundAdminError(runId);
        }
        return { run: mapStrategyQualificationRunRow(row) };
    }

    private buildPromotionGateInput(detail: QualificationRunDetail): PromotionGateEvaluationInput {
        const metadata = detail.run.metadata;
        const promotionGateSignals = metadata.promotionGateSignals;
        if (!isPlainRecord(promotionGateSignals)) {
            throw new QualificationEvidenceInsufficientError("Run metadata is missing promotionGateSignals.");
        }

        const replayStability = promotionGateSignals.replayStability;
        const reconciliationHealth = promotionGateSignals.reconciliationHealth;
        const plannerLatency = promotionGateSignals.plannerLatency;
        const incidentCount = promotionGateSignals.incidentCount;
        const adverseSelection = promotionGateSignals.adverseSelection;

        if (!isPlainRecord(replayStability) || !isPlainRecord(reconciliationHealth) || !isPlainRecord(plannerLatency) || !isPlainRecord(incidentCount) || !isPlainRecord(adverseSelection)) {
            throw new QualificationEvidenceInsufficientError("Run metadata promotionGateSignals is incomplete.");
        }

        const economicQuality = detail.summary.improvement.numericTotals;
        const requiredEconomicKeys = [
            "priceImprovement",
            "slippageSaved",
            "feeSaved",
            "externalNotionalAvoided",
            "internalizationGain",
            "compressionGain"
        ] as const;
        for (const key of requiredEconomicKeys) {
            if (typeof economicQuality[key] !== "string") {
                throw new QualificationEvidenceInsufficientError(`Evaluation summary is missing economic quality metric ${key}.`);
            }
        }

        const {
            priceImprovement,
            slippageSaved,
            feeSaved,
            externalNotionalAvoided,
            internalizationGain,
            compressionGain
        } = economicQuality as Record<(typeof requiredEconomicKeys)[number], string>;

        return {
            strategyKey: detail.run.strategyKey,
            scopeType: detail.run.scopeType,
            scopeId: detail.run.scopeId,
            currentStage: detail.run.stage,
            qualificationRunId: detail.run.id,
            replayStability: replayStability as unknown as ReplayStabilitySignals,
            reconciliationHealth: reconciliationHealth as unknown as ReconciliationHealthSignals,
            plannerLatency: plannerLatency as unknown as PlannerLatencySignals,
            economicQuality: {
                priceImprovement,
                slippageSaved,
                feeSaved,
                externalNotionalAvoided,
                internalizationGain,
                compressionGain
            },
            incidentCount: incidentCount as unknown as IncidentCountSignals,
            adverseSelection: adverseSelection as unknown as AdverseSelectionSignals,
            metadata: {
                evaluationCount: detail.summary.evaluationCount,
                countsByDecisionType: detail.summary.countsByDecisionType
            }
        };
    }
}
