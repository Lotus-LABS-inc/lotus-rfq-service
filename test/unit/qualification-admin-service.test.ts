import { describe, expect, it, vi } from "vitest";
import type { Pool, QueryResult, QueryResultRow } from "pg";

import {
    QualificationAdminService,
    QualificationEvidenceInsufficientError,
    QualificationPromotionGateBlockedError,
    QualificationRunAdminTransitionError,
    createDefaultPromotionGateConfig
} from "../../src/api/admin/qualification-admin-service.js";
import { PromotionGateEvaluator } from "../../src/core/qualification/promotion-gate-evaluator.js";
import { QualificationRunStatus, QualificationStage } from "../../src/core/qualification/qualification.types.js";

const makeQueryResult = <T extends QueryResultRow>(rows: T[]): QueryResult<T> => ({
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows
});

const runRow = {
    id: "11111111-1111-4111-8111-111111111111",
    strategy_key: "strategy.phase3b",
    scope_type: "bucket",
    scope_id: "bucket-1",
    stage: "SHADOW",
    engine_version: "eng-v1",
    config_version: "cfg-v1",
    started_at: new Date("2026-03-12T10:00:00.000Z"),
    ended_at: null,
    status: "RUNNING",
    metadata: {
        promotionGateSignals: {
            replayStability: { matchRate: 0.999, diffRate: 0.001, errorRate: 0, consecutiveStableRuns: 20 },
            reconciliationHealth: { mismatchCount: 0, mismatchRate: 0, infraErrorCount: 0, lockConflictCount: 0 },
            plannerLatency: { p95Ms: 100, p99Ms: 180 },
            incidentCount: { incidents: 0, unresolvedIncidents: 0 },
            adverseSelection: { adverseFillRate: 0.01, postTradeMarkoutLoss: "0.01", lossRate: 0.005 }
        }
    }
};

const evaluationRows = [
    {
        id: "22222222-2222-4222-8222-222222222222",
        qualification_run_id: runRow.id,
        decision_type: "SOR_CONFIG_CHANGE",
        entity_id: "rfq-1",
        replay_envelope_id: null,
        realized_metrics: { realizedFillPrice: "1.01" },
        counterfactual_metrics: { realizedFillPrice: "1.02" },
        improvement_metrics: {
            priceImprovement: "0.05",
            slippageSaved: "0.05",
            feeSaved: "0.02",
            externalNotionalAvoided: "3",
            internalizationGain: "3",
            compressionGain: "1"
        },
        created_at: new Date("2026-03-12T10:05:00.000Z")
    }
];

