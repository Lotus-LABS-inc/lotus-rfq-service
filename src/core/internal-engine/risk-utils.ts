import Decimal from "decimal.js";

// Set precision for safety (standard 20 for financial math)
Decimal.config({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export interface ExposureDelta {
    maxLossDelta: string;
    maxGainDelta: string;
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
    side: "buy" | "sell",
    price: string | number,
    size: string | number
): ExposureDelta {
    const dPrice = new Decimal(price);
    const dSize = new Decimal(size);
    const one = new Decimal(1);

    if (side === "buy") {
        const maxLoss = dPrice.times(dSize);
        const maxGain = one.minus(dPrice).times(dSize);

        return {
            maxLossDelta: maxLoss.toDecimalPlaces(8).toString(),
            maxGainDelta: maxGain.toDecimalPlaces(8).toString()
        };
    } else {
        // side === "sell"
        const maxLoss = one.minus(dPrice).times(dSize);
        const maxGain = dPrice.times(dSize);

        return {
            maxLossDelta: maxLoss.toDecimalPlaces(8).toString(),
            maxGainDelta: maxGain.toDecimalPlaces(8).toString()
        };
    }
}
