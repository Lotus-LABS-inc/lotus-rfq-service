import Decimal from "decimal.js";
import type { Pool, QueryResult } from "pg";
import type { Logger } from "pino";

import type { ControlPlaneAdminService } from "../../api/admin/control-plane-admin-service.js";
import type { ExecutionMode } from "../replay/control-plane.types.js";
import {
    autoSafetyActionsCreatedTotal,
    autoSafetyActionsResolvedTotal
} from "../../observability/metrics.js";
import {
    AutoSafetyActionType,
    QualificationStage,
    type AutoSafetyAction
} from "./qualification.types.js";

export type AutoSafetyTriggerId =
    | "replay_diff_spike"
    | "reconciliation_mismatch_spike"
    | "planner_latency_breach_sustained"
    | "negative_economic_quality_sustained"
    | "stale_reservation_growth"
    | "internalization_failure_spike";

export interface ReplayDiffSpikeThreshold {
    maxDiffRate: number;
    maxErrorRate: number;
    minBreachedWindows: number;
    minDurationMs: number;
}

export interface ReconciliationMismatchSpikeThreshold {
    maxMismatchCount: number;
    maxMismatchRate: number;
    maxInfraErrorCount: number;
    maxLockConflictCount: number;
    minBreachedWindows: number;
    minDurationMs: number;
}

export interface PlannerLatencyBreachThreshold {
    maxP95Ms: number;
    maxP99Ms: number;
    minBreachedWindows: number;
    minDurationMs: number;
}

export interface NegativeEconomicQualityThreshold {
    minPriceImprovement: string;
    minSlippageSaved: string;
    minFeeSaved: string;
    minExternalNotionalAvoided: string;
    minInternalizationGain: string;
    minCompressionGain: string;
    minBreachedWindows: number;
    minDurationMs: number;
}

export interface StaleReservationGrowthThreshold {
    maxStaleReservationCount: number;
    maxGrowthRate: number;
    minBreachedWindows: number;
    minDurationMs: number;
}

export interface InternalizationFailureSpikeThreshold {
    maxFailureCount: number;
    maxFailureRate: number;
    minBreachedWindows: number;
    minDurationMs: number;
}

export interface AutoSafetyActionConfig {
    version: string;
    thresholds: {
        replayDiffSpike: ReplayDiffSpikeThreshold;
        reconciliationMismatchSpike: ReconciliationMismatchSpikeThreshold;
        plannerLatencyBreach: PlannerLatencyBreachThreshold;
        negativeEconomicQuality: NegativeEconomicQualityThreshold;
        staleReservationGrowth: StaleReservationGrowthThreshold;
        internalizationFailureSpike: InternalizationFailureSpikeThreshold;
    };
    actions: Record<AutoSafetyTriggerId, AutoSafetyActionType>;
    cooldownMs: number;
    resolutionPoolingOverrideTtlMs: number;
    sorOnlyOverrideTtlMs: number;
}

export interface ReplayDiffSpikeSignals {
    diffRate: number;
    errorRate: number;
    breachedWindows: number;
    sustainedDurationMs: number;
}

export interface ReconciliationMismatchSpikeSignals {
    mismatchCount: number;
    mismatchRate: number;
    infraErrorCount: number;
    lockConflictCount: number;
    breachedWindows: number;
    sustainedDurationMs: number;
}

export interface PlannerLatencyBreachSignals {
    p95Ms: number;
    p99Ms: number;
    breachedWindows: number;
    sustainedDurationMs: number;
}

export interface NegativeEconomicQualitySignals {
    priceImprovement: string;
    slippageSaved: string;
    feeSaved: string;
    externalNotionalAvoided: string;
    internalizationGain: string;
    compressionGain: string;
    breachedWindows: number;
    sustainedDurationMs: number;
}

export interface StaleReservationGrowthSignals {
    staleReservationCount: number;
    growthRate: number;
    breachedWindows: number;
    sustainedDurationMs: number;
}

export interface InternalizationFailureSpikeSignals {
    failureCount: number;
    failureRate: number;
    breachedWindows: number;
    sustainedDurationMs: number;
}

export interface AutoSafetyEvaluationInput {
    strategyKey: string;
    scopeType: string;
    scopeId: string;
    shardId: string;
    bucketId?: string | null;
    marketId?: string | null;
    currentStage: QualificationStage;
    signals: {
        replayDiffSpike: ReplayDiffSpikeSignals;
        reconciliationMismatchSpike: ReconciliationMismatchSpikeSignals;
        plannerLatencyBreach: PlannerLatencyBreachSignals;
        negativeEconomicQuality: NegativeEconomicQualitySignals;
        staleReservationGrowth: StaleReservationGrowthSignals;
        internalizationFailureSpike: InternalizationFailureSpikeSignals;
    };
    metadata?: Record<string, unknown>;
}

