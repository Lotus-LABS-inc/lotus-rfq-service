import type { Logger } from "pino";

import {
    qualificationEvaluationsWrittenTotal,
    shadowDecisionDiffTotal
} from "../../observability/metrics.js";
import type {
    ClearingDecisionOutput,
    InternalCrossDecisionOutput,
    NettingDecisionOutput,
    RFQGroupingDecisionOutput,
    ResolutionRiskDecisionOutput,
    SORDecisionOutput,
    ShadowDecisionType,
    ShadowQualificationEvaluationResult,
    ShadowQualificationEvaluator
} from "./shadow-qualification-evaluator.js";
import type { EconomicExecutionSnapshot } from "./economic-quality-engine.js";
import type { QualificationRunManager } from "./qualification-run-manager.js";
import type { StrategyDecisionEvaluation } from "./qualification.types.js";

export type QualificationFailMode = "ASYNC_BEST_EFFORT" | "INLINE_BEST_EFFORT" | "STRICT";
export type QualificationEvaluationMode = "live_only" | "shadow_compare";

type DecisionOutput =
    | SORDecisionOutput
    | RFQGroupingDecisionOutput
    | ResolutionRiskDecisionOutput
    | InternalCrossDecisionOutput
    | NettingDecisionOutput
    | ClearingDecisionOutput;

type DecisionCallable<TDecisionOutput extends DecisionOutput = DecisionOutput> = () => Promise<TDecisionOutput> | TDecisionOutput;

export interface QualificationDomainHookConfig {
    enabled: boolean;
    strategyKey: string;
    failMode?: QualificationFailMode;
    shadowEnabled?: boolean;
}

export interface QualificationRuntimeConfig {
    enabled: boolean;
    sor?: QualificationDomainHookConfig;
    rfqGrouping?: QualificationDomainHookConfig;
    resolutionRisk?: QualificationDomainHookConfig;
    phase1InternalCross?: QualificationDomainHookConfig;
    phase2aNetting?: QualificationDomainHookConfig;
    phase2bClearing?: QualificationDomainHookConfig;
}

export interface RuntimeQualificationEvaluationRequest<TDecisionOutput extends DecisionOutput = DecisionOutput> {
    strategyKey: string;
    scopeType: string;
    scopeId: string;
    decisionType: ShadowDecisionType;
    entityId: string;
    mode: QualificationEvaluationMode;
    liveDecision: DecisionCallable<TDecisionOutput>;
    shadowDecision?: DecisionCallable<TDecisionOutput>;
    replayEnvelopeId?: string | null;
    liveEconomicSnapshot?: EconomicExecutionSnapshot;
    shadowEconomicSnapshot?: EconomicExecutionSnapshot;
    metadata?: Record<string, unknown>;
    failMode?: QualificationFailMode;
}

export interface QualificationRuntimeHookDeps {
    qualificationRunManager: Pick<QualificationRunManager, "findActiveRunsByStrategyScope">;
    shadowQualificationEvaluator: Pick<ShadowQualificationEvaluator, "evaluate">;
    logger?: Pick<Logger, "info" | "warn" | "error">;
}

export class QualificationRuntimeHookError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "QualificationRuntimeHookError";
    }
}

export interface IQualificationRuntimeHook {
    emitEvaluation<TDecisionOutput extends DecisionOutput>(
        request: RuntimeQualificationEvaluationRequest<TDecisionOutput>
    ): Promise<StrategyDecisionEvaluation | null>;
}

const toMetricMode = (mode: QualificationEvaluationMode): string => mode;

export class QualificationRuntimeHook implements IQualificationRuntimeHook {
    private readonly qualificationRunManager: Pick<QualificationRunManager, "findActiveRunsByStrategyScope">;
    private readonly shadowQualificationEvaluator: Pick<ShadowQualificationEvaluator, "evaluate">;
    private readonly logger: Pick<Logger, "info" | "warn" | "error"> | undefined;

    public constructor(deps: QualificationRuntimeHookDeps) {
        this.qualificationRunManager = deps.qualificationRunManager;
        this.shadowQualificationEvaluator = deps.shadowQualificationEvaluator;
        this.logger = deps.logger;
    }

    public async emitEvaluation<TDecisionOutput extends DecisionOutput>(
        request: RuntimeQualificationEvaluationRequest<TDecisionOutput>
    ): Promise<StrategyDecisionEvaluation | null> {
        const failMode = request.failMode ?? "ASYNC_BEST_EFFORT";
        if (failMode === "ASYNC_BEST_EFFORT") {
            void this.execute(request).catch((error: unknown) => {
                this.logger?.warn?.(
                    {
                        err: error,
                        strategyKey: request.strategyKey,
                        scopeType: request.scopeType,
                        scopeId: request.scopeId,
                        decisionType: request.decisionType,
                        entityId: request.entityId
                    },
                    "Runtime qualification evaluation failed in async best-effort mode."
                );
            });
            return null;
        }

        try {
            return await this.execute(request);
        } catch (error) {
            if (failMode === "INLINE_BEST_EFFORT") {
                this.logger?.warn?.(
                    {
                        err: error,
                        strategyKey: request.strategyKey,
                        scopeType: request.scopeType,
                        scopeId: request.scopeId,
                        decisionType: request.decisionType,
                        entityId: request.entityId
                    },
                    "Runtime qualification evaluation failed in inline best-effort mode."
                );
                return null;
            }

            throw error;
        }
    }

    private async execute<TDecisionOutput extends DecisionOutput>(
        request: RuntimeQualificationEvaluationRequest<TDecisionOutput>
    ): Promise<StrategyDecisionEvaluation | null> {
        const runs = await this.qualificationRunManager.findActiveRunsByStrategyScope(
            request.strategyKey,
            request.scopeType,
            request.scopeId
        );

        if (runs.length === 0) {
            this.logger?.info?.(
                {
                    strategyKey: request.strategyKey,
                    scopeType: request.scopeType,
                    scopeId: request.scopeId,
                    decisionType: request.decisionType,
                    entityId: request.entityId
                },
                "Skipping runtime qualification evaluation because no active run matched."
            );
            return null;
        }

        if (runs.length > 1) {
            throw new QualificationRuntimeHookError(
                `Multiple active qualification runs matched ${request.strategyKey}/${request.scopeType}/${request.scopeId}.`
            );
        }

        const run = runs[0]!;
        const result = (await this.shadowQualificationEvaluator.evaluate({
            qualificationRunId: run.id,
            strategyKey: request.strategyKey,
            scopeType: request.scopeType,
            scopeId: request.scopeId,
            decisionType: request.decisionType,
            entityId: request.entityId,
            replayEnvelopeId: request.replayEnvelopeId ?? null,
            liveDecision: request.liveDecision,
            shadowDecision: request.shadowDecision ?? request.liveDecision,
            ...(request.liveEconomicSnapshot ? { liveEconomicSnapshot: request.liveEconomicSnapshot } : {}),
            ...(request.shadowEconomicSnapshot ? { shadowEconomicSnapshot: request.shadowEconomicSnapshot } : {}),
            ...(request.metadata ? { metadata: request.metadata } : {})
        } as never)) as ShadowQualificationEvaluationResult;

        qualificationEvaluationsWrittenTotal.labels(
            request.decisionType,
            request.strategyKey,
            toMetricMode(request.mode)
        ).inc();

        if (request.mode === "shadow_compare" && !result.decisionComparison.matched) {
            shadowDecisionDiffTotal.labels(
                request.decisionType,
                result.decisionComparison.divergenceReason
            ).inc();
        }

        return result.persistedEvaluation;
    }
}
