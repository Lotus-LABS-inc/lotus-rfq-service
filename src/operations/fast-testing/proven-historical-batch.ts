import { HistoricalMarketClass, type HistoricalSimulationOrderSide, type HistoricalSimulationRouteMode } from "../../core/historical-simulation/historical-simulation.types.js";
import type { SimulationAdminService, SimulationRunResponse } from "../../api/admin/simulation-admin-service.js";

interface HistoricalRouteDecision {
  status?: string;
}

interface HistoricalVenueProfile {
  venue?: string;
  venueMarketId?: string;
  historyWindow?: {
    start?: string;
    end?: string;
  };
}

export interface HistoricalRouteManifestEntry {
  historicalCanonicalEventId?: string;
  historicalCanonicalMarketId?: string;
  title?: string;
  canonicalCategory?: string;
  decision?: HistoricalRouteDecision;
  venueProfiles?: readonly HistoricalVenueProfile[];
}

export interface ProvenHistoricalBatchPlanEntry {
  canonicalEventId: string;
  canonicalMarketId: string;
  title: string | null;
  canonicalCategory: string | null;
  routeMode: HistoricalSimulationRouteMode;
  marketClass: HistoricalMarketClass;
  side: HistoricalSimulationOrderSide;
  from: Date;
  to: Date;
}

export interface ProvenHistoricalBatchSkippedEntry {
  canonicalEventId: string | null;
  canonicalMarketId: string | null;
  title: string | null;
  reason: "unsupported_route" | "missing_history_window" | "empty_history_window" | "missing_identifiers";
}

export interface ProvenHistoricalBatchRunResult {
  plan: ProvenHistoricalBatchPlanEntry;
  runId: string | null;
  status: string;
  persistedResultCount: number;
  blockedSliceCount: number;
  sliceCount: number;
}

export interface ProvenHistoricalBatchFailure {
  plan: ProvenHistoricalBatchPlanEntry;
  errorCode: string;
  errorMessage: string;
}

export interface ProvenHistoricalBatchExecutionSummary {
  plannedRuns: readonly ProvenHistoricalBatchPlanEntry[];
  skippedRoutes: readonly ProvenHistoricalBatchSkippedEntry[];
  completedRuns: readonly ProvenHistoricalBatchRunResult[];
  failedRuns: readonly ProvenHistoricalBatchFailure[];
}

const PROVEN_ROUTE_MODE_BY_VENUES: Readonly<Record<string, HistoricalSimulationRouteMode>> = {
  OPINION: "OPINION_ONLY",
  "LIMITLESS|POLYMARKET": "POLYMARKET_LIMITLESS"
};

const DEFAULT_SIDES: readonly HistoricalSimulationOrderSide[] = ["BUY", "SELL"];

const sortVenueKey = (venues: readonly string[]): string =>
  [...venues].sort((left, right) => left.localeCompare(right)).join("|");