export interface AutoSafetyTriggerResult {
    trigger: AutoSafetyTriggerId;
    breached: boolean;
    reason: string;
    observed: Record<string, unknown>;
    threshold: Record<string, unknown>;
}

export interface AutoSafetyControlPlaneEffect {
    applied: boolean;
    operation:
        | "none"
        | "already_active"
        | "cooldown_skip"
        | "degrade_shard"
        | "pause_shard"
        | "drain_bucket"
        | "create_override";
    scopeType?: string;
    scopeId?: string;
    targetMode?: string;
    overrideType?: string;
    expiresAt?: Date | null;
}

export interface AutoSafetyEvaluationResult {
    triggered: boolean;
    appliedAction?: AutoSafetyAction;
    actionType?: AutoSafetyActionType;
    triggerResults: readonly AutoSafetyTriggerResult[];
    alreadyActive: boolean;
    controlPlaneEffect: AutoSafetyControlPlaneEffect;
    recommendedStage?: QualificationStage;
}

interface AutoSafetyActionRow {
    id: string;
    strategy_key: string;
    scope_type: string;
    scope_id: string;
    action_type: string;
    trigger_reason: string;
    created_at: Date;
    resolved_at: Date | null;
    metadata: Record<string, unknown>;
}

type ControlPlaneAdminActions = Pick<
    ControlPlaneAdminService,
    "degradeShard" | "pauseShard" | "drainBucket" | "createOverride"
>;

export interface AutoSafetyActionEngineDeps {
    pool: Pool;
    controlPlaneAdminService: ControlPlaneAdminActions;
    config: AutoSafetyActionConfig;
    logger?: Pick<Logger, "info" | "warn" | "error">;
}

export const createDefaultAutoSafetyActionConfig = (): AutoSafetyActionConfig => ({
    version: "phase3b-auto-safety-v1",
    thresholds: {
        replayDiffSpike: {
            maxDiffRate: 0.02,
            maxErrorRate: 0.005,
            minBreachedWindows: 2,
            minDurationMs: 1000
        },
        reconciliationMismatchSpike: {
            maxMismatchCount: 0,
            maxMismatchRate: 0,
            maxInfraErrorCount: 0,
            maxLockConflictCount: 0,
            minBreachedWindows: 2,
            minDurationMs: 1000
        },
        plannerLatencyBreach: {
            maxP95Ms: 250,
            maxP99Ms: 400,
            minBreachedWindows: 2,
            minDurationMs: 1000
        },
        negativeEconomicQuality: {
            minPriceImprovement: "0",
            minSlippageSaved: "0",
            minFeeSaved: "0",
            minExternalNotionalAvoided: "0",
            minInternalizationGain: "0",
            minCompressionGain: "0",
            minBreachedWindows: 2,
            minDurationMs: 1000
        },
        staleReservationGrowth: {
            maxStaleReservationCount: 10,
            maxGrowthRate: 0.25,
            minBreachedWindows: 2,
            minDurationMs: 1000
        },
        internalizationFailureSpike: {
            maxFailureCount: 2,
            maxFailureRate: 0.1,
            minBreachedWindows: 2,
            minDurationMs: 1000
        }
    },
    actions: {
        replay_diff_spike: AutoSafetyActionType.DISABLE_PHASE2B,
        reconciliation_mismatch_spike: AutoSafetyActionType.DISABLE_PHASE2A_AND_2B,
        planner_latency_breach_sustained: AutoSafetyActionType.FORCE_SOR_ONLY,
        negative_economic_quality_sustained: AutoSafetyActionType.DEMOTE_STAGE,
        stale_reservation_growth: AutoSafetyActionType.PAUSE_SCOPE,
        internalization_failure_spike: AutoSafetyActionType.DISABLE_RESOLUTION_POOLING
    },
    cooldownMs: 0,
    resolutionPoolingOverrideTtlMs: 300000,
    sorOnlyOverrideTtlMs: 120000
});

export type AutoSafetyActionEngineErrorCode =
    | "invalid_input"
    | "invalid_config"
    | "action_not_found"
    | "persistence_failed";

export class AutoSafetyActionEngineError extends Error {
    public readonly code: AutoSafetyActionEngineErrorCode;

    public constructor(code: AutoSafetyActionEngineErrorCode, message: string) {
        super(message);
        this.name = "AutoSafetyActionEngineError";
        this.code = code;
    }
}

const REQUESTED_BY = "auto-safety-action-engine";
const OVERRIDE_SCOPE_TYPES = new Set(["MARKET", "BUCKET", "SHARD", "ENGINE"]);
const ACTION_PRECEDENCE: readonly AutoSafetyActionType[] = [
    AutoSafetyActionType.PAUSE_SCOPE,
    AutoSafetyActionType.DISABLE_PHASE2A_AND_2B,
    AutoSafetyActionType.DISABLE_PHASE2B,
    AutoSafetyActionType.FORCE_SOR_ONLY,
    AutoSafetyActionType.DISABLE_RESOLUTION_POOLING,
    AutoSafetyActionType.DEMOTE_STAGE
] as const;

