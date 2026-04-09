import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import {
  SimulationAdminConflictError,
  SimulationAdminService,
  SimulationCanonicalCoverageNotFoundError,
  SimulationRunNotFoundError
} from "./simulation-admin-service.js";
import {
  HistoricalMarketClass,
  HistoricalSimulationCatalogScopeValues,
  type HistoricalSimulationRouteMode,
  HistoricalSimulationRouteModeValues,
  HistoricalSimulationRunStatus
} from "../../core/historical-simulation/historical-simulation.types.js";
import { PredictHistoricalReadinessStateValues } from "../../integrations/predict/predict-types.js";

const paramsSchema = z.object({
  id: z.string().uuid()
});

const canonicalParamsSchema = z.object({
  eventId: z.string().min(1)
});

const canonicalQuerySchema = z.object({
  canonicalMarketId: z.string().optional()
});

const canonicalCategorySchema = z.enum(["SPORTS", "CRYPTO", "POLITICS", "ESPORTS"]);
const routeModeSchema = z.enum(HistoricalSimulationRouteModeValues);
const orderSideSchema = z.enum(["BUY", "SELL"]);
const catalogScopeSchema = z.enum(HistoricalSimulationCatalogScopeValues);
const routeAvailabilityReasonSchema = z.enum([
  "missing_required_venue",
  "missing_historical_rows",
  "missing_pair_assessment",
  "incomplete_resolution_risk",
  "stale_resolution_risk",
  "unsafe_equivalence",
  "ambiguous_venue_identity",
  "opinion_historically_unqualified",
  "predict_historically_unqualified"
]);

const scopeQuerySchema = z.object({
  category: canonicalCategorySchema.optional(),
  marketClass: z.nativeEnum(HistoricalMarketClass).optional(),
  catalogScope: catalogScopeSchema.optional(),
  routeMode: routeModeSchema.optional(),
  venuePair: routeModeSchema.optional()
}).refine(
  (value) => !value.routeMode || !value.venuePair || value.routeMode === value.venuePair,
  {
    message: "routeMode and venuePair must match when both are provided",
    path: ["routeMode"]
  }
);

const routeabilitySummaryQuerySchema = z.object({
  category: canonicalCategorySchema.optional(),
  marketClass: z.nativeEnum(HistoricalMarketClass).optional(),
  catalogScope: catalogScopeSchema.optional()
});

const isoDateSchema = z.string().datetime({ offset: true });

const runBodySchema = z.object({
  marketClass: z.nativeEnum(HistoricalMarketClass),
  routeMode: routeModeSchema.optional(),
  venuePair: routeModeSchema.optional(),
  canonicalEventId: z.string().min(1).optional(),
  canonicalMarketId: z.string().optional(),
  side: orderSideSchema,
  requestedNotional: z.string().refine((value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0;
  }, "requestedNotional must be a positive decimal string"),
  from: isoDateSchema,
  to: isoDateSchema,
  strategyKey: z.string().min(1),
  dryRun: z.boolean()
}).refine((value) => value.routeMode !== undefined || value.venuePair !== undefined, {
  message: "routeMode is required",
  path: ["routeMode"]
}).refine((value) => !value.routeMode || !value.venuePair || value.routeMode === value.venuePair, {
  message: "routeMode and venuePair must match when both are provided",
  path: ["routeMode"]
}).refine((value) => new Date(value.from).getTime() < new Date(value.to).getTime(), {
  message: "from must be before to",
  path: ["to"]
});

const scopeResponseSchema = z.object({
  canonicalEventId: z.string().min(1),
  catalogScope: z.enum(HistoricalSimulationCatalogScopeValues),
  canonicalCategory: canonicalCategorySchema,
  marketClass: z.nativeEnum(HistoricalMarketClass),
  routeMode: routeModeSchema,
  coverageStart: isoDateSchema,
  coverageEnd: isoDateSchema,
  routeableMarketCount: z.number().int(),
  venueCoverage: z.object({
    polymarketRows: z.number().int(),
    limitlessRows: z.number().int(),
    opinionRows: z.number().int(),
    myriadRows: z.number().int(),
    predictRows: z.number().int()
  })
});

