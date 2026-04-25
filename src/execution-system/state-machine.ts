import type { ExecutionStateV0 } from "./types.js";

const transitions: ReadonlyMap<ExecutionStateV0, ReadonlySet<ExecutionStateV0>> = new Map([
  ["CREATED", new Set(["PREFLIGHT_CHECKING", "CANCELLED"])],
  ["PREFLIGHT_CHECKING", new Set(["PREFLIGHT_FAILED", "READY_TO_SUBMIT"])],
  ["PREFLIGHT_FAILED", new Set(["FAILED_CLOSED", "CANCELLED"])],
  ["READY_TO_SUBMIT", new Set(["SUBMITTED", "FAILED_CLOSED", "CANCELLED"])],
  ["SUBMITTED", new Set(["PARTIAL_FILL", "FILLED_PENDING_SETTLEMENT", "FAILED_CLOSED"])],
  ["PARTIAL_FILL", new Set(["FILLED_PENDING_SETTLEMENT", "REROUTING", "FAILED_CLOSED"])],
  ["FILLED_PENDING_SETTLEMENT", new Set(["SETTLEMENT_VERIFIED", "GHOST_FILL_SUSPECTED", "GHOST_FILL_CONFIRMED", "FAILED_CLOSED"])],
  ["SETTLEMENT_VERIFIED", new Set(["COMPLETED"])],
  ["GHOST_FILL_SUSPECTED", new Set(["GHOST_FILL_CONFIRMED", "REROUTING", "FAILED_CLOSED"])],
  ["GHOST_FILL_CONFIRMED", new Set(["REROUTING", "FAILED_CLOSED"])],
  ["REROUTING", new Set(["REROUTED", "FAILED_CLOSED"])],
  ["REROUTED", new Set(["SUBMITTED", "FAILED_CLOSED"])],
  ["FAILED_CLOSED", new Set<ExecutionStateV0>()],
  ["COMPLETED", new Set<ExecutionStateV0>()],
  ["CANCELLED", new Set<ExecutionStateV0>()]
]);

export class ExecutionStateTransitionError extends Error {
  public constructor(from: ExecutionStateV0, to: ExecutionStateV0) {
    super(`Invalid execution v0 state transition: ${from} -> ${to}`);
    this.name = "ExecutionStateTransitionError";
  }
}

export class ExecutionStateMachineV0 {
  public constructor(private state: ExecutionStateV0 = "CREATED") {}

  public current(): ExecutionStateV0 {
    return this.state;
  }

  public canTransitionTo(next: ExecutionStateV0): boolean {
    return transitions.get(this.state)?.has(next) ?? false;
  }

  public transitionTo(next: ExecutionStateV0): ExecutionStateV0 {
    if (!this.canTransitionTo(next)) {
      throw new ExecutionStateTransitionError(this.state, next);
    }
    this.state = next;
    return this.state;
  }
}
