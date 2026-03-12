import Decimal from "decimal.js";

import type { EconomicExecutionSnapshot } from "../economic-quality-engine.js";

export type CounterfactualBaselineErrorCode =
    | "invalid_baseline_input"
    | "missing_replay_snapshot"
    | "unsupported_execution_shape";

export class CounterfactualBaselineError extends Error {
    public readonly code: CounterfactualBaselineErrorCode;

    public constructor(code: CounterfactualBaselineErrorCode, message: string) {
        super(message);
        this.name = "CounterfactualBaselineError";
        this.code = code;
    }
}

export interface BaselineRouteCandidateInput {
    candidateId: string;
    providerId: string;
    quotedPrice: string | number;
    availableSize: string | number;
    fees?: Readonly<Record<string, number>>;
    totalExpectedCost?: string | number;
    effectiveUnitCost?: string | number;
    resolutionRiskPenalty?: string | number;
}

export interface BaselineSelectedQuoteInput {
    quantity: string | number;
    arrivalPrice: string | number;
}

export interface BaselineExecutionDefaults {
    timeToFillMs?: number;
    routeBreakdown?: Record<string, unknown>;
    executionSourceMix?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}

export interface PickCandidateOptions {
    neutralizeResolutionRisk?: boolean | undefined;
    fallbackCandidateOrdering?: readonly string[] | undefined;
}

const ZERO = new Decimal(0);

export const parseDecimal = (value: string | number, fieldName: string): InstanceType<typeof Decimal> => {
    try {
        const parsed = new Decimal(value);
        if (!parsed.isFinite()) {
            throw new Error("non-finite");
        }
        return parsed;
    } catch {
        throw new CounterfactualBaselineError("invalid_baseline_input", `${fieldName} must be a finite decimal value.`);
    }
};

export const ensureNonEmptyString = (value: string, fieldName: string): void => {
    if (value.trim().length === 0) {
        throw new CounterfactualBaselineError("invalid_baseline_input", `${fieldName} must be a non-empty string.`);
    }
};

export const ensurePlainObject = (value: unknown, fieldName: string): void => {
    if (value === undefined) {
        return;
    }

    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new CounterfactualBaselineError("invalid_baseline_input", `${fieldName} must be a plain object when provided.`);
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new CounterfactualBaselineError("invalid_baseline_input", `${fieldName} must be a plain object when provided.`);
    }
};

export const sumFees = (fees?: Readonly<Record<string, number>>): InstanceType<typeof Decimal> => {
    if (!fees) {
        return ZERO;
    }

    return Object.entries(fees)
        .sort(([left], [right]) => left.localeCompare(right))
        .reduce((accumulator, [key, value]) => {
            if (!Number.isFinite(value) || value < 0) {
                throw new CounterfactualBaselineError("invalid_baseline_input", `fees.${key} must be a non-negative finite number.`);
            }
            return accumulator.plus(value);
        }, ZERO);
};

export const validateCandidate = (candidate: BaselineRouteCandidateInput, fieldName: string): void => {
    ensureNonEmptyString(candidate.candidateId, `${fieldName}.candidateId`);
    ensureNonEmptyString(candidate.providerId, `${fieldName}.providerId`);
    const price = parseDecimal(candidate.quotedPrice, `${fieldName}.quotedPrice`);
    const availableSize = parseDecimal(candidate.availableSize, `${fieldName}.availableSize`);
    if (price.lt(0)) {
        throw new CounterfactualBaselineError("invalid_baseline_input", `${fieldName}.quotedPrice must be non-negative.`);
    }
    if (availableSize.lt(0)) {
        throw new CounterfactualBaselineError("invalid_baseline_input", `${fieldName}.availableSize must be non-negative.`);
    }
    if (candidate.totalExpectedCost !== undefined) {
        parseDecimal(candidate.totalExpectedCost, `${fieldName}.totalExpectedCost`);
    }
    if (candidate.effectiveUnitCost !== undefined) {
        parseDecimal(candidate.effectiveUnitCost, `${fieldName}.effectiveUnitCost`);
    }
    if (candidate.resolutionRiskPenalty !== undefined) {
        parseDecimal(candidate.resolutionRiskPenalty, `${fieldName}.resolutionRiskPenalty`);
    }
    sumFees(candidate.fees);
};