const routeabilitySummaryResponseSchema = z.object({
  filters: z.object({
    category: z.enum(["SPORTS", "CRYPTO", "POLITICS", "ESPORTS", "ALL"]),
    catalogScope: z.enum(["live", "historical_simulation", "ALL"]),
    marketClass: z.nativeEnum(HistoricalMarketClass).nullable()
  }),
  totals: z.object({
    eventCount: z.number().int(),
    canonicalMarketCount: z.number().int(),
    runnableSingleCount: z.number().int(),
    runnablePairCount: z.number().int(),
    runnableTriCount: z.number().int()
  }),
  routeModes: z.array(
    z.object({
      routeMode: routeModeSchema,
      label: z.string(),
      cardinality: z.enum(["single", "pair", "tri"]),
      routeableMarketCount: z.number().int(),
      eventCount: z.number().int()
    })
  ),
  blockReasons: z.array(
    z.object({
      reason: routeAvailabilityReasonSchema,
      count: z.number().int()
    })
  ),
  venueVisibility: z.object({
    polymarketEvents: z.number().int(),
    limitlessEvents: z.number().int(),
    opinionEvents: z.number().int(),
    myriadEvents: z.number().int(),
    predictEvents: z.number().int()
  }),
  opinionRouteability: z.object({
    eventsWithOpinionInventory: z.number().int(),
    eventsWithRunnableOpinionOnly: z.number().int(),
    eventsWithBlockedOpinionPairOrTri: z.number().int(),
    semanticsRulepackVersion: z.string().nullable(),
    exactLiveOnlyCount: z.number().int(),
    exactHistoricalQualifiedCount: z.number().int(),
    nearMissCount: z.number().int(),
    blockedUnsafeCandidateCount: z.number().int(),
    lowConfidenceCandidateCount: z.number().int(),
    dominantBlockReasons: z.array(
      z.object({
        reason: routeAvailabilityReasonSchema,
        count: z.number().int()
      })
    ),
    dominantNearMissDimensions: z.array(
      z.object({
        dimension: z.string(),
        count: z.number().int()
      })
    ),
    dominantNearMissReasons: z.array(
      z.object({
        reason: z.string(),
        count: z.number().int()
      })
    )
  }),
  predictRouteability: z.object({
    eventsWithPredictInventory: z.number().int(),
    eventsWithCurrentStateOnlyPredict: z.number().int(),
    eventsWithHistoricallyQualifiedPredict: z.number().int(),
    eventsWithBlockedPredictRoutes: z.number().int(),
    dominantBlockReasons: z.array(
      z.object({
        reason: routeAvailabilityReasonSchema,
        count: z.number().int()
      })
    )
  }),
  triRouteability: z.object({
    candidateCount: z.number().int(),
    runnableCount: z.number().int(),
    dominantBlockReasons: z.array(
      z.object({
        reason: routeAvailabilityReasonSchema,
        count: z.number().int()
      })
    )
  })
});

const runResponseSchema = z.object({
  id: z.string().uuid(),
  qualificationRunId: z.string().uuid().nullable(),
  scopeType: z.string(),
  scopeId: z.string(),
  routeMode: routeModeSchema,
  marketClass: z.nativeEnum(HistoricalMarketClass),
  startedAt: isoDateSchema,
  endedAt: isoDateSchema.nullable(),
  status: z.nativeEnum(HistoricalSimulationRunStatus),
  metadata: z.record(z.string(), z.unknown())
});

const simulationResultRowSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  canonicalEventId: z.string().min(1),
  timestamp: isoDateSchema,
  baselineResults: z.record(z.string(), z.unknown()),
  lotusResult: z.record(z.string(), z.unknown()),
  improvement: z.record(z.string(), z.unknown()),
  rolloutEligibility: z.record(z.string(), z.unknown()),
  createdAt: isoDateSchema
});

