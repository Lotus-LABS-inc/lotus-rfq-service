import { describe, expect, it, vi } from "vitest";

import { QualificationStage, QualificationRunStatus, type StrategyQualificationRun } from "../../src/core/qualification/qualification.types.js";
import {
  QualificationHistoricalSimulationError,
  QualificationHistoricalSimulationService
} from "../../src/core/qualification/qualification-historical-simulation-service.js";
import { HistoricalMarketClass, HistoricalSimulationRunStatus } from "../../src/core/historical-simulation/historical-simulation.types.js";
import type { HistoricalSimulationRunnerResult } from "../../src/simulation/historical-simulation-runner.js";

const qualificationRun: StrategyQualificationRun = {
  id: "run-1",
  strategyKey: "strategy.phase4",
  scopeType: "EVENT",
  scopeId: "scope-1",
  stage: QualificationStage.SHADOW,
  engineVersion: "eng-v1",
  configVersion: "cfg-v1",
  startedAt: new Date("2026-03-13T00:00:00.000Z"),
  endedAt: null,
  status: QualificationRunStatus.RUNNING,
  metadata: {}
};

const simulationResult: HistoricalSimulationRunnerResult = {
  runId: "simulation-run-1",
  dryRun: false,
  status: HistoricalSimulationRunStatus.SUCCEEDED,
  sliceResults: [
    {
      timestamp: new Date("2026-03-13T00:00:00.000Z"),
      baselineResults: {
        polymarketOnly: {
          venue: "POLYMARKET",
          baselineType: "POLYMARKET_ONLY",
          effectiveCost: "0.60",
          slippage: "0.04",
          fees: "0.01",
          fillProbability: "1",
          fillProbabilityReason: null,
          timestampStart: new Date("2026-03-13T00:00:00.000Z"),
          timestampEnd: new Date("2026-03-13T00:00:00.000Z"),
          observedStateCount: 1,
          metadata: {}
        },
        limitlessOnly: {
          venue: "LIMITLESS",
          baselineType: "LIMITLESS_ONLY",
          effectiveCost: "0.58",
          slippage: "0.03",
          fees: "0.01",
          fillProbability: null,
          fillProbabilityReason: "price_only_history",
          timestampStart: new Date("2026-03-13T00:00:00.000Z"),
          timestampEnd: new Date("2026-03-13T00:00:00.000Z"),
          observedStateCount: 1,
          metadata: {}
        },
        opinionOnly: null,
        myriadOnly: null,
        bestExternalOnly: {
          venue: "LIMITLESS",
          baselineType: "BEST_EXTERNAL_ONLY",
          effectiveCost: "0.58",
          slippage: "0.03",
          fees: "0.01",
          fillProbability: null,
          fillProbabilityReason: "price_only_history",
          timestampStart: new Date("2026-03-13T00:00:00.000Z"),
          timestampEnd: new Date("2026-03-13T00:00:00.000Z"),
          observedStateCount: 1,
          metadata: {}
        },
        noInternalization: {
          venue: "LIMITLESS",
          baselineType: "NO_INTERNALIZATION",
          effectiveCost: "0.58",
          slippage: "0.03",
          fees: "0.01",
          fillProbability: null,
          fillProbabilityReason: "price_only_history",
          timestampStart: new Date("2026-03-13T00:00:00.000Z"),
          timestampEnd: new Date("2026-03-13T00:00:00.000Z"),
          observedStateCount: 1,
          metadata: {}
        }
      },
      lotusResult: {
        configVersion: "cfg-v1",
        engineVersion: "eng-v1",
        timestamp: "2026-03-13T00:00:00.000Z",
        safeEquivalentEligible: true,
        feeAdjustedResult: {
          effectiveCost: "0.55",
          slippage: "0.01",
          fees: "0.00",
          fillProbability: "1",
          fillProbabilityReason: null
        },
        metadata: {
          blocked: false
        }
      },
      improvement: {
        bestExternalOnly: {
          effectiveCostDelta: "0.03"
        }
      },
      rolloutEligibility: {
        status: "EVALUATED",
        safeEquivalentEligible: true,
        reason: null
      },
      persistedResultId: "result-1"
    }
  ],
  sliceCount: 1,
  persistedResultCount: 1,
  blockedSliceCount: 0,
  metadata: {
    canonicalEventId: "canonical-event-1"
  }
};

