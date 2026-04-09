import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

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
import type {
  PredictHistoricalReadinessState,
  PredictHistoricalReadinessSummary
} from "../../integrations/predict/predict-types.js";
import { PredictReadinessRepository } from "../../repositories/predict-readiness.repository.js";
import {
  opinionExactMatchCurationSchema,
  type OpinionExactMatchCuration
} from "../../simulation/opinion-exact-match-curation.js";
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
  venue_market_id?: string;
  venue: string;
  row_count: string;
  coverage_start: Date;
  coverage_end: Date;
  canonical_category: string | null;
  market_class: string | null;
}

interface PredictMarketReadiness {
  canonicalMarketId: string;
  predictVenueMarketIds: readonly string[];
  summary: PredictHistoricalReadinessSummary | null;
}

interface CanonicalMembershipRow {
  canonical_market_id: string;
  venue: string;
  venue_market_id: string;
}

interface OpinionExactMatchState {
  classification: NonNullable<CanonicalMarketOption["opinionExactMatch"]>["classification"];
  historicalQualified: boolean;
  reason: string | null;
}

interface OpinionCurationSummaryReasonCount {
  reason: string;
  count: number;
}

interface OpinionCurationSummaryDimensionCount {
  dimension: string;
  count: number;
}

interface LoadedOpinionCuration {
  semanticsRulepackVersion: string | null;
  entries: OpinionExactMatchCuration["entries"];
  exactMatchesByCanonicalMarketId: ReadonlyMap<string, OpinionExactMatchState>;
}

type SupportedSimulationCategory = "SPORTS" | "CRYPTO" | "POLITICS" | "ESPORTS";