const simulationRunnerResultSchema = z.object({
  runId: z.string().uuid().nullable(),
  dryRun: z.boolean(),
  status: z.nativeEnum(HistoricalSimulationRunStatus),
  sliceResults: z.array(
    z.object({
      timestamp: isoDateSchema,
      baselineResults: z.record(z.string(), z.unknown()),
      lotusResult: z.record(z.string(), z.unknown()),
      improvement: z.record(z.string(), z.unknown()),
      rolloutEligibility: z.record(z.string(), z.unknown()),
      persistedResultId: z.string().uuid().nullable()
    })
  ),
  sliceCount: z.number().int(),
  persistedResultCount: z.number().int(),
  blockedSliceCount: z.number().int(),
  metadata: z.record(z.string(), z.unknown())
});

const canonicalCoverageResponseSchema = z.object({
  canonicalEventId: z.string().min(1),
  catalogScope: z.enum(HistoricalSimulationCatalogScopeValues),
  canonicalMarketId: z.string().nullable(),
  canonicalCategory: z.enum(["SPORTS", "CRYPTO", "POLITICS", "ESPORTS", "OTHER"]).nullable(),
  marketClass: z.nativeEnum(HistoricalMarketClass).nullable(),
  venueCoverage: z.array(
    z.object({
      venue: z.string(),
      rowCount: z.number().int(),
      coverageStart: isoDateSchema,
      coverageEnd: isoDateSchema
    })
  ),
  predictReadinessOverview: z.object({
    state: z.enum(PredictHistoricalReadinessStateValues),
    historicalQualified: z.boolean(),
    reasons: z.array(z.string()),
    recorderAccumulatingMarkets: z.number().int(),
    fallbackReadyMarkets: z.number().int(),
    nativeReadyMarkets: z.number().int(),
    currentStateOnlyMarkets: z.number().int(),
    unusableMarkets: z.number().int()
  }),
  pairedMarkets: z.array(
    z.object({
      venue: z.string(),
      venueMarketId: z.string(),
      title: z.string().nullable()
    })
  ),
  routeModeSummary: z.array(
    z.object({
      routeMode: routeModeSchema,
      label: z.string(),
      cardinality: z.enum(["single", "pair", "tri"]),
      routeableMarketCount: z.number().int(),
      hasAnyRoute: z.boolean()
    })
  ),
  hasTriVenueRoute: z.boolean(),
  triVenueRouteableMarketCount: z.number().int(),
  canonicalMarkets: z.array(
    z.object({
      canonicalMarketId: z.string(),
      isRunnable: z.boolean(),
      runnableRouteModes: z.array(routeModeSchema),
      venues: z.array(
        z.object({
          venue: z.string(),
          venueMarketId: z.string(),
          title: z.string().nullable()
        })
      ),
      routeModes: z.array(
        z.object({
          routeMode: routeModeSchema,
          label: z.string(),
          cardinality: z.enum(["single", "pair", "tri"]),
          requiredVenues: z.array(z.string()),
          runnable: z.boolean(),
          reason: z.enum([
            "missing_required_venue",
            "missing_historical_rows",
            "missing_pair_assessment",
            "incomplete_resolution_risk",
            "stale_resolution_risk",
            "unsafe_equivalence",
            "ambiguous_venue_identity",
            "opinion_historically_unqualified",
            "predict_historically_unqualified"
          ]).nullable()
        })
      ),
      opinionExactMatch: z.object({
        classification: z.enum([
          "semantic_exact_historical_qualified",
          "semantic_exact_live_only",
          "semantic_near_exact",
          "proxy_or_mismatch",
          "unresolved_no_candidate"
        ]),
        historicalQualified: z.boolean(),
        reason: z.string().nullable()
      }).nullable().optional(),
      predictReadiness: z.object({
        state: z.enum(PredictHistoricalReadinessStateValues),
        historicalQualified: z.boolean(),
        reason: z.string().nullable(),
        environments: z.array(z.enum(["mainnet", "testnet"])),
        currentStateRowCount: z.number().int(),
        nativeOrderbookSnapshotCount: z.number().int(),
        nativeMatchEventCount: z.number().int(),
        recorderCheckpointCount: z.number().int(),
        fallbackSnapshotCount: z.number().int(),
        fallbackCoveredWindowCount: z.number().int()
      }).nullable().optional()
    })
  ),
  resolutionRiskInspection: z.object({
    canonicalEventId: z.string().min(1),
    profiles: z.array(z.record(z.string(), z.unknown())),
    assessments: z.array(z.record(z.string(), z.unknown())),
    scoringVersion: z.string(),
    freshness: z.object({
      profileCount: z.number().int(),
      expectedPairCount: z.number().int(),
      persistedPairCount: z.number().int(),
      lastComputedAt: isoDateSchema.nullable(),
      latestProfileUpdatedAt: isoDateSchema.nullable(),
      isComplete: z.boolean(),
      isStale: z.boolean(),
      hasMixedVersions: z.boolean()
    })
  }),
  ambiguity: z.record(z.string(), z.object({
    isAmbiguous: z.boolean(),
    count: z.number().int(),
    markets: z.array(z.string())
  }))
});

