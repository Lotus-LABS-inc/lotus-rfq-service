import Decimal from "decimal.js";
import type { Logger } from "pino";
import type { Pool, QueryResultRow } from "pg";

import {
  HistoricalMarketClass,
  resolveHistoricalSimulationRouteModeVenues,
  HistoricalSimulationRunStatus,
  type HistoricalRoutingComparison,
  type HistoricalCanonicalCategory,
  type HistoricalSimulationOrderSide,
  type HistoricalSimulationRouteMode,
  type CreateHistoricalSimulationResultInput,
  type HistoricalMarketState
} from "../core/historical-simulation/historical-simulation.types.js";
import type { BestExternalOnlyBaselineEvaluator } from "./baselines/best-external-only-baseline.js";
import type { HistoricalSimulationBaselineEstimate } from "./baselines/shared.js";
import type { LimitlessOnlyBaselineEvaluator } from "./baselines/limitless-only-baseline.js";
import type { MyriadOnlyBaselineEvaluator } from "./baselines/myriad-only-baseline.js";
import type { NoInternalizationBaselineEvaluator } from "./baselines/no-internalization-baseline.js";
import type { OpinionOnlyBaselineEvaluator } from "./baselines/opinion-only-baseline.js";
import type { PolymarketOnlyBaselineEvaluator } from "./baselines/polymarket-only-baseline.js";
import type { PredictOnlyBaselineEvaluator } from "./baselines/predict-only-baseline.js";

export type HistoricalSimulationRunnerErrorCode =
  | "historical_state_missing"
  | "historical_state_invalid"
  | "lotus_evaluator_missing"
  | "lotus_evaluation_failed"
  | "baseline_evaluation_failed"
  | "simulation_persistence_failed";

export class HistoricalSimulationRunnerError extends Error {
  public readonly code: HistoricalSimulationRunnerErrorCode;

  public constructor(code: HistoricalSimulationRunnerErrorCode, message: string) {
    super(message);
    this.name = "HistoricalSimulationRunnerError";
    this.code = code;
  }
}

export interface HistoricalLotusFeeAdjustedResult {
  effectiveCost: string;
  slippage: string;
  fees: string;
  fillProbability: string | null;
  fillProbabilityReason?: string | null;
  routingComparison?: HistoricalRoutingComparison;
  metadata?: Record<string, unknown>;
}

export interface HistoricalLotusPathSliceContext {
  scopeType: string;
  scopeId: string;
  routeMode: HistoricalSimulationRouteMode;
  marketClass: HistoricalMarketClass;
  canonicalEventId: string;
  canonicalMarketId: string | null | undefined;
  side: HistoricalSimulationOrderSide;
  requestedNotional: string;
  timestamp: Date;
  configVersion: string;
  engineVersion: string;
  states: readonly HistoricalMarketState[];
  providedSnapshots?: {
    resolutionRiskSnapshot?: Record<string, unknown>;
  };
  metadata?: Record<string, unknown>;
}

export interface HistoricalLotusResolutionRiskGatingResult {
  allowed: boolean;
  safeEquivalentEligible: boolean;
  reason: string | null;
  metadata?: Record<string, unknown>;
}

export interface HistoricalLotusPathEvaluatorBundle {
  evaluateRFQGrouping(context: HistoricalLotusPathSliceContext): Promise<Record<string, unknown>> | Record<string, unknown>;
  evaluateSOR(context: HistoricalLotusPathSliceContext): Promise<Record<string, unknown>> | Record<string, unknown>;
  evaluateInternalCrossEligibility(context: HistoricalLotusPathSliceContext): Promise<Record<string, unknown>> | Record<string, unknown>;
  evaluatePhase2ANettingEligibility(context: HistoricalLotusPathSliceContext): Promise<Record<string, unknown>> | Record<string, unknown>;
  evaluateResolutionRiskGating(
    context: HistoricalLotusPathSliceContext
  ): Promise<HistoricalLotusResolutionRiskGatingResult> | HistoricalLotusResolutionRiskGatingResult;
  evaluateFeeAdjustedLotusResult(
    context: HistoricalLotusPathSliceContext,
    priorDecisions: {
      resolutionRiskGating: HistoricalLotusResolutionRiskGatingResult;
      rfqGrouping: Record<string, unknown>;
      sor: Record<string, unknown>;
      internalCrossEligibility: Record<string, unknown>;
      phase2aNettingEligibility: Record<string, unknown>;
    }
  ): Promise<HistoricalLotusFeeAdjustedResult> | HistoricalLotusFeeAdjustedResult;
}