export interface SimulationAdminScopeFilters {
  category?: SupportedSimulationCategory;
  marketClass?: HistoricalMarketClass;
  catalogScope?: HistoricalSimulationCatalogScope;
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
    predictRows: number;
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
  predictReadinessOverview: {
    state: PredictHistoricalReadinessState;
    historicalQualified: boolean;
    reasons: readonly string[];
    recorderAccumulatingMarkets: number;
    fallbackReadyMarkets: number;
    nativeReadyMarkets: number;
    currentStateOnlyMarkets: number;
    unusableMarkets: number;
  };
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

export interface SimulationRouteabilityReasonCount {
  reason: HistoricalSimulationRouteAvailabilityReason;
  count: number;
}

export interface SimulationRouteabilityModeSummary {
  routeMode: HistoricalSimulationRouteMode;
  label: string;
  cardinality: "single" | "pair" | "tri";
  routeableMarketCount: number;
  eventCount: number;
}

export interface SimulationRouteabilitySummary {
  filters: {
    category: SupportedSimulationCategory | "ALL";
    catalogScope: HistoricalSimulationCatalogScope | "ALL";
    marketClass: HistoricalMarketClass | null;
  };
  totals: {
    eventCount: number;
    canonicalMarketCount: number;
    runnableSingleCount: number;
    runnablePairCount: number;
    runnableTriCount: number;
  };
  routeModes: readonly SimulationRouteabilityModeSummary[];
  blockReasons: readonly SimulationRouteabilityReasonCount[];
  venueVisibility: {
    polymarketEvents: number;
    limitlessEvents: number;
    opinionEvents: number;
    myriadEvents: number;
    predictEvents: number;
  };
  opinionRouteability: {
    eventsWithOpinionInventory: number;
    eventsWithRunnableOpinionOnly: number;
    eventsWithBlockedOpinionPairOrTri: number;
    semanticsRulepackVersion: string | null;
    exactLiveOnlyCount: number;
    exactHistoricalQualifiedCount: number;
    nearMissCount: number;
    blockedUnsafeCandidateCount: number;
    lowConfidenceCandidateCount: number;
    dominantBlockReasons: readonly SimulationRouteabilityReasonCount[];
    dominantNearMissDimensions: readonly OpinionCurationSummaryDimensionCount[];
    dominantNearMissReasons: readonly OpinionCurationSummaryReasonCount[];
  };
  predictRouteability: {
    eventsWithPredictInventory: number;
    eventsWithCurrentStateOnlyPredict: number;
    eventsWithHistoricallyQualifiedPredict: number;
    eventsWithBlockedPredictRoutes: number;
    dominantBlockReasons: readonly SimulationRouteabilityReasonCount[];
  };
  triRouteability: {
    candidateCount: number;
    runnableCount: number;
    dominantBlockReasons: readonly SimulationRouteabilityReasonCount[];
  };
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

const OPINION_CURATION_ARTIFACT_PATH = path.resolve(process.cwd(), "docs", "opinion-exact-match-curation.json");
const SAFE_ROUTE_EQUIVALENCE = new Set(["SAFE_EQUIVALENT", "EQUIVALENT_WITH_LAG"]);
const RESOLUTION_RISK_STALENESS_TOLERANCE_MS = 1_000;

const isAssessmentFreshAgainstProfiles = (
  assessmentComputedAt: Date | null,
  latestProfileUpdatedAt: Date | null
): boolean => {
  if (assessmentComputedAt === null) {
    return false;
  }
  if (latestProfileUpdatedAt === null) {
    return true;
  }
  return assessmentComputedAt.getTime() + RESOLUTION_RISK_STALENESS_TOLERANCE_MS >= latestProfileUpdatedAt.getTime();
};

const sortOpinionReasonCounts = (
  counts: ReadonlyMap<string, number>
): readonly OpinionCurationSummaryReasonCount[] =>
  [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([reason, count]) => ({ reason, count }));

const sortOpinionDimensionCounts = (
  counts: ReadonlyMap<string, number>
): readonly OpinionCurationSummaryDimensionCount[] =>
  [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([dimension, count]) => ({ dimension, count }));

const readOpinionCurationArtifact = (
  logger: Pick<Logger, "info" | "warn" | "error">
): LoadedOpinionCuration => {
  if (!existsSync(OPINION_CURATION_ARTIFACT_PATH)) {
    return {
      semanticsRulepackVersion: null,
      entries: [],
      exactMatchesByCanonicalMarketId: new Map()
    };
  }

  try {
    const payload = opinionExactMatchCurationSchema.parse(
      JSON.parse(readFileSync(OPINION_CURATION_ARTIFACT_PATH, "utf8"))
    );
    const exactMatchesByCanonicalMarketId = new Map<string, OpinionExactMatchState>();
    for (const entry of payload.entries) {
      if (
        entry.decision.status === "semantic_exact_historical_qualified"
        || entry.decision.status === "semantic_exact_live_only"
      ) {
        exactMatchesByCanonicalMarketId.set(entry.selectedSeed.canonicalMarketId, {
          classification: entry.decision.status,
          historicalQualified: entry.decision.status === "semantic_exact_historical_qualified",
          reason: entry.decision.reason
        });
      }
    }
    return {
      semanticsRulepackVersion: payload.policy.semanticsRulepackVersion,
      entries: payload.entries,
      exactMatchesByCanonicalMarketId
    };
  } catch (error) {
    logger.warn({
      msg: "Failed to parse Opinion exact-match curation artifact.",
      artifactPath: OPINION_CURATION_ARTIFACT_PATH,
      error
    });
    return {
      semanticsRulepackVersion: null,
      entries: [],
      exactMatchesByCanonicalMarketId: new Map()
    };
  }
};

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
    !isComplete || !isAssessmentFreshAgainstProfiles(lastComputedAt, latestProfileUpdatedAt);

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

const buildMembershipKey = (venue: string, venueMarketId: string): string =>
  `${venue}|${venueMarketId}`;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const looksLikeUuid = (value: string): boolean => UUID_PATTERN.test(value);

const buildCurrentCanonicalMembershipMap = (
  rows: readonly CanonicalMembershipRow[]
): ReadonlyMap<string, string> =>
  new Map(
    rows.map((row) => [
      buildMembershipKey(row.venue, row.venue_market_id),
      row.canonical_market_id
    ] as const)
  );

const remapPairedMarketRows = (
  rows: readonly PairedMarketRow[],
  membershipByVenueMarket: ReadonlyMap<string, string>
): readonly PairedMarketRow[] =>
  rows.map((row) => ({
    ...row,
    canonical_market_id:
      membershipByVenueMarket.get(buildMembershipKey(row.venue, row.venue_market_id))
      ?? row.canonical_market_id
  }));

const remapMarketCoverageRows = (
  rows: readonly MarketCoverageRow[],
  membershipByVenueMarket: ReadonlyMap<string, string>
): readonly MarketCoverageRow[] => {
  const grouped = new Map<string, MarketCoverageRow>();
  for (const row of rows) {
    const canonicalMarketId =
      membershipByVenueMarket.get(buildMembershipKey(row.venue, row.venue_market_id ?? ""))
      ?? row.canonical_market_id;
    const key = `${canonicalMarketId ?? "null"}|${row.venue}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ...row,
        canonical_market_id: canonicalMarketId
      });
      continue;
    }

    grouped.set(key, {
      ...existing,
      canonical_market_id: canonicalMarketId,
      row_count: String(coerceCount(existing.row_count) + coerceCount(row.row_count)),
      coverage_start: existing.coverage_start < row.coverage_start ? existing.coverage_start : row.coverage_start,
      coverage_end: existing.coverage_end > row.coverage_end ? existing.coverage_end : row.coverage_end,
      canonical_category: existing.canonical_category ?? row.canonical_category,
      market_class: existing.market_class ?? row.market_class
    });
  }

  return [...grouped.values()].sort((left, right) =>
    (left.canonical_market_id ?? "").localeCompare(right.canonical_market_id ?? "")
    || left.venue.localeCompare(right.venue)
  );
};

const buildCoverageRowsFromMarketCoverage = (
  rows: readonly MarketCoverageRow[]
): ReadonlyArray<CoverageRow & { canonical_category: string | null; market_class: string | null }> => {
  const grouped = new Map<string, CoverageRow & { canonical_category: string | null; market_class: string | null }>();
  for (const row of rows) {
    const existing = grouped.get(row.venue);
    if (!existing) {
      grouped.set(row.venue, {
        venue: row.venue,
        row_count: row.row_count,
        coverage_start: row.coverage_start,
        coverage_end: row.coverage_end,
        canonical_category: row.canonical_category,
        market_class: row.market_class
      });
      continue;
    }

    grouped.set(row.venue, {
      ...existing,
      row_count: String(coerceCount(existing.row_count) + coerceCount(row.row_count)),
      coverage_start: existing.coverage_start < row.coverage_start ? existing.coverage_start : row.coverage_start,
      coverage_end: existing.coverage_end > row.coverage_end ? existing.coverage_end : row.coverage_end,
      canonical_category: existing.canonical_category ?? row.canonical_category,
      market_class: existing.market_class ?? row.market_class
    });
  }

  return [...grouped.values()].sort((left, right) => left.venue.localeCompare(right.venue));
};

const buildCanonicalOpinionExactMatches = (input: {
  marketRows: readonly PairedMarketRow[];
  marketCoverageRows: readonly MarketCoverageRow[];
  fallbackMatchesByMarketId: ReadonlyMap<string, OpinionExactMatchState>;
}): ReadonlyMap<string, OpinionExactMatchState> => {
  const pairedMarketsById = buildPairedMarketIdentityMap(input.marketRows);
  const marketCoverage = buildMarketVenueCoverage(input.marketCoverageRows);
  const merged = new Map<string, OpinionExactMatchState>();

  for (const [canonicalMarketId, venues] of pairedMarketsById.entries()) {
    const venueSet = new Set(venues.map((venue) => venue.venue));
    if (!venueSet.has("OPINION")) {
      continue;
    }
    if (![...venueSet].some((venue) => venue !== "OPINION")) {
      continue;
    }

    const venueCoverage = marketCoverage.get(canonicalMarketId) ?? new Map();
    const opinionCoverage = venueCoverage.get("OPINION")?.rowCount ?? 0;
    const hasCounterpartyHistoricalCoverage = [...venueCoverage.entries()].some(
      ([venue, coverage]) => venue !== "OPINION" && coverage.rowCount > 0
    );

    merged.set(canonicalMarketId, {
      classification:
        opinionCoverage > 0 && hasCounterpartyHistoricalCoverage
          ? "semantic_exact_historical_qualified"
          : "semantic_exact_live_only",
      historicalQualified: opinionCoverage > 0 && hasCounterpartyHistoricalCoverage,
      reason: "canonical_promoted_overlap"
    });
  }

  for (const [canonicalMarketId, fallback] of input.fallbackMatchesByMarketId.entries()) {
    if (!merged.has(canonicalMarketId)) {
      merged.set(canonicalMarketId, fallback);
    }
  }

  return merged;
};

const routeModeRequiresHistoricallyQualifiedPredict = (routeMode: HistoricalSimulationRouteMode): boolean =>
  routeMode === "POLYMARKET_PREDICT" ||
  routeMode === "LIMITLESS_PREDICT" ||
  routeMode === "OPINION_PREDICT";

const routeModeRequiresHistoricallyQualifiedOpinion = (routeMode: HistoricalSimulationRouteMode): boolean =>
  routeMode === "POLYMARKET_OPINION" ||
  routeMode === "LIMITLESS_OPINION" ||
  routeMode === "POLYMARKET_LIMITLESS_OPINION" ||
  routeMode === "OPINION_PREDICT";

const buildPredictReadinessOverview = (
  readiness: ReadonlyMap<string, PredictHistoricalReadinessSummary>
): SimulationCanonicalCoverage["predictReadinessOverview"] => {
  const summaries = [...readiness.values()];
  const stateCounts = summaries.reduce<Record<PredictHistoricalReadinessState, number>>(
    (accumulator, summary) => {
      accumulator[summary.state] += 1;
      return accumulator;
    },
    {
      CURRENT_STATE_ONLY: 0,
      RECORDER_ACCUMULATING: 0,
      HISTORICAL_READY_NATIVE: 0,
      HISTORICAL_READY_FALLBACK: 0,
      UNUSABLE: 0
    }
  );
  const reasons = [...new Set(summaries.map((summary) => summary.reason).filter((reason): reason is string => reason !== null))];
  const state: PredictHistoricalReadinessState =
    stateCounts.HISTORICAL_READY_NATIVE > 0
      ? "HISTORICAL_READY_NATIVE"
      : stateCounts.HISTORICAL_READY_FALLBACK > 0
        ? "HISTORICAL_READY_FALLBACK"
        : stateCounts.RECORDER_ACCUMULATING > 0
          ? "RECORDER_ACCUMULATING"
          : stateCounts.CURRENT_STATE_ONLY > 0
            ? "CURRENT_STATE_ONLY"
            : "UNUSABLE";

  return {
    state,
    historicalQualified: state === "HISTORICAL_READY_NATIVE" || state === "HISTORICAL_READY_FALLBACK",
    reasons,
    recorderAccumulatingMarkets: stateCounts.RECORDER_ACCUMULATING,
    fallbackReadyMarkets: stateCounts.HISTORICAL_READY_FALLBACK,
    nativeReadyMarkets: stateCounts.HISTORICAL_READY_NATIVE,
    currentStateOnlyMarkets: stateCounts.CURRENT_STATE_ONLY,
    unusableMarkets: stateCounts.UNUSABLE
  };
};

const buildPredictReadinessInputsFromRows = (
  marketRows: readonly PairedMarketRow[]
): readonly PredictMarketReadiness[] => {
  const grouped = new Map<string, string[]>();
  for (const row of marketRows) {
    if (!row.canonical_market_id || row.venue !== "PREDICT") {
      continue;
    }
    const marketIds = grouped.get(row.canonical_market_id) ?? [];
    marketIds.push(row.venue_market_id);
    grouped.set(row.canonical_market_id, marketIds);
  }

  return [...grouped.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([canonicalMarketId, predictVenueMarketIds]) => ({
      canonicalMarketId,
      predictVenueMarketIds: [...new Set(predictVenueMarketIds)].sort((left, right) => left.localeCompare(right)),
      summary: null
    }));
};

const buildPredictReadinessInputsFromCanonicalMarkets = (
  markets: readonly CanonicalMarketOption[]
): readonly PredictMarketReadiness[] =>
  markets
    .map((market) => ({
      canonicalMarketId: market.canonicalMarketId,
      predictVenueMarketIds: market.venues
        .filter((venue) => venue.venue === "PREDICT")
        .map((venue) => venue.venueMarketId)
        .sort((left, right) => left.localeCompare(right)),
      summary: null
    }))
    .filter((market) => market.predictVenueMarketIds.length > 0);

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
  opinionExactMatch?: OpinionExactMatchState | null;
  predictReadiness?: PredictHistoricalReadinessSummary | null;
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

    if (
      routeModeRequiresHistoricallyQualifiedOpinion(definition.mode)
      && input.opinionExactMatch
      && !input.opinionExactMatch.historicalQualified
    ) {
      return resolveUnavailableRoute(definition.mode, "opinion_historically_unqualified");
    }

    if (
      routeModeRequiresHistoricallyQualifiedPredict(definition.mode) &&
      (!input.predictReadiness || !input.predictReadiness.historicalQualified)
    ) {
      return resolveUnavailableRoute(definition.mode, "predict_historically_unqualified");
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
      if (!isAssessmentFreshAgainstProfiles(assessment.computedAt, latestProfileUpdate)) {
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
  opinionExactMatchesByMarketId: ReadonlyMap<string, OpinionExactMatchState>;
  predictReadinessByMarketId: ReadonlyMap<string, PredictHistoricalReadinessSummary>;
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
        assessmentsByPair,
        opinionExactMatch: input.opinionExactMatchesByMarketId.get(canonicalMarketId) ?? null,
        predictReadiness: input.predictReadinessByMarketId.get(canonicalMarketId) ?? null
      });
      const runnableRouteModes = routeModes.filter((mode) => mode.runnable).map((mode) => mode.routeMode);
      return {
        canonicalMarketId,
        isRunnable: runnableRouteModes.length > 0,
        venues,
        routeModes,
        runnableRouteModes,
        opinionExactMatch: input.opinionExactMatchesByMarketId.get(canonicalMarketId) ?? null,
        predictReadiness: input.predictReadinessByMarketId.get(canonicalMarketId) ?? null
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

const sortReasonCounts = (
  counts: ReadonlyMap<HistoricalSimulationRouteAvailabilityReason, number>
): readonly SimulationRouteabilityReasonCount[] =>
  [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([reason, count]) => ({ reason, count }));

interface FilteredCoverageResult {
  row: EventRow;
  coverage: SimulationCanonicalCoverage;
}

export class SimulationAdminService {
  private readonly logger: Pick<Logger, "info" | "warn" | "error">;

  public constructor(private readonly deps: SimulationAdminServiceDeps) {
    this.logger = deps.logger ?? createNoopLogger();
  }

  public async listScopes(filters: SimulationAdminScopeFilters = {}): Promise<SimulationScopeSummary[]> {
    const routeMode = filters.routeMode ?? DEFAULT_ROUTE_MODE;
    const coverages = await this.loadFilteredCoverages(filters);

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
            .reduce((total, entry) => total + entry.rowCount, 0),
          predictRows: coverage.venueCoverage
            .filter((entry) => entry.venue === "PREDICT")
            .reduce((total, entry) => total + entry.rowCount, 0)
        }
      }];
    });
  }

  public async getRouteabilitySummary(
    filters: Omit<SimulationAdminScopeFilters, "routeMode"> = {}
  ): Promise<SimulationRouteabilitySummary> {
    const coverages = await this.loadFilteredCoverages(filters);
    const opinionCuration = readOpinionCurationArtifact(this.logger);
    const routeModeMarketCounts = new Map<HistoricalSimulationRouteMode, number>();
    const routeModeEventCounts = new Map<HistoricalSimulationRouteMode, number>();
    const blockReasonCounts = new Map<HistoricalSimulationRouteAvailabilityReason, number>();
    const opinionReasonCounts = new Map<HistoricalSimulationRouteAvailabilityReason, number>();
    const predictReasonCounts = new Map<HistoricalSimulationRouteAvailabilityReason, number>();
    const triReasonCounts = new Map<HistoricalSimulationRouteAvailabilityReason, number>();
    const opinionNearMissReasonCounts = new Map<string, number>();
    const opinionNearMissDimensionCounts = new Map<string, number>();
    const venueEventCounts = {
      polymarketEvents: 0,
      limitlessEvents: 0,
      opinionEvents: 0,
      myriadEvents: 0,
      predictEvents: 0
    };

    let canonicalMarketCount = 0;
    let runnableSingleCount = 0;
    let runnablePairCount = 0;
    let runnableTriCount = 0;
    let triCandidateCount = 0;
    let triRunnableCount = 0;
    let eventsWithOpinionInventory = 0;
    let eventsWithRunnableOpinionOnly = 0;
    let eventsWithBlockedOpinionPairOrTri = 0;
    let exactLiveOnlyCount = 0;
    let exactHistoricalQualifiedCount = 0;
    let nearMissCount = 0;
    let blockedUnsafeCandidateCount = 0;
    let lowConfidenceCandidateCount = 0;
    let eventsWithPredictInventory = 0;
    let eventsWithCurrentStateOnlyPredict = 0;
    let eventsWithHistoricallyQualifiedPredict = 0;
    let eventsWithBlockedPredictRoutes = 0;

    const filteredEventIds = new Set(coverages.map(({ coverage }) => coverage.canonicalEventId));
    const filteredOpinionEntries = opinionCuration.entries.filter((entry) =>
      filteredEventIds.has(entry.selectedSeed.canonicalEventId)
    );

    for (const entry of filteredOpinionEntries) {
      nearMissCount += entry.nearMissCandidates.length;
      for (const evaluation of entry.candidateEvaluations) {
        if (evaluation.semanticValidation.discoveryStatus === "candidate_blocked") {
          blockedUnsafeCandidateCount += 1;
        }
        if (evaluation.semanticValidation.qualificationSummary.lowConfidenceSemanticRate > 0) {
          lowConfidenceCandidateCount += 1;
        }
      }
      for (const candidate of entry.nearMissCandidates) {
        const reason = candidate.comparison.primaryFailureReason ?? candidate.comparison.failedDimensions[0] ?? "semantic_near_exact";
        opinionNearMissReasonCounts.set(reason, (opinionNearMissReasonCounts.get(reason) ?? 0) + 1);
        for (const dimension of candidate.comparison.failedDimensions) {
          opinionNearMissDimensionCounts.set(
            dimension,
            (opinionNearMissDimensionCounts.get(dimension) ?? 0) + 1
          );
        }
      }
    }

    for (const { coverage } of coverages) {
      const coverageVenues = new Set(coverage.venueCoverage.map((entry) => entry.venue));
      if (coverageVenues.has("POLYMARKET")) {
        venueEventCounts.polymarketEvents += 1;
      }
      if (coverageVenues.has("LIMITLESS")) {
        venueEventCounts.limitlessEvents += 1;
      }
      if (coverageVenues.has("OPINION")) {
        venueEventCounts.opinionEvents += 1;
      }
      if (coverageVenues.has("MYRIAD")) {
        venueEventCounts.myriadEvents += 1;
      }
      if (coverageVenues.has("PREDICT")) {
        venueEventCounts.predictEvents += 1;
      }

      for (const summary of coverage.routeModeSummary) {
        routeModeMarketCounts.set(
          summary.routeMode,
          (routeModeMarketCounts.get(summary.routeMode) ?? 0) + summary.routeableMarketCount
        );
        if (summary.hasAnyRoute) {
          routeModeEventCounts.set(summary.routeMode, (routeModeEventCounts.get(summary.routeMode) ?? 0) + 1);
        }
      }

      canonicalMarketCount += coverage.canonicalMarkets.length;

      let eventHasOpinionInventory = false;
      let eventHasRunnableOpinionOnly = false;
      let eventHasBlockedOpinionPairOrTri = false;
      let eventHasPredictInventory = false;
      let eventHasCurrentStateOnlyPredict = false;
      let eventHasHistoricallyQualifiedPredict = false;
      let eventHasBlockedPredictRoutes = false;
      const eventOpinionReasonCounts = new Map<HistoricalSimulationRouteAvailabilityReason, number>();
      const eventPredictReasonCounts = new Map<HistoricalSimulationRouteAvailabilityReason, number>();

      for (const market of coverage.canonicalMarkets) {
        if (market.opinionExactMatch?.classification === "semantic_exact_live_only") {
          exactLiveOnlyCount += 1;
        }
        if (market.opinionExactMatch?.classification === "semantic_exact_historical_qualified") {
          exactHistoricalQualifiedCount += 1;
        }
        if (market.routeModes.some((route) => route.cardinality === "single" && route.runnable)) {
          runnableSingleCount += 1;
        }
        if (market.routeModes.some((route) => route.cardinality === "pair" && route.runnable)) {
          runnablePairCount += 1;
        }
        if (market.routeModes.some((route) => route.cardinality === "tri" && route.runnable)) {
          runnableTriCount += 1;
        }

        const hasOpinionVenue = market.venues.some((venue) => venue.venue === "OPINION");
        const hasPredictVenue = market.venues.some((venue) => venue.venue === "PREDICT");
        const predictReadiness = market.predictReadiness ?? null;
        if (hasOpinionVenue) {
          eventHasOpinionInventory = true;
        }
        if (hasPredictVenue || predictReadiness !== null) {
          eventHasPredictInventory = true;
        }
        if (predictReadiness?.state === "CURRENT_STATE_ONLY") {
          eventHasCurrentStateOnlyPredict = true;
        }
        if (predictReadiness?.historicalQualified) {
          eventHasHistoricallyQualifiedPredict = true;
        }

        const triRoutes = market.routeModes.filter((route) => route.cardinality === "tri");
        if (triRoutes.some((route) => route.runnable || route.reason !== "missing_required_venue")) {
          triCandidateCount += 1;
        }
        if (triRoutes.some((route) => route.runnable)) {
          triRunnableCount += 1;
        }

        for (const route of market.routeModes) {
          if (!route.runnable && route.reason) {
            blockReasonCounts.set(route.reason, (blockReasonCounts.get(route.reason) ?? 0) + 1);
          }

          if (route.routeMode === "OPINION_ONLY" && route.runnable) {
            eventHasRunnableOpinionOnly = true;
          }

          if (route.cardinality === "tri" && !route.runnable && route.reason) {
            triReasonCounts.set(route.reason, (triReasonCounts.get(route.reason) ?? 0) + 1);
          }

          if (route.requiredVenues.includes("OPINION") && route.cardinality !== "single" && !route.runnable && route.reason) {
            eventOpinionReasonCounts.set(route.reason, (eventOpinionReasonCounts.get(route.reason) ?? 0) + 1);
            eventHasBlockedOpinionPairOrTri = true;
          }

          if (route.requiredVenues.includes("PREDICT") && !route.runnable && route.reason) {
            eventPredictReasonCounts.set(route.reason, (eventPredictReasonCounts.get(route.reason) ?? 0) + 1);
            eventHasBlockedPredictRoutes = true;
          }
        }
      }

      if (eventHasOpinionInventory) {
        eventsWithOpinionInventory += 1;
      }
      if (eventHasRunnableOpinionOnly) {
        eventsWithRunnableOpinionOnly += 1;
      }
      if (eventHasBlockedOpinionPairOrTri && eventHasOpinionInventory) {
        eventsWithBlockedOpinionPairOrTri += 1;
      }
      if (eventHasOpinionInventory) {
        for (const [reason, count] of eventOpinionReasonCounts.entries()) {
          opinionReasonCounts.set(reason, (opinionReasonCounts.get(reason) ?? 0) + count);
        }
      }
      if (eventHasPredictInventory) {
        eventsWithPredictInventory += 1;
      }
      if (eventHasCurrentStateOnlyPredict) {
        eventsWithCurrentStateOnlyPredict += 1;
      }
      if (eventHasHistoricallyQualifiedPredict) {
        eventsWithHistoricallyQualifiedPredict += 1;
      }
      if (eventHasBlockedPredictRoutes && eventHasPredictInventory) {
        eventsWithBlockedPredictRoutes += 1;
      }
      if (eventHasPredictInventory) {
        for (const [reason, count] of eventPredictReasonCounts.entries()) {
          predictReasonCounts.set(reason, (predictReasonCounts.get(reason) ?? 0) + count);
        }
      }
    }

    return {
      filters: {
        category: filters.category ?? "ALL",
        catalogScope: filters.catalogScope ?? "ALL",
        marketClass: filters.marketClass ?? null
      },
      totals: {
        eventCount: coverages.length,
        canonicalMarketCount,
        runnableSingleCount,
        runnablePairCount,
        runnableTriCount
      },
      routeModes: HistoricalSimulationRouteModeDefinitions.map((definition) => ({
        routeMode: definition.mode,
        label: definition.label,
        cardinality: definition.cardinality,
        routeableMarketCount: routeModeMarketCounts.get(definition.mode) ?? 0,
        eventCount: routeModeEventCounts.get(definition.mode) ?? 0
      })),
      blockReasons: sortReasonCounts(blockReasonCounts),
      venueVisibility: venueEventCounts,
      opinionRouteability: {
        eventsWithOpinionInventory,
        eventsWithRunnableOpinionOnly,
        eventsWithBlockedOpinionPairOrTri,
        semanticsRulepackVersion: opinionCuration.semanticsRulepackVersion,
        exactLiveOnlyCount,
        exactHistoricalQualifiedCount,
        nearMissCount,
        blockedUnsafeCandidateCount,
        lowConfidenceCandidateCount,
        dominantBlockReasons: sortReasonCounts(opinionReasonCounts),
        dominantNearMissDimensions: sortOpinionDimensionCounts(opinionNearMissDimensionCounts),
        dominantNearMissReasons: sortOpinionReasonCounts(opinionNearMissReasonCounts)
      },
      predictRouteability: {
        eventsWithPredictInventory,
        eventsWithCurrentStateOnlyPredict,
        eventsWithHistoricallyQualifiedPredict,
        eventsWithBlockedPredictRoutes,
        dominantBlockReasons: sortReasonCounts(predictReasonCounts)
      },
      triRouteability: {
        candidateCount: triCandidateCount,
        runnableCount: triRunnableCount,
        dominantBlockReasons: sortReasonCounts(triReasonCounts)
      }
    };
  }

  public async runSimulation(input: SimulationRunInput): Promise<SimulationRunResponse> {
    const canonicalEventId = await this.resolveCanonicalEventId(input);
    const eventCoverage = await this.getCanonicalCoverage(canonicalEventId);
    const canonicalMarketId = this.resolveCanonicalMarketId(input, eventCoverage);
    const coverage = await this.getCanonicalCoverage(canonicalEventId, canonicalMarketId);
    const selectedOpinionExactMatch = coverage.canonicalMarkets.find(
      (market) => market.canonicalMarketId === canonicalMarketId
    )?.opinionExactMatch ?? null;
    const predictReadiness = await this.loadPredictMarketReadiness(eventCoverage.canonicalMarkets, {
      start: input.from,
      end: input.to
    });
    const selectedPredictReadiness = predictReadiness.find((entry) => entry.canonicalMarketId === canonicalMarketId)?.summary ?? null;

    if (
      routeModeRequiresHistoricallyQualifiedOpinion(input.routeMode)
      && selectedOpinionExactMatch
      && !selectedOpinionExactMatch.historicalQualified
    ) {
      throw new SimulationAdminConflictError(
        `Opinion exact overlap for ${canonicalMarketId} is present but not historically qualified under route mode ${input.routeMode}.`
      );
    }

    if (
      routeModeRequiresHistoricallyQualifiedPredict(input.routeMode) &&
      (!selectedPredictReadiness || !selectedPredictReadiness.historicalQualified)
    ) {
      throw new SimulationAdminConflictError(
        `Predict historical evidence is not ready for ${canonicalMarketId} under route mode ${input.routeMode}.`
      );
    }

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
        catalogScope: coverage.catalogScope,
        predictReadiness: selectedPredictReadiness
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
    const [pairedMarketRows, marketCoverageRows, canonicalMembershipRows, resolutionRiskInspection] = await Promise.all([
      this.deps.pool.query<PairedMarketRow>(
        `SELECT DISTINCT ON (venue, venue_market_id)
            venue,
            venue_market_id,
            canonical_market_id,
            orderbook_snapshot
          FROM historical_market_states
         WHERE canonical_event_id = $1
         ORDER BY venue, venue_market_id, "timestamp" DESC`,
        [eventId]
      ),
      this.deps.pool.query<MarketCoverageRow>(
        `SELECT
           canonical_market_id,
           venue_market_id,
           venue,
           COUNT(*)::text AS row_count,
           MIN("timestamp") AS coverage_start,
           MAX("timestamp") AS coverage_end,
           MIN(canonical_category) AS canonical_category,
           MIN(market_class) AS market_class
         FROM historical_market_states
        WHERE canonical_event_id = $1
        GROUP BY canonical_market_id, venue_market_id, venue
        ORDER BY canonical_market_id NULLS FIRST, venue ASC, venue_market_id ASC`,
        [eventId]
      ),
      looksLikeUuid(eventId)
        ? this.deps.pool.query<CanonicalMembershipRow>(
            `SELECT
               members.canonical_executable_market_id AS canonical_market_id,
               vmp.venue,
               vmp.venue_market_id
             FROM canonical_executable_market_members members
             JOIN venue_market_profiles vmp
               ON vmp.id = members.venue_market_profile_id
            WHERE vmp.canonical_event_id = $1`,
            [eventId]
          )
        : Promise.resolve({ rows: [] as CanonicalMembershipRow[] }),
      this.loadResolutionRiskInspection(eventId, catalogScope)
    ]);

    const membershipByVenueMarket = buildCurrentCanonicalMembershipMap(canonicalMembershipRows.rows);
    const remappedPairedMarketRows = remapPairedMarketRows(pairedMarketRows.rows, membershipByVenueMarket);
    const remappedMarketCoverageRows = remapMarketCoverageRows(marketCoverageRows.rows, membershipByVenueMarket);
    const filteredPairedMarketRows = canonicalMarketId
      ? remappedPairedMarketRows.filter((row) => row.canonical_market_id === canonicalMarketId)
      : remappedPairedMarketRows;
    const filteredMarketCoverageRows = canonicalMarketId
      ? remappedMarketCoverageRows.filter((row) => row.canonical_market_id === canonicalMarketId)
      : remappedMarketCoverageRows;
    const coverageRows = buildCoverageRowsFromMarketCoverage(filteredMarketCoverageRows);
    const canonicalMarketRows = remappedPairedMarketRows;

    if (coverageRows.length === 0) {
      throw new SimulationCanonicalCoverageNotFoundError(eventId);
    }

    const pairedMarkets = filteredPairedMarketRows.map((row) => ({
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

    const first = coverageRows[0]!;
    const scopedProfiles = filterResolutionRiskProfiles(resolutionRiskInspection, canonicalMarketId);
    const scopedAssessments = filterResolutionRiskAssessments(resolutionRiskInspection, canonicalMarketId);
    const scopedFreshness = computeScopedResolutionRiskFreshness(resolutionRiskInspection, canonicalMarketId);
    const opinionCuration = readOpinionCurationArtifact(this.logger);
    const predictReadiness = await this.loadPredictMarketReadiness(
      canonicalMarketRows,
      undefined
    );
    const opinionExactMatchesByMarketId = buildCanonicalOpinionExactMatches({
      marketRows: canonicalMarketRows,
      marketCoverageRows: remappedMarketCoverageRows,
      fallbackMatchesByMarketId: opinionCuration.exactMatchesByCanonicalMarketId
    });
    const predictReadinessByMarketId = new Map(
      predictReadiness
        .filter((entry) => entry.summary !== null)
        .map((entry) => [entry.canonicalMarketId, entry.summary as PredictHistoricalReadinessSummary])
    );
    const canonicalMarkets = buildCanonicalMarketOptions({
      inspection: resolutionRiskInspection,
      marketRows: canonicalMarketRows,
      marketCoverageRows: remappedMarketCoverageRows,
      opinionExactMatchesByMarketId,
      predictReadinessByMarketId
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
      venueCoverage: coverageRows.map((row) => ({
        venue: row.venue,
        rowCount: coerceCount(row.row_count),
        coverageStart: new Date(row.coverage_start),
        coverageEnd: new Date(row.coverage_end)
      })),
      predictReadinessOverview: buildPredictReadinessOverview(predictReadinessByMarketId),
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

  private async loadPredictMarketReadiness(
    markets: readonly PairedMarketRow[] | readonly CanonicalMarketOption[],
    window?: { start: Date; end: Date }
  ): Promise<readonly PredictMarketReadiness[]> {
    const seedReadiness = markets.length === 0
      ? []
      : "venues" in markets[0]!
        ? buildPredictReadinessInputsFromCanonicalMarkets(markets as readonly CanonicalMarketOption[])
        : buildPredictReadinessInputsFromRows(markets as readonly PairedMarketRow[]);

    if (seedReadiness.length === 0) {
      return [];
    }

    const marketIds = [...new Set(seedReadiness.flatMap((entry) => entry.predictVenueMarketIds))];
    const readinessRepository = new PredictReadinessRepository(this.deps.pool);
    const readinessByMarketId = await readinessRepository.summarizeReadinessByMarketIds({
      marketIds,
      ...(window ? { window } : {})
    });

    return seedReadiness.map((entry) => {
      const summaries = entry.predictVenueMarketIds
        .map((marketId) => readinessByMarketId.get(marketId) ?? null)
        .filter((summary): summary is PredictHistoricalReadinessSummary => summary !== null);

      if (summaries.length === 0) {
        return entry;
      }

      const merged: PredictHistoricalReadinessSummary = summaries.reduce<PredictHistoricalReadinessSummary>(
        (current, summary) => {
          const rank = (state: PredictHistoricalReadinessState): number => ({
            HISTORICAL_READY_NATIVE: 5,
            HISTORICAL_READY_FALLBACK: 4,
            RECORDER_ACCUMULATING: 3,
            CURRENT_STATE_ONLY: 2,
            UNUSABLE: 1
          })[state];
          const currentRank = rank(current.state);
          const summaryRank = rank(summary.state);

          return {
            marketId: current.marketId,
            state: summaryRank > currentRank ? summary.state : current.state,
            historicalQualified: current.historicalQualified || summary.historicalQualified,
            reason: summaryRank > currentRank ? summary.reason : (current.reason ?? summary.reason),
            environments: [...new Set([...current.environments, ...summary.environments])].sort((left, right) =>
              left.localeCompare(right)
            ),
            currentStateRowCount: current.currentStateRowCount + summary.currentStateRowCount,
            currentStateCoverageStart:
              current.currentStateCoverageStart === null
                ? summary.currentStateCoverageStart
                : summary.currentStateCoverageStart === null
                  ? current.currentStateCoverageStart
                  : current.currentStateCoverageStart < summary.currentStateCoverageStart
                    ? current.currentStateCoverageStart
                    : summary.currentStateCoverageStart,
            currentStateCoverageEnd:
              current.currentStateCoverageEnd === null
                ? summary.currentStateCoverageEnd
                : summary.currentStateCoverageEnd === null
                  ? current.currentStateCoverageEnd
                  : current.currentStateCoverageEnd > summary.currentStateCoverageEnd
                    ? current.currentStateCoverageEnd
                    : summary.currentStateCoverageEnd,
            nativeOrderbookSnapshotCount: current.nativeOrderbookSnapshotCount + summary.nativeOrderbookSnapshotCount,
            nativeMatchEventCount: current.nativeMatchEventCount + summary.nativeMatchEventCount,
            recorderCheckpointCount: current.recorderCheckpointCount + summary.recorderCheckpointCount,
            fallbackSnapshotCount: current.fallbackSnapshotCount + summary.fallbackSnapshotCount,
            fallbackCoveredWindowCount: current.fallbackCoveredWindowCount + summary.fallbackCoveredWindowCount
          };
        },
        {
          marketId: entry.predictVenueMarketIds.join("|"),
          state: "UNUSABLE",
          historicalQualified: false,
          reason: null,
          environments: [],
          currentStateRowCount: 0,
          currentStateCoverageStart: null,
          currentStateCoverageEnd: null,
          nativeOrderbookSnapshotCount: 0,
          nativeMatchEventCount: 0,
          recorderCheckpointCount: 0,
          fallbackSnapshotCount: 0,
          fallbackCoveredWindowCount: 0
        }
      );

      return {
        ...entry,
        summary: merged
      };
    });
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

  private async loadFilteredCoverages(
    filters: Omit<SimulationAdminScopeFilters, "routeMode"> = {}
  ): Promise<readonly FilteredCoverageResult[]> {
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

    return filters.catalogScope
      ? coverages.filter(({ coverage }) => coverage.catalogScope === filters.catalogScope)
      : coverages;
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