export interface AdminSimulationRouteDeps {
  simulationAdminService: SimulationAdminService;
}

const resolveRouteModeInput = (
  value: { routeMode?: HistoricalSimulationRouteMode | undefined; venuePair?: HistoricalSimulationRouteMode | undefined }
): HistoricalSimulationRouteMode | undefined =>
  value.routeMode ?? value.venuePair;

export const registerAdminSimulationRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminSimulationRouteDeps
): Promise<void> => {
  app.get("/admin/simulation/scopes", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedQuery = scopeQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedQuery.error.flatten() });
    }

    try {
      const resolvedRouteMode = resolveRouteModeInput(parsedQuery.data);
      const scopes = await deps.simulationAdminService.listScopes({
        ...(parsedQuery.data.category ? { category: parsedQuery.data.category } : {}),
        ...(parsedQuery.data.marketClass ? { marketClass: parsedQuery.data.marketClass } : {}),
        ...(parsedQuery.data.catalogScope ? { catalogScope: parsedQuery.data.catalogScope } : {}),
        ...(resolvedRouteMode ? { routeMode: resolvedRouteMode } : {})
      });
      return reply.send({
        scopes: z.array(scopeResponseSchema).parse(scopes.map(serializeScope))
      });
    } catch (error) {
      app.log.error({ err: error, filters: parsedQuery.data }, "Failed to list simulation scopes.");
      return reply.status(500).send({ code: "SIMULATION_ADMIN_ERROR", message: "Failed to list simulation scopes." });
    }
  });

  app.get("/admin/simulation/routeability-summary", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedQuery = routeabilitySummaryQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedQuery.error.flatten() });
    }

    try {
      const summary = await deps.simulationAdminService.getRouteabilitySummary({
        ...(parsedQuery.data.category ? { category: parsedQuery.data.category } : {}),
        ...(parsedQuery.data.marketClass ? { marketClass: parsedQuery.data.marketClass } : {}),
        ...(parsedQuery.data.catalogScope ? { catalogScope: parsedQuery.data.catalogScope } : {})
      });
      return reply.send({
        summary: routeabilitySummaryResponseSchema.parse(summary)
      });
    } catch (error) {
      app.log.error({ err: error, filters: parsedQuery.data }, "Failed to load routeability summary.");
      return reply.status(500).send({ code: "SIMULATION_ADMIN_ERROR", message: "Failed to load routeability summary." });
    }
  });

  app.post("/admin/simulation/run", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedBody = runBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedBody.error.flatten() });
    }

    try {
      const routeMode = resolveRouteModeInput(parsedBody.data);
      const result = await deps.simulationAdminService.runSimulation({
        marketClass: parsedBody.data.marketClass,
        routeMode: routeMode as typeof HistoricalSimulationRouteModeValues[number],
        ...(parsedBody.data.canonicalEventId ? { canonicalEventId: parsedBody.data.canonicalEventId } : {}),
        ...(parsedBody.data.canonicalMarketId ? { canonicalMarketId: parsedBody.data.canonicalMarketId } : {}),
        side: parsedBody.data.side,
        requestedNotional: parsedBody.data.requestedNotional,
        from: new Date(parsedBody.data.from),
        to: new Date(parsedBody.data.to),
        strategyKey: parsedBody.data.strategyKey,
        dryRun: parsedBody.data.dryRun
      });

      return reply.send({
        run: result.run ? runResponseSchema.parse(serializeRun(result.run)) : null,
        simulationResult: simulationRunnerResultSchema.parse(serializeSimulationRunnerResult(result.simulationResult))
      });
    } catch (error) {
      if (error instanceof SimulationAdminConflictError) {
        return reply.status(409).send({ code: "SIMULATION_SCOPE_CONFLICT", message: error.message });
      }
      if (error instanceof SimulationCanonicalCoverageNotFoundError) {
        return reply.status(404).send({ code: "SIMULATION_CANONICAL_COVERAGE_NOT_FOUND", message: error.message });
      }
      if (error instanceof Error && error.name === "HistoricalSimulationRunnerError") {
        return reply.status(400).send({ code: "SIMULATION_RUNNER_ERROR", message: error.message });
      }
      app.log.error({ err: error, body: parsedBody.data }, "Failed to trigger historical simulation run.");
      return reply.status(500).send({ code: "SIMULATION_ADMIN_ERROR", message: "Failed to trigger historical simulation run." });
    }
  });

  app.get("/admin/simulation/run/:id", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedParams.error.flatten() });
    }

    try {
      const run = await deps.simulationAdminService.getRun(parsedParams.data.id);
      return reply.send({ run: runResponseSchema.parse(serializeRun(run)) });
    } catch (error) {
      if (error instanceof SimulationRunNotFoundError) {
        return reply.status(404).send({ code: "SIMULATION_RUN_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error, runId: parsedParams.data.id }, "Failed to load historical simulation run.");
      return reply.status(500).send({ code: "SIMULATION_ADMIN_ERROR", message: "Failed to load historical simulation run." });
    }
  });

  app.get("/admin/simulation/run/:id/results", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedParams.error.flatten() });
    }

    try {
      const results = await deps.simulationAdminService.listRunResults(parsedParams.data.id);
      return reply.send({
        results: z.array(simulationResultRowSchema).parse(results.map(serializeResult))
      });
    } catch (error) {
      if (error instanceof SimulationRunNotFoundError) {
        return reply.status(404).send({ code: "SIMULATION_RUN_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error, runId: parsedParams.data.id }, "Failed to list historical simulation results.");
      return reply.status(500).send({ code: "SIMULATION_ADMIN_ERROR", message: "Failed to list historical simulation results." });
    }
  });

  app.get("/admin/simulation/canonical/:eventId", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = canonicalParamsSchema.safeParse(request.params);
    const parsedQuery = canonicalQuerySchema.safeParse(request.query);
    if (!parsedParams.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedParams.error.flatten() });
    }
    if (!parsedQuery.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedQuery.error.flatten() });
    }

    try {
      const coverage = await deps.simulationAdminService.getCanonicalCoverage(
        parsedParams.data.eventId,
        parsedQuery.data.canonicalMarketId
      );
      return reply.send(canonicalCoverageResponseSchema.parse(serializeCanonicalCoverage(coverage)));
    } catch (error) {
      if (error instanceof SimulationCanonicalCoverageNotFoundError) {
        return reply.status(404).send({ code: "SIMULATION_CANONICAL_COVERAGE_NOT_FOUND", message: error.message });
      }
      app.log.error(
        { err: error, canonicalEventId: parsedParams.data.eventId, canonicalMarketId: parsedQuery.data.canonicalMarketId },
        "Failed to load simulation canonical coverage."
      );
      return reply.status(500).send({ code: "SIMULATION_ADMIN_ERROR", message: "Failed to load simulation canonical coverage." });
    }
  });
};