export interface HistoricalSimulationRunnerInput {
  qualificationRunId?: string | null;
  scopeType: string;
  scopeId: string;
  routeMode: HistoricalSimulationRouteMode;
  marketClass: HistoricalMarketClass;
  canonicalEventId: string;
  canonicalMarketId?: string | null | undefined;
  side: HistoricalSimulationOrderSide;
  requestedNotional: string;
  windowStart: Date;
  windowEnd: Date;
  configVersion: string;
  engineVersion: string;
  dryRun: boolean;
  metadata?: Record<string, unknown>;
  providedSnapshots?: {
    resolutionRiskByTimestamp?: Readonly<Record<string, Record<string, unknown>>>;
  };
}

export interface HistoricalSimulationSliceResult {
  timestamp: Date;
  baselineResults: {
    polymarketOnly: HistoricalSimulationBaselineEstimate | null;
    limitlessOnly: HistoricalSimulationBaselineEstimate | null;
    opinionOnly: HistoricalSimulationBaselineEstimate | null;
    myriadOnly: HistoricalSimulationBaselineEstimate | null;
    predictOnly: HistoricalSimulationBaselineEstimate | null;
    bestExternalOnly: HistoricalSimulationBaselineEstimate;
    noInternalization: HistoricalSimulationBaselineEstimate;
  };
  lotusResult: Record<string, unknown>;
  improvement: Record<string, unknown>;
  rolloutEligibility: Record<string, unknown>;
  persistedResultId: string | null;
}

export interface HistoricalSimulationRunnerResult {
  runId: string | null;
  dryRun: boolean;
  status: HistoricalSimulationRunStatus;
  sliceResults: readonly HistoricalSimulationSliceResult[];
  sliceCount: number;
  persistedResultCount: number;
  blockedSliceCount: number;
  metadata: Record<string, unknown>;
}

interface HistoricalSimulationRunRow extends QueryResultRow {
  id: string;
  status: string;
}

interface HistoricalSimulationResultRow extends QueryResultRow {
  id: string;
}

interface HistoricalMarketStateRow extends QueryResultRow {
  id: string;
  canonical_event_id: string;
  canonical_market_id: string | null;
  canonical_category: string | null;
  venue: string;
  venue_market_id: string;
  market_class: string;
  timestamp: Date;
  midpoint: string | null;
  best_bid: string | null;
  best_ask: string | null;
  spread: string | null;
  last_price: string | null;
  volume: string | null;
  open_interest: string | null;
  candles: Record<string, unknown> | null;
  orderbook_snapshot: Record<string, unknown> | null;
  market_events: Record<string, unknown> | null;
  trades: Record<string, unknown> | null;
  own_execution_history: Record<string, unknown> | null;
  metadata_version: string;
  source_timestamp: Date;
}

export interface HistoricalSimulationRunnerDeps {
  pool: Pool;
  polymarketOnlyBaselineEvaluator: Pick<PolymarketOnlyBaselineEvaluator, "evaluate">;
  limitlessOnlyBaselineEvaluator: Pick<LimitlessOnlyBaselineEvaluator, "evaluate">;
  opinionOnlyBaselineEvaluator: Pick<OpinionOnlyBaselineEvaluator, "evaluate">;
  myriadOnlyBaselineEvaluator: Pick<MyriadOnlyBaselineEvaluator, "evaluate">;
  predictOnlyBaselineEvaluator: Pick<PredictOnlyBaselineEvaluator, "evaluate">;
  bestExternalOnlyBaselineEvaluator: Pick<BestExternalOnlyBaselineEvaluator, "evaluate">;
  noInternalizationBaselineEvaluator: Pick<NoInternalizationBaselineEvaluator, "evaluate">;
  lotusEvaluators: HistoricalLotusPathEvaluatorBundle;
  logger?: Pick<Logger, "info" | "warn" | "error">;
}

const createNoopLogger = (): Pick<Logger, "info" | "warn" | "error"> => ({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
});

