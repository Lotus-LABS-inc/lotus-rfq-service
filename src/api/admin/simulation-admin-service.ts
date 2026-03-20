import type { Pool } from "pg";
import type { Logger } from "pino";

import {
  HistoricalMarketClass,
  type HistoricalSimulationCatalogScope,
  HistoricalSimulationRouteModeDefinitions,
  HistoricalSimulationRunStatus,
  getHistoricalSimulationRouteModeDefinition,
  type HistoricalSimulationOrderSide,
  type HistoricalSimulationEventRouteSummary,
  type HistoricalSimulationRouteAvailability,
  type HistoricalSimulationRouteAvailabilityReason,
  type HistoricalSimulationRouteMode,
  type CanonicalMarketOption,
  type HistoricalSimulationResult,
  type HistoricalSimulationRun,
  type PairedMarketIdentity
} from "../../core/historical-simulation/historical-simulation.types.js";
import type { ResolutionRiskAdminService } from "./resolution-risk-admin-service.js";
import type { HistoricalSimulationCatalogService } from "./historical-simulation-catalog-service.js";
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

interface EventRow {
  canonical_event_id: string;
  canonical_category: string;
  market_class: string;
}

interface CoverageRow {
  venue: string;
  row_count: string;
  coverage_start: Date;
  coverage_end: Date;
}

interface PairedMarketRow {
  venue: string;
  venue_market_id: string;
  canonical_market_id: string | null;
  orderbook_snapshot: Record<string, unknown> | null;
}

interface MarketCoverageRow {
  canonical_market_id: string | null;
  venue: string;
  row_count: string;
  coverage_start: Date;
  coverage_end: Date;
  canonical_category: string | null;
  market_class: string | null;
}

type SupportedSimulationCategory = "SPORTS" | "CRYPTO" | "POLITICS" | "ESPORTS";

export interface SimulationAdminScopeFilters {
  category?: SupportedSimulationCategory;
  marketClass?: HistoricalMarketClass;
  routeMode?: HistoricalSimulationRouteMode;
}

export interface SimulationScopeSummary {
  canonicalEventId: string;
  catalogScope: HistoricalSimulationCatalogScope;
  canonicalCategory: SupportedSimulationCategory;
  marketClass: HistoricalMarketClass;
  routeMode: HistoricalSimulationRouteMode;
  coverageStart: Date;
  coverageEnd: Date;
  routeableMarketCount: number;
  venueCoverage: {
    polymarketRows: number;
    limitlessRows: number;
    opinionRows: number;
    myriadRows: number;
  };
}

const DEFAULT_ROUTE_MODE: SimulationScopeSummary["routeMode"] = "POLYMARKET_LIMITLESS";

export interface SimulationRunInput {
  marketClass: HistoricalMarketClass;
  routeMode: HistoricalSimulationRouteMode;
  canonicalEventId?: string;
  canonicalMarketId?: string;
  side: HistoricalSimulationOrderSide;
  requestedNotional: string;
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
  catalogScope: HistoricalSimulationCatalogScope;
  canonicalMarketId: string | null;
  canonicalCategory: SupportedSimulationCategory | "OTHER" | null;
  marketClass: HistoricalMarketClass | null;
  venueCoverage: ReadonlyArray<{
    venue: string;
    rowCount: number;
    coverageStart: Date;
    coverageEnd: Date;
  }>;
  pairedMarkets: PairedMarketIdentity[];
  canonicalMarkets: CanonicalMarketOption[];
  routeModeSummary: ReadonlyArray<HistoricalSimulationEventRouteSummary>;
  hasTriVenueRoute: boolean;
  triVenueRouteableMarketCount: number;
  resolutionRiskInspection: Awaited<ReturnType<ResolutionRiskAdminService["getCanonicalInspection"]>>;
  ambiguity: Record<string, {
    isAmbiguous: boolean;
    count: number;
    markets: string[];
  }>;
}

