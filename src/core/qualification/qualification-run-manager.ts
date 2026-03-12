import type { Pool, QueryResult } from "pg";
import type { Logger } from "pino";

import {
    QualificationRunStatus,
    type CreateStrategyDecisionEvaluationInput,
    type StrategyDecisionEvaluation,
    type StrategyQualificationRun,
    type QualificationStage
} from "./qualification.types.js";

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

export class QualificationRunNotFoundError extends Error {
    public constructor(runId: string) {
        super(`Qualification run ${runId} not found.`);
        this.name = "QualificationRunNotFoundError";
    }
}

export class QualificationRunTransitionError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "QualificationRunTransitionError";
    }
}

export class QualificationDecisionEvaluationError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "QualificationDecisionEvaluationError";
    }
}

export interface QualificationRunManagerDeps {
    pool: Pool;
    logger?: Pick<Logger, "info" | "warn" | "error">;
}

const TERMINAL_STATUSES = new Set<QualificationRunStatus>([
    QualificationRunStatus.SUCCEEDED,
    QualificationRunStatus.FAILED,
    QualificationRunStatus.CANCELLED
]);

const ACTIVE_STATUSES = [QualificationRunStatus.PENDING, QualificationRunStatus.RUNNING] as const;

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

const ensureNonEmptyString = (value: string, fieldName: string): void => {
    if (value.trim().length === 0) {
        throw new QualificationDecisionEvaluationError(`${fieldName} must be a non-empty string.`);
    }
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};

export class QualificationRunManager {
    private readonly pool: Pool;
    private readonly logger: Pick<Logger, "info" | "warn" | "error"> | undefined;

    public constructor(deps: QualificationRunManagerDeps) {
        this.pool = deps.pool;
        this.logger = deps.logger;
    }

    public async createRun(
        strategyKey: string,
        scopeType: string,
        scopeId: string,
        stage: QualificationStage,
        engineVersion: string,
        configVersion: string
    ): Promise<StrategyQualificationRun> {
        ensureNonEmptyString(strategyKey, "strategyKey");
        ensureNonEmptyString(scopeType, "scopeType");
        ensureNonEmptyString(scopeId, "scopeId");
        ensureNonEmptyString(stage, "stage");
        ensureNonEmptyString(engineVersion, "engineVersion");
        ensureNonEmptyString(configVersion, "configVersion");

        const result: QueryResult<StrategyQualificationRunRow> = await this.pool.query(
            `INSERT INTO strategy_qualification_runs
                (strategy_key, scope_type, scope_id, stage, engine_version, config_version, status, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, '{}'::jsonb)
             RETURNING
                id,
                strategy_key,
                scope_type,
                scope_id,
                stage,
                engine_version,
                config_version,
                started_at,
                ended_at,
                status,
                metadata`,
            [
                strategyKey,
                scopeType,
                scopeId,
                stage,
                engineVersion,
                configVersion,
                QualificationRunStatus.RUNNING
            ]
        );

        const row = result.rows[0];
        if (!row) {
            throw new QualificationRunTransitionError("Failed to create qualification run.");
        }

        this.logger?.info?.(
            {
                runId: row.id,
                strategyKey,
                scopeType,
                scopeId,
                stage,
                engineVersion,
                configVersion
            },
            "Created qualification run."
        );

        return mapStrategyQualificationRunRow(row);
    }

    public async closeRun(runId: string, status: QualificationRunStatus): Promise<StrategyQualificationRun> {
        ensureNonEmptyString(runId, "runId");

        if (!TERMINAL_STATUSES.has(status)) {
            throw new QualificationRunTransitionError(`Cannot close run with non-terminal status ${status}.`);
        }

        const current = await this.getRun(runId);
        if (current.endedAt !== null) {
            throw new QualificationRunTransitionError(`Qualification run ${runId} is already closed.`);
        }

        const result: QueryResult<StrategyQualificationRunRow> = await this.pool.query(
            `UPDATE strategy_qualification_runs
             SET status = $2,
                 ended_at = NOW()
             WHERE id = $1
             RETURNING
                id,
                strategy_key,
                scope_type,
                scope_id,
                stage,
                engine_version,
                config_version,
                started_at,
                ended_at,
                status,
                metadata`,
            [runId, status]
        );

        const row = result.rows[0];
        if (!row) {
            throw new QualificationRunNotFoundError(runId);
        }

        this.logger?.info?.({ runId, status }, "Closed qualification run.");

        return mapStrategyQualificationRunRow(row);
    }

