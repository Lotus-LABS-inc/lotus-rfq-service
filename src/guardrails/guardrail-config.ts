export interface PerformanceGuardrailConfig {
  readonly version: string;
  readonly maxSorPlanningLatencyMs: number;
  readonly maxNettingPlanningLatencyMs: number;
  readonly maxClearingPlanningLatencyMs: number;
  readonly maxBucketEntityCount: number;
  readonly maxGraphEdges: number;
  readonly maxCandidateGroups: number;
  readonly maxLockWaitMs: number;
  readonly maxLockHoldMs: number;
  readonly maxReplayWriteFailuresBeforeDegrade: number;
  readonly degradationPolicyVersion: string;
}

export interface SerializedPerformanceGuardrailConfig {
  version: string;
  maxSorPlanningLatencyMs: number;
  maxNettingPlanningLatencyMs: number;
  maxClearingPlanningLatencyMs: number;
  maxBucketEntityCount: number;
  maxGraphEdges: number;
  maxCandidateGroups: number;
  maxLockWaitMs: number;
  maxLockHoldMs: number;
  maxReplayWriteFailuresBeforeDegrade: number;
  degradationPolicyVersion: string;
}

export interface PerformanceGuardrailConfigErrorOptions {
  code: "invalid_guardrail_config";
}

export class PerformanceGuardrailConfigError extends Error {
  public readonly code: "invalid_guardrail_config";

  public constructor(message: string, options: PerformanceGuardrailConfigErrorOptions) {
    super(message);
    this.name = "PerformanceGuardrailConfigError";
    this.code = options.code;
  }
}

export const validatePerformanceGuardrailConfig = (
  config: PerformanceGuardrailConfig | SerializedPerformanceGuardrailConfig,
): void => {
  ensureNonEmptyString(config.version, "version");
  ensureNonEmptyString(config.degradationPolicyVersion, "degradationPolicyVersion");

  ensurePositiveInteger(config.maxSorPlanningLatencyMs, "maxSorPlanningLatencyMs");
  ensurePositiveInteger(config.maxNettingPlanningLatencyMs, "maxNettingPlanningLatencyMs");
  ensurePositiveInteger(config.maxClearingPlanningLatencyMs, "maxClearingPlanningLatencyMs");
  ensurePositiveInteger(config.maxBucketEntityCount, "maxBucketEntityCount");
  ensurePositiveInteger(config.maxGraphEdges, "maxGraphEdges");
  ensurePositiveInteger(config.maxCandidateGroups, "maxCandidateGroups");
  ensurePositiveInteger(config.maxLockWaitMs, "maxLockWaitMs");
  ensurePositiveInteger(config.maxLockHoldMs, "maxLockHoldMs");
  ensurePositiveInteger(
    config.maxReplayWriteFailuresBeforeDegrade,
    "maxReplayWriteFailuresBeforeDegrade",
  );
};

export const createPerformanceGuardrailConfig = (
  input: PerformanceGuardrailConfig | SerializedPerformanceGuardrailConfig,
): PerformanceGuardrailConfig => {
  validatePerformanceGuardrailConfig(input);

  return Object.freeze({
    version: input.version,
    maxSorPlanningLatencyMs: input.maxSorPlanningLatencyMs,
    maxNettingPlanningLatencyMs: input.maxNettingPlanningLatencyMs,
    maxClearingPlanningLatencyMs: input.maxClearingPlanningLatencyMs,
    maxBucketEntityCount: input.maxBucketEntityCount,
    maxGraphEdges: input.maxGraphEdges,
    maxCandidateGroups: input.maxCandidateGroups,
    maxLockWaitMs: input.maxLockWaitMs,
    maxLockHoldMs: input.maxLockHoldMs,
    maxReplayWriteFailuresBeforeDegrade: input.maxReplayWriteFailuresBeforeDegrade,
    degradationPolicyVersion: input.degradationPolicyVersion,
  });
};

export const serializePerformanceGuardrailConfig = (
  config: PerformanceGuardrailConfig,
): SerializedPerformanceGuardrailConfig => {
  validatePerformanceGuardrailConfig(config);

  return {
    version: config.version,
    maxSorPlanningLatencyMs: config.maxSorPlanningLatencyMs,
    maxNettingPlanningLatencyMs: config.maxNettingPlanningLatencyMs,
    maxClearingPlanningLatencyMs: config.maxClearingPlanningLatencyMs,
    maxBucketEntityCount: config.maxBucketEntityCount,
    maxGraphEdges: config.maxGraphEdges,
    maxCandidateGroups: config.maxCandidateGroups,
    maxLockWaitMs: config.maxLockWaitMs,
    maxLockHoldMs: config.maxLockHoldMs,
    maxReplayWriteFailuresBeforeDegrade: config.maxReplayWriteFailuresBeforeDegrade,
    degradationPolicyVersion: config.degradationPolicyVersion,
  };
};

const ensureNonEmptyString = (value: string, field: string): void => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PerformanceGuardrailConfigError(`${field} must be a non-empty string.`, {
      code: "invalid_guardrail_config",
    });
  }
};

const ensurePositiveInteger = (value: number, field: string): void => {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new PerformanceGuardrailConfigError(`${field} must be a positive integer.`, {
      code: "invalid_guardrail_config",
    });
  }
};
