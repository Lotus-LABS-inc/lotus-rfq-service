import type { Pool } from "pg";
import type { Logger } from "pino";

import {
  HistoricalMarketClass,
  HistoricalSimulationRunStatus,
  type HistoricalSimulationResult,
  type HistoricalSimulationRun,
  type PairedMarketIdentity
} from "../../core/historical-simulation/historical-simulation.types.js";
import type { ResolutionRiskAdminService } from "./resolution-risk-admin-service.js";
import type {
  HistoricalSimulationRunner,
  HistoricalSimulationRunnerResult
} from "../../simulation/historical-simulation-runner.js";

interface HistoricalSimulationRunRow {
  id: string;
  qualification_run_id: string | null;
  scope_type: string;
  scope_id: string;
  venue_pair: string;
  market_class: string;
  started_at: Date;
  ended_at: Date | null;
  status: string;
  metadata: Record<string, unknown>;
}

interface HistoricalSimulationResultRow {
  id: string;
  run_id: string;
  canonical_event_id: string;
  timestamp: Date;
  baseline_results: Record<string, unknown>;
  lotus_result: Record<string, unknown>;
  improvement: Record<string, unknown>;
  rollout_eligibility: Record<string, unknown>;
  created_at: Date;
}

interface ScopeRow {
  canonical_event_id: string;
  canonical_category: string;
  market_class: string;
  coverage_start: Date;
  coverage_end: Date;
  polymarket_rows: string;
  limitless_rows: string;
  venue_count: string;
}

interface CoverageRow {
  venue: string;
  row_count: string;
  coverage_start: Date;
  coverage_end: Date;
}

export interface SimulationAdminScopeFilters {
  category?: "SPORTS" | "CRYPTO";
  marketClass?: HistoricalMarketClass;
}

export interface SimulationScopeSummary {
  canonicalEventId: string;
  canonicalCategory: "SPORTS" | "CRYPTO";
  marketClass: HistoricalMarketClass;
  venuePair: "POLYMARKET_LIMITLESS";
  coverageStart: Date;
  coverageEnd: Date;
  venueCoverage: {
    polymarketRows: number;
    limitlessRows: number;
  };
}

export interface SimulationRunInput {
  marketClass: HistoricalMarketClass;
  venuePair: string;
  canonicalEventId?: string;
  from: Date;
  to: Date;
  strategyKey: string;
  dryRun: boolean;
}

export interface SimulationRunResponse {
  run: HistoricalSimulationRun | null;
  simulationResult: HistoricalSimulationRunnerResult;
}

export interface SimulationCanonicalCoverage {
  canonicalEventId: string;
  canonicalCategory: "SPORTS" | "CRYPTO" | "OTHER" | null;
  marketClass: HistoricalMarketClass | null;
  venueCoverage: ReadonlyArray<{
    venue: string;
    rowCount: number;
    coverageStart: Date;
    coverageEnd: Date;
  }>;
  pairedMarkets: PairedMarketIdentity[];
  resolutionRiskInspection: Awaited<ReturnType<ResolutionRiskAdminService["getCanonicalInspection"]>>;
}

export interface SimulationAdminServiceDeps {
  pool: Pool;
  historicalSimulationRunner: Pick<HistoricalSimulationRunner, "run">;
  resolutionRiskAdminService: Pick<ResolutionRiskAdminService, "getCanonicalInspection">;
  configVersion: string;
  engineVersion: string;
  logger?: Pick<Logger, "info" | "warn" | "error">;
}

export class SimulationRunNotFoundError extends Error {
  public constructor(runId: string) {
    super(`Historical simulation run ${runId} not found.`);
    this.name = "SimulationRunNotFoundError";
  }
}

export class SimulationCanonicalCoverageNotFoundError extends Error {
  public constructor(eventId: string) {
    super(`No historical canonical coverage found for event ${eventId}.`);
    this.name = "SimulationCanonicalCoverageNotFoundError";
  }
}

export class SimulationAdminConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SimulationAdminConflictError";
  }
}

const createNoopLogger = (): Pick<Logger, "info" | "warn" | "error"> => ({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
});

const mapRunRow = (row: HistoricalSimulationRunRow): HistoricalSimulationRun => ({
  id: row.id,
  qualificationRunId: row.qualification_run_id,
  scopeType: row.scope_type,
  scopeId: row.scope_id,
  venuePair: row.venue_pair,
  marketClass: row.market_class as HistoricalMarketClass,
  startedAt: new Date(row.started_at),
  endedAt: row.ended_at ? new Date(row.ended_at) : null,
  status: row.status as HistoricalSimulationRunStatus,
  metadata: row.metadata
});

