import Decimal from "decimal.js";

// Set precision for safety (standard 20 for financial math)
Decimal.config({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export type PredictionMarketSide = "BUY" | "SELL" | "buy" | "sell";
type DecimalValue = InstanceType<typeof Decimal>;

export interface ExposureDelta {
    maxLossDelta: string;
    maxGainDelta: string;
}

export class ExposureDeltaValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ExposureDeltaValidationError";
    }
}

/**
 * Calculates risk exposure deltas for prediction market contracts.
 * Contracts settle at either $1 or $0.
 * 
 * Buyer: 
 *   maxLoss = price * size (Cost of purchase)
 *   maxGain = (1 - price) * size (Net profit if settle at 1)
 * 
 * Seller:
 *   maxLoss = (1 - price) * size (Equivalent to collateral for short)
 *   maxGain = price * size (Maximum profit if settle at 0)
 */
export function calculateExposureDelta(
    side: PredictionMarketSide,
    price: string | number,
    size: string | number
): ExposureDelta {
    const normalizedSide = normalizeSide(side);
    const dPrice = parseDecimalInput(price, "price");
    const dSize = parseDecimalInput(size, "size");
    const one = new Decimal(1);

    if (dPrice.lt(0) || dPrice.gt(1)) {
        throw new ExposureDeltaValidationError("price must be within [0, 1] for prediction markets");
    }

    if (dSize.lt(0)) {
        throw new ExposureDeltaValidationError("size must be greater than or equal to 0");
    }

    if (normalizedSide === "buy") {
        const maxLoss = dPrice.times(dSize);
        const maxGain = one.minus(dPrice).times(dSize);

        return {
            maxLossDelta: maxLoss.toDecimalPlaces(8).toString(),
            maxGainDelta: maxGain.toDecimalPlaces(8).toString()
        };
    }

    const maxLoss = one.minus(dPrice).times(dSize);
    const maxGain = dPrice.times(dSize);

    return {
        maxLossDelta: maxLoss.toDecimalPlaces(8).toString(),
        maxGainDelta: maxGain.toDecimalPlaces(8).toString()
    };
}

function normalizeSide(side: PredictionMarketSide): "buy" | "sell" {
    if (side === "BUY" || side === "buy") {
        return "buy";
    }

    if (side === "SELL" || side === "sell") {
        return "sell";
    }

    throw new ExposureDeltaValidationError(`unsupported side: ${String(side)}`);
}

function parseDecimalInput(value: string | number, field: string): DecimalValue {
    try {
        const decimal = new Decimal(value);
        if (!decimal.isFinite()) {
            throw new ExposureDeltaValidationError(`${field} must be finite`);
        }
        return decimal;
    } catch (error) {
        if (error instanceof ExposureDeltaValidationError) {
            throw error;
        }

        throw new ExposureDeltaValidationError(`${field} must be a valid decimal`);
    }
}
