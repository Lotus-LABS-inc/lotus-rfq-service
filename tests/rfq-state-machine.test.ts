import { describe, expect, it, vi } from "vitest";
import {
  InvalidRFQStateTransitionError,
  RFQStateMachine,
  type RFQTransitionEvent
} from "../src/core/rfq-engine/rfq-state-machine.js";

const createLoggerStub = () => ({
  info: vi.fn<(payload: Record<string, unknown>, message: string) => void>(),
  error: vi.fn<(payload: Record<string, unknown>, message: string) => void>()
});

describe("RFQStateMachine", () => {
  it("starts from CREATED by default", () => {
    const logger = createLoggerStub();
    const machine = new RFQStateMachine({ logger });

    expect(machine.getState()).toBe("CREATED");
  });

  it("allows valid transitions and reaches SETTLED", () => {
    const logger = createLoggerStub();
    const machine = new RFQStateMachine({ logger });

    machine.transitionTo("BROADCAST");
    machine.transitionTo("COLLECTING_QUOTES");
    machine.transitionTo("RANKING");
    machine.transitionTo("AWAITING_USER");
    machine.transitionTo("ACCEPTED");
    machine.transitionTo("EXECUTING");
    machine.transitionTo("SETTLED");

    expect(machine.getState()).toBe("SETTLED");
    expect(logger.info).toHaveBeenCalledTimes(7);
  });

  it("throws on invalid transition and logs rejection", () => {
    const logger = createLoggerStub();
    const machine = new RFQStateMachine({ logger });

    expect(() => machine.transitionTo("EXECUTING")).toThrow(InvalidRFQStateTransitionError);
    expect(machine.getState()).toBe("CREATED");
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("emits transition hook on every valid transition", () => {
    const logger = createLoggerStub();
    const emitted: RFQTransitionEvent[] = [];
    const machine = new RFQStateMachine({
      logger,
      onTransition: (event) => {
        emitted.push(event);
      },
      now: () => new Date("2026-02-25T00:00:00.000Z")
    });

    machine.transitionTo("BROADCAST", {
      reason: "fanout",
      metadata: { batchId: "batch-1" }
    });
    machine.transitionTo("COLLECTING_QUOTES");

    expect(emitted).toHaveLength(2);
    expect(emitted[0]).toMatchObject({
      from: "CREATED",
      to: "BROADCAST",
      context: {
        reason: "fanout",
        metadata: { batchId: "batch-1" }
      }
    });
  });

  it("does not allow transitions from terminal states", () => {
    const logger = createLoggerStub();
    const machine = new RFQStateMachine({ logger, initialState: "FAILED" });

    expect(machine.getAllowedTransitions()).toEqual([]);
    expect(machine.canTransitionTo("SETTLED")).toBe(false);
    expect(() => machine.transitionTo("SETTLED")).toThrow(InvalidRFQStateTransitionError);
  });
});