const mapResultRow = (row: HistoricalSimulationResultRow): HistoricalSimulationResult => ({
  id: row.id,
  runId: row.run_id,
  canonicalEventId: row.canonical_event_id,
  timestamp: new Date(row.timestamp),
  baselineResults: row.baseline_results,
  lotusResult: row.lotus_result,
  improvement: row.improvement,
  rolloutEligibility: row.rollout_eligibility,
  createdAt: new Date(row.created_at)
});

const coerceCount = (value: string): number => Number.parseInt(value, 10);

export class SimulationAdminService {
  private readonly logger: Pick<Logger, "info" | "warn" | "error">;

  public constructor(private readonly deps: SimulationAdminServiceDeps) {
    this.logger = deps.logger ?? createNoopLogger();
  }

  public async listScopes(filters: SimulationAdminScopeFilters = {}): Promise<SimulationScopeSummary[]> {
    const clauses = [
      `canonical_category IN ('SPORTS', 'CRYPTO')`
    ];
    const values: string[] = [];

    if (filters.category) {
      values.push(filters.category);
      clauses.push(`canonical_category = $${values.length}`);
    }

    if (filters.marketClass) {
      values.push(filters.marketClass);
      clauses.push(`market_class = $${values.length}`);
    }

    const result = await this.deps.pool.query<ScopeRow>(
      `SELECT
         canonical_event_id,
         canonical_category,
         market_class,
         MIN("timestamp") AS coverage_start,
         MAX("timestamp") AS coverage_end,
         COUNT(*) FILTER (WHERE venue = 'POLYMARKET')::text AS polymarket_rows,
         COUNT(*) FILTER (WHERE venue = 'LIMITLESS')::text AS limitless_rows,
         COUNT(DISTINCT venue)::text AS venue_count
       FROM historical_market_states
      WHERE ${clauses.join(" AND ")}
      GROUP BY canonical_event_id, canonical_category, market_class
     HAVING COUNT(DISTINCT venue) = 2
        AND COUNT(*) FILTER (WHERE venue = 'POLYMARKET') > 0
        AND COUNT(*) FILTER (WHERE venue = 'LIMITLESS') > 0
      ORDER BY canonical_event_id ASC`,
      values
    );

    return result.rows.map((row) => ({
      canonicalEventId: row.canonical_event_id,
      canonicalCategory: row.canonical_category as "SPORTS" | "CRYPTO",
      marketClass: row.market_class as HistoricalMarketClass,
      venuePair: "POLYMARKET_LIMITLESS",
      coverageStart: new Date(row.coverage_start),
      coverageEnd: new Date(row.coverage_end),
      venueCoverage: {
        polymarketRows: coerceCount(row.polymarket_rows),
        limitlessRows: coerceCount(row.limitless_rows)
      }
    }));
  }

  public async runSimulation(input: SimulationRunInput): Promise<SimulationRunResponse> {
    const canonicalEventId = await this.resolveCanonicalEventId(input);
    const coverage = await this.getCanonicalCoverage(canonicalEventId);
    const resolutionRiskByTimestamp = await this.loadResolutionRiskSnapshotByTimestamp(
      canonicalEventId,
      input.from,
      input.to
    );

    const simulationResult = await this.deps.historicalSimulationRunner.run({
      scopeType: "CANONICAL_EVENT",
      scopeId: canonicalEventId,
      venuePair: input.venuePair,
      marketClass: input.marketClass,
      canonicalEventId,
      windowStart: input.from,
      windowEnd: input.to,
      configVersion: this.deps.configVersion,
      engineVersion: this.deps.engineVersion,
      dryRun: input.dryRun,
      metadata: {
        strategyKey: input.strategyKey,
        requestedVenuePair: input.venuePair,
        requestedCoverageCategory: coverage.canonicalCategory
      },
      providedSnapshots: {
        resolutionRiskByTimestamp
      }
    });

    const run = simulationResult.runId === null ? null : await this.getRun(simulationResult.runId);
    return { run, simulationResult };
  }

  public async getRun(runId: string): Promise<HistoricalSimulationRun> {
    const result = await this.deps.pool.query<HistoricalSimulationRunRow>(
      `SELECT
         id,
         qualification_run_id,
         scope_type,
         scope_id,
         venue_pair,
         market_class,
         started_at,
         ended_at,
         status,
         metadata
       FROM historical_simulation_runs
      WHERE id = $1
      LIMIT 1`,
      [runId]
    );

    const row = result.rows[0];
    if (!row) {
      throw new SimulationRunNotFoundError(runId);
    }

    return mapRunRow(row);
  }