describe("QualificationHistoricalSimulationService", () => {
  it("attaches simulation outputs to a qualification run and populates decision evaluations", async () => {
    const getRun = vi.fn().mockResolvedValue(qualificationRun);
    const mergeRunMetadata = vi.fn().mockImplementation(async (_runId: string, patch: Record<string, unknown>) => ({
      ...qualificationRun,
      metadata: {
        ...qualificationRun.metadata,
        ...patch
      }
    }));
    const recordDecisionEvaluation = vi.fn().mockResolvedValue({
      id: "evaluation-1",
      qualificationRunId: qualificationRun.id,
      decisionType: "HISTORICAL_SIMULATION",
      entityId: "simulation-run-1:2026-03-13T00:00:00.000Z",
      replayEnvelopeId: null,
      realizedMetrics: {},
      counterfactualMetrics: {},
      improvementMetrics: {},
      createdAt: new Date("2026-03-13T00:00:01.000Z")
    });
    const run = vi.fn().mockResolvedValue(simulationResult);

    const service = new QualificationHistoricalSimulationService({
      qualificationRunManager: {
        getRun,
        mergeRunMetadata,
        recordDecisionEvaluation
      },
      historicalSimulationRunner: { run }
    });

    const result = await service.runHistoricalSimulationForQualification({
      qualificationRunId: qualificationRun.id,
      attachToQualificationRun: true,
      populateDecisionEvaluations: true,
      scopeType: "EVENT",
      scopeId: qualificationRun.scopeId,
      routeMode: "POLYMARKET_LIMITLESS",
      marketClass: HistoricalMarketClass.BINARY,
      canonicalEventId: "canonical-event-1",
      side: "BUY",
      requestedNotional: "100",
      windowStart: new Date("2026-03-13T00:00:00.000Z"),
      windowEnd: new Date("2026-03-13T00:05:00.000Z"),
      configVersion: "cfg-v1",
      engineVersion: "eng-v1",
      dryRun: false
    });

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        qualificationRunId: qualificationRun.id
      })
    );
    expect(recordDecisionEvaluation).toHaveBeenCalledTimes(1);
    expect(mergeRunMetadata).toHaveBeenCalledWith(
      qualificationRun.id,
      expect.objectContaining({
        historicalSimulationEvidence: expect.objectContaining({
          latestSimulationRunId: "simulation-run-1",
          sliceCount: 1
        })
      })
    );
    expect(result.simulationRunId).toBe("simulation-run-1");
    expect(result.populatedEvaluations).toHaveLength(1);
    expect(result.qualificationRun.metadata.historicalSimulationEvidence).toEqual(
      expect.objectContaining({
        latestSimulationRunId: "simulation-run-1"
      })
    );
  });

  it("writes blocked supplemental evidence without inventing unsupported gains", async () => {
    const blockedSimulationResult: HistoricalSimulationRunnerResult = {
      ...simulationResult,
      blockedSliceCount: 1,
      sliceResults: [
        {
          ...simulationResult.sliceResults[0]!,
          lotusResult: {
            configVersion: "cfg-v1",
            engineVersion: "eng-v1",
            timestamp: "2026-03-13T00:00:00.000Z",
            safeEquivalentEligible: false,
            feeAdjustedResult: null,
            metadata: {
              blocked: true,
              blockedReason: "not_safe_equivalent"
            }
          },
          rolloutEligibility: {
            status: "BLOCKED",
            safeEquivalentEligible: false,
            reason: "not_safe_equivalent"
          }
        }
      ]
    };

    const recordDecisionEvaluation = vi.fn().mockResolvedValue({
      id: "evaluation-2",
      qualificationRunId: qualificationRun.id,
      decisionType: "HISTORICAL_SIMULATION",
      entityId: "simulation-run-1:2026-03-13T00:00:00.000Z",
      replayEnvelopeId: null,
      realizedMetrics: {},
      counterfactualMetrics: {},
      improvementMetrics: {},
      createdAt: new Date("2026-03-13T00:00:01.000Z")
    });

    const service = new QualificationHistoricalSimulationService({
      qualificationRunManager: {
        getRun: vi.fn().mockResolvedValue(qualificationRun),
        mergeRunMetadata: vi.fn().mockResolvedValue(qualificationRun),
        recordDecisionEvaluation
      },
      historicalSimulationRunner: {
        run: vi.fn().mockResolvedValue(blockedSimulationResult)
      }
    });

    await service.runHistoricalSimulationForQualification({
      qualificationRunId: qualificationRun.id,
      attachToQualificationRun: false,
      populateDecisionEvaluations: true,
      scopeType: "EVENT",
      scopeId: qualificationRun.scopeId,
      routeMode: "POLYMARKET_LIMITLESS",
      marketClass: HistoricalMarketClass.BINARY,
      canonicalEventId: "canonical-event-1",
      side: "BUY",
      requestedNotional: "100",
      windowStart: new Date("2026-03-13T00:00:00.000Z"),
      windowEnd: new Date("2026-03-13T00:05:00.000Z"),
      configVersion: "cfg-v1",
      engineVersion: "eng-v1",
      dryRun: false
    });

    expect(recordDecisionEvaluation).toHaveBeenCalledWith(
      qualificationRun.id,
      expect.objectContaining({
        improvementMetrics: expect.objectContaining({
          priceImprovement: "0",
          slippageSaved: "0",
          feeSaved: "0",
          externalNotionalAvoided: "0",
          internalizationGain: "0",
          compressionGain: "0",
          blocked: true
        })
      })
    );
  });

  it("fails closed when dry-run is asked to attach qualification evidence", async () => {
    const service = new QualificationHistoricalSimulationService({
      qualificationRunManager: {
        getRun: vi.fn().mockResolvedValue(qualificationRun),
        mergeRunMetadata: vi.fn(),
        recordDecisionEvaluation: vi.fn()
      },
      historicalSimulationRunner: {
        run: vi.fn()
      }
    });

    await expect(
      service.runHistoricalSimulationForQualification({
        qualificationRunId: qualificationRun.id,
        attachToQualificationRun: true,
        populateDecisionEvaluations: false,
        scopeType: "EVENT",
        scopeId: qualificationRun.scopeId,
        routeMode: "POLYMARKET_LIMITLESS",
        marketClass: HistoricalMarketClass.BINARY,
        canonicalEventId: "canonical-event-1",
        side: "BUY",
        requestedNotional: "100",
        windowStart: new Date("2026-03-13T00:00:00.000Z"),
        windowEnd: new Date("2026-03-13T00:05:00.000Z"),
        configVersion: "cfg-v1",
        engineVersion: "eng-v1",
        dryRun: true
      })
    ).rejects.toBeInstanceOf(QualificationHistoricalSimulationError);
  });
});
