import type { ExecutionState } from "./execution-state-types.js";

const VALID_TRANSITIONS: Readonly<Record<ExecutionState, readonly ExecutionState[]>> = {
    CREATED: ["CHECKED", "FAILED"],
    CHECKED: ["QUOTED", "FAILED"],
    QUOTED: ["AWAITING_APPROVAL", "APPROVED", "FAILED"],
    AWAITING_APPROVAL: ["APPROVED", "FAILED", "RECONCILING"],
    APPROVED: ["EXECUTING", "FAILED"],
    EXECUTING: ["PARTIALLY_FILLED", "FILLED", "FAILED", "SYNC_PENDING"],
    PARTIALLY_FILLED: ["EXECUTING", "FILLED", "FAILED", "SYNC_PENDING", "RECONCILING"],
    FILLED: ["SYNC_PENDING", "SETTLED", "RECONCILING"],
    FAILED: ["RECONCILING"],
    SYNC_PENDING: ["FILLED", "SETTLED", "FAILED", "RECONCILING"],
    SETTLED: [],
    RECONCILING: ["EXECUTING", "FAILED", "SETTLED", "SYNC_PENDING"]
};

export const canTransitionExecutionState = (
    from: ExecutionState | null,
    to: ExecutionState
): boolean => {
    if (from === null) {
        return to === "CREATED";
    }
    return VALID_TRANSITIONS[from].includes(to);
};

export const getAllowedExecutionTransitions = (state: ExecutionState): readonly ExecutionState[] =>
    VALID_TRANSITIONS[state];