const candidateRankingCost = (
    candidate: BaselineRouteCandidateInput,
    requestedSize: InstanceType<typeof Decimal>,
    options: PickCandidateOptions
): InstanceType<typeof Decimal> => {
    if (options.neutralizeResolutionRisk) {
        if (candidate.totalExpectedCost !== undefined) {
            return parseDecimal(candidate.totalExpectedCost, `${candidate.candidateId}.totalExpectedCost`).minus(
                candidate.resolutionRiskPenalty !== undefined
                    ? parseDecimal(candidate.resolutionRiskPenalty, `${candidate.candidateId}.resolutionRiskPenalty`)
                    : ZERO
            );
        }

        if (candidate.effectiveUnitCost !== undefined) {
            return parseDecimal(candidate.effectiveUnitCost, `${candidate.candidateId}.effectiveUnitCost`)
                .times(requestedSize)
                .minus(
                    candidate.resolutionRiskPenalty !== undefined
                        ? parseDecimal(candidate.resolutionRiskPenalty, `${candidate.candidateId}.resolutionRiskPenalty`)
                        : ZERO
                );
        }
    }

    if (candidate.totalExpectedCost !== undefined) {
        return parseDecimal(candidate.totalExpectedCost, `${candidate.candidateId}.totalExpectedCost`);
    }

    if (candidate.effectiveUnitCost !== undefined) {
        return parseDecimal(candidate.effectiveUnitCost, `${candidate.candidateId}.effectiveUnitCost`).times(requestedSize);
    }

    return parseDecimal(candidate.quotedPrice, `${candidate.candidateId}.quotedPrice`)
        .times(requestedSize)
        .plus(sumFees(candidate.fees));
};

const orderingRank = (candidateId: string, fallbackCandidateOrdering?: readonly string[]): number => {
    if (!fallbackCandidateOrdering) {
        return Number.MAX_SAFE_INTEGER;
    }

    const index = fallbackCandidateOrdering.indexOf(candidateId);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

export const pickDeterministicBestCandidate = (
    candidates: readonly BaselineRouteCandidateInput[],
    selectedQuote: BaselineSelectedQuoteInput,
    options: PickCandidateOptions = {}
): BaselineRouteCandidateInput => {
    if (candidates.length === 0) {
        throw new CounterfactualBaselineError("missing_replay_snapshot", "At least one route candidate is required.");
    }

    const requestedSize = parseDecimal(selectedQuote.quantity, "selectedQuote.quantity");
    if (requestedSize.lte(0)) {
        throw new CounterfactualBaselineError("invalid_baseline_input", "selectedQuote.quantity must be positive.");
    }
    parseDecimal(selectedQuote.arrivalPrice, "selectedQuote.arrivalPrice");

    const validated = candidates.map((candidate, index) => {
        validateCandidate(candidate, `routeCandidates[${index}]`);
        return candidate;
    });

    return [...validated].sort((left, right) => {
        const costDiff = candidateRankingCost(left, requestedSize, options).cmp(
            candidateRankingCost(right, requestedSize, options)
        );
        if (costDiff !== 0) {
            return costDiff;
        }

        const fallbackRankDiff = orderingRank(left.candidateId, options.fallbackCandidateOrdering) -
            orderingRank(right.candidateId, options.fallbackCandidateOrdering);
        if (fallbackRankDiff !== 0) {
            return fallbackRankDiff;
        }

        const providerDiff = left.providerId.localeCompare(right.providerId);
        if (providerDiff !== 0) {
            return providerDiff;
        }

        return left.candidateId.localeCompare(right.candidateId);
    })[0] as BaselineRouteCandidateInput;
};

export const buildExternalizedEconomicSnapshot = (
    candidate: BaselineRouteCandidateInput,
    selectedQuote: BaselineSelectedQuoteInput,
    defaults?: BaselineExecutionDefaults
): EconomicExecutionSnapshot => {
    validateCandidate(candidate, "candidate");
    ensurePlainObject(defaults?.routeBreakdown, "defaults.routeBreakdown");
    ensurePlainObject(defaults?.executionSourceMix, "defaults.executionSourceMix");
    ensurePlainObject(defaults?.metadata, "defaults.metadata");

    const requestedSize = parseDecimal(selectedQuote.quantity, "selectedQuote.quantity");
    const arrivalPrice = parseDecimal(selectedQuote.arrivalPrice, "selectedQuote.arrivalPrice");
    const availableSize = parseDecimal(candidate.availableSize, "candidate.availableSize");
    const fillPrice = parseDecimal(candidate.quotedPrice, "candidate.quotedPrice");
    const filledSize = Decimal.min(requestedSize, availableSize);
    const fillNotional = fillPrice.times(filledSize);
    const fees = sumFees(candidate.fees);
    const effectiveCost = fillNotional.plus(fees);

    const timeToFillMs = defaults?.timeToFillMs ?? 0;
    if (!Number.isFinite(timeToFillMs) || timeToFillMs < 0) {
        throw new CounterfactualBaselineError("invalid_baseline_input", "defaults.timeToFillMs must be a non-negative finite number.");
    }

    return {
        requestedSize: requestedSize.toString(),
        filledSize: filledSize.toString(),
        fillNotional: fillNotional.toString(),
        effectiveCost: effectiveCost.toString(),
        fees: fees.toString(),
        fillPrice: fillPrice.toString(),
        arrivalPrice: arrivalPrice.toString(),
        externalNotional: fillNotional.toString(),
        internalizedNotional: "0",
        crossedNotional: "0",
        nettedNotional: "0",
        clearedNotional: "0",
        compressionNotional: "0",
        timeToFillMs,
        ...(defaults?.routeBreakdown ? { routeBreakdown: defaults.routeBreakdown } : {}),
        ...(defaults?.executionSourceMix ? { executionSourceMix: defaults.executionSourceMix } : {}),
        ...(defaults?.metadata ? { metadata: defaults.metadata } : {})
    };
};
