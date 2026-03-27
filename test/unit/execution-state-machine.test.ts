import { describe, expect, it } from "vitest";

import { ExecutionStateMachine, InvalidExecutionStateTransitionError } from "../../src/execution/execution-state-machine.js";

describe("ExecutionStateMachine", () => {
    it("supports the happy path", () => {
        const machine = new ExecutionStateMachine();
        machine.transitionTo("CREATED");
        machine.transitionTo("CHECKED");
        machine.transitionTo("QUOTED");
        machine.transitionTo("APPROVED");
        machine.transitionTo("EXECUTING");
        machine.transitionTo("FILLED");
        machine.transitionTo("SETTLED");

        expect(machine.getState()).toBe("SETTLED");
    });

    it("rejects illegal transitions", () => {
        const machine = new ExecutionStateMachine();
        expect(() => machine.transitionTo("FILLED")).toThrow(InvalidExecutionStateTransitionError);
    });
});
