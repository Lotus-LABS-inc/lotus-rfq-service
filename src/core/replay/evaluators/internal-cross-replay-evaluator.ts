import Decimal from "decimal.js";
import { asArray, asObject, asString, ReplayEvaluationError } from "./shared.js";

const parseAmount = (value: unknown, fieldName: string): InstanceType<typeof Decimal> => {
    if (typeof value !== "string" && typeof value !== "number") {
        throw new ReplayEvaluationError("invalid_replay_envelope", `${fieldName} must be a numeric string or number.`);
    }

    const amount = new Decimal(value);
    if (!amount.isFinite() || amount.isNegative()) {
        throw new ReplayEvaluationError("invalid_replay_envelope", `${fieldName} must be finite and non-negative.`);
    }

    return amount;
};

const readIncomingSize = (incomingOrder: Record<string, unknown>): InstanceType<typeof Decimal> => {
    const candidates = [
        incomingOrder.remainingSize,
        incomingOrder.remaining_size,
        incomingOrder.initial_size,
        incomingOrder.initialSize,
        incomingOrder.size,
        incomingOrder.quantity
    ];
    for (const value of candidates) {
        if (value !== undefined && value !== null) {
            return parseAmount(value, "incomingOrder.size");
        }
    }

    throw new ReplayEvaluationError("invalid_replay_envelope", "incomingOrder must include a replayable size field.");
};

export const replayInternalCross = (inputSnapshot: Record<string, unknown>, decisionTrace: Record<string, unknown>): Record<string, unknown> => {
    const incomingOrder = asObject(inputSnapshot.incomingOrder, "inputSnapshot.incomingOrder");
    const orderedCandidates = asArray(inputSnapshot.orderedCandidates, "inputSnapshot.orderedCandidates").map((value) =>
        asObject(value, "inputSnapshot.orderedCandidates[]")
    );
    const makerIterationOrder = asArray(decisionTrace.makerIterationOrder, "decisionTrace.makerIterationOrder").map((value, index) =>
        asString(value, `decisionTrace.makerIterationOrder[${index}]`)
    );
    const matchDecisions = asArray(decisionTrace.matchDecisions, "decisionTrace.matchDecisions").map((value) =>
        asObject(value, "decisionTrace.matchDecisions[]")
    );

    if (orderedCandidates.length !== makerIterationOrder.length) {
        throw new ReplayEvaluationError("invalid_replay_envelope", "maker iteration order must cover every ordered candidate.");
    }

    const incomingSize = readIncomingSize(incomingOrder);
    const filledSize = matchDecisions.reduce((sum, decision, index) => {
        const makerOrderId = typeof decision.makerOrderId === "string" ? decision.makerOrderId : typeof decision.orderId === "string" ? decision.orderId : null;
        if (!makerOrderId) {
            throw new ReplayEvaluationError("invalid_replay_envelope", `decisionTrace.matchDecisions[${index}] must include makerOrderId.`);
        }
        return sum.plus(parseAmount(decision.matchedSize, `decisionTrace.matchDecisions[${index}].matchedSize`));
    }, new Decimal(0));

    const remainingSize = Decimal.max(new Decimal(0), incomingSize.minus(filledSize));

    return {
        result: {
            filledSize: filledSize.toString(),
            remainingSize: remainingSize.toString(),
            matchDecisions
        }
    };
};
