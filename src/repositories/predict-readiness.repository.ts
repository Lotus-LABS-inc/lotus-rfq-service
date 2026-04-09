import type { Pool, QueryResultRow } from "pg";

import type {
  PredictEnvironment,
  PredictFallbackCoverageScanArtifact,
  PredictHistoricalReadinessState,
  PredictHistoricalReadinessSummary
} from "../integrations/predict/predict-types.js";

interface CountRow extends QueryResultRow {
  market_id: string;
  row_count: string;
  coverage_start?: Date | null;
  coverage_end?: Date | null;
  environments?: readonly PredictEnvironment[] | null;
}

interface PredictFallbackCoverageScanRow extends QueryResultRow {
  environment: PredictEnvironment;
  market_id: string;
  window_start: Date;
  window_end: Date;
  snapshot_count: number;
  first_snapshot_at: Date | null;
  last_snapshot_at: Date | null;
  scan_metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface PersistPredictFallbackCoverageScanInput {
  environment: PredictEnvironment;
  marketId: string;
  windowStart: Date;
  windowEnd: Date;
  snapshotCount: number;
  firstSnapshotAt: Date | null;
  lastSnapshotAt: Date | null;
  metadata?: Record<string, unknown>;
}

export interface PredictReadinessWindow {
  start: Date;
  end: Date;
}

const coerceCount = (value: string | number | null | undefined): number =>
  typeof value === "number" ? value : Number.parseInt(value ?? "0", 10);

const dedupeEnvironments = (input: Iterable<readonly PredictEnvironment[] | PredictEnvironment[] | null | undefined>): readonly PredictEnvironment[] => {
  const environments = new Set<PredictEnvironment>();
  for (const group of input) {
    for (const environment of group ?? []) {
      environments.add(environment);
    }
  }
  return [...environments].sort((left, right) => left.localeCompare(right));
};

const resolveReadinessState = (input: {
  currentStateRowCount: number;
  nativeOrderbookSnapshotCount: number;
  nativeMatchEventCount: number;
  recorderCheckpointCount: number;
  fallbackSnapshotCount: number;
}): { state: PredictHistoricalReadinessState; reason: string | null } => {
  if (input.nativeOrderbookSnapshotCount > 0 || input.nativeMatchEventCount > 0) {
    return {
      state: "HISTORICAL_READY_NATIVE",
      reason: "native_historical_evidence_available"
    };
  }

  if (input.fallbackSnapshotCount > 0) {
    return {
      state: "HISTORICAL_READY_FALLBACK",
      reason: "predexon_fallback_historical_evidence_available"
    };
  }

  if (input.recorderCheckpointCount > 0) {
    return {
      state: "RECORDER_ACCUMULATING",
      reason: "recorder_active_but_historical_window_not_ready"
    };
  }

  if (input.currentStateRowCount > 0) {
    return {
      state: "CURRENT_STATE_ONLY",
      reason: "current_state_only_no_historical_evidence"
    };
  }

  return {
    state: "UNUSABLE",
    reason: "no_predict_evidence_available"
  };
};

const overlapClause = (alias: string, startParam: string, endParam: string): string =>
  `${alias}.window_start <= ${endParam} AND ${alias}.window_end >= ${startParam}`;

export class PredictReadinessRepository {
  public constructor(private readonly pool: Pool) {}