  public async listRunResults(runId: string): Promise<HistoricalSimulationResult[]> {
    await this.getRun(runId);

    const result = await this.deps.pool.query<HistoricalSimulationResultRow>(
      `SELECT
         id,
         run_id,
         canonical_event_id,
         "timestamp",
         baseline_results,
         lotus_result,
         improvement,
         rollout_eligibility,
         created_at
       FROM historical_simulation_results
      WHERE run_id = $1
      ORDER BY "timestamp" ASC, created_at ASC`,
      [runId]
    );

    return result.rows.map(mapResultRow);
  }

  public async getCanonicalCoverage(eventId: string): Promise<SimulationCanonicalCoverage> {
    const [coverageRows, pairedMarketRows, resolutionRiskInspection] = await Promise.all([
      this.deps.pool.query<CoverageRow & { canonical_category: string | null; market_class: string | null }>(
        `SELECT
           venue,
           COUNT(*)::text AS row_count,
           MIN("timestamp") AS coverage_start,
           MAX("timestamp") AS coverage_end,
           MIN(canonical_category) AS canonical_category,
           MIN(market_class) AS market_class
         FROM historical_market_states
        WHERE canonical_event_id = $1
        GROUP BY venue
        ORDER BY venue ASC`,
        [eventId]
      ),
      this.deps.pool.query<{ venue: string; venue_market_id: string; orderbook_snapshot: any }>(
        `SELECT DISTINCT ON (venue, venue_market_id)
            venue,
            venue_market_id,
            orderbook_snapshot
         FROM historical_market_states
         WHERE canonical_event_id = $1
         ORDER BY venue, venue_market_id, "timestamp" DESC`,
        [eventId]
      ),
      this.deps.resolutionRiskAdminService.getCanonicalInspection(eventId)
    ]);

    if (coverageRows.rowCount === 0) {
      throw new SimulationCanonicalCoverageNotFoundError(eventId);
    }

    const first = coverageRows.rows[0]!;
    return {
      canonicalEventId: eventId,
      canonicalCategory: first.canonical_category as "SPORTS" | "CRYPTO" | "OTHER" | null,
      marketClass: first.market_class as HistoricalMarketClass | null,
      venueCoverage: coverageRows.rows.map((row) => ({
        venue: row.venue,
        rowCount: coerceCount(row.row_count),
        coverageStart: new Date(row.coverage_start),
        coverageEnd: new Date(row.coverage_end)
      })),
      pairedMarkets: pairedMarketRows.rows.map((row) => ({
        venue: row.venue,
        venueMarketId: row.venue_market_id,
        title: row.orderbook_snapshot?.market_title ?? row.orderbook_snapshot?.title ?? null
      })),
      resolutionRiskInspection
    };
  }

  private async resolveCanonicalEventId(input: SimulationRunInput): Promise<string> {
    if (input.canonicalEventId) {
      return input.canonicalEventId;
    }

    const scopes = await this.listScopes({ marketClass: input.marketClass });
    const matchingScopes = scopes.filter((scope) => scope.venuePair === input.venuePair);
    if (matchingScopes.length !== 1) {
      throw new SimulationAdminConflictError(
        `Simulation run requires exactly one resolvable canonical event for ${input.venuePair}; found ${matchingScopes.length}.`
      );
    }

    return matchingScopes[0]!.canonicalEventId;
  }

  private async loadResolutionRiskSnapshotByTimestamp(
    canonicalEventId: string,
    from: Date,
    to: Date
  ): Promise<Readonly<Record<string, Record<string, unknown>>>> {
    const inspection = await this.deps.resolutionRiskAdminService.getCanonicalInspection(canonicalEventId);
    const result = await this.deps.pool.query<{ timestamp: Date }>(
      `SELECT DISTINCT "timestamp"
         FROM historical_market_states
        WHERE canonical_event_id = $1
          AND "timestamp" >= $2
          AND "timestamp" <= $3
        ORDER BY "timestamp" ASC`,
      [canonicalEventId, from, to]
    );

    return Object.fromEntries(
      result.rows.map((row) => [
        new Date(row.timestamp).toISOString(),
        {
          canonicalEventId: inspection.canonicalEventId,
          safeEquivalentEligible:
            inspection.freshness.isComplete &&
            !inspection.freshness.isStale &&
            inspection.assessments.every((assessment) => 
               assessment.equivalenceClass === "SAFE_EQUIVALENT" || 
               assessment.equivalenceClass === "EQUIVALENT_WITH_LAG"
            ),
          freshness: inspection.freshness,
          scoringVersion: inspection.scoringVersion
        }
      ])
    );
  }
}