export interface SimulationAdminServiceDeps {
  pool: Pool;
  historicalSimulationRunner: Pick<HistoricalSimulationRunner, "run">;
  resolutionRiskAdminService: Pick<ResolutionRiskAdminService, "getCanonicalInspection">;
  historicalSimulationCatalogService: Pick<HistoricalSimulationCatalogService, "hasCanonicalEvent" | "getCanonicalInspection">;
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

const SAFE_ROUTE_EQUIVALENCE = new Set(["SAFE_EQUIVALENT", "EQUIVALENT_WITH_LAG"]);

const mapRunRow = (row: HistoricalSimulationRunRow): HistoricalSimulationRun => ({
  id: row.id,
  qualificationRunId: row.qualification_run_id,
  scopeType: row.scope_type,
  scopeId: row.scope_id,
  routeMode: row.venue_pair as HistoricalSimulationRouteMode,
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

type ResolutionRiskInspection = Awaited<ReturnType<ResolutionRiskAdminService["getCanonicalInspection"]>>;
type ResolutionRiskProfile = ResolutionRiskInspection["profiles"][number];
type ResolutionRiskAssessment = ResolutionRiskInspection["assessments"][number];
type CatalogScopeInspection = ResolutionRiskInspection;

const filterResolutionRiskProfiles = (
  inspection: ResolutionRiskInspection,
  canonicalMarketId?: string | null
): readonly ResolutionRiskProfile[] =>
  canonicalMarketId
    ? inspection.profiles.filter((profile) => profile.canonicalMarketId === canonicalMarketId)
    : inspection.profiles;

const filterResolutionRiskAssessments = (
  inspection: ResolutionRiskInspection,
  canonicalMarketId?: string | null
): readonly ResolutionRiskAssessment[] =>
  canonicalMarketId
    ? inspection.assessments.filter((assessment) => assessment.canonicalMarketId === canonicalMarketId)
    : inspection.assessments;

const computeScopedResolutionRiskFreshness = (
  inspection: ResolutionRiskInspection,
  canonicalMarketId?: string | null
): ResolutionRiskInspection["freshness"] => {
  const relevantProfiles = filterResolutionRiskProfiles(inspection, canonicalMarketId);
  const relevantAssessments = filterResolutionRiskAssessments(inspection, canonicalMarketId);
  const lastComputedAt = relevantAssessments.reduce<Date | null>(
    (current, assessment) => (current === null || assessment.computedAt > current ? assessment.computedAt : current),
    null
  );
  const latestProfileUpdatedAt = relevantProfiles.reduce<Date | null>(
    (current, profile) => (current === null || profile.updatedAt > current ? profile.updatedAt : current),
    null
  );
  const expectedPairCount =
    relevantProfiles.length < 2 ? 0 : (relevantProfiles.length * (relevantProfiles.length - 1)) / 2;
  const persistedPairCount = new Set(
    relevantAssessments.map((assessment) => `${assessment.marketAProfileId}|${assessment.marketBProfileId}`)
  ).size;
  const versions = [...new Set(relevantAssessments.map((assessment) => assessment.version))];
  const isComplete = relevantProfiles.length >= 2 && persistedPairCount === expectedPairCount;
  const isStale =
    !isComplete || lastComputedAt === null || (latestProfileUpdatedAt !== null && lastComputedAt < latestProfileUpdatedAt);

  return {
    profileCount: relevantProfiles.length,
    expectedPairCount,
    persistedPairCount,
    lastComputedAt,
    latestProfileUpdatedAt,
    isComplete,
    isStale,
    hasMixedVersions: versions.length > 1
  };
};

const selectMarketTitle = (snapshot: Record<string, unknown> | null): string | null => {
  if (!snapshot) {
    return null;
  }

  const marketTitle = snapshot["market_title"];
  if (typeof marketTitle === "string" && marketTitle.trim().length > 0) {
    return marketTitle;
  }

  const title = snapshot["title"];
  return typeof title === "string" && title.trim().length > 0 ? title : null;
};

const buildAssessmentKey = (profileAId: string, profileBId: string): string =>
  [profileAId, profileBId].sort((left, right) => left.localeCompare(right)).join("|");

const buildTitleMap = (marketRows: readonly PairedMarketRow[]): Map<string, string | null> => {
  const titleMap = new Map<string, string | null>();
  for (const row of marketRows) {
    titleMap.set(
      `${row.canonical_market_id ?? "null"}|${row.venue}|${row.venue_market_id}`,
      selectMarketTitle(row.orderbook_snapshot)
    );
  }
  return titleMap;
};

const buildProfilesByMarket = (inspection: ResolutionRiskInspection): Map<string, ResolutionRiskProfile[]> => {
  const grouped = new Map<string, ResolutionRiskProfile[]>();
  for (const profile of inspection.profiles) {
    const profiles = grouped.get(profile.canonicalMarketId) ?? [];
    profiles.push(profile);
    grouped.set(profile.canonicalMarketId, profiles);
  }
  return grouped;
};

const buildAssessmentsByPair = (inspection: ResolutionRiskInspection): Map<string, ResolutionRiskAssessment> =>
  new Map(
    inspection.assessments.map((assessment) => [
      buildAssessmentKey(assessment.marketAProfileId, assessment.marketBProfileId),
      assessment
    ])
  );

const buildMarketVenueCoverage = (
  marketCoverageRows: readonly MarketCoverageRow[]
): Map<string, Map<string, { rowCount: number; coverageStart: Date; coverageEnd: Date }>> => {
  const grouped = new Map<string, Map<string, { rowCount: number; coverageStart: Date; coverageEnd: Date }>>();
  for (const row of marketCoverageRows) {
    if (!row.canonical_market_id) {
      continue;
    }
    const venueCoverage = grouped.get(row.canonical_market_id) ?? new Map<string, {
      rowCount: number;
      coverageStart: Date;
      coverageEnd: Date;
    }>();
    venueCoverage.set(row.venue, {
      rowCount: coerceCount(row.row_count),
      coverageStart: new Date(row.coverage_start),
      coverageEnd: new Date(row.coverage_end)
    });
    grouped.set(row.canonical_market_id, venueCoverage);
  }
  return grouped;
};

const buildPairedMarketIdentityMap = (
  marketRows: readonly PairedMarketRow[]
): Map<string, PairedMarketIdentity[]> => {
  const grouped = new Map<string, PairedMarketIdentity[]>();
  for (const row of marketRows) {
    if (!row.canonical_market_id) {
      continue;
    }
    const venues = grouped.get(row.canonical_market_id) ?? [];
    venues.push({
      venue: row.venue,
      venueMarketId: row.venue_market_id,
      title: selectMarketTitle(row.orderbook_snapshot)
    });
    grouped.set(row.canonical_market_id, venues);
  }
  return grouped;
};

const resolveUnavailableRoute = (
  routeMode: HistoricalSimulationRouteMode,
  reason: HistoricalSimulationRouteAvailabilityReason
): HistoricalSimulationRouteAvailability => {
  const definition = getHistoricalSimulationRouteModeDefinition(routeMode);
  return {
    routeMode,
    label: definition.label,
    cardinality: definition.cardinality,
    requiredVenues: definition.requiredVenues,
    runnable: false,
    reason
  };
};

const resolveAvailableRoute = (
  routeMode: HistoricalSimulationRouteMode
): HistoricalSimulationRouteAvailability => {
  const definition = getHistoricalSimulationRouteModeDefinition(routeMode);
  return {
    routeMode,
    label: definition.label,
    cardinality: definition.cardinality,
    requiredVenues: definition.requiredVenues,
    runnable: true,
    reason: null
  };
};

const pairwiseVenueCombinations = (venues: readonly string[]): Array<[string, string]> => {
  const pairs: Array<[string, string]> = [];
  for (let index = 0; index < venues.length; index += 1) {
    for (let cursor = index + 1; cursor < venues.length; cursor += 1) {
      pairs.push([venues[index]!, venues[cursor]!]);
    }
  }
  return pairs;
};

const buildRouteModeAvailability = (input: {
  venueCoverage: Map<string, { rowCount: number; coverageStart: Date; coverageEnd: Date }>;
  profiles: readonly ResolutionRiskProfile[];
  assessmentsByPair: ReadonlyMap<string, ResolutionRiskAssessment>;
}): readonly HistoricalSimulationRouteAvailability[] => {
  const profilesByVenue = new Map<string, ResolutionRiskProfile[]>();
  for (const profile of input.profiles) {
    const profiles = profilesByVenue.get(profile.venue) ?? [];
    profiles.push(profile);
    profilesByVenue.set(profile.venue, profiles);
  }

  return HistoricalSimulationRouteModeDefinitions.map((definition) => {
    for (const venue of definition.requiredVenues) {
      const coverage = input.venueCoverage.get(venue);
      if (!coverage) {
        return resolveUnavailableRoute(definition.mode, "missing_required_venue");
      }
      if (coverage.rowCount <= 0) {
        return resolveUnavailableRoute(definition.mode, "missing_historical_rows");
      }
    }

    if (definition.cardinality === "single") {
      return resolveAvailableRoute(definition.mode);
    }

    const requiredProfiles = definition.requiredVenues.map((venue) => ({
      venue,
      profiles: profilesByVenue.get(venue) ?? []
    }));

    if (requiredProfiles.some((entry) => entry.profiles.length === 0)) {
      return resolveUnavailableRoute(definition.mode, "incomplete_resolution_risk");
    }

    if (requiredProfiles.some((entry) => entry.profiles.length > 1)) {
      return resolveUnavailableRoute(definition.mode, "ambiguous_venue_identity");
    }

    for (const [leftVenue, rightVenue] of pairwiseVenueCombinations(definition.requiredVenues)) {
      const leftProfile = profilesByVenue.get(leftVenue)?.[0];
      const rightProfile = profilesByVenue.get(rightVenue)?.[0];
      if (!leftProfile || !rightProfile) {
        return resolveUnavailableRoute(definition.mode, "incomplete_resolution_risk");
      }

      const assessment = input.assessmentsByPair.get(buildAssessmentKey(leftProfile.id, rightProfile.id));
      if (!assessment) {
        return resolveUnavailableRoute(definition.mode, "missing_pair_assessment");
      }

      const latestProfileUpdate = leftProfile.updatedAt > rightProfile.updatedAt ? leftProfile.updatedAt : rightProfile.updatedAt;
      if (assessment.computedAt < latestProfileUpdate) {
        return resolveUnavailableRoute(definition.mode, "stale_resolution_risk");
      }

      if (!SAFE_ROUTE_EQUIVALENCE.has(assessment.equivalenceClass)) {
        return resolveUnavailableRoute(definition.mode, "unsafe_equivalence");
      }
    }

    return resolveAvailableRoute(definition.mode);
  });
};

const buildCanonicalMarketOptions = (input: {
  inspection: ResolutionRiskInspection;
  marketRows: readonly PairedMarketRow[];
  marketCoverageRows: readonly MarketCoverageRow[];
}): CanonicalMarketOption[] => {
  const titleMap = buildTitleMap(input.marketRows);
  const profilesByMarket = buildProfilesByMarket(input.inspection);
  const assessmentsByPair = buildAssessmentsByPair(input.inspection);
  const marketCoverage = buildMarketVenueCoverage(input.marketCoverageRows);
  const pairedMarketsById = buildPairedMarketIdentityMap(input.marketRows);
  const canonicalMarketIds = new Set<string>([
    ...profilesByMarket.keys(),
    ...marketCoverage.keys(),
    ...pairedMarketsById.keys()
  ]);

  return [...canonicalMarketIds]
    .sort((left, right) => left.localeCompare(right))
    .map((canonicalMarketId) => {
      const venues = (pairedMarketsById.get(canonicalMarketId) ?? []).map((venue) => ({
        ...venue,
        title: titleMap.get(`${canonicalMarketId}|${venue.venue}|${venue.venueMarketId}`) ?? venue.title
      })).sort(
        (left, right) =>
          left.venue.localeCompare(right.venue) ||
          left.venueMarketId.localeCompare(right.venueMarketId)
      );
      const routeModes = buildRouteModeAvailability({
        venueCoverage: marketCoverage.get(canonicalMarketId) ?? new Map(),
        profiles: profilesByMarket.get(canonicalMarketId) ?? [],
        assessmentsByPair
      });
      const runnableRouteModes = routeModes.filter((mode) => mode.runnable).map((mode) => mode.routeMode);
      return {
        canonicalMarketId,
        isRunnable: runnableRouteModes.length > 0,
        venues,
        routeModes,
        runnableRouteModes
      };
    });
};

const buildRouteModeSummary = (
  canonicalMarkets: readonly CanonicalMarketOption[]
): HistoricalSimulationEventRouteSummary[] =>
  HistoricalSimulationRouteModeDefinitions.map((definition) => {
    const routeableMarketCount = canonicalMarkets.filter((market) =>
      market.routeModes.some((routeMode) => routeMode.routeMode === definition.mode && routeMode.runnable)
    ).length;
    return {
      routeMode: definition.mode,
      label: definition.label,
      cardinality: definition.cardinality,
      routeableMarketCount,
      hasAnyRoute: routeableMarketCount > 0
    };
  });

export class SimulationAdminService {
  private readonly logger: Pick<Logger, "info" | "warn" | "error">;

  public constructor(private readonly deps: SimulationAdminServiceDeps) {
    this.logger = deps.logger ?? createNoopLogger();
  }

  public async listScopes(filters: SimulationAdminScopeFilters = {}): Promise<SimulationScopeSummary[]> {
    const routeMode = filters.routeMode ?? DEFAULT_ROUTE_MODE;
    const clauses = [
      `canonical_category IN ('SPORTS', 'CRYPTO', 'POLITICS', 'ESPORTS')`
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

    const result = await this.deps.pool.query<EventRow>(
      `SELECT
         canonical_event_id,
         canonical_category,
         market_class
       FROM historical_market_states
      WHERE ${clauses.join(" AND ")}
      GROUP BY canonical_event_id, canonical_category, market_class
      ORDER BY canonical_event_id ASC`,
      values
    );

    const coverages = await Promise.all(
      result.rows.map(async (row) => ({
        row,
        coverage: await this.getCanonicalCoverage(row.canonical_event_id)
      }))
    );

    return coverages.flatMap(({ row, coverage }) => {
      const routeableMarkets = coverage.canonicalMarkets.filter((market) =>
        market.routeModes.some((availability) => availability.routeMode === routeMode && availability.runnable)
      );
      if (routeableMarkets.length === 0) {
        return [];
      }

      const coverageStart = coverage.venueCoverage.reduce<Date>(
        (current, entry) => entry.coverageStart < current ? entry.coverageStart : current,
        coverage.venueCoverage[0]!.coverageStart
      );
      const coverageEnd = coverage.venueCoverage.reduce<Date>(
        (current, entry) => entry.coverageEnd > current ? entry.coverageEnd : current,
        coverage.venueCoverage[0]!.coverageEnd
      );

      return [{
        canonicalEventId: row.canonical_event_id,
        catalogScope: coverage.catalogScope,
        canonicalCategory: row.canonical_category as SupportedSimulationCategory,
        marketClass: row.market_class as HistoricalMarketClass,
        routeMode,
        coverageStart,
        coverageEnd,
        routeableMarketCount: routeableMarkets.length,
        venueCoverage: {
          polymarketRows: coverage.venueCoverage
            .filter((entry) => entry.venue === "POLYMARKET")
            .reduce((total, entry) => total + entry.rowCount, 0),
          limitlessRows: coverage.venueCoverage
            .filter((entry) => entry.venue === "LIMITLESS")
            .reduce((total, entry) => total + entry.rowCount, 0),
          opinionRows: coverage.venueCoverage
            .filter((entry) => entry.venue === "OPINION")
            .reduce((total, entry) => total + entry.rowCount, 0),
          myriadRows: coverage.venueCoverage
            .filter((entry) => entry.venue === "MYRIAD")
            .reduce((total, entry) => total + entry.rowCount, 0)
        }
      }];
    });
  }

  public async runSimulation(input: SimulationRunInput): Promise<SimulationRunResponse> {
    const canonicalEventId = await this.resolveCanonicalEventId(input);
    const eventCoverage = await this.getCanonicalCoverage(canonicalEventId);
    const canonicalMarketId = this.resolveCanonicalMarketId(input, eventCoverage);
    const coverage = await this.getCanonicalCoverage(canonicalEventId, canonicalMarketId);
    const resolutionRiskByTimestamp = await this.loadResolutionRiskSnapshotByTimestamp(
      canonicalEventId,
      input.from,
      input.to,
      canonicalMarketId,
      coverage.catalogScope
    );

    const simulationResult = await this.deps.historicalSimulationRunner.run({
      scopeType: "CANONICAL_EVENT",
      scopeId: canonicalEventId,
      routeMode: input.routeMode,
      marketClass: input.marketClass,
      canonicalEventId,
      canonicalMarketId,
      side: input.side,
      requestedNotional: input.requestedNotional,
      windowStart: input.from,
      windowEnd: input.to,
      configVersion: this.deps.configVersion,
      engineVersion: this.deps.engineVersion,
      dryRun: input.dryRun,
      metadata: {
        strategyKey: input.strategyKey,
        side: input.side,
        requestedNotional: input.requestedNotional,
        requestedRouteMode: input.routeMode,
        requestedCoverageCategory: coverage.canonicalCategory,
        catalogScope: coverage.catalogScope
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

  public async getCanonicalCoverage(eventId: string, canonicalMarketId?: string | null): Promise<SimulationCanonicalCoverage> {
    const catalogScope = await this.resolveCatalogScopeForEvent(eventId);
    const coverageValues = canonicalMarketId ? [eventId, canonicalMarketId] : [eventId];
    const coverageFilter = canonicalMarketId ? `canonical_event_id = $1 AND canonical_market_id = $2` : `canonical_event_id = $1`;
    const [coverageRows, pairedMarketRows, canonicalMarketRows, marketCoverageRows, resolutionRiskInspection] = await Promise.all([
      this.deps.pool.query<CoverageRow & { canonical_category: string | null; market_class: string | null }>(
        `SELECT
           venue,
           COUNT(*)::text AS row_count,
           MIN("timestamp") AS coverage_start,
           MAX("timestamp") AS coverage_end,
           MIN(canonical_category) AS canonical_category,
           MIN(market_class) AS market_class
         FROM historical_market_states
        WHERE ${coverageFilter}
        GROUP BY venue
        ORDER BY venue ASC`,
        coverageValues
      ),
      this.deps.pool.query<PairedMarketRow>(
        `SELECT DISTINCT ON (venue, venue_market_id)
            venue,
            venue_market_id,
            canonical_market_id,
            orderbook_snapshot
          FROM historical_market_states
         WHERE ${coverageFilter}
         ORDER BY venue, venue_market_id, "timestamp" DESC`,
        coverageValues
      ),
      this.deps.pool.query<PairedMarketRow>(
        `SELECT DISTINCT ON (canonical_market_id, venue, venue_market_id)
            canonical_market_id,
            venue,
            venue_market_id,
            orderbook_snapshot
          FROM historical_market_states
         WHERE canonical_event_id = $1
         ORDER BY canonical_market_id NULLS FIRST, venue, venue_market_id, "timestamp" DESC`,
        [eventId]
      ),
      this.deps.pool.query<MarketCoverageRow>(
        `SELECT
           canonical_market_id,
           venue,
           COUNT(*)::text AS row_count,
           MIN("timestamp") AS coverage_start,
           MAX("timestamp") AS coverage_end,
           MIN(canonical_category) AS canonical_category,
           MIN(market_class) AS market_class
         FROM historical_market_states
        WHERE canonical_event_id = $1
        GROUP BY canonical_market_id, venue
        ORDER BY canonical_market_id NULLS FIRST, venue ASC`,
        [eventId]
      ),
      this.loadResolutionRiskInspection(eventId, catalogScope)
    ]);

    if (coverageRows.rowCount === 0) {
      throw new SimulationCanonicalCoverageNotFoundError(eventId);
    }

    const pairedMarkets = pairedMarketRows.rows.map((row) => ({
      venue: row.venue,
      venueMarketId: row.venue_market_id,
      title: selectMarketTitle(row.orderbook_snapshot)
    }));

    const ambiguity: Record<string, { isAmbiguous: boolean; count: number; markets: string[] }> = {};
    const venues = [...new Set(pairedMarkets.map((m) => m.venue))];
    for (const venue of venues) {
      const venueMarkets = pairedMarkets.filter((m) => m.venue === venue);
      ambiguity[venue] = {
        isAmbiguous: venueMarkets.length > 1,
        count: venueMarkets.length,
        markets: venueMarkets.map((m) => m.venueMarketId)
      };
    }

    const first = coverageRows.rows[0]!;
    const scopedProfiles = filterResolutionRiskProfiles(resolutionRiskInspection, canonicalMarketId);
    const scopedAssessments = filterResolutionRiskAssessments(resolutionRiskInspection, canonicalMarketId);
    const scopedFreshness = computeScopedResolutionRiskFreshness(resolutionRiskInspection, canonicalMarketId);
    const canonicalMarkets = buildCanonicalMarketOptions({
      inspection: resolutionRiskInspection,
      marketRows: canonicalMarketRows.rows,
      marketCoverageRows: marketCoverageRows.rows
    });
    const routeModeSummary = buildRouteModeSummary(canonicalMarkets);
    const triVenueRouteableMarketCount = routeModeSummary.find(
      (summary) => summary.routeMode === "POLYMARKET_LIMITLESS_OPINION"
    )?.routeableMarketCount ?? 0;
    return {
      canonicalEventId: eventId,
      catalogScope,
      canonicalMarketId: canonicalMarketId ?? null,
      canonicalCategory: first.canonical_category as SupportedSimulationCategory | "OTHER" | null,
      marketClass: first.market_class as HistoricalMarketClass | null,
      venueCoverage: coverageRows.rows.map((row) => ({
        venue: row.venue,
        rowCount: coerceCount(row.row_count),
        coverageStart: new Date(row.coverage_start),
        coverageEnd: new Date(row.coverage_end)
      })),
      pairedMarkets,
      canonicalMarkets,
      routeModeSummary,
      hasTriVenueRoute: triVenueRouteableMarketCount > 0,
      triVenueRouteableMarketCount,
      ambiguity,
      resolutionRiskInspection: {
        ...resolutionRiskInspection,
        profiles: scopedProfiles,
        assessments: scopedAssessments,
        freshness: scopedFreshness
      }
    };
  }

  private async resolveCanonicalEventId(input: SimulationRunInput): Promise<string> {
    if (input.canonicalEventId) {
      return input.canonicalEventId;
    }

    const scopes = await this.listScopes({
      marketClass: input.marketClass,
      routeMode: input.routeMode
    });
    const matchingScopes = scopes.filter((scope) => scope.routeMode === input.routeMode);
    if (matchingScopes.length !== 1) {
      throw new SimulationAdminConflictError(
        `Simulation run requires exactly one resolvable canonical event for ${input.routeMode}; found ${matchingScopes.length}.`
      );
    }

    return matchingScopes[0]!.canonicalEventId;
  }

  private resolveCanonicalMarketId(
    input: SimulationRunInput,
    coverage: SimulationCanonicalCoverage
  ): string {
    const routeableMarkets = coverage.canonicalMarkets.filter((market) =>
      market.routeModes.some((availability) => availability.routeMode === input.routeMode && availability.runnable)
    );

    if (input.canonicalMarketId) {
      const selectedMarket = coverage.canonicalMarkets.find((market) => market.canonicalMarketId === input.canonicalMarketId);
      if (!selectedMarket) {
        throw new SimulationAdminConflictError(
          `Canonical market ${input.canonicalMarketId} is not part of event ${coverage.canonicalEventId}.`
        );
      }

      const selectedRoute = selectedMarket.routeModes.find((availability) => availability.routeMode === input.routeMode);
      if (!selectedRoute?.runnable) {
        throw new SimulationAdminConflictError(
          `Canonical market ${input.canonicalMarketId} is not runnable for route mode ${input.routeMode}.`
        );
      }

      return input.canonicalMarketId;
    }

    if (routeableMarkets.length === 0) {
      throw new SimulationAdminConflictError(
        `No exact canonical markets are runnable for ${input.routeMode} under event ${coverage.canonicalEventId}.`
      );
    }

    if (routeableMarkets.length > 1) {
      throw new SimulationAdminConflictError(
        `Route mode ${input.routeMode} has ${routeableMarkets.length} runnable canonical markets under event ${coverage.canonicalEventId}; choose one exact canonical market.`
      );
    }

    return routeableMarkets[0]!.canonicalMarketId;
  }

  private async loadResolutionRiskSnapshotByTimestamp(
    canonicalEventId: string,
    from: Date,
    to: Date,
    canonicalMarketId?: string | null,
    catalogScope?: HistoricalSimulationCatalogScope
  ): Promise<Readonly<Record<string, Record<string, unknown>>>> {
    const resolvedCatalogScope = catalogScope ?? (await this.resolveCatalogScopeForEvent(canonicalEventId));
    const inspection = await this.loadResolutionRiskInspection(canonicalEventId, resolvedCatalogScope);
    const result = await this.deps.pool.query<{ timestamp: Date }>(
      `SELECT DISTINCT "timestamp"
         FROM historical_market_states
        WHERE canonical_event_id = $1
          AND "timestamp" >= $2
          AND "timestamp" <= $3
          AND ($4::text IS NULL OR canonical_market_id = $4)
        ORDER BY "timestamp" ASC`,
      [canonicalEventId, from, to, canonicalMarketId ?? null]
    );

    const relevantAssessments = filterResolutionRiskAssessments(inspection, canonicalMarketId);
    const freshness = computeScopedResolutionRiskFreshness(inspection, canonicalMarketId);

    const safeEquivalentEligible = relevantAssessments.length > 0 && relevantAssessments.every((assessment) => 
       assessment.equivalenceClass === "SAFE_EQUIVALENT" || 
       assessment.equivalenceClass === "EQUIVALENT_WITH_LAG"
    );

    const snapshot = {
      canonicalEventId: inspection.canonicalEventId,
      catalogScope: resolvedCatalogScope,
      canonicalMarketId: canonicalMarketId ?? (relevantAssessments.length === 1 ? relevantAssessments[0]?.canonicalMarketId : null),
      safeEquivalentEligible,
      freshness,
      scoringVersion: inspection.scoringVersion
    };

    return Object.fromEntries(
      result.rows.map((row) => [
        new Date(row.timestamp).toISOString(),
        snapshot
      ])
    );
  }

  private async resolveCatalogScopeForEvent(eventId: string): Promise<HistoricalSimulationCatalogScope> {
    return (await this.deps.historicalSimulationCatalogService.hasCanonicalEvent(eventId))
      ? "historical_simulation"
      : "live";
  }

  private async loadResolutionRiskInspection(
    eventId: string,
    catalogScope: HistoricalSimulationCatalogScope
  ): Promise<CatalogScopeInspection> {
    return catalogScope === "historical_simulation"
      ? this.deps.historicalSimulationCatalogService.getCanonicalInspection(eventId)
      : this.deps.resolutionRiskAdminService.getCanonicalInspection(eventId);
  }
}