const orderKeysDeterministically = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => orderKeysDeterministically(entry));
  }

  if (value !== null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort((left, right) => left.localeCompare(right))
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = orderKeysDeterministically((value as Record<string, unknown>)[key]);
        return accumulator;
      }, {});
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
};

const stableJsonRecord = (value: Record<string, unknown>): Record<string, unknown> =>
  orderKeysDeterministically(value) as Record<string, unknown>;

const parseDeltaDecimal = (value: string | null, fieldName: string): InstanceType<typeof Decimal> | null => {
  if (value === null) {
    return null;
  }

  try {
    const parsed = new Decimal(value);
    if (!parsed.isFinite()) {
      throw new Error("non-finite");
    }
    return parsed;
  } catch {
    throw new HistoricalSimulationRunnerError(
      "historical_state_invalid",
      `${fieldName} must be a finite decimal-compatible string.`
    );
  }
};

const mapHistoricalMarketStateRow = (row: HistoricalMarketStateRow): HistoricalMarketState => ({
  id: row.id,
  canonicalEventId: row.canonical_event_id,
  canonicalMarketId: row.canonical_market_id,
  canonicalCategory: row.canonical_category as HistoricalCanonicalCategory | null,
  venue: row.venue,
  venueMarketId: row.venue_market_id,
  marketClass: row.market_class as HistoricalMarketClass,
  timestamp: new Date(row.timestamp),
  midpoint: row.midpoint,
  bestBid: row.best_bid,
  bestAsk: row.best_ask,
  spread: row.spread,
  lastPrice: row.last_price,
  volume: row.volume,
  openInterest: row.open_interest,
  candles: row.candles,
  orderbookSnapshot: row.orderbook_snapshot,
  marketEvents: row.market_events,
  trades: row.trades,
  ownExecutionHistory: row.own_execution_history,
  metadataVersion: row.metadata_version,
  sourceTimestamp: new Date(row.source_timestamp)
});

const sortStates = (states: readonly HistoricalMarketState[]): HistoricalMarketState[] =>
  [...states].sort(
    (left, right) =>
      left.timestamp.getTime() - right.timestamp.getTime() ||
      left.venue.localeCompare(right.venue) ||
      left.venueMarketId.localeCompare(right.venueMarketId) ||
      left.sourceTimestamp.getTime() - right.sourceTimestamp.getTime()
  );

const stateHasPriceEvidence = (state: HistoricalMarketState): boolean =>
  state.bestBid !== null || state.bestAsk !== null || state.midpoint !== null || state.lastPrice !== null;

const venueHasPriceEvidence = (states: readonly HistoricalMarketState[], venue: string): boolean =>
  states.some((state) => state.venue === venue && stateHasPriceEvidence(state));

const mergeAsOfState = (
  previous: HistoricalMarketState | undefined,
  next: HistoricalMarketState
): HistoricalMarketState => {
  if (previous === undefined) {
    return next;
  }

  return {
    ...next,
    midpoint: next.midpoint ?? previous.midpoint,
    bestBid: next.bestBid ?? previous.bestBid,
    bestAsk: next.bestAsk ?? previous.bestAsk,
    spread: next.spread ?? previous.spread,
    lastPrice: next.lastPrice ?? previous.lastPrice
  };
};

const groupStatesIntoSlices = (
  states: readonly HistoricalMarketState[]
): ReadonlyMap<string, readonly HistoricalMarketState[]> => {
  const orderedStates = sortStates(states);
  const snapshots = new Map<string, readonly HistoricalMarketState[]>();
  const latestByVenueMarket = new Map<string, HistoricalMarketState>();

  for (const state of orderedStates) {
    const key = state.timestamp.toISOString();
    const venueMarketKey = `${state.venue}::${state.venueMarketId}`;
    latestByVenueMarket.set(venueMarketKey, mergeAsOfState(latestByVenueMarket.get(venueMarketKey), state));

    const snapshot = sortStates([...latestByVenueMarket.values()]);
    if (snapshot.some((entry) => stateHasPriceEvidence(entry))) {
      snapshots.set(key, snapshot);
    }
  }

  return new Map([...snapshots.entries()].sort((left, right) => left[0].localeCompare(right[0])));
};

