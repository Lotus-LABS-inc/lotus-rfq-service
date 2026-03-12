import Decimal from "decimal.js";
import { asArray, asObject, asString, ReplayEvaluationError } from "./shared.js";

const parseAmount = (value: unknown, fieldName: string): InstanceType<typeof Decimal> => {
    if (typeof value !== "string" && typeof value !== "number") {
        throw new ReplayEvaluationError("invalid_replay_envelope", `${fieldName} must be numeric.`);
    }

    const amount = new Decimal(value);
    if (!amount.isFinite() || amount.isNegative()) {
        throw new ReplayEvaluationError("invalid_replay_envelope", `${fieldName} must be finite and non-negative.`);
    }

    return amount;
};

export const replayNettingPhase2A = (
    inputSnapshot: Record<string, unknown>,
    decisionTrace: Record<string, unknown>
): Record<string, unknown> => {
    const incomingCombo = asObject(inputSnapshot.incomingCombo, "inputSnapshot.incomingCombo");
    const matchedLegPairOrder = asArray(decisionTrace.matchedLegPairOrder, "decisionTrace.matchedLegPairOrder").map((entry) =>
        asObject(entry, "decisionTrace.matchedLegPairOrder[]")
    );

    const legs = asArray(incomingCombo.legs, "inputSnapshot.incomingCombo.legs").map((leg) => asObject(leg, "inputSnapshot.incomingCombo.legs[]"));
    const matchedByIncomingLegId = new Map<string, InstanceType<typeof Decimal>>();

    for (const pair of matchedLegPairOrder) {
        const incomingLegId = asString(pair.incomingLegId, "decisionTrace.matchedLegPairOrder[].incomingLegId");
        const matchedSize = parseAmount(pair.matchedSize, `decisionTrace.matchedLegPairOrder[${incomingLegId}].matchedSize`);
        matchedByIncomingLegId.set(incomingLegId, (matchedByIncomingLegId.get(incomingLegId) ?? new Decimal(0)).plus(matchedSize));
    }

    const residualLegs = legs.flatMap((leg) => {
        const legId = asString(leg.id, "inputSnapshot.incomingCombo.legs[].id");
        const remaining = parseAmount(
            leg.remainingSize ?? leg.remaining_size ?? leg.quantity,
            `inputSnapshot.incomingCombo.legs[${legId}].remaining`
        ).minus(matchedByIncomingLegId.get(legId) ?? 0);

        if (remaining.lte(0)) {
            return [];
        }

        return [{
            id: legId,
            canonicalMarketId: asString(leg.canonicalMarketId ?? leg.canonical_market_id, `inputSnapshot.incomingCombo.legs[${legId}].canonicalMarketId`),
            canonicalOutcomeId: asString(leg.canonicalOutcomeId ?? leg.canonical_outcome_id, `inputSnapshot.incomingCombo.legs[${legId}].canonicalOutcomeId`),
            side: asString(leg.side, `inputSnapshot.incomingCombo.legs[${legId}].side`),
            remainingSize: remaining.toString()
        }];
    });

    const nettedSize = [...matchedByIncomingLegId.values()].reduce((max, amount) => amount.greaterThan(max) ? amount : max, new Decimal(0));

    return {
        result: {
            nettedSize: nettedSize.toString(),
            residualLegs,
            residualRemaining: residualLegs.length > 0
        }
    };
};