const serializeRun = (run: {
  id: string;
  qualificationRunId: string | null;
  scopeType: string;
  scopeId: string;
  routeMode: typeof HistoricalSimulationRouteModeValues[number];
  marketClass: HistoricalMarketClass;
  startedAt: Date;
  endedAt: Date | null;
  status: HistoricalSimulationRunStatus;
  metadata: Record<string, unknown>;
}) => ({
  ...run,
  startedAt: run.startedAt.toISOString(),
  endedAt: run.endedAt ? run.endedAt.toISOString() : null
});

const serializeScope = (scope: {
  canonicalEventId: string;
  catalogScope: typeof HistoricalSimulationCatalogScopeValues[number];
  canonicalCategory: "SPORTS" | "CRYPTO" | "POLITICS" | "ESPORTS";
  marketClass: HistoricalMarketClass;
  routeMode: typeof HistoricalSimulationRouteModeValues[number];
  coverageStart: Date;
  coverageEnd: Date;
  routeableMarketCount: number;
  venueCoverage: { polymarketRows: number; limitlessRows: number; opinionRows: number; myriadRows: number; predictRows: number };
}) => ({
  ...scope,
  coverageStart: scope.coverageStart.toISOString(),
  coverageEnd: scope.coverageEnd.toISOString()
});