const buildBlockedLotusResult = (
  input: HistoricalSimulationRunnerInput,
  timestamp: Date,
  gating: HistoricalLotusResolutionRiskGatingResult
): Record<string, unknown> =>
  stableJsonRecord({
    configVersion: input.configVersion,
    engineVersion: input.engineVersion,
    timestamp: timestamp.toISOString(),
    rfqGrouping: null,
    resolutionRiskGating: gating,
    sor: null,
    internalCrossEligibility: null,
    phase2aNettingEligibility: null,
    feeAdjustedResult: null,
    safeEquivalentEligible: gating.safeEquivalentEligible,
    metadata: {
      blocked: true,
      blockedReason: gating.reason
    }
  });

const compareLotusAgainstBaseline = (
  lotusResult: HistoricalLotusFeeAdjustedResult | null,
  baseline: HistoricalSimulationBaselineEstimate
): Record<string, unknown> => {
  if (!lotusResult) {
    return stableJsonRecord({
      status: "BLOCKED",
      baselineVenue: baseline.venue,
      baselineType: baseline.baselineType,
      baselineEffectiveCost: baseline.effectiveCost,
      baselineSlippage: baseline.slippage,
      baselineFees: baseline.fees,
      baselineFillProbability: baseline.fillProbability
    });
  }

  return stableJsonRecord({
    status: "EVALUATED",
    baselineVenue: baseline.venue,
    baselineType: baseline.baselineType,
    baselineEffectiveCost: baseline.effectiveCost,
    baselineSlippage: baseline.slippage,
    baselineFees: baseline.fees,
    baselineFillProbability: baseline.fillProbability,
    effectiveCostDelta: parseDeltaDecimal(baseline.effectiveCost, "baseline.effectiveCost")
      ?.minus(parseDeltaDecimal(lotusResult.effectiveCost, "lotusResult.effectiveCost")!)
      .toString(),
    slippageDelta: parseDeltaDecimal(baseline.slippage, "baseline.slippage")
      ?.minus(parseDeltaDecimal(lotusResult.slippage, "lotusResult.slippage")!)
      .toString(),
    feeDelta: parseDeltaDecimal(baseline.fees, "baseline.fees")
      ?.minus(parseDeltaDecimal(lotusResult.fees, "lotusResult.fees")!)
      .toString(),
    fillProbabilityDelta:
      baseline.fillProbability !== null && lotusResult.fillProbability !== null
        ? parseDeltaDecimal(baseline.fillProbability, "baseline.fillProbability")
            ?.minus(parseDeltaDecimal(lotusResult.fillProbability, "lotusResult.fillProbability")!)
            .toString()
        : null
  });
};

export class HistoricalSimulationRunner {
  private readonly logger: Pick<Logger, "info" | "warn" | "error">;

  public constructor(private readonly deps: HistoricalSimulationRunnerDeps) {
    this.logger = deps.logger ?? createNoopLogger();
    this.validateEvaluators(deps.lotusEvaluators);
  }

  public async run(input: HistoricalSimulationRunnerInput): Promise<HistoricalSimulationRunnerResult> {
    let runId: string | null = null;

    try {
      if (!input.dryRun) {
        runId = await this.createRun(input);
      }

      const states = await this.loadHistoricalStates(input);
      if (states.length === 0) {
        throw new HistoricalSimulationRunnerError(
          "historical_state_missing",
          `No historical market states found for ${input.canonicalEventId} in the requested window.`
        );
      }

      const slices = groupStatesIntoSlices(states);
      const sliceResults: HistoricalSimulationSliceResult[] = [];

      for (const [sliceKey, sliceStates] of slices.entries()) {
        const sliceResult = await this.evaluateSlice(input, new Date(sliceKey), sliceStates, runId);
        sliceResults.push(sliceResult);
      }

      const blockedSliceCount = sliceResults.filter(
        (slice) => (slice.rolloutEligibility.status as string | undefined) === "BLOCKED"
      ).length;
      const persistedResultCount = sliceResults.filter((slice) => slice.persistedResultId !== null).length;

      if (runId !== null) {
        await this.closeRun(runId, HistoricalSimulationRunStatus.SUCCEEDED);
      }

      return {
        runId,
        dryRun: input.dryRun,
        status: HistoricalSimulationRunStatus.SUCCEEDED,
        sliceResults,
        sliceCount: sliceResults.length,
        persistedResultCount,
        blockedSliceCount,
        metadata: stableJsonRecord({
          configVersion: input.configVersion,
          engineVersion: input.engineVersion,
          canonicalEventId: input.canonicalEventId,
          ...(input.metadata ?? {})
        })
      };
    } catch (error) {
      if (runId !== null) {
        await this.closeRun(runId, HistoricalSimulationRunStatus.FAILED).catch(() => undefined);
      }

      if (error instanceof HistoricalSimulationRunnerError) {
        throw error;
      }

      throw new HistoricalSimulationRunnerError(
        "lotus_evaluation_failed",
        error instanceof Error ? error.message : "Historical simulation failed."
      );
    }
  }

