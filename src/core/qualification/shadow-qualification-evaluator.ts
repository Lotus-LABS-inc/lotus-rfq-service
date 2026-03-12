import type { Logger } from "pino";

import {
    CounterfactualBaselineType,
    EconomicQualityEngine,
    type EconomicExecutionSnapshot,
    type EconomicQualityEvaluationResult
} from "./economic-quality-engine.js";
import type { ExternalOnlyBaselineBuilder, ExternalOnlyBaselineInput } from "./baselines/external-only-baseline.js";
import type { NoInternalizationBaselineBuilder, NoInternalizationBaselineInput } from "./baselines/no-internalization-baseline.js";
import type { NoResolutionRiskBaselineBuilder, NoResolutionRiskBaselineInput } from "./baselines/no-resolution-risk-baseline.js";
import type { QualificationRunManager } from "./qualification-run-manager.js";
import type { StrategyDecisionEvaluation } from "./qualification.types.js";

export type ShadowDecisionType =
    | "SOR_CONFIG_CHANGE"
    | "RFQ_GROUPING_CHANGE"
    | "RESOLUTION_RISK_THRESHOLD_CHANGE"
    | "PHASE1_INTERNAL_CROSS_CHANGE"
    | "PHASE2A_NETTING_SCOPE_CHANGE"
    | "PHASE2B_CLEARING_STRATEGY_CHANGE";

export type ShadowQualificationEvaluatorErrorCode =
    | "invalid_input"
    | "missing_economic_context"
    | "unsupported_baseline"
    | "evaluation_failed";

export class ShadowQualificationEvaluatorError extends Error {
    public readonly code: ShadowQualificationEvaluatorErrorCode;

    public constructor(code: ShadowQualificationEvaluatorErrorCode, message: string) {
        super(message);
        this.name = "ShadowQualificationEvaluatorError";
        this.code = code;
    }
}

type DecisionCallable<T> = () => Promise<T> | T;

export interface SORDecisionOutput {
    routeIds: readonly string[];
    providerIds: readonly string[];
    allocations: ReadonlyArray<{
        candidateId: string;
        providerId: string;
        targetSize: string;
        targetPrice: string;
    }>;
    effectiveSourceMix?: Record<string, unknown>;
}

export interface RFQGroupingDecisionOutput {
    safePools: readonly string[][];
    cautionLanes: readonly string[][];
    blockedProfiles: readonly string[];
}

export interface ResolutionRiskDecisionOutput {
    intendedDecision: string;
    enforcedDecision: string;
    equivalenceClass?: string | null;
    reason: string;
}

export interface InternalCrossDecisionOutput {
    filledSize: string;
    matchedOrderIds: readonly string[];
    remainingSize: string;
}

export interface NettingDecisionOutput {
    nettingGroupIds: readonly string[];
    nettedSize: string;
    residualLegs: ReadonlyArray<{
        id: string;
        remainingSize: string;
    }>;
}

export interface ClearingDecisionOutput {
    clearingRoundId: string;
    participantSetHash: string;
    matchSignatureHash: string;
    compressionScore: string;
    residuals: ReadonlyArray<{
        key: string;
        signedResidual: string;
    }>;
}

interface ShadowQualificationEvaluationInputBase<TDecisionOutput> {
    qualificationRunId: string;
    strategyKey: string;
    scopeType: string;
    scopeId: string;
    decisionType: ShadowDecisionType;
    entityId: string;
    replayEnvelopeId?: string | null;
    liveDecision: DecisionCallable<TDecisionOutput>;
    shadowDecision: DecisionCallable<TDecisionOutput>;
    liveEconomicSnapshot?: EconomicExecutionSnapshot;
    shadowEconomicSnapshot?: EconomicExecutionSnapshot;
    metadata?: Record<string, unknown>;
}

export interface SORShadowQualificationEvaluationInput extends ShadowQualificationEvaluationInputBase<SORDecisionOutput> {
    decisionType: "SOR_CONFIG_CHANGE";
}

