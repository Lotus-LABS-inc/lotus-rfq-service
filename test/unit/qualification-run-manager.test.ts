import { describe, expect, it, vi } from "vitest";
import type { Pool, QueryResult, QueryResultRow } from "pg";

import {
    QualificationRunManager,
    QualificationDecisionEvaluationError,
    QualificationRunNotFoundError,
    QualificationRunTransitionError
} from "../../src/core/qualification/qualification-run-manager.js";
import { QualificationRunStatus, QualificationStage } from "../../src/core/qualification/qualification.types.js";

const makeQueryResult = <T extends QueryResultRow>(rows: T[]): QueryResult<T> => ({
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows
});

describe("QualificationRunManager", () => {
    it("creates a run with RUNNING status and null endedAt", async () => {
        const query = vi.fn(async () =>
            makeQueryResult([
                {
                    id: "run-1",
                    strategy_key: "phase3b.sor",
                    scope_type: "bucket",
                    scope_id: "bucket-1",
                    stage: "CANARY",
                    engine_version: "eng-v1",
                    config_version: "cfg-v1",
                    started_at: new Date("2026-03-12T11:00:00.000Z"),
                    ended_at: null,
                    status: "RUNNING",
                    metadata: {}
                }
            ])
        );

        const manager = new QualificationRunManager({ pool: { query } as unknown as Pool });
        const run = await manager.createRun(
            "phase3b.sor",
            "bucket",
            "bucket-1",
            QualificationStage.CANARY,
            "eng-v1",
            "cfg-v1"
        );

        expect(run.status).toBe(QualificationRunStatus.RUNNING);
        expect(run.endedAt).toBeNull();
        expect(run.stage).toBe(QualificationStage.CANARY);
    });

    it("closes a run with a terminal status", async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce(
                makeQueryResult([
                    {
                        id: "run-1",
                        strategy_key: "phase3b.sor",
                        scope_type: "bucket",
                        scope_id: "bucket-1",
                        stage: "SHADOW",
                        engine_version: "eng-v1",
                        config_version: "cfg-v1",
                        started_at: new Date("2026-03-12T11:00:00.000Z"),
                        ended_at: null,
                        status: "RUNNING",
                        metadata: {}
                    }
                ])
            )
            .mockResolvedValueOnce(
                makeQueryResult([
                    {
                        id: "run-1",
                        strategy_key: "phase3b.sor",
                        scope_type: "bucket",
                        scope_id: "bucket-1",
                        stage: "SHADOW",
                        engine_version: "eng-v1",
                        config_version: "cfg-v1",
                        started_at: new Date("2026-03-12T11:00:00.000Z"),
                        ended_at: new Date("2026-03-12T11:30:00.000Z"),
                        status: "SUCCEEDED",
                        metadata: {}
                    }
                ])
            );

        const manager = new QualificationRunManager({ pool: { query } as unknown as Pool });
        const run = await manager.closeRun("run-1", QualificationRunStatus.SUCCEEDED);

        expect(run.status).toBe(QualificationRunStatus.SUCCEEDED);
        expect(run.endedAt).not.toBeNull();
    });

    it("rejects closing a run with a non-terminal status", async () => {
        const manager = new QualificationRunManager({ pool: { query: vi.fn() } as unknown as Pool });

        await expect(manager.closeRun("run-1", QualificationRunStatus.RUNNING)).rejects.toBeInstanceOf(
            QualificationRunTransitionError
        );
    });

    it("rejects closing an already-ended run", async () => {
        const query = vi.fn(async () =>
            makeQueryResult([
                {
                    id: "run-1",
                    strategy_key: "phase3b.sor",
                    scope_type: "bucket",
                    scope_id: "bucket-1",
                    stage: "SHADOW",
                    engine_version: "eng-v1",
                    config_version: "cfg-v1",
                    started_at: new Date("2026-03-12T11:00:00.000Z"),
                    ended_at: new Date("2026-03-12T11:30:00.000Z"),
                    status: "FAILED",
                    metadata: {}
                }
            ])
        );

        const manager = new QualificationRunManager({ pool: { query } as unknown as Pool });

        await expect(manager.closeRun("run-1", QualificationRunStatus.FAILED)).rejects.toBeInstanceOf(
            QualificationRunTransitionError
        );
    });

    it("persists a strategy decision evaluation", async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce(
                makeQueryResult([
                    {
                        id: "run-1",
                        strategy_key: "phase3b.sor",
                        scope_type: "bucket",
                        scope_id: "bucket-1",
                        stage: "CANARY",
                        engine_version: "eng-v1",
                        config_version: "cfg-v1",
                        started_at: new Date("2026-03-12T11:00:00.000Z"),
                        ended_at: null,
                        status: "RUNNING",
                        metadata: {}
                    }
                ])
            )
            .mockResolvedValueOnce(
                makeQueryResult([
                    {
                        id: "evaluation-1",
                        qualification_run_id: "run-1",
                        decision_type: "SOR_PLAN",
                        entity_id: "rfq-1",
                        replay_envelope_id: "env-1",
                        realized_metrics: { fillRate: "0.91" },
                        counterfactual_metrics: { fillRate: "0.89" },
                        improvement_metrics: { liftBps: "2.0" },
                        created_at: new Date("2026-03-12T11:05:00.000Z")
                    }
                ])
            );

        const manager = new QualificationRunManager({ pool: { query } as unknown as Pool });
        const evaluation = await manager.recordDecisionEvaluation("run-1", {
            decisionType: "SOR_PLAN",
            entityId: "rfq-1",
            replayEnvelopeId: "env-1",
            realizedMetrics: { fillRate: "0.91" },
            counterfactualMetrics: { fillRate: "0.89" },
            improvementMetrics: { liftBps: "2.0" }
        });

        expect(evaluation.decisionType).toBe("SOR_PLAN");
        expect(evaluation.improvementMetrics).toEqual({ liftBps: "2.0" });
    });

    it("rejects recording an evaluation for a missing run", async () => {
        const query = vi.fn(async () => makeQueryResult([]));
        const manager = new QualificationRunManager({ pool: { query } as unknown as Pool });

        await expect(
            manager.recordDecisionEvaluation("missing-run", {
                decisionType: "SOR_PLAN",
                entityId: "rfq-1",
                realizedMetrics: {},
                counterfactualMetrics: {},
                improvementMetrics: {}
            })
        ).rejects.toBeInstanceOf(QualificationRunNotFoundError);
    });

    it("rejects non-object metric payloads", async () => {
        const manager = new QualificationRunManager({ pool: { query: vi.fn() } as unknown as Pool });

        await expect(
            manager.recordDecisionEvaluation("run-1", {
                decisionType: "SOR_PLAN",
                entityId: "rfq-1",
                realizedMetrics: [] as unknown as Record<string, unknown>,
                counterfactualMetrics: {},
                improvementMetrics: {}
            })
        ).rejects.toBeInstanceOf(QualificationDecisionEvaluationError);
    });

    it("lists only open pending or running runs", async () => {
        const query = vi.fn(async () =>
            makeQueryResult([
                {
                    id: "run-1",
                    strategy_key: "phase3b.sor",
                    scope_type: "bucket",
                    scope_id: "bucket-1",
                    stage: "INTERNAL_ONLY",
                    engine_version: "eng-v1",
                    config_version: "cfg-v1",
                    started_at: new Date("2026-03-12T11:00:00.000Z"),
                    ended_at: null,
                    status: "PENDING",
                    metadata: {}
                },
                {
                    id: "run-2",
                    strategy_key: "phase3b.sor",
                    scope_type: "bucket",
                    scope_id: "bucket-2",
                    stage: "SHADOW",
                    engine_version: "eng-v1",
                    config_version: "cfg-v1",
                    started_at: new Date("2026-03-12T11:10:00.000Z"),
                    ended_at: null,
                    status: "RUNNING",
                    metadata: {}
                }
            ])
        );

        const manager = new QualificationRunManager({ pool: { query } as unknown as Pool });
        const runs = await manager.listActiveRuns();

        expect(runs.map((run) => run.status)).toEqual([
            QualificationRunStatus.PENDING,
            QualificationRunStatus.RUNNING
        ]);
    });
});