const parseDecimal = (value: string, fieldName: string): InstanceType<typeof Decimal> => {
    try {
        const decimal = new Decimal(value);
        if (!decimal.isFinite()) {
            throw new Error("non-finite");
        }
        return decimal;
    } catch {
        throw new AutoSafetyActionEngineError("invalid_input", `${fieldName} must be a finite decimal string.`);
    }
};

const ensureFiniteNumber = (value: number, fieldName: string): void => {
    if (!Number.isFinite(value) || value < 0) {
        throw new AutoSafetyActionEngineError("invalid_input", `${fieldName} must be a non-negative finite number.`);
    }
};

const ensureNonEmptyString = (value: string, fieldName: string): void => {
    if (value.trim().length === 0) {
        throw new AutoSafetyActionEngineError("invalid_input", `${fieldName} must be a non-empty string.`);
    }
};

const mapAutoSafetyActionRow = (row: AutoSafetyActionRow): AutoSafetyAction => ({
    id: row.id,
    strategyKey: row.strategy_key,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    actionType: row.action_type as AutoSafetyActionType,
    triggerReason: row.trigger_reason,
    createdAt: new Date(row.created_at),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
    metadata: row.metadata
});

const nextLowerStage = (stage: QualificationStage): QualificationStage | undefined => {
    switch (stage) {
        case QualificationStage.BROAD_PROD:
            return QualificationStage.LIMITED_PROD;
        case QualificationStage.LIMITED_PROD:
            return QualificationStage.CANARY;
        case QualificationStage.CANARY:
            return QualificationStage.SHADOW;
        case QualificationStage.SHADOW:
            return QualificationStage.INTERNAL_ONLY;
        default:
            return undefined;
    }
};

const demotionModeForStage = (stage: QualificationStage): ExecutionMode | undefined => {
    switch (stage) {
        case QualificationStage.LIMITED_PROD:
            return "DISABLE_PHASE2B";
        case QualificationStage.CANARY:
            return "DISABLE_PHASE2A_AND_2B";
        case QualificationStage.SHADOW:
            return "SOR_ONLY";
        case QualificationStage.INTERNAL_ONLY:
            return "SAFE_FALLBACK";
        default:
            return undefined;
    }
};

const normalizeScopeType = (scopeType: string): string => scopeType.trim().toUpperCase();

const toRecord = (value: Record<string, unknown>): Record<string, unknown> => ({ ...value });

export class AutoSafetyActionEngine {
    private readonly pool: Pool;
    private readonly controlPlaneAdminService: ControlPlaneAdminActions;
    private readonly config: AutoSafetyActionConfig;
    private readonly logger: Pick<Logger, "info" | "warn" | "error"> | undefined;

    public constructor(deps: AutoSafetyActionEngineDeps) {
        this.pool = deps.pool;
        this.controlPlaneAdminService = deps.controlPlaneAdminService;
        this.config = Object.freeze(deps.config);
        this.logger = deps.logger;
        this.validateConfig(this.config);
    }

    public async evaluate(input: AutoSafetyEvaluationInput): Promise<AutoSafetyEvaluationResult> {
        this.validateInput(input);

        const triggerResults = this.evaluateTriggers(input);
        const breached = triggerResults.filter((result) => result.breached);
        if (breached.length === 0) {
            return {
                triggered: false,
                triggerResults,
                alreadyActive: false,
                controlPlaneEffect: {
                    applied: false,
                    operation: "none"
                }
            };
        }

        const selected = this.selectAction(input.currentStage, breached);
        const actionType = selected.actionType;
        const recommendedStage = selected.recommendedStage;
        const primaryTrigger = selected.primaryTrigger;

        const existingAction = await this.findLatestMatchingAction(
            input.strategyKey,
            input.scopeType,
            input.scopeId,
            actionType
        );
        if (existingAction?.resolvedAt === null) {
            return {
                triggered: true,
                appliedAction: existingAction,
                actionType,
                triggerResults,
                alreadyActive: true,
                controlPlaneEffect: {
                    applied: false,
                    operation: "already_active",
                    scopeType: existingAction.scopeType,
                    scopeId: existingAction.scopeId
                },
                ...(recommendedStage ? { recommendedStage } : {})
            };
        }

        if (
            existingAction &&
            this.config.cooldownMs > 0 &&
            Date.now() - existingAction.createdAt.getTime() < this.config.cooldownMs
        ) {
            return {
                triggered: false,
                actionType,
                triggerResults,
                alreadyActive: false,
                controlPlaneEffect: {
                    applied: false,
                    operation: "cooldown_skip",
                    scopeType: existingAction.scopeType,
                    scopeId: existingAction.scopeId
                },
                ...(recommendedStage ? { recommendedStage } : {})
            };
        }

        const controlPlaneEffect = await this.applyControlPlaneAction(
            input,
            actionType,
            primaryTrigger.trigger,
            recommendedStage
        );
        const metadata = {
            configVersion: this.config.version,
            currentStage: input.currentStage,
            ...(recommendedStage ? { recommendedStage } : {}),
            primaryTrigger: primaryTrigger.trigger,
            triggerResults,
            controlPlaneEffect,
            context: {
                strategyKey: input.strategyKey,
                scopeType: input.scopeType,
                scopeId: input.scopeId,
                shardId: input.shardId,
                bucketId: input.bucketId ?? null,
                marketId: input.marketId ?? null
            },
            ...(input.metadata ? { metadata: input.metadata } : {})
        };

        const action = await this.insertAction({
            strategyKey: input.strategyKey,
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            actionType,
            triggerReason: primaryTrigger.trigger,
            metadata
        });

        this.logger?.info?.(
            {
                strategyKey: input.strategyKey,
                scopeType: input.scopeType,
                scopeId: input.scopeId,
                actionType,
                triggerReason: primaryTrigger.trigger
            },
            "Applied auto safety action."
        );

        return {
            triggered: true,
            appliedAction: action,
            actionType,
            triggerResults,
            alreadyActive: false,
            controlPlaneEffect,
            ...(recommendedStage ? { recommendedStage } : {})
        };
    }

