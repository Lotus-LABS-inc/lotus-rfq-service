import type { ExecutionState, ExecutionTransitionEvent, ExecutionTransitionMetadata } from "./execution-state-types.js";
import { canTransitionExecutionState, getAllowedExecutionTransitions } from "./execution-transition-guard.js";

export class InvalidExecutionStateTransitionError extends Error {
    public constructor(
        public readonly from: ExecutionState | null,
        public readonly to: ExecutionState
    ) {
        super(`Invalid execution transition from ${from ?? "null"} to ${to}.`);
        this.name = "InvalidExecutionStateTransitionError";
    }
}

export interface ExecutionStateMachineOptions {
    initialState?: ExecutionState;
    now?: () => Date;
    onTransition?: (event: ExecutionTransitionEvent) => void;
}

export class ExecutionStateMachine {
    private currentState: ExecutionState | null;
    private readonly now: () => Date;
    private readonly onTransition: ((event: ExecutionTransitionEvent) => void) | undefined;

    public constructor(options: ExecutionStateMachineOptions = {}) {
        this.currentState = options.initialState ?? null;
        this.now = options.now ?? (() => new Date());
        this.onTransition = options.onTransition;
    }

    public getState(): ExecutionState | null {
        return this.currentState;
    }

    public getAllowedTransitions(): readonly ExecutionState[] {
        if (this.currentState === null) {
            return ["CREATED"];
        }
        return getAllowedExecutionTransitions(this.currentState);
    }

    public transitionTo(nextState: ExecutionState, metadata?: ExecutionTransitionMetadata): ExecutionState {
        const previousState = this.currentState;
        if (!canTransitionExecutionState(previousState, nextState)) {
            throw new InvalidExecutionStateTransitionError(previousState, nextState);
        }
        const event: ExecutionTransitionEvent = {
            from: previousState,
            to: nextState,
            at: this.now(),
            ...(metadata ? { metadata } : {})
        };
        this.currentState = nextState;
        this.onTransition?.(event);
        return nextState;
    }
}
