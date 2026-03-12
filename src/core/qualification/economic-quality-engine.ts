import Decimal from "decimal.js";

export enum CounterfactualBaselineType {
    BEST_EXTERNAL_ONLY = "BEST_EXTERNAL_ONLY",
    NO_INTERNAL_CROSS = "NO_INTERNAL_CROSS",
    NO_PHASE2_CLEARING = "NO_PHASE2_CLEARING",
    NO_RESOLUTION_AWARE_GROUPING = "NO_RESOLUTION_AWARE_GROUPING"
}

export type EconomicQualityEngineErrorCode =
    | "invalid_snapshot"
    | "invalid_baseline"
    | "invalid_metric_input";

export class EconomicQualityEngineError extends Error {
    public readonly code: EconomicQualityEngineErrorCode;

    public constructor(code: EconomicQualityEngineErrorCode, message: string) {
        super(message);
        this.name = "EconomicQualityEngineError";
        this.code = code;
    }
}

export interface EconomicExecutionSnapshot {
    requestedSize: string;
    filledSize: string;
    fillNotional: string;
    effectiveCost: string;
    fees: string;
    fillPrice: string;
    arrivalPrice: string;
    externalNotional: string;
    internalizedNotional: string;
    crossedNotional: string;
    nettedNotional: string;
    clearedNotional: string;
    compressionNotional: string;
    timeToFillMs: number;
    routeBreakdown?: Record<string, unknown>;
    executionSourceMix?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}

export interface EconomicQualityInput {
    realized: EconomicExecutionSnapshot;
    baselines: Partial<Record<CounterfactualBaselineType, EconomicExecutionSnapshot>>;
    primaryBaseline: CounterfactualBaselineType;
}

export interface RealizedQualityMetrics {
    realizedFillPrice: string;
    realizedEffectiveCost: string;
    realizedSlippage: string;
    realizedFees: string;
    timeToFillMs: number;
    partialFillRatio: string;
    externalNotional: string;
    internalizedNotional: string;
    compressionNotional: string;
}

export interface ImprovementMetrics {
    priceImprovement: string;
    slippageSaved: string;
    feeSaved: string;
    externalNotionalAvoided: string;
    internalizationGain: string;
    compressionGain: string;
}

export interface EconomicQualityEvaluationResult {
    realized: RealizedQualityMetrics;
    baselines: Partial<Record<CounterfactualBaselineType, RealizedQualityMetrics>>;
    primaryBaseline: CounterfactualBaselineType;
    improvement: ImprovementMetrics;
}

type RequiredDecimalField =
    | "requestedSize"
    | "filledSize"
    | "fillNotional"
    | "effectiveCost"
    | "fees"
    | "fillPrice"
    | "arrivalPrice"
    | "externalNotional"
    | "internalizedNotional"
    | "crossedNotional"
    | "nettedNotional"
    | "clearedNotional"
    | "compressionNotional";

const REQUIRED_DECIMAL_FIELDS: readonly RequiredDecimalField[] = [
    "requestedSize",
    "filledSize",
    "fillNotional",
    "effectiveCost",
    "fees",
    "fillPrice",
    "arrivalPrice",
    "externalNotional",
    "internalizedNotional",
    "crossedNotional",
    "nettedNotional",
    "clearedNotional",
    "compressionNotional"
] as const;

const parseDecimal = (raw: string, fieldName: string): InstanceType<typeof Decimal> => {
    try {
        const parsed = new Decimal(raw);
        if (!parsed.isFinite()) {
            throw new Error("non-finite");
        }
        return parsed;
    } catch {
        throw new EconomicQualityEngineError("invalid_metric_input", `${fieldName} must be a finite decimal string.`);
    }
};

const ensureTimeToFillMs = (value: number, label: string): void => {
    if (!Number.isFinite(value) || value < 0) {
        throw new EconomicQualityEngineError("invalid_snapshot", `${label}.timeToFillMs must be a non-negative finite number.`);
    }
};