export interface RFQGroupingShadowQualificationEvaluationInput extends ShadowQualificationEvaluationInputBase<RFQGroupingDecisionOutput> {
    decisionType: "RFQ_GROUPING_CHANGE";
}

export interface ResolutionRiskShadowQualificationEvaluationInput extends ShadowQualificationEvaluationInputBase<ResolutionRiskDecisionOutput> {
    decisionType: "RESOLUTION_RISK_THRESHOLD_CHANGE";
}

export interface InternalCrossShadowQualificationEvaluationInput extends ShadowQualificationEvaluationInputBase<InternalCrossDecisionOutput> {
    decisionType: "PHASE1_INTERNAL_CROSS_CHANGE";
}

export interface NettingShadowQualificationEvaluationInput extends ShadowQualificationEvaluationInputBase<NettingDecisionOutput> {
    decisionType: "PHASE2A_NETTING_SCOPE_CHANGE";
}

export interface ClearingShadowQualificationEvaluationInput extends ShadowQualificationEvaluationInputBase<ClearingDecisionOutput> {
    decisionType: "PHASE2B_CLEARING_STRATEGY_CHANGE";
}

export type BuilderReadyBaselineInput =
    | {
        baselineType: CounterfactualBaselineType.BEST_EXTERNAL_ONLY;
        builderInput: ExternalOnlyBaselineInput;
    }
    | {
        baselineType: CounterfactualBaselineType.NO_INTERNAL_CROSS | CounterfactualBaselineType.NO_PHASE2_CLEARING;
        builderInput: NoInternalizationBaselineInput;
    }
    | {
        baselineType: CounterfactualBaselineType.NO_RESOLUTION_AWARE_GROUPING;
        builderInput: NoResolutionRiskBaselineInput;
    };

type EconomicContext =
    | {
        mode: "direct";
        primaryBaseline: CounterfactualBaselineType;
    }
    | {
        mode: "baseline_builder";
        baseline: BuilderReadyBaselineInput;
    };

export type ShadowQualificationEvaluationInput =
    | (SORShadowQualificationEvaluationInput & { economicContext?: EconomicContext })
    | (RFQGroupingShadowQualificationEvaluationInput & { economicContext?: EconomicContext })
    | (ResolutionRiskShadowQualificationEvaluationInput & { economicContext?: EconomicContext })
    | (InternalCrossShadowQualificationEvaluationInput & { economicContext?: EconomicContext })
    | (NettingShadowQualificationEvaluationInput & { economicContext?: EconomicContext })
    | (ClearingShadowQualificationEvaluationInput & { economicContext?: EconomicContext });

export interface ShadowDecisionFieldDiff {
    path: string;
    live: unknown;
    shadow: unknown;
}

export interface ShadowDecisionComparison {
    matched: boolean;
    divergenceReason:
        | "no_diff"
        | "route_choice_changed"
        | "allocation_changed"
        | "grouping_changed"
        | "resolution_threshold_changed"
        | "internal_cross_fill_changed"
        | "netting_scope_changed"
        | "clearing_selection_changed"
        | "compression_changed";
    liveSummary: Record<string, unknown>;
    shadowSummary: Record<string, unknown>;
    fieldDiffs: readonly ShadowDecisionFieldDiff[];
}

export interface ShadowQualificationEvaluationResult {
    decisionComparison: ShadowDecisionComparison;
    economicComparison?: EconomicQualityEvaluationResult;
    persistedEvaluation: StrategyDecisionEvaluation;
    nonMutating: true;
}

export interface ShadowQualificationEvaluatorDeps {
    qualificationRunManager: Pick<QualificationRunManager, "recordDecisionEvaluation">;
    economicQualityEngine: EconomicQualityEngine;
    externalOnlyBaselineBuilder?: Pick<ExternalOnlyBaselineBuilder, "build">;
    noInternalizationBaselineBuilder?: Pick<NoInternalizationBaselineBuilder, "build">;
    noResolutionRiskBaselineBuilder?: Pick<NoResolutionRiskBaselineBuilder, "build">;
    logger?: Pick<Logger, "info" | "warn" | "error">;
}

