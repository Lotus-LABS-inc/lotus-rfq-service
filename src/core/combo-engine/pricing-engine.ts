import Decimal from "decimal.js";
import { ComboRFQSession, ComboQuote } from "./types.js";

interface CanonicalMarketProbabilities {
    outcomeProbMap: Map<string, number>; // Maps outcome_id to probability [0, 1]
}

/**
 * Ensures a value is a valid numeric string, falling back to 0.
 */
function safeDecimal(val: string | number | undefined | null): InstanceType<typeof Decimal> {
    if (!val) return new Decimal(0);
    try {
        const d = new Decimal(val);
        if (d.isNaN() || !d.isFinite()) return new Decimal(0);
        return d;
    } catch {
        return new Decimal(0);
    }
}

/**
 * Computes the theoretical price and payout vector across terminal states for a multi-leg combination.
 * Only applicable if canonical mapping provides a unified state space.
 * 
 * @param combo The ComboRFQ Session definition
 * @param marketOutcomeProbabilities Probabilities defined by the canonical oracle for each market's outcomes
 * @returns { payoffVector: number[], theoreticalPrice: number }
 */
export async function computePayoutVector(
    combo: ComboRFQSession,
    marketOutcomeProbabilities: Map<string, CanonicalMarketProbabilities>
): Promise<{ payoffVector: number[], theoreticalPrice: number }> {

    // Simplification for binary markets / unified state space mapping.
    // In a fully generalized system, this requires cross-cartesian product evaluation 
    // of all independent market states. For this implementation, we evaluate per known state.

    // Determine the universe of canonical outcomes involved in this combo
    const universeOutcomes = new Set<string>();
    for (const leg of combo.legs) {
        universeOutcomes.add(leg.canonicalOutcomeId);
    }

    const stateVector: number[] = [];
    let theoreticalPriceSum = new Decimal(0);

    for (const outcome of universeOutcomes) {
        let statePayout = new Decimal(0);
        let jointProb = new Decimal(1); // Naive assumption: Independent conditional probabilities (simplified for demo)

        for (const leg of combo.legs) {
            const sideMult = leg.side === "buy" ? new Decimal(1) : new Decimal(-1);
            const size = safeDecimal(leg.quantity);

            // If the leg's outcome matches the evaluated universe state, it pays out 1 unit * size
            if (leg.canonicalOutcomeId === outcome) {
                statePayout = statePayout.plus(size.times(sideMult));
            }

            const marketProbs = marketOutcomeProbabilities.get(leg.canonicalMarketId);
            if (marketProbs) {
                const prob = marketProbs.outcomeProbMap.get(outcome) || 0;
                // Accumulate independent intersection probability (Highly simplified joint prob math)
                // In a production Exchange engine, Canonical service provides the exact copula/joint density vector.
                if (prob > 0 && prob < 1) {
                    jointProb = jointProb.times(new Decimal(prob));
                }
            }
        }

        stateVector.push(statePayout.toNumber());
        theoreticalPriceSum = theoreticalPriceSum.plus(statePayout.times(jointProb));
    }

    return {
        payoffVector: stateVector,
        theoreticalPrice: theoreticalPriceSum.toNumber()
    };
}

/**
 * Fallback pricing model that naively sums the individual leg prices.
 * Used when canonical mappings do not support joint-state payout resolution.
 * 
 * @param combo The ComboRFQSession definition
 * @param legMidPrices Map of legId to its perceived fair mid price
 * @returns number 
 */
export function computeLinearApproxPrice(
    combo: ComboRFQSession,
    legMidPrices: Map<string, number>
): number {
    let sum = new Decimal(0);

    for (const leg of combo.legs) {
        const sideMult = leg.side === "buy" ? new Decimal(1) : new Decimal(-1);
        const size = safeDecimal(leg.quantity);
        const price = safeDecimal(legMidPrices.get(leg.id));

        sum = sum.plus(price.times(size).times(sideMult));
    }

    return sum.toNumber();
}

/**
 * Computes the 'effective cost' to the Taker from an LP quote.
 * This takes into account the gross price plus any implied fees or network gas costs embedded in the payload.
 * 
 * @param lpQuote The ComboQuote provided by the LP
 * @param executionFeeBps Platform fee
 * @returns number
 */
export function computeEffectiveCostFromLPQuote(
    lpQuote: ComboQuote,
    executionFeeBps: number = 0
): number {
    let baseCost = new Decimal(0);

    if (lpQuote.isComboQuote && lpQuote.comboPrice) {
        baseCost = safeDecimal(lpQuote.comboPrice);
    } else if (lpQuote.perLegPrices) {
        for (const leg of lpQuote.perLegPrices) {
            const p = safeDecimal(leg.price);
            const s = safeDecimal(leg.size);
            baseCost = baseCost.plus(p.times(s));
        }
    }

    // Add execution fee
    const feeMult = new Decimal(executionFeeBps).dividedBy(10000);
    const feeCost = baseCost.times(feeMult).abs();

    // Note: Assuming `rawPayload` might have fixed gas overheads in some architectures
    const gasOverhead = safeDecimal(lpQuote.rawPayload?.impliedGasCostUsd);

    return baseCost.plus(feeCost).plus(gasOverhead).toNumber();
}
