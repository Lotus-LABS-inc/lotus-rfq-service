import { describe, expect, it } from "vitest";

import {
  PerformanceGuardrailConfigError,
  createPerformanceGuardrailConfig,
  serializePerformanceGuardrailConfig,
  validatePerformanceGuardrailConfig,
} from "../../src/guardrails/guardrail-config.js";

const validConfigInput = {
  version: "guardrails-v1",
  maxSorPlanningLatencyMs: 250,
  maxNettingPlanningLatencyMs: 400,
  maxClearingPlanningLatencyMs: 600,
  maxBucketEntityCount: 500,
  maxGraphEdges: 5_000,
  maxCandidateGroups: 1_000,
  maxLockWaitMs: 100,
  maxLockHoldMs: 500,
  maxReplayWriteFailuresBeforeDegrade: 3,
  degradationPolicyVersion: "degrade-v1",
} as const;

describe("guardrail-config", () => {
  it("creates a valid frozen config", () => {
    const config = createPerformanceGuardrailConfig(validConfigInput);

    expect(config).toEqual(validConfigInput);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("serializes to the exact replay-safe shape", () => {
    const config = createPerformanceGuardrailConfig(validConfigInput);

    expect(serializePerformanceGuardrailConfig(config)).toEqual(validConfigInput);
  });

  it("repeated serialization of identical config is identical", () => {
    const config = createPerformanceGuardrailConfig(validConfigInput);

    const serializedA = JSON.stringify(serializePerformanceGuardrailConfig(config));
    const serializedB = JSON.stringify(serializePerformanceGuardrailConfig(config));

    expect(serializedA).toBe(serializedB);
  });

  it("preserves all numeric fields exactly", () => {
    const config = createPerformanceGuardrailConfig(validConfigInput);

    expect(config.maxSorPlanningLatencyMs).toBe(250);
    expect(config.maxNettingPlanningLatencyMs).toBe(400);
    expect(config.maxClearingPlanningLatencyMs).toBe(600);
    expect(config.maxBucketEntityCount).toBe(500);
    expect(config.maxGraphEdges).toBe(5_000);
    expect(config.maxCandidateGroups).toBe(1_000);
    expect(config.maxLockWaitMs).toBe(100);
    expect(config.maxLockHoldMs).toBe(500);
    expect(config.maxReplayWriteFailuresBeforeDegrade).toBe(3);
  });

  it("fails closed on empty version", () => {
    expect(() =>
      createPerformanceGuardrailConfig({
        ...validConfigInput,
        version: "   ",
      }),
    ).toThrowError(PerformanceGuardrailConfigError);
  });

  it("fails closed on empty degradationPolicyVersion", () => {
    expect(() =>
      createPerformanceGuardrailConfig({
        ...validConfigInput,
        degradationPolicyVersion: "",
      }),
    ).toThrowError(PerformanceGuardrailConfigError);
  });

  it("fails closed on zero or negative numeric values", () => {
    expect(() =>
      createPerformanceGuardrailConfig({
        ...validConfigInput,
        maxCandidateGroups: 0,
      }),
    ).toThrowError(PerformanceGuardrailConfigError);

    expect(() =>
      createPerformanceGuardrailConfig({
        ...validConfigInput,
        maxGraphEdges: -1,
      }),
    ).toThrowError(PerformanceGuardrailConfigError);
  });

  it("fails closed on non-finite numeric values", () => {
    expect(() =>
      createPerformanceGuardrailConfig({
        ...validConfigInput,
        maxLockWaitMs: Number.NaN,
      }),
    ).toThrowError(PerformanceGuardrailConfigError);

    expect(() =>
      createPerformanceGuardrailConfig({
        ...validConfigInput,
        maxLockHoldMs: Number.POSITIVE_INFINITY,
      }),
    ).toThrowError(PerformanceGuardrailConfigError);
  });

  it("validatePerformanceGuardrailConfig accepts a valid serialized shape", () => {
    expect(() => validatePerformanceGuardrailConfig(validConfigInput)).not.toThrow();
  });
});