    public async resolveAction(
        actionId: string,
        resolutionMetadata: Record<string, unknown> = {}
    ): Promise<AutoSafetyAction> {
        ensureNonEmptyString(actionId, "actionId");

        const result: QueryResult<AutoSafetyActionRow> = await this.pool.query(
            `UPDATE auto_safety_actions
             SET resolved_at = NOW(),
                 metadata = metadata || jsonb_build_object('resolution', $2::jsonb)
             WHERE id = $1
               AND resolved_at IS NULL
             RETURNING id, strategy_key, scope_type, scope_id, action_type, trigger_reason, created_at, resolved_at, metadata`,
            [
                actionId,
                JSON.stringify({
                    resolvedAt: new Date().toISOString(),
                    ...resolutionMetadata
                })
            ]
        );

        const row = result.rows[0];
        if (!row) {
            const existing = await this.pool.query<{ resolved_at: Date | null }>(
                `SELECT resolved_at FROM auto_safety_actions WHERE id = $1 LIMIT 1`,
                [actionId]
            );
            if (existing.rows[0]?.resolved_at) {
                throw new AutoSafetyActionEngineError(
                    "invalid_input",
                    `Auto safety action ${actionId} is already resolved.`
                );
            }
            throw new AutoSafetyActionEngineError("action_not_found", `Auto safety action ${actionId} not found.`);
        }

        autoSafetyActionsResolvedTotal.labels(row.action_type, row.scope_type).inc();
        return mapAutoSafetyActionRow(row);
    }

    private validateConfig(config: AutoSafetyActionConfig): void {
        ensureNonEmptyString(config.version, "config.version");
        ensureFiniteNumber(config.cooldownMs, "config.cooldownMs");
        ensureFiniteNumber(config.resolutionPoolingOverrideTtlMs, "config.resolutionPoolingOverrideTtlMs");
        ensureFiniteNumber(config.sorOnlyOverrideTtlMs, "config.sorOnlyOverrideTtlMs");

        const actionValues = new Set(Object.values(AutoSafetyActionType));
        const triggerIds: readonly AutoSafetyTriggerId[] = [
            "replay_diff_spike",
            "reconciliation_mismatch_spike",
            "planner_latency_breach_sustained",
            "negative_economic_quality_sustained",
            "stale_reservation_growth",
            "internalization_failure_spike"
        ];

        for (const triggerId of triggerIds) {
            if (!actionValues.has(config.actions[triggerId])) {
                throw new AutoSafetyActionEngineError(
                    "invalid_config",
                    `config.actions.${triggerId} must map to a valid AutoSafetyActionType.`
                );
            }
        }
    }