const ensureNonEmptyString = (value: string, fieldName: string): void => {
    if (value.trim().length === 0) {
        throw new ShadowQualificationEvaluatorError("invalid_input", `${fieldName} must be a non-empty string.`);
    }
};

const clone = <T>(value: T): T => structuredClone(value);

const normalizeArray = (items: readonly unknown[]): readonly unknown[] => items.map((item) => normalizeValue(item));

const normalizeObject = (value: Record<string, unknown>): Record<string, unknown> =>
    Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .reduce<Record<string, unknown>>((accumulator, key) => {
            accumulator[key] = normalizeValue(value[key]);
            return accumulator;
        }, {});

const normalizeValue = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        return normalizeArray(value);
    }
    if (value !== null && typeof value === "object") {
        return normalizeObject(value as Record<string, unknown>);
    }
    return value;
};

const stableStringify = (value: unknown): string => JSON.stringify(normalizeValue(value));

const asPlainRecord = (value: unknown): Record<string, unknown> => normalizeValue(value) as Record<string, unknown>;

interface QualificationRollupMetadata {
    market?: string;
    venuePair?: string;
    liveVenue?: string;
    shadowVenue?: string;
}

const maybeString = (value: unknown): string | undefined => {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeSORDecision = (decision: SORDecisionOutput): Record<string, unknown> => ({
    routeIds: [...decision.routeIds],
    providerIds: [...decision.providerIds],
    allocations: [...decision.allocations].map((allocation) => ({
        candidateId: allocation.candidateId,
        providerId: allocation.providerId,
        targetPrice: allocation.targetPrice,
        targetSize: allocation.targetSize
    })),
    ...(decision.effectiveSourceMix ? { effectiveSourceMix: normalizeObject(decision.effectiveSourceMix) } : {})
});

const resolveRollupMetadata = (
    input: ShadowQualificationEvaluationInput,
    liveSummary: Record<string, unknown>,
    shadowSummary: Record<string, unknown>
): QualificationRollupMetadata => {
    const metadata = input.metadata ?? {};
    const market = maybeString(metadata.market) ?? (input.scopeType.toUpperCase() === "MARKET" ? input.scopeId : undefined);
    const liveVenue =
        maybeString(metadata.liveVenue) ??
        (Array.isArray(liveSummary.providerIds) ? maybeString(liveSummary.providerIds[0]) : undefined);
    const shadowVenue =
        maybeString(metadata.shadowVenue) ??
        (Array.isArray(shadowSummary.providerIds) ? maybeString(shadowSummary.providerIds[0]) : undefined);
    const venuePair = maybeString(metadata.venuePair) ?? (liveVenue && shadowVenue ? `${liveVenue}->${shadowVenue}` : undefined);

    return {
        ...(market ? { market } : {}),
        ...(venuePair ? { venuePair } : {}),
        ...(liveVenue ? { liveVenue } : {}),
        ...(shadowVenue ? { shadowVenue } : {})
    };
};

const appendRollupMetadata = (
    record: Record<string, unknown>,
    metadata: QualificationRollupMetadata
): Record<string, unknown> => ({
    ...record,
    ...metadata
});

const sortNestedStringArrays = (arrays: readonly string[][]): readonly string[][] =>
    [...arrays]
        .map((entry) => [...entry].sort((left, right) => left.localeCompare(right)))
        .sort((left, right) => left.join("|").localeCompare(right.join("|")));

const normalizeGroupingDecision = (decision: RFQGroupingDecisionOutput): Record<string, unknown> => ({
    safePools: sortNestedStringArrays(decision.safePools),
    cautionLanes: sortNestedStringArrays(decision.cautionLanes),
    blockedProfiles: [...decision.blockedProfiles].sort((left, right) => left.localeCompare(right))
});

const normalizeResolutionRiskDecision = (decision: ResolutionRiskDecisionOutput): Record<string, unknown> => ({
    intendedDecision: decision.intendedDecision,
    enforcedDecision: decision.enforcedDecision,
    equivalenceClass: decision.equivalenceClass ?? null,
    reason: decision.reason
});

const normalizeInternalCrossDecision = (decision: InternalCrossDecisionOutput): Record<string, unknown> => ({
    filledSize: decision.filledSize,
    matchedOrderIds: [...decision.matchedOrderIds].sort((left, right) => left.localeCompare(right)),
    remainingSize: decision.remainingSize
});

const normalizeNettingDecision = (decision: NettingDecisionOutput): Record<string, unknown> => ({
    nettingGroupIds: [...decision.nettingGroupIds].sort((left, right) => left.localeCompare(right)),
    nettedSize: decision.nettedSize,
    residualLegs: [...decision.residualLegs].sort((left, right) => left.id.localeCompare(right.id))
});

const normalizeClearingDecision = (decision: ClearingDecisionOutput): Record<string, unknown> => ({
    clearingRoundId: decision.clearingRoundId,
    participantSetHash: decision.participantSetHash,
    matchSignatureHash: decision.matchSignatureHash,
    compressionScore: decision.compressionScore,
    residuals: [...decision.residuals].sort((left, right) => left.key.localeCompare(right.key))
});

const collectDiffs = (path: string, live: unknown, shadow: unknown, accumulator: ShadowDecisionFieldDiff[]): void => {
    if (stableStringify(live) === stableStringify(shadow)) {
        return;
    }

    if (Array.isArray(live) && Array.isArray(shadow)) {
        if (live.length !== shadow.length) {
            accumulator.push({ path, live, shadow });
            return;
        }

        live.forEach((entry, index) => {
            collectDiffs(`${path}[${index}]`, entry, shadow[index], accumulator);
        });
        return;
    }

    if (live !== null && shadow !== null && typeof live === "object" && typeof shadow === "object") {
        const liveObject = live as Record<string, unknown>;
        const shadowObject = shadow as Record<string, unknown>;
        const keys = [...new Set([...Object.keys(liveObject), ...Object.keys(shadowObject)])].sort((left, right) =>
            left.localeCompare(right)
        );

        keys.forEach((key) => {
            collectDiffs(path ? `${path}.${key}` : key, liveObject[key], shadowObject[key], accumulator);
        });
        return;
    }

    accumulator.push({ path, live, shadow });
};

const compareSummaries = (
    divergenceReason: ShadowDecisionComparison["divergenceReason"],
    liveSummary: Record<string, unknown>,
    shadowSummary: Record<string, unknown>
): ShadowDecisionComparison => {
    const fieldDiffs: ShadowDecisionFieldDiff[] = [];
    collectDiffs("", liveSummary, shadowSummary, fieldDiffs);

    return {
        matched: fieldDiffs.length === 0,
        divergenceReason: fieldDiffs.length === 0 ? "no_diff" : divergenceReason,
        liveSummary,
        shadowSummary,
        fieldDiffs
    };
};

const structuralComparisonForInput = (
    input: ShadowQualificationEvaluationInput,
    liveDecision: unknown,
    shadowDecision: unknown
): ShadowDecisionComparison => {
    switch (input.decisionType) {
        case "SOR_CONFIG_CHANGE": {
            const liveSummary = normalizeSORDecision(liveDecision as SORDecisionOutput);
            const shadowSummary = normalizeSORDecision(shadowDecision as SORDecisionOutput);
            const liveRoutes = stableStringify(liveSummary.routeIds);
            const shadowRoutes = stableStringify(shadowSummary.routeIds);
            return compareSummaries(
                liveRoutes !== shadowRoutes ? "route_choice_changed" : "allocation_changed",
                liveSummary,
                shadowSummary
            );
        }
        case "RFQ_GROUPING_CHANGE":
            return compareSummaries(
                "grouping_changed",
                normalizeGroupingDecision(liveDecision as RFQGroupingDecisionOutput),
                normalizeGroupingDecision(shadowDecision as RFQGroupingDecisionOutput)
            );
        case "RESOLUTION_RISK_THRESHOLD_CHANGE":
            return compareSummaries(
                "resolution_threshold_changed",
                normalizeResolutionRiskDecision(liveDecision as ResolutionRiskDecisionOutput),
                normalizeResolutionRiskDecision(shadowDecision as ResolutionRiskDecisionOutput)
            );
        case "PHASE1_INTERNAL_CROSS_CHANGE":
            return compareSummaries(
                "internal_cross_fill_changed",
                normalizeInternalCrossDecision(liveDecision as InternalCrossDecisionOutput),
                normalizeInternalCrossDecision(shadowDecision as InternalCrossDecisionOutput)
            );
        case "PHASE2A_NETTING_SCOPE_CHANGE":
            return compareSummaries(
                "netting_scope_changed",
                normalizeNettingDecision(liveDecision as NettingDecisionOutput),
                normalizeNettingDecision(shadowDecision as NettingDecisionOutput)
            );
        case "PHASE2B_CLEARING_STRATEGY_CHANGE": {
            const liveSummary = normalizeClearingDecision(liveDecision as ClearingDecisionOutput);
            const shadowSummary = normalizeClearingDecision(shadowDecision as ClearingDecisionOutput);
            const reason =
                stableStringify({
                    clearingRoundId: liveSummary.clearingRoundId,
                    participantSetHash: liveSummary.participantSetHash,
                    matchSignatureHash: liveSummary.matchSignatureHash
                }) !==
                stableStringify({
                    clearingRoundId: shadowSummary.clearingRoundId,
                    participantSetHash: shadowSummary.participantSetHash,
                    matchSignatureHash: shadowSummary.matchSignatureHash
                })
                    ? "clearing_selection_changed"
                    : "compression_changed";
            return compareSummaries(reason, liveSummary, shadowSummary);
        }
        default:
            throw new ShadowQualificationEvaluatorError("invalid_input", `Unsupported decision type ${(input as { decisionType: string }).decisionType}.`);
    }
};

export class ShadowQualificationEvaluator {
    private readonly qualificationRunManager: Pick<QualificationRunManager, "recordDecisionEvaluation">;
    private readonly economicQualityEngine: EconomicQualityEngine;
    private readonly externalOnlyBaselineBuilder: Pick<ExternalOnlyBaselineBuilder, "build"> | undefined;
    private readonly noInternalizationBaselineBuilder: Pick<NoInternalizationBaselineBuilder, "build"> | undefined;
    private readonly noResolutionRiskBaselineBuilder: Pick<NoResolutionRiskBaselineBuilder, "build"> | undefined;
    private readonly logger: Pick<Logger, "info" | "warn" | "error"> | undefined;

    public constructor(deps: ShadowQualificationEvaluatorDeps) {
        this.qualificationRunManager = deps.qualificationRunManager;
        this.economicQualityEngine = deps.economicQualityEngine;
        this.externalOnlyBaselineBuilder = deps.externalOnlyBaselineBuilder;
        this.noInternalizationBaselineBuilder = deps.noInternalizationBaselineBuilder;
        this.noResolutionRiskBaselineBuilder = deps.noResolutionRiskBaselineBuilder;
        this.logger = deps.logger;
    }

    public async evaluate(input: ShadowQualificationEvaluationInput): Promise<ShadowQualificationEvaluationResult> {
        ensureNonEmptyString(input.qualificationRunId, "qualificationRunId");
        ensureNonEmptyString(input.strategyKey, "strategyKey");
        ensureNonEmptyString(input.scopeType, "scopeType");
        ensureNonEmptyString(input.scopeId, "scopeId");
        ensureNonEmptyString(input.entityId, "entityId");

        const [liveDecision, shadowDecision] = await Promise.all([
            Promise.resolve().then(() => input.liveDecision()),
            Promise.resolve().then(() => input.shadowDecision())
        ]);

        const decisionComparison = structuralComparisonForInput(input, clone(liveDecision), clone(shadowDecision));
        const economicComparison = this.buildEconomicComparison(input);
        const rollupMetadata = resolveRollupMetadata(input, decisionComparison.liveSummary, decisionComparison.shadowSummary);
        const realizedMetrics = appendRollupMetadata(
            asPlainRecord(economicComparison?.realized ?? decisionComparison.liveSummary),
            rollupMetadata
        );
        const counterfactualMetrics = appendRollupMetadata(
            asPlainRecord(economicComparison?.baselines?.[economicComparison.primaryBaseline] ?? decisionComparison.shadowSummary),
            rollupMetadata
        );

        const persistedEvaluation = await this.qualificationRunManager.recordDecisionEvaluation(input.qualificationRunId, {
            decisionType: input.decisionType,
            entityId: input.entityId,
            replayEnvelopeId: input.replayEnvelopeId ?? null,
            realizedMetrics,
            counterfactualMetrics,
            improvementMetrics: asPlainRecord(
                economicComparison?.improvement ?? {
                    matched: decisionComparison.matched,
                    divergenceReason: decisionComparison.divergenceReason,
                    fieldDiffs: decisionComparison.fieldDiffs,
                    ...(input.metadata ? { metadata: input.metadata } : {})
                }
            )
        });

        this.logger?.info?.(
            {
                qualificationRunId: input.qualificationRunId,
                decisionType: input.decisionType,
                entityId: input.entityId,
                matched: decisionComparison.matched,
                divergenceReason: decisionComparison.divergenceReason
            },
            "Persisted shadow qualification evaluation."
        );

        return {
            decisionComparison,
            ...(economicComparison ? { economicComparison } : {}),
            persistedEvaluation,
            nonMutating: true
        };
    }

    private buildEconomicComparison(input: ShadowQualificationEvaluationInput): EconomicQualityEvaluationResult | undefined {
        if (!input.economicContext) {
            return undefined;
        }

        if (input.economicContext.mode === "direct") {
            if (!input.liveEconomicSnapshot || !input.shadowEconomicSnapshot) {
                throw new ShadowQualificationEvaluatorError(
                    "missing_economic_context",
                    "Direct economic comparison requires both liveEconomicSnapshot and shadowEconomicSnapshot."
                );
            }

            return this.economicQualityEngine.evaluate({
                realized: clone(input.liveEconomicSnapshot),
                baselines: {
                    [input.economicContext.primaryBaseline]: clone(input.shadowEconomicSnapshot)
                },
                primaryBaseline: input.economicContext.primaryBaseline
            });
        }

        if (!input.liveEconomicSnapshot) {
            throw new ShadowQualificationEvaluatorError(
                "missing_economic_context",
                "Baseline-builder economic comparison requires liveEconomicSnapshot."
            );
        }

        const builtBaseline = this.buildBaselineSnapshot(input.economicContext.baseline);
        return this.economicQualityEngine.evaluate({
            realized: clone(input.liveEconomicSnapshot),
            baselines: {
                [input.economicContext.baseline.baselineType]: builtBaseline
            },
            primaryBaseline: input.economicContext.baseline.baselineType
        });
    }

    private buildBaselineSnapshot(input: BuilderReadyBaselineInput): EconomicExecutionSnapshot {
        switch (input.baselineType) {
            case CounterfactualBaselineType.BEST_EXTERNAL_ONLY:
                if (!this.externalOnlyBaselineBuilder) {
                    throw new ShadowQualificationEvaluatorError("unsupported_baseline", "External-only baseline builder is not configured.");
                }
                return this.externalOnlyBaselineBuilder.build(input.builderInput);
            case CounterfactualBaselineType.NO_INTERNAL_CROSS:
            case CounterfactualBaselineType.NO_PHASE2_CLEARING:
                if (!this.noInternalizationBaselineBuilder) {
                    throw new ShadowQualificationEvaluatorError("unsupported_baseline", "No-internalization baseline builder is not configured.");
                }
                return this.noInternalizationBaselineBuilder.build(input.builderInput);
            case CounterfactualBaselineType.NO_RESOLUTION_AWARE_GROUPING:
                if (!this.noResolutionRiskBaselineBuilder) {
                    throw new ShadowQualificationEvaluatorError("unsupported_baseline", "No-resolution-risk baseline builder is not configured.");
                }
                return this.noResolutionRiskBaselineBuilder.build(input.builderInput);
            default:
                throw new ShadowQualificationEvaluatorError("unsupported_baseline", `Unsupported baseline type ${(input as { baselineType: string }).baselineType}.`);
        }
    }
}
