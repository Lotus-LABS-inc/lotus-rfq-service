import type { Logger } from "pino";

import type { CreateHistoricalMarketStateInput } from "../core/historical-simulation/historical-simulation.types.js";
import {
  historicalIngestFailuresTotal,
  historicalIngestRunsTotal,
  historicalRowsWrittenTotal
} from "../observability/metrics.js";

export type HistoricalIngestionMode = "backfill" | "incremental";
export type HistoricalIngestionCategory = "sports" | "crypto";

export interface HistoricalIngestionJobInput {
  mode: HistoricalIngestionMode;
  windowStart: Date;
  windowEnd: Date;
  batchSize: number;
  overlapMs?: number;
}

export interface HistoricalIngestionJobResult {
  venue: string;
  mode: HistoricalIngestionMode;
  discoveredMarkets: number;
  fetchedFragments: number;
  normalizedRecords: number;
  insertedRows: number;
  skippedRows: number;
  failedScopes: number;
}

export interface HistoricalIngestScopeProvider<TScope> {
  listScopedMarkets(input: {
    categories: readonly HistoricalIngestionCategory[];
  }): Promise<readonly TScope[]>;
}

export interface HistoricalStateInsertResult {
  inserted: number;
  skipped: number;
}

export interface HistoricalMarketStateRepositoryContract {
  getLatestSourceTimestamp(input: {
    venue: string;
    venueMarketId: string;
    metadataVersion: string;
  }): Promise<Date | null>;
  insertManyIgnoreDuplicates(states: readonly CreateHistoricalMarketStateInput[]): Promise<HistoricalStateInsertResult>;
}

export const mergeHistoricalStates = (
  states: readonly CreateHistoricalMarketStateInput[]
): CreateHistoricalMarketStateInput[] => {
  const merged = new Map<string, CreateHistoricalMarketStateInput>();

  for (const state of states) {
    const key = [
      state.canonicalEventId,
      state.venue,
      state.venueMarketId,
      state.timestamp.toISOString(),
      state.metadataVersion
    ].join("|");

    const current = merged.get(key);
    if (!current) {
      merged.set(key, {
        ...state,
        timestamp: new Date(state.timestamp),
        sourceTimestamp: new Date(state.sourceTimestamp)
      });
      continue;
    }

    merged.set(key, {
      ...current,
      midpoint: current.midpoint ?? state.midpoint ?? null,
      bestBid: current.bestBid ?? state.bestBid ?? null,
      bestAsk: current.bestAsk ?? state.bestAsk ?? null,
      spread: current.spread ?? state.spread ?? null,
      lastPrice: current.lastPrice ?? state.lastPrice ?? null,
      volume: current.volume ?? state.volume ?? null,
      openInterest: current.openInterest ?? state.openInterest ?? null,
      candles: current.candles ?? state.candles ?? null,
      orderbookSnapshot: current.orderbookSnapshot ?? state.orderbookSnapshot ?? null,
      marketEvents: current.marketEvents ?? state.marketEvents ?? null,
      trades: current.trades ?? state.trades ?? null,
      ownExecutionHistory: current.ownExecutionHistory ?? state.ownExecutionHistory ?? null,
      sourceTimestamp:
        current.sourceTimestamp.getTime() >= state.sourceTimestamp.getTime()
          ? current.sourceTimestamp
          : new Date(state.sourceTimestamp)
    });
  }

  return [...merged.values()].sort(
    (left, right) =>
      left.timestamp.getTime() - right.timestamp.getTime() ||
      left.canonicalEventId.localeCompare(right.canonicalEventId) ||
      left.venue.localeCompare(right.venue) ||
      left.venueMarketId.localeCompare(right.venueMarketId)
  );
};

export const resolveEffectiveWindowStart = (
  input: HistoricalIngestionJobInput,
  latestSourceTimestamp: Date | null
): Date => {
  if (!latestSourceTimestamp || input.mode === "backfill") {
    return new Date(input.windowStart);
  }

  if (input.overlapMs !== undefined) {
    return new Date(Math.max(input.windowStart.getTime(), latestSourceTimestamp.getTime() - input.overlapMs));
  }

  return new Date(Math.max(input.windowStart.getTime(), latestSourceTimestamp.getTime() + 1));
};

export const recordHistoricalRunSuccess = (
  venue: string,
  mode: HistoricalIngestionMode,
  insertedRows: number
): void => {
  historicalRowsWrittenTotal.inc({ venue, mode }, insertedRows);
  historicalIngestRunsTotal.inc({ venue, mode, status: "success" });
};

export const recordHistoricalRunFailure = (
  venue: string,
  mode: HistoricalIngestionMode,
  stage: string
): void => {
  historicalIngestFailuresTotal.inc({ venue, stage });
  historicalIngestRunsTotal.inc({ venue, mode, status: "failure" });
};

export const recordHistoricalStageFailure = (venue: string, stage: string): void => {
  historicalIngestFailuresTotal.inc({ venue, stage });
};

export const createNoopLogger = (): Pick<Logger, "info" | "warn" | "error"> => ({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
});