  private async evaluateSlice(
    input: HistoricalSimulationRunnerInput,
    timestamp: Date,
    states: readonly HistoricalMarketState[],
    runId: string | null
  ): Promise<HistoricalSimulationSliceResult> {
      const baselineInput = {
      canonicalEventId: input.canonicalEventId,
      marketStates: states,
      side: input.side,
      requestedNotional: input.requestedNotional,
      feePolicy: {
        version: input.configVersion,
        venues: {
          POLYMARKET: { feeBps: "0" },
          LIMITLESS: { feeBps: "0" },
          OPINION: { feeBps: "0" },
          MYRIAD: { feeBps: "0" },
          PREDICT: { feeBps: "0" }
        }
      }
    };

    let baselineResults: HistoricalSimulationSliceResult["baselineResults"];
    try {
      baselineResults = {
        polymarketOnly: venueHasPriceEvidence(states, "POLYMARKET")
          ? this.deps.polymarketOnlyBaselineEvaluator.evaluate(baselineInput)
          : null,
        limitlessOnly: venueHasPriceEvidence(states, "LIMITLESS")
          ? this.deps.limitlessOnlyBaselineEvaluator.evaluate(baselineInput)
          : null,
        opinionOnly: venueHasPriceEvidence(states, "OPINION")
          ? this.deps.opinionOnlyBaselineEvaluator.evaluate(baselineInput)
          : null,
        myriadOnly: venueHasPriceEvidence(states, "MYRIAD")
          ? this.deps.myriadOnlyBaselineEvaluator.evaluate(baselineInput)
          : null,
        predictOnly: venueHasPriceEvidence(states, "PREDICT")
          ? this.deps.predictOnlyBaselineEvaluator.evaluate(baselineInput)
          : null,
        bestExternalOnly: this.deps.bestExternalOnlyBaselineEvaluator.evaluate(baselineInput),
        noInternalization: this.deps.noInternalizationBaselineEvaluator.evaluate(baselineInput)
      };
    } catch (error) {
      throw new HistoricalSimulationRunnerError(
        "baseline_evaluation_failed",
        error instanceof Error ? error.message : "Historical baseline evaluation failed."
      );
    }

    const resolutionRiskSnapshot = input.providedSnapshots?.resolutionRiskByTimestamp?.[timestamp.toISOString()];
    const sliceContext: HistoricalLotusPathSliceContext = {
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      routeMode: input.routeMode,
      marketClass: input.marketClass,
      canonicalEventId: input.canonicalEventId,
      canonicalMarketId: input.canonicalMarketId,
      side: input.side,
      requestedNotional: input.requestedNotional,
      timestamp,
      configVersion: input.configVersion,
      engineVersion: input.engineVersion,
      states,
      ...(resolutionRiskSnapshot
        ? {
            providedSnapshots: {
              resolutionRiskSnapshot
            }
          }
        : {}),
      ...(input.metadata ? { metadata: input.metadata } : {})
    };

    let lotusResult: Record<string, unknown>;
    let feeAdjustedLotusResult: HistoricalLotusFeeAdjustedResult | null = null;
    let rolloutEligibility: Record<string, unknown>;

    try {
      const gating = await Promise.resolve(this.deps.lotusEvaluators.evaluateResolutionRiskGating(sliceContext));
      if (!gating.allowed || !gating.safeEquivalentEligible) {
        lotusResult = buildBlockedLotusResult(input, timestamp, gating);
        rolloutEligibility = stableJsonRecord({
          status: "BLOCKED",
          safeEquivalentEligible: gating.safeEquivalentEligible,
          reason: gating.reason
        });
      } else {
        const rfqGrouping = await Promise.resolve(this.deps.lotusEvaluators.evaluateRFQGrouping(sliceContext));
        const sor = await Promise.resolve(this.deps.lotusEvaluators.evaluateSOR(sliceContext));
        const internalCrossEligibility = await Promise.resolve(
          this.deps.lotusEvaluators.evaluateInternalCrossEligibility(sliceContext)
        );
        const phase2aNettingEligibility = await Promise.resolve(
          this.deps.lotusEvaluators.evaluatePhase2ANettingEligibility(sliceContext)
        );
        feeAdjustedLotusResult = await Promise.resolve(
          this.deps.lotusEvaluators.evaluateFeeAdjustedLotusResult(sliceContext, {
            resolutionRiskGating: gating,
            rfqGrouping,
            sor,
            internalCrossEligibility,
            phase2aNettingEligibility
          })
        );

        lotusResult = stableJsonRecord({
          configVersion: input.configVersion,
          engineVersion: input.engineVersion,
          timestamp: timestamp.toISOString(),
          rfqGrouping,
          resolutionRiskGating: gating,
          sor,
          internalCrossEligibility,
          phase2aNettingEligibility,
          feeAdjustedResult: feeAdjustedLotusResult,
          safeEquivalentEligible: gating.safeEquivalentEligible,
          metadata: {
            blocked: false
          }
        });
        rolloutEligibility = stableJsonRecord({
          status: "EVALUATED",
          safeEquivalentEligible: gating.safeEquivalentEligible,
          reason: gating.reason
        });
      }
    } catch (error) {
      throw new HistoricalSimulationRunnerError(
        "lotus_evaluation_failed",
        error instanceof Error ? error.message : "Lotus historical path evaluation failed."
      );
    }

    const improvement = stableJsonRecord({
      bestExternalOnly: compareLotusAgainstBaseline(feeAdjustedLotusResult, baselineResults.bestExternalOnly),
      noInternalization: compareLotusAgainstBaseline(feeAdjustedLotusResult, baselineResults.noInternalization),
      venueSpecific: {
        ...(baselineResults.polymarketOnly
          ? {
              polymarketOnly: compareLotusAgainstBaseline(feeAdjustedLotusResult, baselineResults.polymarketOnly)
            }
          : {}),
        ...(baselineResults.limitlessOnly
          ? {
              limitlessOnly: compareLotusAgainstBaseline(feeAdjustedLotusResult, baselineResults.limitlessOnly)
            }
          : {}),
        ...(baselineResults.opinionOnly
          ? {
              opinionOnly: compareLotusAgainstBaseline(feeAdjustedLotusResult, baselineResults.opinionOnly)
            }
          : {}),
        ...(baselineResults.myriadOnly
          ? {
              myriadOnly: compareLotusAgainstBaseline(feeAdjustedLotusResult, baselineResults.myriadOnly)
            }
          : {}),
        ...(baselineResults.predictOnly
          ? {
              predictOnly: compareLotusAgainstBaseline(feeAdjustedLotusResult, baselineResults.predictOnly)
            }
          : {})
      }
    });

    const persistedResultId =
      runId === null
        ? null
        : await this.insertSimulationResult({
            runId,
            canonicalEventId: input.canonicalEventId,
            timestamp,
            baselineResults: stableJsonRecord(baselineResults),
            lotusResult,
            improvement,
            rolloutEligibility
          });

    return {
      timestamp,
      baselineResults,
      lotusResult,
      improvement,
      rolloutEligibility,
      persistedResultId
    };
  }