    public async recordDecisionEvaluation(
        runId: string,
        evaluation: Omit<CreateStrategyDecisionEvaluationInput, "qualificationRunId">
    ): Promise<StrategyDecisionEvaluation> {
        ensureNonEmptyString(runId, "runId");
        ensureNonEmptyString(evaluation.decisionType, "decisionType");
        ensureNonEmptyString(evaluation.entityId, "entityId");

        if (!isPlainObject(evaluation.realizedMetrics)) {
            throw new QualificationDecisionEvaluationError("realizedMetrics must be a plain object.");
        }
        if (!isPlainObject(evaluation.counterfactualMetrics)) {
            throw new QualificationDecisionEvaluationError("counterfactualMetrics must be a plain object.");
        }
        if (!isPlainObject(evaluation.improvementMetrics)) {
            throw new QualificationDecisionEvaluationError("improvementMetrics must be a plain object.");
        }

        await this.getRun(runId);

        const result: QueryResult<StrategyDecisionEvaluationRow> = await this.pool.query(
            `INSERT INTO strategy_decision_evaluations
                (qualification_run_id, decision_type, entity_id, replay_envelope_id, realized_metrics, counterfactual_metrics, improvement_metrics)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
             RETURNING
                id,
                qualification_run_id,
                decision_type,
                entity_id,
                replay_envelope_id,
                realized_metrics,
                counterfactual_metrics,
                improvement_metrics,
                created_at`,
            [
                runId,
                evaluation.decisionType,
                evaluation.entityId,
                evaluation.replayEnvelopeId ?? null,
                JSON.stringify(evaluation.realizedMetrics),
                JSON.stringify(evaluation.counterfactualMetrics),
                JSON.stringify(evaluation.improvementMetrics)
            ]
        );

        const row = result.rows[0];
        if (!row) {
            throw new QualificationDecisionEvaluationError("Failed to persist strategy decision evaluation.");
        }

        return mapStrategyDecisionEvaluationRow(row);
    }

    public async listActiveRuns(): Promise<StrategyQualificationRun[]> {
        const result: QueryResult<StrategyQualificationRunRow> = await this.pool.query(
            `SELECT
                id,
                strategy_key,
                scope_type,
                scope_id,
                stage,
                engine_version,
                config_version,
                started_at,
                ended_at,
                status,
                metadata
             FROM strategy_qualification_runs
             WHERE ended_at IS NULL
               AND status = ANY($1::text[])
             ORDER BY started_at ASC, id ASC`,
            [ACTIVE_STATUSES]
        );

        return result.rows.map(mapStrategyQualificationRunRow);
    }

    public async findActiveRunsByStrategyScope(
        strategyKey: string,
        scopeType: string,
        scopeId: string
    ): Promise<StrategyQualificationRun[]> {
        ensureNonEmptyString(strategyKey, "strategyKey");
        ensureNonEmptyString(scopeType, "scopeType");
        ensureNonEmptyString(scopeId, "scopeId");

        const result: QueryResult<StrategyQualificationRunRow> = await this.pool.query(
            `SELECT
                id,
                strategy_key,
                scope_type,
                scope_id,
                stage,
                engine_version,
                config_version,
                started_at,
                ended_at,
                status,
                metadata
             FROM strategy_qualification_runs
             WHERE strategy_key = $1
               AND scope_type = $2
               AND scope_id = $3
               AND ended_at IS NULL
               AND status = ANY($4::text[])
             ORDER BY started_at ASC, id ASC`,
            [strategyKey, scopeType, scopeId, ACTIVE_STATUSES]
        );

        return result.rows.map(mapStrategyQualificationRunRow);
    }

    private async getRun(runId: string): Promise<StrategyQualificationRun> {
        const result: QueryResult<StrategyQualificationRunRow> = await this.pool.query(
            `SELECT
                id,
                strategy_key,
                scope_type,
                scope_id,
                stage,
                engine_version,
                config_version,
                started_at,
                ended_at,
                status,
                metadata
             FROM strategy_qualification_runs
             WHERE id = $1
             LIMIT 1`,
            [runId]
        );

        const row = result.rows[0];
        if (!row) {
            throw new QualificationRunNotFoundError(runId);
        }

        return mapStrategyQualificationRunRow(row);
    }
}