  public async upsertFallbackCoverageScan(input: PersistPredictFallbackCoverageScanInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO predict_fallback_coverage_scans (
         environment,
         market_id,
         window_start,
         window_end,
         snapshot_count,
         first_snapshot_at,
         last_snapshot_at,
         scan_metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (environment, market_id, window_start, window_end)
       DO UPDATE SET
         snapshot_count = EXCLUDED.snapshot_count,
         first_snapshot_at = EXCLUDED.first_snapshot_at,
         last_snapshot_at = EXCLUDED.last_snapshot_at,
         scan_metadata = EXCLUDED.scan_metadata,
         updated_at = NOW()`,
      [
        input.environment,
        input.marketId,
        input.windowStart,
        input.windowEnd,
        input.snapshotCount,
        input.firstSnapshotAt,
        input.lastSnapshotAt,
        JSON.stringify(input.metadata ?? {})
      ]
    );
  }

  public async listFallbackCoverageScans(input: {
    marketIds: readonly string[];
    window?: PredictReadinessWindow;
  }): Promise<readonly PredictFallbackCoverageScanArtifact[]> {
    if (input.marketIds.length === 0) {
      return [];
    }

    const values: unknown[] = [input.marketIds];
    const windowClause = input.window
      ? (() => {
          values.push(input.window.start, input.window.end);
          return `AND ${overlapClause("predict_fallback_coverage_scans", "$2", "$3")}`;
        })()
      : "";

    const result = await this.pool.query<PredictFallbackCoverageScanRow>(
      `SELECT environment,
              market_id,
              window_start,
              window_end,
              snapshot_count,
              first_snapshot_at,
              last_snapshot_at,
              scan_metadata,
              created_at,
              updated_at
         FROM predict_fallback_coverage_scans
        WHERE market_id = ANY($1::text[])
          ${windowClause}
        ORDER BY market_id ASC, window_start ASC, environment ASC`,
      values
    );

    return result.rows.map((row) => ({
      environment: row.environment,
      marketId: row.market_id,
      windowStart: new Date(row.window_start),
      windowEnd: new Date(row.window_end),
      snapshotCount: row.snapshot_count,
      firstSnapshotAt: row.first_snapshot_at ? new Date(row.first_snapshot_at) : null,
      lastSnapshotAt: row.last_snapshot_at ? new Date(row.last_snapshot_at) : null,
      metadata: row.scan_metadata,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    }));
  }

  public async summarizeReadinessByMarketIds(input: {
    marketIds: readonly string[];
    window?: PredictReadinessWindow;
  }): Promise<ReadonlyMap<string, PredictHistoricalReadinessSummary>> {
    if (input.marketIds.length === 0) {
      return new Map();
    }

    const [currentStateRows, metadataRows, nativeSnapshotRows, nativeMatchEventRows, checkpointRows, fallbackRows, fallbackCoverageScans] =
      await Promise.all([
        this.loadCurrentStateRows(input.marketIds, input.window),
        this.loadMetadataRows(input.marketIds),
        this.loadNativeSnapshotRows(input.marketIds, input.window),
        this.loadNativeMatchEventRows(input.marketIds, input.window),
        this.loadRecorderCheckpointRows(input.marketIds),
        this.loadFallbackSnapshotRows(input.marketIds, input.window),
        this.listFallbackCoverageScans({
          marketIds: input.marketIds,
          ...(input.window ? { window: input.window } : {})
        })
      ]);

    const currentStateByMarket = new Map(currentStateRows.map((row) => [row.market_id, row]));
    const metadataByMarket = new Map(metadataRows.map((row) => [row.market_id, row]));
    const nativeSnapshotsByMarket = new Map(nativeSnapshotRows.map((row) => [row.market_id, row]));
    const nativeMatchEventsByMarket = new Map(nativeMatchEventRows.map((row) => [row.market_id, row]));
    const checkpointsByMarket = new Map(checkpointRows.map((row) => [row.market_id, row]));
    const fallbackByMarket = new Map(fallbackRows.map((row) => [row.market_id, row]));
    const fallbackCoverageByMarket = fallbackCoverageScans.reduce<Map<string, number>>((accumulator, scan) => {
      if (scan.snapshotCount > 0) {
        accumulator.set(scan.marketId, (accumulator.get(scan.marketId) ?? 0) + 1);
      }
      return accumulator;
    }, new Map());

    return new Map(
      input.marketIds.map((marketId) => {
        const currentState = currentStateByMarket.get(marketId);
        const metadata = metadataByMarket.get(marketId);
        const nativeSnapshots = nativeSnapshotsByMarket.get(marketId);
        const nativeMatchEvents = nativeMatchEventsByMarket.get(marketId);
        const checkpoints = checkpointsByMarket.get(marketId);
        const fallback = fallbackByMarket.get(marketId);
        const currentStateRowCount = coerceCount(currentState?.row_count ?? 0);
        const nativeOrderbookSnapshotCount = coerceCount(nativeSnapshots?.row_count ?? 0);
        const nativeMatchEventCount = coerceCount(nativeMatchEvents?.row_count ?? 0);
        const recorderCheckpointCount = coerceCount(checkpoints?.row_count ?? 0);
        const fallbackSnapshotCount = coerceCount(fallback?.row_count ?? 0);
        const resolved = resolveReadinessState({
          currentStateRowCount,
          nativeOrderbookSnapshotCount,
          nativeMatchEventCount,
          recorderCheckpointCount,
          fallbackSnapshotCount
        });

        return [marketId, {
          marketId,
          state: resolved.state,
          historicalQualified:
            resolved.state === "HISTORICAL_READY_NATIVE" || resolved.state === "HISTORICAL_READY_FALLBACK",
          reason: resolved.reason,
          environments: dedupeEnvironments([
            metadata?.environments,
            nativeSnapshots?.environments,
            nativeMatchEvents?.environments,
            checkpoints?.environments,
            fallback?.environments
          ]),
          currentStateRowCount,
          currentStateCoverageStart: currentState?.coverage_start ? new Date(currentState.coverage_start) : null,
          currentStateCoverageEnd: currentState?.coverage_end ? new Date(currentState.coverage_end) : null,
          nativeOrderbookSnapshotCount,
          nativeMatchEventCount,
          recorderCheckpointCount,
          fallbackSnapshotCount,
          fallbackCoveredWindowCount: fallbackCoverageByMarket.get(marketId) ?? 0
        } satisfies PredictHistoricalReadinessSummary];
      })
    );
  }

  private async loadCurrentStateRows(
    marketIds: readonly string[],
    window?: PredictReadinessWindow
  ): Promise<readonly CountRow[]> {
    const values: unknown[] = [marketIds];
    const windowClause = window
      ? (() => {
          values.push(window.start, window.end);
          return `AND "timestamp" >= $2 AND "timestamp" <= $3`;
        })()
      : "";

    const result = await this.pool.query<CountRow>(
      `SELECT venue_market_id AS market_id,
              COUNT(*)::text AS row_count,
              MIN("timestamp") AS coverage_start,
              MAX("timestamp") AS coverage_end
         FROM historical_market_states
        WHERE venue = 'PREDICT'
          AND venue_market_id = ANY($1::text[])
          ${windowClause}
        GROUP BY venue_market_id`,
      values
    );

    return result.rows;
  }

  private async loadMetadataRows(marketIds: readonly string[]): Promise<readonly CountRow[]> {
    const result = await this.pool.query<CountRow>(
      `SELECT market_id,
              COUNT(*)::text AS row_count,
              ARRAY_AGG(DISTINCT environment)::text[] AS environments
         FROM predict_market_metadata
        WHERE market_id = ANY($1::text[])
        GROUP BY market_id`,
      [marketIds]
    );

    return result.rows;
  }

  private async loadNativeSnapshotRows(
    marketIds: readonly string[],
    window?: PredictReadinessWindow
  ): Promise<readonly CountRow[]> {
    const values: unknown[] = [marketIds];
    const windowClause = window
      ? (() => {
          values.push(window.start, window.end);
          return `AND COALESCE(source_timestamp, recorded_at) >= $2 AND COALESCE(source_timestamp, recorded_at) <= $3`;
        })()
      : "";

    const result = await this.pool.query<CountRow>(
      `SELECT market_id,
              COUNT(*)::text AS row_count,
              ARRAY_AGG(DISTINCT environment)::text[] AS environments
         FROM predict_orderbook_snapshots
        WHERE market_id = ANY($1::text[])
          ${windowClause}
        GROUP BY market_id`,
      values
    );

    return result.rows;
  }

  private async loadNativeMatchEventRows(
    marketIds: readonly string[],
    window?: PredictReadinessWindow
  ): Promise<readonly CountRow[]> {
    const values: unknown[] = [marketIds];
    const windowClause = window
      ? (() => {
          values.push(window.start, window.end);
          return `AND event_timestamp IS NOT NULL AND event_timestamp >= $2 AND event_timestamp <= $3`;
        })()
      : "";

    const result = await this.pool.query<CountRow>(
      `SELECT market_id,
              COUNT(*)::text AS row_count,
              ARRAY_AGG(DISTINCT environment)::text[] AS environments
         FROM predict_match_events
        WHERE market_id = ANY($1::text[])
          ${windowClause}
        GROUP BY market_id`,
      values
    );

    return result.rows;
  }

  private async loadRecorderCheckpointRows(marketIds: readonly string[]): Promise<readonly CountRow[]> {
    const result = await this.pool.query<CountRow>(
      `SELECT market_id,
              COUNT(*)::text AS row_count,
              ARRAY_AGG(DISTINCT environment)::text[] AS environments
         FROM predict_recorder_checkpoints
        WHERE market_id = ANY($1::text[])
        GROUP BY market_id`,
      [marketIds]
    );

    return result.rows;
  }

  private async loadFallbackSnapshotRows(
    marketIds: readonly string[],
    window?: PredictReadinessWindow
  ): Promise<readonly CountRow[]> {
    const values: unknown[] = [marketIds];
    const windowClause = window
      ? (() => {
          values.push(window.start, window.end);
          return `AND source_timestamp >= $2 AND source_timestamp <= $3`;
        })()
      : "";

    const result = await this.pool.query<CountRow>(
      `SELECT market_id,
              COUNT(*)::text AS row_count,
              ARRAY_AGG(DISTINCT environment)::text[] AS environments
         FROM predict_fallback_historical_snapshots
        WHERE market_id = ANY($1::text[])
          ${windowClause}
        GROUP BY market_id`,
      values
    );

    return result.rows;
  }
}
