import { describe, expect, it } from "vitest";
import {
    AutoSafetyActionType,
    QualificationRunStatus,
    QualificationStage,
    type AutoSafetyAction,
    type CreatePromotionEventInput,
    type StrategyDecisionEvaluation
} from "../../src/core/qualification/qualification.types.js";

describe("qualification domain types", () => {
    it("keeps qualification stages stable and ordered for shadow-first rollout", () => {
        const stages = [
            QualificationStage.INTERNAL_ONLY,
            QualificationStage.SHADOW,
            QualificationStage.CANARY,
            QualificationStage.LIMITED_PROD,
            QualificationStage.BROAD_PROD
        ];

        expect(stages).toEqual([
            "INTERNAL_ONLY",
            "SHADOW",
            "CANARY",
            "LIMITED_PROD",
            "BROAD_PROD"
        ]);
    });

    it("keeps qualification run statuses stable for explainable lifecycle tracking", () => {
        const statuses = [
            QualificationRunStatus.PENDING,
            QualificationRunStatus.RUNNING,
            QualificationRunStatus.PAUSED,
            QualificationRunStatus.SUCCEEDED,
            QualificationRunStatus.FAILED,
            QualificationRunStatus.CANCELLED
        ];

        expect(statuses).toHaveLength(6);
    });

    it("keeps promotion metadata optional on create input while preserving structured payloads", () => {
        const promotion: CreatePromotionEventInput = {
            strategyKey: "phase3b.sor.v2",
            scopeType: "bucket",
            scopeId: "bucket-42",
            fromStage: QualificationStage.SHADOW,
            toStage: QualificationStage.CANARY,
            reason: "met_thresholds",
            createdBy: "ops@example.com"
        };

        expect(promotion.metadata).toBeUndefined();
    });

    it("keeps auto safety actions auditable with nullable resolution time", () => {
        const action: AutoSafetyAction = {
            id: "action-1",
            strategyKey: "phase3b.sor.v2",
            scopeType: "shard",
            scopeId: "planner-a",
            actionType: AutoSafetyActionType.DEMOTE_STAGE,
            triggerReason: "latency_spike",
            createdAt: new Date("2026-03-12T10:00:00.000Z"),
            resolvedAt: null,
            metadata: { thresholdMs: 120 }
        };

        expect(action.resolvedAt).toBeNull();
    });

    it("keeps realized and counterfactual metric payloads structured", () => {
        const evaluation: StrategyDecisionEvaluation = {
            id: "evaluation-1",
            qualificationRunId: "run-1",
            decisionType: "SOR_PLAN",
            entityId: "rfq-1",
            replayEnvelopeId: "env-1",
            realizedMetrics: { fillRate: "0.91" },
            counterfactualMetrics: { fillRate: "0.88" },
            improvementMetrics: { liftBps: "3.0" },
            createdAt: new Date("2026-03-12T10:05:00.000Z")
        };

        expect(evaluation.realizedMetrics).toEqual({ fillRate: "0.91" });
        expect(evaluation.counterfactualMetrics).toEqual({ fillRate: "0.88" });
        expect(evaluation.improvementMetrics).toEqual({ liftBps: "3.0" });
    });
});