const serializeResult = (result: {
  id: string;
  runId: string;
  canonicalEventId: string;
  timestamp: Date;
  baselineResults: Record<string, unknown>;
  lotusResult: Record<string, unknown>;
  improvement: Record<string, unknown>;
  rolloutEligibility: Record<string, unknown>;
  createdAt: Date;
}) => ({
  ...result,
  timestamp: result.timestamp.toISOString(),
  createdAt: result.createdAt.toISOString()
});

const serializeSimulationRunnerResult = (result: {
  runId: string | null;
  dryRun: boolean;
  status: HistoricalSimulationRunStatus;
  sliceResults: ReadonlyArray<{
    timestamp: Date;
    baselineResults: Record<string, unknown>;
    lotusResult: Record<string, unknown>;
    improvement: Record<string, unknown>;
    rolloutEligibility: Record<string, unknown>;
    persistedResultId: string | null;
  }>;
  sliceCount: number;
  persistedResultCount: number;
  blockedSliceCount: number;
  metadata: Record<string, unknown>;
}) => ({
  ...result,
  sliceResults: result.sliceResults.map((slice) => ({
    ...slice,
    timestamp: slice.timestamp.toISOString()
  }))
});

const serializeCanonicalCoverage = (coverage: {
  canonicalEventId: string;
  catalogScope: typeof HistoricalSimulationCatalogScopeValues[number];
  canonicalMarketId: string | null;
  canonicalCategory: "SPORTS" | "CRYPTO" | "POLITICS" | "ESPORTS" | "OTHER" | null;
  marketClass: HistoricalMarketClass | null;
  venueCoverage: ReadonlyArray<{ venue: string; rowCount: number; coverageStart: Date; coverageEnd: Date }>;
  predictReadinessOverview: {
    state: (typeof PredictHistoricalReadinessStateValues)[number];
    historicalQualified: boolean;
    reasons: readonly string[];
    recorderAccumulatingMarkets: number;
    fallbackReadyMarkets: number;
    nativeReadyMarkets: number;
    currentStateOnlyMarkets: number;
    unusableMarkets: number;
  };
  pairedMarkets: ReadonlyArray<{ venue: string; venueMarketId: string; title: string | null }>;
  routeModeSummary: ReadonlyArray<{
    routeMode: typeof HistoricalSimulationRouteModeValues[number];
    label: string;
    cardinality: "single" | "pair" | "tri";
    routeableMarketCount: number;
    hasAnyRoute: boolean;
  }>;
  hasTriVenueRoute: boolean;
  triVenueRouteableMarketCount: number;
  canonicalMarkets: ReadonlyArray<{
    canonicalMarketId: string;
    isRunnable: boolean;
    runnableRouteModes: ReadonlyArray<typeof HistoricalSimulationRouteModeValues[number]>;
    venues: ReadonlyArray<{ venue: string; venueMarketId: string; title: string | null }>;
    routeModes: ReadonlyArray<{
      routeMode: typeof HistoricalSimulationRouteModeValues[number];
      label: string;
      cardinality: "single" | "pair" | "tri";
      requiredVenues: readonly string[];
      runnable: boolean;
      reason:
        | "missing_required_venue"
        | "missing_historical_rows"
        | "missing_pair_assessment"
        | "incomplete_resolution_risk"
        | "stale_resolution_risk"
        | "unsafe_equivalence"
        | "ambiguous_venue_identity"
        | "opinion_historically_unqualified"
        | "predict_historically_unqualified"
        | null;
    }>;
    opinionExactMatch?: {
      classification:
        | "semantic_exact_historical_qualified"
        | "semantic_exact_live_only"
        | "semantic_near_exact"
        | "proxy_or_mismatch"
        | "unresolved_no_candidate";
      historicalQualified: boolean;
      reason: string | null;
    } | null;
    predictReadiness?: {
      state: (typeof PredictHistoricalReadinessStateValues)[number];
      historicalQualified: boolean;
      reason: string | null;
      environments: readonly ("mainnet" | "testnet")[];
      currentStateRowCount: number;
      nativeOrderbookSnapshotCount: number;
      nativeMatchEventCount: number;
      recorderCheckpointCount: number;
      fallbackSnapshotCount: number;
      fallbackCoveredWindowCount: number;
    } | null;
  }>;
  resolutionRiskInspection: {
    canonicalEventId: string;
    profiles: ReadonlyArray<unknown>;
    assessments: ReadonlyArray<unknown>;
    scoringVersion: string;
    freshness: {
      profileCount: number;
      expectedPairCount: number;
      persistedPairCount: number;
      lastComputedAt: Date | null;
      latestProfileUpdatedAt: Date | null;
      isComplete: boolean;
      isStale: boolean;
      hasMixedVersions: boolean;
    };
  };
  ambiguity: Record<string, { isAmbiguous: boolean; count: number; markets: string[] }>;
}) => ({
  ...coverage,
  venueCoverage: coverage.venueCoverage.map((entry) => ({
    ...entry,
    coverageStart: entry.coverageStart.toISOString(),
    coverageEnd: entry.coverageEnd.toISOString()
  })),
  canonicalMarkets: coverage.canonicalMarkets.map((market) => ({
    ...market,
    predictReadiness: market.predictReadiness ?? null
  })),
  resolutionRiskInspection: {
    ...coverage.resolutionRiskInspection,
    profiles: JSON.parse(JSON.stringify(coverage.resolutionRiskInspection.profiles)) as Record<string, unknown>[],
    assessments: JSON.parse(JSON.stringify(coverage.resolutionRiskInspection.assessments)) as Record<string, unknown>[],
    freshness: {
      ...coverage.resolutionRiskInspection.freshness,
      lastComputedAt: coverage.resolutionRiskInspection.freshness.lastComputedAt
        ? coverage.resolutionRiskInspection.freshness.lastComputedAt.toISOString()
        : null,
      latestProfileUpdatedAt: coverage.resolutionRiskInspection.freshness.latestProfileUpdatedAt
        ? coverage.resolutionRiskInspection.freshness.latestProfileUpdatedAt.toISOString()
        : null
    }
  },
  ambiguity: coverage.ambiguity
});
