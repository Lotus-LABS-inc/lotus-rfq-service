import Decimal from "decimal.js";
import type { Logger } from "pino";

import { QualificationRunStatus, type StrategyDecisionEvaluation, type StrategyQualificationRun } from "./qualification.types.js";
import type {
  HistoricalSimulationRunner,
  HistoricalSimulationRunnerInput,
  HistoricalSimulationRunnerResult,
  HistoricalSimulationSliceResult
} from "../../simulation/historical-simulation-runner.js";

export interface QualificationHistoricalSimulationServiceDeps {
  qualificationRunManager: Pick<
    import("./qualification-run-manager.js").QualificationRunManager,
    "getRun" | "mergeRunMetadata" | "recordDecisionEvaluation"
  >;
  historicalSimulationRunner: Pick<HistoricalSimulationRunner, "run">;
  logger?: Pick<Logger, "info" | "warn" | "error">;
}

export interface QualificationHistoricalSimulationInput
  extends Omit<HistoricalSimulationRunnerInput, "qualificationRunId"> {
  qualificationRunId: string;
  attachToQualificationRun: boolean;
  populateDecisionEvaluations: boolean;
}

export interface QualificationHistoricalSimulationResult {
  qualificationRun: StrategyQualificationRun;
  simulationRunId: string | null;
  simulationResult: HistoricalSimulationRunnerResult;
  populatedEvaluations: readonly StrategyDecisionEvaluation[];
  historicalSimulationSummary: Record<string, unknown> | null;
}

export class QualificationHistoricalSimulationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "QualificationHistoricalSimulationError";
  }
}

const TERMINAL_QUALIFICATION_RUN_STATUSES = new Set<QualificationRunStatus>([
  QualificationRunStatus.SUCCEEDED,
  QualificationRunStatus.FAILED,
  QualificationRunStatus.CANCELLED
]);

const ZERO = new Decimal(0);

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const parseDecimal = (value: unknown): InstanceType<typeof Decimal> => {
  if (typeof value !== "string" && typeof value !== "number") {
    return ZERO;
  }

  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : ZERO;
  } catch {
    return ZERO;
  }
};

const stableObject = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .reduce<Record<string, unknown>>((accumulator, key) => {
      const entry = value[key];
      if (Array.isArray(entry)) {
        accumulator[key] = entry.map((item) => (isPlainRecord(item) ? stableObject(item) : item));
        return accumulator;
      }
      accumulator[key] = isPlainRecord(entry) ? stableObject(entry) : entry;
      return accumulator;
    }, {});

const deriveImprovementMetrics = (sliceResult: HistoricalSimulationSliceResult): Record<string, unknown> => {
  const lotusFeeAdjusted = isPlainRecord(sliceResult.lotusResult.feeAdjustedResult)
    ? sliceResult.lotusResult.feeAdjustedResult
    : null;
  const blocked =
    (isPlainRecord(sliceResult.lotusResult.metadata) && sliceResult.lotusResult.metadata.blocked === true) ||
    (sliceResult.rolloutEligibility.status as string | undefined) === "BLOCKED";

  if (!lotusFeeAdjusted || blocked) {
    return stableObject({
      priceImprovement: "0",
      slippageSaved: "0",
      feeSaved: "0",
      externalNotionalAvoided: "0",
      internalizationGain: "0",
      compressionGain: "0",
      baselineTypeUsed: "BEST_EXTERNAL_ONLY",
      supplementalEvidence: true,
      blocked: true,
      fillProbabilityDelta: null,
      unsupportedMetricsZeroed: ["externalNotionalAvoided", "internalizationGain", "compressionGain"]
    });
  }

  const bestExternal = sliceResult.baselineResults.bestExternalOnly;
  const baselineFeeStripped = parseDecimal(bestExternal.effectiveCost).minus(parseDecimal(bestExternal.fees));
  const lotusFeeStripped = parseDecimal(lotusFeeAdjusted.effectiveCost).minus(parseDecimal(lotusFeeAdjusted.fees));
  const fillProbabilityDelta =
    bestExternal.fillProbability !== null && typeof lotusFeeAdjusted.fillProbability === "string"
      ? parseDecimal(bestExternal.fillProbability).minus(parseDecimal(lotusFeeAdjusted.fillProbability)).toString()
      : null;

  return stableObject({
    priceImprovement: baselineFeeStripped.minus(lotusFeeStripped).toString(),
    slippageSaved: parseDecimal(bestExternal.slippage).minus(parseDecimal(lotusFeeAdjusted.slippage)).toString(),
    feeSaved: parseDecimal(bestExternal.fees).minus(parseDecimal(lotusFeeAdjusted.fees)).toString(),
    externalNotionalAvoided: "0",
    internalizationGain: "0",
    compressionGain: "0",
    baselineTypeUsed: "BEST_EXTERNAL_ONLY",
    supplementalEvidence: true,
    blocked: false,
    fillProbabilityDelta,
    unsupportedMetricsZeroed: ["externalNotionalAvoided", "internalizationGain", "compressionGain"]
  });
};