const parseHistoryWindow = (
  value: HistoricalVenueProfile["historyWindow"]
): { start: Date; end: Date } | null => {
  if (!value?.start || !value?.end) {
    return null;
  }

  const start = new Date(value.start);
  const end = new Date(value.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  return { start, end };
};

const resolveEffectiveHistoryWindow = (
  venueProfiles: readonly HistoricalVenueProfile[]
): { start: Date; end: Date } | null | "empty" => {
  const windows = venueProfiles
    .map((profile) => parseHistoryWindow(profile.historyWindow))
    .filter((window): window is { start: Date; end: Date } => window !== null);

  if (windows.length === 0) {
    return null;
  }

  const start = windows.reduce<Date>(
    (current, window) => window.start > current ? window.start : current,
    windows[0]!.start
  );
  const end = windows.reduce<Date>(
    (current, window) => window.end < current ? window.end : current,
    windows[0]!.end
  );

  return start < end ? { start, end } : "empty";
};

const resolveProvenRouteMode = (
  venueProfiles: readonly HistoricalVenueProfile[]
): HistoricalSimulationRouteMode | null => {
  const venues = venueProfiles
    .map((profile) => profile.venue?.trim() ?? "")
    .filter((venue) => venue.length > 0);
  if (venues.length === 0) {
    return null;
  }

  return PROVEN_ROUTE_MODE_BY_VENUES[sortVenueKey(venues)] ?? null;
};

export const buildProvenHistoricalBatchPlan = (
  routes: readonly HistoricalRouteManifestEntry[],
  sides: readonly HistoricalSimulationOrderSide[] = DEFAULT_SIDES
): { plannedRuns: readonly ProvenHistoricalBatchPlanEntry[]; skippedRoutes: readonly ProvenHistoricalBatchSkippedEntry[] } => {
  const plannedRuns: ProvenHistoricalBatchPlanEntry[] = [];
  const skippedRoutes: ProvenHistoricalBatchSkippedEntry[] = [];

  for (const route of routes) {
    if (route.decision?.status !== "accepted") {
      continue;
    }

    const canonicalEventId = route.historicalCanonicalEventId ?? null;
    const canonicalMarketId = route.historicalCanonicalMarketId ?? null;
    const title = route.title ?? null;
    if (!canonicalEventId || !canonicalMarketId) {
      skippedRoutes.push({
        canonicalEventId,
        canonicalMarketId,
        title,
        reason: "missing_identifiers"
      });
      continue;
    }

    const venueProfiles = route.venueProfiles ?? [];
    const routeMode = resolveProvenRouteMode(venueProfiles);
    if (!routeMode) {
      skippedRoutes.push({
        canonicalEventId,
        canonicalMarketId,
        title,
        reason: "unsupported_route"
      });
      continue;
    }

    const effectiveWindow = resolveEffectiveHistoryWindow(venueProfiles);
    if (effectiveWindow === null) {
      skippedRoutes.push({
        canonicalEventId,
        canonicalMarketId,
        title,
        reason: "missing_history_window"
      });
      continue;
    }
    if (effectiveWindow === "empty") {
      skippedRoutes.push({
        canonicalEventId,
        canonicalMarketId,
        title,
        reason: "empty_history_window"
      });
      continue;
    }

    for (const side of sides) {
      plannedRuns.push({
        canonicalEventId,
        canonicalMarketId,
        title,
        canonicalCategory: route.canonicalCategory ?? null,
        routeMode,
        marketClass: HistoricalMarketClass.BINARY,
        side,
        from: effectiveWindow.start,
        to: effectiveWindow.end
      });
    }
  }

  return { plannedRuns, skippedRoutes };
};

const resolveErrorCode = (error: unknown): string =>
  typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : error instanceof Error && error.name
      ? error.name
      : "simulation_batch_failed";

const resolveErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown simulation batch failure.";

export interface RunProvenHistoricalBatchInput {
  routes: readonly HistoricalRouteManifestEntry[];
  simulationAdminService: Pick<SimulationAdminService, "runSimulation">;
  requestedNotional?: string;
  strategyKey?: string;
  dryRun?: boolean;
}

export const runProvenHistoricalBatch = async (
  input: RunProvenHistoricalBatchInput
): Promise<ProvenHistoricalBatchExecutionSummary> => {
  const { plannedRuns, skippedRoutes } = buildProvenHistoricalBatchPlan(input.routes);
  const completedRuns: ProvenHistoricalBatchRunResult[] = [];
  const failedRuns: ProvenHistoricalBatchFailure[] = [];

  for (const plan of plannedRuns) {
    try {
      const result: SimulationRunResponse = await input.simulationAdminService.runSimulation({
        marketClass: plan.marketClass,
        routeMode: plan.routeMode,
        canonicalEventId: plan.canonicalEventId,
        canonicalMarketId: plan.canonicalMarketId,
        side: plan.side,
        requestedNotional: input.requestedNotional ?? "100",
        from: plan.from,
        to: plan.to,
        strategyKey: input.strategyKey ?? "strategy.sim.v1",
        dryRun: input.dryRun ?? false
      });

      completedRuns.push({
        plan,
        runId: result.run?.id ?? result.simulationResult.runId,
        status: result.simulationResult.status,
        persistedResultCount: result.simulationResult.persistedResultCount,
        blockedSliceCount: result.simulationResult.blockedSliceCount,
        sliceCount: result.simulationResult.sliceCount
      });
    } catch (error) {
      failedRuns.push({
        plan,
        errorCode: resolveErrorCode(error),
        errorMessage: resolveErrorMessage(error)
      });
    }
  }

  return {
    plannedRuns,
    skippedRoutes,
    completedRuns,
    failedRuns
  };
};