describe("QualificationAdminService", () => {
    it("lists runs with filters", async () => {
        const query = vi.fn(async () => makeQueryResult([runRow]));
        const service = new QualificationAdminService({
            pool: { query } as unknown as Pool,
            promotionGateEvaluator: new PromotionGateEvaluator(createDefaultPromotionGateConfig())
        });

        const runs = await service.listRuns({ stage: QualificationStage.SHADOW, status: QualificationRunStatus.RUNNING });

        expect(runs).toHaveLength(1);
        expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE stage = $1 AND status = $2"), [
            QualificationStage.SHADOW,
            QualificationRunStatus.RUNNING
        ]);
    });

    it("returns run detail with aggregated metrics", async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce(makeQueryResult([runRow]))
            .mockResolvedValueOnce(makeQueryResult([runRow]))
            .mockResolvedValueOnce(makeQueryResult(evaluationRows));
        const service = new QualificationAdminService({
            pool: { query } as unknown as Pool,
            promotionGateEvaluator: new PromotionGateEvaluator(createDefaultPromotionGateConfig())
        });

        const detail = await service.getRunDetail(runRow.id);

        expect(detail.summary.evaluationCount).toBe(1);
        expect(detail.summary.countsByDecisionType).toEqual({ SOR_CONFIG_CHANGE: 1 });
        expect(detail.summary.improvement.numericTotals.priceImprovement).toBe("0.05");
    });

    it("promotes a run when the gate evaluator allows it and persists a promotion event", async () => {
        const query = vi.fn(async (sql: string) => {
            if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
                return makeQueryResult([]);
            }
            if (sql.includes("FROM strategy_qualification_runs") && sql.includes("LIMIT 1")) {
                return makeQueryResult([runRow]);
            }
            if (sql.includes("FROM strategy_decision_evaluations")) {
                return makeQueryResult(evaluationRows);
            }
            if (sql.includes("UPDATE strategy_qualification_runs")) {
                return makeQueryResult([{
                    ...runRow,
                    stage: "CANARY"
                }]);
            }
            if (sql.includes("INSERT INTO strategy_promotion_events")) {
                return makeQueryResult([{
                    id: "33333333-3333-4333-8333-333333333333",
                    strategy_key: runRow.strategy_key,
                    scope_type: runRow.scope_type,
                    scope_id: runRow.scope_id,
                    from_stage: "SHADOW",
                    to_stage: "CANARY",
                    reason: "promotion_gate_passed",
                    created_by: "admin@example.com",
                    created_at: new Date("2026-03-12T10:10:00.000Z"),
                    metadata: {}
                }]);
            }
            throw new Error(`Unhandled SQL: ${sql}`);
        });
        const connect = vi.fn(async () => ({
            query,
            release: vi.fn()
        }));
        const service = new QualificationAdminService({
            pool: { query, connect } as unknown as Pool,
            promotionGateEvaluator: new PromotionGateEvaluator(createDefaultPromotionGateConfig())
        });

        const result = await service.promoteRun(runRow.id, "admin@example.com");

        expect(result.run.stage).toBe(QualificationStage.CANARY);
        expect(result.promotionEvent.toStage).toBe(QualificationStage.CANARY);
        expect(result.gateResult.promotable).toBe(true);
    });

    it("blocks promotion when qualification evidence is missing", async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce(makeQueryResult([{ ...runRow, metadata: {} }]))
            .mockResolvedValueOnce(makeQueryResult([{ ...runRow, metadata: {} }]))
            .mockResolvedValueOnce(makeQueryResult(evaluationRows));
        const service = new QualificationAdminService({
            pool: { query } as unknown as Pool,
            promotionGateEvaluator: new PromotionGateEvaluator(createDefaultPromotionGateConfig())
        });

        await expect(service.promoteRun(runRow.id, "admin@example.com")).rejects.toBeInstanceOf(
            QualificationEvidenceInsufficientError
        );
    });

    it("blocks promotion when the evaluator rejects the gate", async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce(makeQueryResult([runRow]))
            .mockResolvedValueOnce(makeQueryResult([runRow]))
            .mockResolvedValueOnce(
                makeQueryResult([
                    {
                        ...evaluationRows[0],
                        improvement_metrics: {
                            priceImprovement: "-1",
                            slippageSaved: "-1",
                            feeSaved: "-1",
                            externalNotionalAvoided: "-1",
                            internalizationGain: "-1",
                            compressionGain: "-1"
                        }
                    }
                ])
            );
        const service = new QualificationAdminService({
            pool: { query } as unknown as Pool,
            promotionGateEvaluator: new PromotionGateEvaluator(createDefaultPromotionGateConfig())
        });

        await expect(service.promoteRun(runRow.id, "admin@example.com")).rejects.toBeInstanceOf(
            QualificationPromotionGateBlockedError
        );
    });

    it("demotes to a lower stage and persists a promotion event", async () => {
        const query = vi.fn(async (sql: string) => {
            if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
                return makeQueryResult([]);
            }
            if (sql.includes("FROM strategy_qualification_runs") && sql.includes("LIMIT 1")) {
                return makeQueryResult([{ ...runRow, stage: "CANARY" }]);
            }
            if (sql.includes("UPDATE strategy_qualification_runs")) {
                return makeQueryResult([{ ...runRow, stage: "SHADOW" }]);
            }
            if (sql.includes("INSERT INTO strategy_promotion_events")) {
                return makeQueryResult([{
                    id: "44444444-4444-4444-8444-444444444444",
                    strategy_key: runRow.strategy_key,
                    scope_type: runRow.scope_type,
                    scope_id: runRow.scope_id,
                    from_stage: "CANARY",
                    to_stage: "SHADOW",
                    reason: "manual_reason",
                    created_by: "admin@example.com",
                    created_at: new Date("2026-03-12T10:15:00.000Z"),
                    metadata: {}
                }]);
            }
            throw new Error(`Unhandled SQL: ${sql}`);
        });
        const connect = vi.fn(async () => ({
            query,
            release: vi.fn()
        }));
        const service = new QualificationAdminService({
            pool: { query, connect } as unknown as Pool,
            promotionGateEvaluator: new PromotionGateEvaluator(createDefaultPromotionGateConfig())
        });

        const result = await service.demoteRun(runRow.id, QualificationStage.SHADOW, "manual_reason", "admin@example.com");

        expect(result.run.stage).toBe(QualificationStage.SHADOW);
        expect(result.promotionEvent.reason).toBe("manual_reason");
    });

    it("fails closed on invalid demotion target", async () => {
        const query = vi.fn().mockResolvedValueOnce(makeQueryResult([runRow]));
        const service = new QualificationAdminService({
            pool: { query } as unknown as Pool,
            promotionGateEvaluator: new PromotionGateEvaluator(createDefaultPromotionGateConfig())
        });

        await expect(
            service.demoteRun(runRow.id, QualificationStage.CANARY, "bad", "admin@example.com")
        ).rejects.toBeInstanceOf(QualificationRunAdminTransitionError);
    });

    it("pauses a running run", async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce(makeQueryResult([runRow]))
            .mockResolvedValueOnce(makeQueryResult([{ ...runRow, status: "PAUSED" }]));
        const service = new QualificationAdminService({
            pool: { query } as unknown as Pool,
            promotionGateEvaluator: new PromotionGateEvaluator(createDefaultPromotionGateConfig())
        });

        const result = await service.pauseRun(runRow.id, "ops pause", "admin@example.com");

        expect(result.run.status).toBe(QualificationRunStatus.PAUSED);
    });
});