  private validateEvaluators(lotusEvaluators: HistoricalLotusPathEvaluatorBundle): void {
    const requiredEvaluators = [
      "evaluateRFQGrouping",
      "evaluateSOR",
      "evaluateInternalCrossEligibility",
      "evaluatePhase2ANettingEligibility",
      "evaluateResolutionRiskGating",
      "evaluateFeeAdjustedLotusResult"
    ] as const;

    for (const evaluatorName of requiredEvaluators) {
      if (typeof lotusEvaluators[evaluatorName] !== "function") {
        throw new HistoricalSimulationRunnerError(
          "lotus_evaluator_missing",
          `Missing Lotus historical evaluator: ${evaluatorName}.`
        );
      }
    }
  }

  private async createRun(input: HistoricalSimulationRunnerInput): Promise<string> {
    const result = await this.deps.pool.query<HistoricalSimulationRunRow>(
      `INSERT INTO historical_simulation_runs (
         qualification_run_id,
         scope_type,
         scope_id,
         venue_pair,
         market_class,
         status,
         metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id, status`,
      [
        input.qualificationRunId ?? null,
        input.scopeType,
        input.scopeId,
        input.routeMode,
        input.marketClass,
        HistoricalSimulationRunStatus.RUNNING,
        JSON.stringify(
            stableJsonRecord({
              canonicalEventId: input.canonicalEventId,
              configVersion: input.configVersion,
              engineVersion: input.engineVersion,
              side: input.side,
              requestedNotional: input.requestedNotional,
              dryRun: input.dryRun,
            ...(input.metadata ?? {})
          })
        )
      ]
    );

    const row = result.rows[0];
    if (!row) {
      throw new HistoricalSimulationRunnerError("simulation_persistence_failed", "Failed to create historical simulation run.");
    }
    return row.id;
  }