    private validateInput(input: AutoSafetyEvaluationInput): void {
        ensureNonEmptyString(input.strategyKey, "strategyKey");
        ensureNonEmptyString(input.scopeType, "scopeType");
        ensureNonEmptyString(input.scopeId, "scopeId");
        ensureNonEmptyString(input.shardId, "shardId");

        ensureFiniteNumber(input.signals.replayDiffSpike.diffRate, "signals.replayDiffSpike.diffRate");
        ensureFiniteNumber(input.signals.replayDiffSpike.errorRate, "signals.replayDiffSpike.errorRate");
        ensureFiniteNumber(input.signals.replayDiffSpike.breachedWindows, "signals.replayDiffSpike.breachedWindows");
        ensureFiniteNumber(input.signals.replayDiffSpike.sustainedDurationMs, "signals.replayDiffSpike.sustainedDurationMs");

        ensureFiniteNumber(input.signals.reconciliationMismatchSpike.mismatchCount, "signals.reconciliationMismatchSpike.mismatchCount");
        ensureFiniteNumber(input.signals.reconciliationMismatchSpike.mismatchRate, "signals.reconciliationMismatchSpike.mismatchRate");
        ensureFiniteNumber(input.signals.reconciliationMismatchSpike.infraErrorCount, "signals.reconciliationMismatchSpike.infraErrorCount");
        ensureFiniteNumber(input.signals.reconciliationMismatchSpike.lockConflictCount, "signals.reconciliationMismatchSpike.lockConflictCount");
        ensureFiniteNumber(input.signals.reconciliationMismatchSpike.breachedWindows, "signals.reconciliationMismatchSpike.breachedWindows");
        ensureFiniteNumber(input.signals.reconciliationMismatchSpike.sustainedDurationMs, "signals.reconciliationMismatchSpike.sustainedDurationMs");

        ensureFiniteNumber(input.signals.plannerLatencyBreach.p95Ms, "signals.plannerLatencyBreach.p95Ms");
        ensureFiniteNumber(input.signals.plannerLatencyBreach.p99Ms, "signals.plannerLatencyBreach.p99Ms");
        ensureFiniteNumber(input.signals.plannerLatencyBreach.breachedWindows, "signals.plannerLatencyBreach.breachedWindows");
        ensureFiniteNumber(input.signals.plannerLatencyBreach.sustainedDurationMs, "signals.plannerLatencyBreach.sustainedDurationMs");

        parseDecimal(input.signals.negativeEconomicQuality.priceImprovement, "signals.negativeEconomicQuality.priceImprovement");
        parseDecimal(input.signals.negativeEconomicQuality.slippageSaved, "signals.negativeEconomicQuality.slippageSaved");
        parseDecimal(input.signals.negativeEconomicQuality.feeSaved, "signals.negativeEconomicQuality.feeSaved");
        parseDecimal(input.signals.negativeEconomicQuality.externalNotionalAvoided, "signals.negativeEconomicQuality.externalNotionalAvoided");
        parseDecimal(input.signals.negativeEconomicQuality.internalizationGain, "signals.negativeEconomicQuality.internalizationGain");
        parseDecimal(input.signals.negativeEconomicQuality.compressionGain, "signals.negativeEconomicQuality.compressionGain");
        ensureFiniteNumber(input.signals.negativeEconomicQuality.breachedWindows, "signals.negativeEconomicQuality.breachedWindows");
        ensureFiniteNumber(input.signals.negativeEconomicQuality.sustainedDurationMs, "signals.negativeEconomicQuality.sustainedDurationMs");

        ensureFiniteNumber(input.signals.staleReservationGrowth.staleReservationCount, "signals.staleReservationGrowth.staleReservationCount");
        ensureFiniteNumber(input.signals.staleReservationGrowth.growthRate, "signals.staleReservationGrowth.growthRate");
        ensureFiniteNumber(input.signals.staleReservationGrowth.breachedWindows, "signals.staleReservationGrowth.breachedWindows");
        ensureFiniteNumber(input.signals.staleReservationGrowth.sustainedDurationMs, "signals.staleReservationGrowth.sustainedDurationMs");

        ensureFiniteNumber(input.signals.internalizationFailureSpike.failureCount, "signals.internalizationFailureSpike.failureCount");
        ensureFiniteNumber(input.signals.internalizationFailureSpike.failureRate, "signals.internalizationFailureSpike.failureRate");
        ensureFiniteNumber(input.signals.internalizationFailureSpike.breachedWindows, "signals.internalizationFailureSpike.breachedWindows");
        ensureFiniteNumber(input.signals.internalizationFailureSpike.sustainedDurationMs, "signals.internalizationFailureSpike.sustainedDurationMs");
    }

    private evaluateTriggers(input: AutoSafetyEvaluationInput): readonly AutoSafetyTriggerResult[] {
        return [
            this.evaluateReplayDiffSpike(input.signals.replayDiffSpike, this.config.thresholds.replayDiffSpike),
            this.evaluateReconciliationMismatchSpike(
                input.signals.reconciliationMismatchSpike,
                this.config.thresholds.reconciliationMismatchSpike
            ),
            this.evaluatePlannerLatencyBreach(
                input.signals.plannerLatencyBreach,
                this.config.thresholds.plannerLatencyBreach
            ),
            this.evaluateNegativeEconomicQuality(
                input.signals.negativeEconomicQuality,
                this.config.thresholds.negativeEconomicQuality
            ),
            this.evaluateStaleReservationGrowth(
                input.signals.staleReservationGrowth,
                this.config.thresholds.staleReservationGrowth
            ),
            this.evaluateInternalizationFailureSpike(
                input.signals.internalizationFailureSpike,
                this.config.thresholds.internalizationFailureSpike
            )
        ];
    }

