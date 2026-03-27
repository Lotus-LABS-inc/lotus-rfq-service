export const executionStates = [
    "CREATED",
    "CHECKED",
    "QUOTED",
    "AWAITING_APPROVAL",
    "APPROVED",
    "EXECUTING",
    "PARTIALLY_FILLED",
    "FILLED",
    "FAILED",
    "SYNC_PENDING",
    "SETTLED",
    "RECONCILING"
] as const;

export type ExecutionState = typeof executionStates[number];

export interface ExecutionTransitionMetadata {
    reason?: string;
    payload?: Readonly<Record<string, unknown>>;
}

export interface ExecutionTransitionEvent {
    from: ExecutionState | null;
    to: ExecutionState;
    at: Date;
    metadata?: ExecutionTransitionMetadata;
}