  private async closeRun(runId: string, status: HistoricalSimulationRunStatus): Promise<void> {
    await this.deps.pool.query(
      `UPDATE historical_simulation_runs
          SET status = $2,
              ended_at = now()
        WHERE id = $1`,
      [runId, status]
    );
  }

  private async loadHistoricalStates(input: HistoricalSimulationRunnerInput): Promise<readonly HistoricalMarketState[]> {
    const allowedVenues = resolveHistoricalSimulationRouteModeVenues(input.routeMode);
    if (allowedVenues.length === 0) {
      throw new HistoricalSimulationRunnerError(
        "historical_state_invalid",
        `Unsupported route mode ${input.routeMode}.`
      );
    }

    const result = await this.deps.pool.query<HistoricalMarketStateRow>(
      `SELECT
         id,
         canonical_event_id,
         canonical_market_id,
         canonical_category,
         venue,
         venue_market_id,
         market_class,
         timestamp,
         midpoint,
         best_bid,
         best_ask,
         spread,
         last_price,
         volume,
         open_interest,
         candles,
         orderbook_snapshot,
         market_events,
         trades,
         own_execution_history,
         metadata_version,
         source_timestamp
       FROM historical_market_states
      WHERE canonical_event_id = $1
        AND timestamp >= $2
        AND timestamp <= $3
        AND ($4::text IS NULL OR canonical_market_id = $4)
        AND venue = ANY($5::text[])
      ORDER BY timestamp ASC, venue ASC, venue_market_id ASC, source_timestamp ASC`,
      [input.canonicalEventId, input.windowStart, input.windowEnd, input.canonicalMarketId ?? null, allowedVenues]
    );

    const states = result.rows.map(mapHistoricalMarketStateRow);
    const canonicalEventIds = new Set(states.map((state) => state.canonicalEventId));
    if (states.length > 0 && (canonicalEventIds.size !== 1 || !canonicalEventIds.has(input.canonicalEventId))) {
      throw new HistoricalSimulationRunnerError(
        "historical_state_invalid",
        `Loaded historical states do not resolve cleanly to canonical event ${input.canonicalEventId}.`
      );
    }
    return states;
  }

  private async insertSimulationResult(input: CreateHistoricalSimulationResultInput): Promise<string> {
    const result = await this.deps.pool.query<HistoricalSimulationResultRow>(
      `INSERT INTO historical_simulation_results (
         run_id,
         canonical_event_id,
         timestamp,
         baseline_results,
         lotus_result,
         improvement,
         rollout_eligibility
       ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb)
       RETURNING id`,
      [
        input.runId,
        input.canonicalEventId,
        input.timestamp,
        JSON.stringify(input.baselineResults),
        JSON.stringify(input.lotusResult),
        JSON.stringify(input.improvement),
        JSON.stringify(input.rolloutEligibility)
      ]
    );

    const row = result.rows[0];
    if (!row) {
      throw new HistoricalSimulationRunnerError(
        "simulation_persistence_failed",
        "Failed to persist historical simulation result."
      );
    }
    return row.id;
  }
}