    private evaluateReplayDiffSpike(
        observed: ReplayDiffSpikeSignals,
        threshold: ReplayDiffSpikeThreshold
    ): AutoSafetyTriggerResult {
        const breached =
            (observed.diffRate > threshold.maxDiffRate || observed.errorRate > threshold.maxErrorRate) &&
            observed.breachedWindows >= threshold.minBreachedWindows &&
            observed.sustainedDurationMs >= threshold.minDurationMs;

        return {
            trigger: "replay_diff_spike",
            breached,
            reason: breached ? "replay diff/error thresholds breached" : "replay diff/error thresholds healthy",
            observed: toRecord({ ...observed }),
            threshold: toRecord({ ...threshold })
        };
    }

    private evaluateReconciliationMismatchSpike(
        observed: ReconciliationMismatchSpikeSignals,
        threshold: ReconciliationMismatchSpikeThreshold
    ): AutoSafetyTriggerResult {
        const breached =
            (observed.mismatchCount > threshold.maxMismatchCount ||
                observed.mismatchRate > threshold.maxMismatchRate ||
                observed.infraErrorCount > threshold.maxInfraErrorCount ||
                observed.lockConflictCount > threshold.maxLockConflictCount) &&
            observed.breachedWindows >= threshold.minBreachedWindows &&
            observed.sustainedDurationMs >= threshold.minDurationMs;

        return {
            trigger: "reconciliation_mismatch_spike",
            breached,
            reason: breached ? "reconciliation thresholds breached" : "reconciliation thresholds healthy",
            observed: toRecord({ ...observed }),
            threshold: toRecord({ ...threshold })
        };
    }

    private evaluatePlannerLatencyBreach(
        observed: PlannerLatencyBreachSignals,
        threshold: PlannerLatencyBreachThreshold
    ): AutoSafetyTriggerResult {
        const breached =
            (observed.p95Ms > threshold.maxP95Ms || observed.p99Ms > threshold.maxP99Ms) &&
            observed.breachedWindows >= threshold.minBreachedWindows &&
            observed.sustainedDurationMs >= threshold.minDurationMs;

        return {
            trigger: "planner_latency_breach_sustained",
            breached,
            reason: breached ? "planner latency sustained breach detected" : "planner latency within threshold",
            observed: toRecord({ ...observed }),
            threshold: toRecord({ ...threshold })
        };
    }

    private evaluateNegativeEconomicQuality(
        observed: NegativeEconomicQualitySignals,
        threshold: NegativeEconomicQualityThreshold
    ): AutoSafetyTriggerResult {
        const breached =
            (parseDecimal(observed.priceImprovement, "negativeEconomicQuality.priceImprovement").lt(
                parseDecimal(threshold.minPriceImprovement, "negativeEconomicQuality.threshold.minPriceImprovement")
            ) ||
                parseDecimal(observed.slippageSaved, "negativeEconomicQuality.slippageSaved").lt(
                    parseDecimal(threshold.minSlippageSaved, "negativeEconomicQuality.threshold.minSlippageSaved")
                ) ||
                parseDecimal(observed.feeSaved, "negativeEconomicQuality.feeSaved").lt(
                    parseDecimal(threshold.minFeeSaved, "negativeEconomicQuality.threshold.minFeeSaved")
                ) ||
                parseDecimal(observed.externalNotionalAvoided, "negativeEconomicQuality.externalNotionalAvoided").lt(
                    parseDecimal(
                        threshold.minExternalNotionalAvoided,
                        "negativeEconomicQuality.threshold.minExternalNotionalAvoided"
                    )
                ) ||
                parseDecimal(observed.internalizationGain, "negativeEconomicQuality.internalizationGain").lt(
                    parseDecimal(
                        threshold.minInternalizationGain,
                        "negativeEconomicQuality.threshold.minInternalizationGain"
                    )
                ) ||
                parseDecimal(observed.compressionGain, "negativeEconomicQuality.compressionGain").lt(
                    parseDecimal(threshold.minCompressionGain, "negativeEconomicQuality.threshold.minCompressionGain")
                )) &&
            observed.breachedWindows >= threshold.minBreachedWindows &&
            observed.sustainedDurationMs >= threshold.minDurationMs;

        return {
            trigger: "negative_economic_quality_sustained",
            breached,
            reason: breached ? "economic quality sustained breach detected" : "economic quality within threshold",
            observed: toRecord({ ...observed }),
            threshold: toRecord({ ...threshold })
        };
    }