const computeMetrics = (snapshot: EconomicExecutionSnapshot, label: string): RealizedQualityMetrics => {
    for (const field of REQUIRED_DECIMAL_FIELDS) {
        parseDecimal(snapshot[field as RequiredDecimalField], `${label}.${field}`);
    }

    ensureTimeToFillMs(snapshot.timeToFillMs, label);

    const requestedSize = parseDecimal(snapshot.requestedSize, `${label}.requestedSize`);
    const filledSize = parseDecimal(snapshot.filledSize, `${label}.filledSize`);
    const fillNotional = parseDecimal(snapshot.fillNotional, `${label}.fillNotional`);
    const effectiveCost = parseDecimal(snapshot.effectiveCost, `${label}.effectiveCost`);
    const fees = parseDecimal(snapshot.fees, `${label}.fees`);
    const arrivalPrice = parseDecimal(snapshot.arrivalPrice, `${label}.arrivalPrice`);
    const externalNotional = parseDecimal(snapshot.externalNotional, `${label}.externalNotional`);
    const internalizedNotional = parseDecimal(snapshot.internalizedNotional, `${label}.internalizedNotional`);
    const compressionNotional = parseDecimal(snapshot.compressionNotional, `${label}.compressionNotional`);

    if (requestedSize.lte(0)) {
        throw new EconomicQualityEngineError("invalid_snapshot", `${label}.requestedSize must be positive.`);
    }
    if (filledSize.lt(0)) {
        throw new EconomicQualityEngineError("invalid_snapshot", `${label}.filledSize must be non-negative.`);
    }
    if (filledSize.gt(requestedSize)) {
        throw new EconomicQualityEngineError("invalid_snapshot", `${label}.filledSize cannot exceed requestedSize.`);
    }
    if (arrivalPrice.lte(0)) {
        throw new EconomicQualityEngineError("invalid_snapshot", `${label}.arrivalPrice must be positive.`);
    }

    const realizedFillPrice = filledSize.eq(0) ? new Decimal(0) : fillNotional.div(filledSize);
    const realizedSlippage = realizedFillPrice.minus(arrivalPrice).times(filledSize);
    const partialFillRatio = filledSize.div(requestedSize);

    return {
        realizedFillPrice: realizedFillPrice.toString(),
        realizedEffectiveCost: effectiveCost.toString(),
        realizedSlippage: realizedSlippage.toString(),
        realizedFees: fees.toString(),
        timeToFillMs: snapshot.timeToFillMs,
        partialFillRatio: partialFillRatio.toString(),
        externalNotional: externalNotional.toString(),
        internalizedNotional: internalizedNotional.toString(),
        compressionNotional: compressionNotional.toString()
    };
};

export class EconomicQualityEngine {
    public evaluate(input: EconomicQualityInput): EconomicQualityEvaluationResult {
        const primarySnapshot = input.baselines[input.primaryBaseline];
        if (!primarySnapshot) {
            throw new EconomicQualityEngineError(
                "invalid_baseline",
                `Primary baseline ${input.primaryBaseline} is missing from baselines.`
            );
        }

        const realized = computeMetrics(input.realized, "realized");
        const baselines = Object.entries(input.baselines).reduce<Partial<Record<CounterfactualBaselineType, RealizedQualityMetrics>>>(
            (accumulator, [baselineType, snapshot]) => {
                if (!snapshot) {
                    return accumulator;
                }

                accumulator[baselineType as CounterfactualBaselineType] = computeMetrics(
                    snapshot,
                    `baselines.${baselineType}`
                );
                return accumulator;
            },
            {}
        );

        const primaryMetrics = baselines[input.primaryBaseline];
        if (!primaryMetrics) {
            throw new EconomicQualityEngineError(
                "invalid_baseline",
                `Primary baseline ${input.primaryBaseline} could not be evaluated.`
            );
        }

        const improvement: ImprovementMetrics = {
            priceImprovement: new Decimal(primaryMetrics.realizedFillPrice)
                .minus(realized.realizedFillPrice)
                .toString(),
            slippageSaved: new Decimal(primaryMetrics.realizedSlippage)
                .minus(realized.realizedSlippage)
                .toString(),
            feeSaved: new Decimal(primaryMetrics.realizedFees)
                .minus(realized.realizedFees)
                .toString(),
            externalNotionalAvoided: new Decimal(primaryMetrics.externalNotional)
                .minus(realized.externalNotional)
                .toString(),
            internalizationGain: new Decimal(realized.internalizedNotional)
                .minus(primaryMetrics.internalizedNotional)
                .toString(),
            compressionGain: new Decimal(realized.compressionNotional)
                .minus(primaryMetrics.compressionNotional)
                .toString()
        };

        return {
            realized,
            baselines,
            primaryBaseline: input.primaryBaseline,
            improvement
        };
    }
}