const buildHistoricalSimulationSummary = (
  input: QualificationHistoricalSimulationInput,
  result: HistoricalSimulationRunnerResult
): Record<string, unknown> => {
  const totals = result.sliceResults.reduce(
    (accumulator, sliceResult) => {
      const metrics = deriveImprovementMetrics(sliceResult);
      accumulator.priceImprovement = accumulator.priceImprovement.plus(parseDecimal(metrics.priceImprovement));
      accumulator.slippageSaved = accumulator.slippageSaved.plus(parseDecimal(metrics.slippageSaved));
      accumulator.feeSaved = accumulator.feeSaved.plus(parseDecimal(metrics.feeSaved));
      return accumulator;
    },
    {
      priceImprovement: ZERO,
      slippageSaved: ZERO,
      feeSaved: ZERO
    }
  );

  return stableObject({
    latestSimulationRunId: result.runId,
    attachedAt: new Date().toISOString(),
    scope: {
      venuePair: input.venuePair,
      marketClass: input.marketClass,
      canonicalEventId: input.canonicalEventId,
      windowStart: input.windowStart.toISOString(),
      windowEnd: input.windowEnd.toISOString()
    },
    sliceCount: result.sliceCount,
    blockedSliceCount: result.blockedSliceCount,
    persistedResultCount: result.persistedResultCount,
    bestExternalDeltaTotals: {
      priceImprovement: totals.priceImprovement.toString(),
      slippageSaved: totals.slippageSaved.toString(),
      feeSaved: totals.feeSaved.toString()
    },
    safeEquivalentBlockedCount: result.blockedSliceCount
  });
};

export class QualificationHistoricalSimulationService {
  private readonly logger: Pick<Logger, "info" | "warn" | "error">;

  public constructor(private readonly deps: QualificationHistoricalSimulationServiceDeps) {
    this.logger = deps.logger ?? {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    };
  }

  public async runHistoricalSimulationForQualification(
    input: QualificationHistoricalSimulationInput
  ): Promise<QualificationHistoricalSimulationResult> {
    const qualificationRun = await this.deps.qualificationRunManager.getRun(input.qualificationRunId);

    if (TERMINAL_QUALIFICATION_RUN_STATUSES.has(qualificationRun.status)) {
      throw new QualificationHistoricalSimulationError(
        `Qualification run ${qualificationRun.id} is terminal and cannot accept historical simulation evidence.`
      );
    }

    if (input.dryRun && (input.attachToQualificationRun || input.populateDecisionEvaluations)) {
      throw new QualificationHistoricalSimulationError(
        "Dry-run historical simulation cannot attach to qualification runs or populate decision evaluations."
      );
    }

    const simulationResult = await this.deps.historicalSimulationRunner.run({
      ...input,
      qualificationRunId: input.attachToQualificationRun ? input.qualificationRunId : null
    });

    if (!input.dryRun && (input.attachToQualificationRun || input.populateDecisionEvaluations) && simulationResult.runId === null) {
      throw new QualificationHistoricalSimulationError(
        "Persisted historical simulation must return a runId when attaching or populating qualification evidence."
      );
    }

    const populatedEvaluations = input.populateDecisionEvaluations
      ? await this.populateDecisionEvaluations(input.qualificationRunId, simulationResult)
      : [];

    const historicalSimulationSummary =
      input.attachToQualificationRun && simulationResult.runId !== null
        ? buildHistoricalSimulationSummary(input, simulationResult)
        : null;

    const updatedQualificationRun =
      historicalSimulationSummary === null
        ? qualificationRun
        : await this.deps.qualificationRunManager.mergeRunMetadata(input.qualificationRunId, {
            historicalSimulationEvidence: historicalSimulationSummary
          });

    this.logger.info(
      {
        qualificationRunId: input.qualificationRunId,
        simulationRunId: simulationResult.runId,
        attached: input.attachToQualificationRun,
        populatedEvaluations: populatedEvaluations.length
      },
      "Completed qualification historical simulation bridge run."
    );

    return {
      qualificationRun: updatedQualificationRun,
      simulationRunId: simulationResult.runId,
      simulationResult,
      populatedEvaluations,
      historicalSimulationSummary
    };
  }

  private async populateDecisionEvaluations(
    qualificationRunId: string,
    simulationResult: HistoricalSimulationRunnerResult
  ): Promise<readonly StrategyDecisionEvaluation[]> {
    const simulationRunId = simulationResult.runId;
    if (simulationRunId === null) {
      throw new QualificationHistoricalSimulationError(
        "Historical simulation decision evaluations require a persisted simulation run."
      );
    }

    const evaluations: StrategyDecisionEvaluation[] = [];
    for (const sliceResult of simulationResult.sliceResults) {
      const blocked =
        (sliceResult.rolloutEligibility.status as string | undefined) === "BLOCKED" ||
        (isPlainRecord(sliceResult.lotusResult.metadata) && sliceResult.lotusResult.metadata.blocked === true);

      const realizedMetrics = stableObject({
        ...(isPlainRecord(sliceResult.lotusResult) ? sliceResult.lotusResult : {}),
        simulationRunId,
        timestamp: sliceResult.timestamp.toISOString(),
        safeEquivalentEligible: sliceResult.lotusResult.safeEquivalentEligible ?? false,
        blocked,
        configVersion: sliceResult.lotusResult.configVersion ?? null,
        engineVersion: sliceResult.lotusResult.engineVersion ?? null
      });

      const counterfactualMetrics = stableObject({
        primaryCounterfactual: sliceResult.baselineResults.bestExternalOnly,
        baselines: sliceResult.baselineResults
      });

      const improvementMetrics = deriveImprovementMetrics(sliceResult);

      const evaluation = await this.deps.qualificationRunManager.recordDecisionEvaluation(qualificationRunId, {
        decisionType: "HISTORICAL_SIMULATION",
        entityId: `${simulationRunId}:${sliceResult.timestamp.toISOString()}`,
        replayEnvelopeId: null,
        realizedMetrics,
        counterfactualMetrics,
        improvementMetrics
      });
      evaluations.push(evaluation);
    }

    return evaluations;
  }
}