    private evaluateStaleReservationGrowth(
        observed: StaleReservationGrowthSignals,
        threshold: StaleReservationGrowthThreshold
    ): AutoSafetyTriggerResult {
        const breached =
            (observed.staleReservationCount > threshold.maxStaleReservationCount ||
                observed.growthRate > threshold.maxGrowthRate) &&
            observed.breachedWindows >= threshold.minBreachedWindows &&
            observed.sustainedDurationMs >= threshold.minDurationMs;

        return {
            trigger: "stale_reservation_growth",
            breached,
            reason: breached ? "stale reservation growth detected" : "stale reservation growth within threshold",
            observed: toRecord({ ...observed }),
            threshold: toRecord({ ...threshold })
        };
    }

    private evaluateInternalizationFailureSpike(
        observed: InternalizationFailureSpikeSignals,
        threshold: InternalizationFailureSpikeThreshold
    ): AutoSafetyTriggerResult {
        const breached =
            (observed.failureCount > threshold.maxFailureCount || observed.failureRate > threshold.maxFailureRate) &&
            observed.breachedWindows >= threshold.minBreachedWindows &&
            observed.sustainedDurationMs >= threshold.minDurationMs;

        return {
            trigger: "internalization_failure_spike",
            breached,
            reason: breached ? "internalization failure spike detected" : "internalization failure rate healthy",
            observed: toRecord({ ...observed }),
            threshold: toRecord({ ...threshold })
        };
    }

    private selectAction(
        currentStage: QualificationStage,
        breached: readonly AutoSafetyTriggerResult[]
    ): {
        actionType: AutoSafetyActionType;
        recommendedStage?: QualificationStage;
        primaryTrigger: AutoSafetyTriggerResult;
    } {
        const mapped = breached.map((result) => ({
            trigger: result,
            actionType: this.config.actions[result.trigger]
        }));

        const selectedAction =
            ACTION_PRECEDENCE.find((actionType) => mapped.some((entry) => entry.actionType === actionType)) ??
            mapped[0]!.actionType;
        const selectedTrigger = mapped.find((entry) => entry.actionType === selectedAction)?.trigger ?? breached[0]!;

        if (selectedAction === AutoSafetyActionType.DEMOTE_STAGE) {
            const recommendedStage = nextLowerStage(currentStage);
            if (!recommendedStage) {
                return {
                    actionType: AutoSafetyActionType.PAUSE_SCOPE,
                    primaryTrigger: selectedTrigger
                };
            }

            return {
                actionType: selectedAction,
                recommendedStage,
                primaryTrigger: selectedTrigger
            };
        }

        return {
            actionType: selectedAction,
            primaryTrigger: selectedTrigger
        };
    }

    private async applyControlPlaneAction(
        input: AutoSafetyEvaluationInput,
        actionType: AutoSafetyActionType,
        trigger: AutoSafetyTriggerId,
        recommendedStage?: QualificationStage
    ): Promise<AutoSafetyControlPlaneEffect> {
        switch (actionType) {
            case AutoSafetyActionType.DISABLE_PHASE2B:
                await this.controlPlaneAdminService.degradeShard({
                    shardId: input.shardId,
                    targetMode: "DISABLE_PHASE2B",
                    requestedBy: REQUESTED_BY
                });
                return {
                    applied: true,
                    operation: "degrade_shard",
                    scopeType: "SHARD",
                    scopeId: input.shardId,
                    targetMode: "DISABLE_PHASE2B"
                };
            case AutoSafetyActionType.DISABLE_PHASE2A_AND_2B:
                await this.controlPlaneAdminService.degradeShard({
                    shardId: input.shardId,
                    targetMode: "DISABLE_PHASE2A_AND_2B",
                    requestedBy: REQUESTED_BY
                });
                return {
                    applied: true,
                    operation: "degrade_shard",
                    scopeType: "SHARD",
                    scopeId: input.shardId,
                    targetMode: "DISABLE_PHASE2A_AND_2B"
                };
            case AutoSafetyActionType.FORCE_SOR_ONLY:
                await this.controlPlaneAdminService.degradeShard({
                    shardId: input.shardId,
                    targetMode: "SOR_ONLY",
                    requestedBy: REQUESTED_BY
                });
                return {
                    applied: true,
                    operation: "degrade_shard",
                    scopeType: "SHARD",
                    scopeId: input.shardId,
                    targetMode: "SOR_ONLY"
                };
            case AutoSafetyActionType.PAUSE_SCOPE:
                if (normalizeScopeType(input.scopeType) === "BUCKET" && input.bucketId) {
                    await this.controlPlaneAdminService.drainBucket(input.bucketId, REQUESTED_BY);
                    return {
                        applied: true,
                        operation: "drain_bucket",
                        scopeType: "BUCKET",
                        scopeId: input.bucketId
                    };
                }

                await this.controlPlaneAdminService.pauseShard(input.shardId, REQUESTED_BY);
                return {
                    applied: true,
                    operation: "pause_shard",
                    scopeType: "SHARD",
                    scopeId: input.shardId
                };
            case AutoSafetyActionType.DISABLE_RESOLUTION_POOLING: {
                const scopeType = this.ensureOverrideScopeType(input.scopeType);
                const expiresAt = new Date(Date.now() + this.config.resolutionPoolingOverrideTtlMs);
                const override = await this.controlPlaneAdminService.createOverride({
                    scopeType,
                    scopeId: input.scopeId,
                    overrideType: "GUARDRAIL_ENFORCEMENT",
                    payload: {
                        enforcementMode: "ENFORCED",
                        reason: `phase3b:auto_safety:disable_resolution_pooling:${trigger}`,
                        policy: "DISABLE_RESOLUTION_POOLING",
                        strategyKey: input.strategyKey,
                        scopeType: input.scopeType,
                        scopeId: input.scopeId
                    },
                    createdBy: REQUESTED_BY,
                    expiresAt
                });
                return {
                    applied: true,
                    operation: "create_override",
                    scopeType: override.scopeType,
                    scopeId: override.scopeId,
                    overrideType: override.overrideType,
                    expiresAt: override.expiresAt
                };
            }
            case AutoSafetyActionType.DEMOTE_STAGE: {
                if (!recommendedStage) {
                    throw new AutoSafetyActionEngineError("invalid_input", "DEMOTE_STAGE requires a recommendedStage.");
                }

                const targetMode = demotionModeForStage(recommendedStage);
                if (!targetMode) {
                    throw new AutoSafetyActionEngineError(
                        "invalid_input",
                        `No control-plane mapping exists for demotion target ${recommendedStage}.`
                    );
                }

                const expiresAt =
                    targetMode === "SOR_ONLY" && this.config.sorOnlyOverrideTtlMs > 0
                        ? new Date(Date.now() + this.config.sorOnlyOverrideTtlMs)
                        : null;
                const override = await this.controlPlaneAdminService.createOverride({
                    scopeType: "SHARD",
                    scopeId: input.shardId,
                    overrideType: "EXECUTION_MODE",
                    payload: {
                        mode: targetMode,
                        reason: `phase3b:auto_safety:demote_stage:${recommendedStage}`
                    },
                    createdBy: REQUESTED_BY,
                    expiresAt
                });

                return {
                    applied: true,
                    operation: "create_override",
                    scopeType: override.scopeType,
                    scopeId: override.scopeId,
                    overrideType: override.overrideType,
                    targetMode,
                    expiresAt: override.expiresAt
                };
            }
            default:
                throw new AutoSafetyActionEngineError("invalid_input", `Unsupported action ${actionType}.`);
        }
    }

    private ensureOverrideScopeType(scopeType: string): "MARKET" | "BUCKET" | "SHARD" | "ENGINE" {
        const normalized = normalizeScopeType(scopeType);
        if (!OVERRIDE_SCOPE_TYPES.has(normalized)) {
            throw new AutoSafetyActionEngineError(
                "invalid_input",
                `scopeType ${scopeType} cannot be used for a control-plane override.`
            );
        }
        return normalized as "MARKET" | "BUCKET" | "SHARD" | "ENGINE";
    }

    private async findLatestMatchingAction(
        strategyKey: string,
        scopeType: string,
        scopeId: string,
        actionType: AutoSafetyActionType
    ): Promise<AutoSafetyAction | null> {
        const result: QueryResult<AutoSafetyActionRow> = await this.pool.query(
            `SELECT id, strategy_key, scope_type, scope_id, action_type, trigger_reason, created_at, resolved_at, metadata
             FROM auto_safety_actions
             WHERE strategy_key = $1
               AND scope_type = $2
               AND scope_id = $3
               AND action_type = $4
             ORDER BY created_at DESC, id DESC
             LIMIT 1`,
            [strategyKey, scopeType, scopeId, actionType]
        );

        return result.rows[0] ? mapAutoSafetyActionRow(result.rows[0]) : null;
    }

    private async insertAction(input: {
        strategyKey: string;
        scopeType: string;
        scopeId: string;
        actionType: AutoSafetyActionType;
        triggerReason: AutoSafetyTriggerId;
        metadata: Record<string, unknown>;
    }): Promise<AutoSafetyAction> {
        const result: QueryResult<AutoSafetyActionRow> = await this.pool.query(
            `INSERT INTO auto_safety_actions (strategy_key, scope_type, scope_id, action_type, trigger_reason, metadata)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)
             RETURNING id, strategy_key, scope_type, scope_id, action_type, trigger_reason, created_at, resolved_at, metadata`,
            [
                input.strategyKey,
                input.scopeType,
                input.scopeId,
                input.actionType,
                input.triggerReason,
                JSON.stringify(input.metadata)
            ]
        );

        const row = result.rows[0];
        if (!row) {
            throw new AutoSafetyActionEngineError("persistence_failed", "Failed to persist auto safety action.");
        }

        autoSafetyActionsCreatedTotal.labels(row.action_type, row.trigger_reason, row.scope_type).inc();
        return mapAutoSafetyActionRow(row);
    }
}
