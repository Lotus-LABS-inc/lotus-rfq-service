import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import {
  SimulationAdminConflictError,
  SimulationAdminService,
  SimulationCanonicalCoverageNotFoundError,
  SimulationRunNotFoundError
} from "./simulation-admin-service.js";
import { HistoricalMarketClass, HistoricalSimulationRunStatus } from "../../core/historical-simulation/historical-simulation.types.js";

const paramsSchema = z.object({
  id: z.string().uuid()
});

const canonicalParamsSchema = z.object({
  eventId: z.string().uuid()
});

const scopeQuerySchema = z.object({
  category: z.enum(["SPORTS", "CRYPTO"]).optional(),
  marketClass: z.nativeEnum(HistoricalMarketClass).optional()
});

const isoDateSchema = z.string().datetime({ offset: true });

const runBodySchema = z.object({
  marketClass: z.nativeEnum(HistoricalMarketClass),
  venuePair: z.string().min(1),
  canonicalEventId: z.string().uuid().optional(),
  from: isoDateSchema,
  to: isoDateSchema,
  strategyKey: z.string().min(1),
  dryRun: z.boolean()
}).refine((value) => new Date(value.from).getTime() < new Date(value.to).getTime(), {
  message: "from must be before to",
  path: ["to"]
});

const scopeResponseSchema = z.object({
  canonicalEventId: z.string().uuid(),
  canonicalCategory: z.enum(["SPORTS", "CRYPTO"]),
  marketClass: z.nativeEnum(HistoricalMarketClass),
  venuePair: z.literal("POLYMARKET_LIMITLESS"),
  coverageStart: isoDateSchema,
  coverageEnd: isoDateSchema,
  venueCoverage: z.object({
    polymarketRows: z.number().int(),
    limitlessRows: z.number().int()
  })
});

const runResponseSchema = z.object({
  id: z.string().uuid(),
  qualificationRunId: z.string().uuid().nullable(),
  scopeType: z.string(),
  scopeId: z.string(),
  venuePair: z.string(),
  marketClass: z.nativeEnum(HistoricalMarketClass),
  startedAt: isoDateSchema,
  endedAt: isoDateSchema.nullable(),
  status: z.nativeEnum(HistoricalSimulationRunStatus),
  metadata: z.record(z.string(), z.unknown())
});

const simulationResultRowSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  canonicalEventId: z.string().uuid(),
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
  canonicalEventId: z.string().uuid(),
  canonicalCategory: z.enum(["SPORTS", "CRYPTO", "OTHER"]).nullable(),
  marketClass: z.nativeEnum(HistoricalMarketClass).nullable(),
  venueCoverage: z.array(
    z.object({
      venue: z.string(),
      rowCount: z.number().int(),
      coverageStart: isoDateSchema,
      coverageEnd: isoDateSchema
    })
  ),
  pairedMarkets: z.array(
    z.object({
      venue: z.string(),
      venueMarketId: z.string(),
      title: z.string().nullable()
    })
  ),
  resolutionRiskInspection: z.object({
    canonicalEventId: z.string().uuid(),
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
  })
});

export interface AdminSimulationRouteDeps {
  simulationAdminService: SimulationAdminService;
}

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
      const scopes = await deps.simulationAdminService.listScopes({
        ...(parsedQuery.data.category ? { category: parsedQuery.data.category } : {}),
        ...(parsedQuery.data.marketClass ? { marketClass: parsedQuery.data.marketClass } : {})
      });
      return reply.send({
        scopes: z.array(scopeResponseSchema).parse(scopes.map(serializeScope))
      });
    } catch (error) {
      app.log.error({ err: error, filters: parsedQuery.data }, "Failed to list simulation scopes.");
      return reply.status(500).send({ code: "SIMULATION_ADMIN_ERROR", message: "Failed to list simulation scopes." });
    }
  });

  app.post("/admin/simulation/run", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedBody = runBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedBody.error.flatten() });
    }

    try {
      const result = await deps.simulationAdminService.runSimulation({
        marketClass: parsedBody.data.marketClass,
        venuePair: parsedBody.data.venuePair,
        ...(parsedBody.data.canonicalEventId ? { canonicalEventId: parsedBody.data.canonicalEventId } : {}),
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
    if (!parsedParams.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedParams.error.flatten() });
    }

    try {
      const coverage = await deps.simulationAdminService.getCanonicalCoverage(parsedParams.data.eventId);
      return reply.send(canonicalCoverageResponseSchema.parse(serializeCanonicalCoverage(coverage)));
    } catch (error) {
      if (error instanceof SimulationCanonicalCoverageNotFoundError) {
        return reply.status(404).send({ code: "SIMULATION_CANONICAL_COVERAGE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error, canonicalEventId: parsedParams.data.eventId }, "Failed to load simulation canonical coverage.");
      return reply.status(500).send({ code: "SIMULATION_ADMIN_ERROR", message: "Failed to load simulation canonical coverage." });
    }
  });
};

const serializeRun = (run: {
  id: string;
  qualificationRunId: string | null;
  scopeType: string;
  scopeId: string;
  venuePair: string;
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
  canonicalCategory: "SPORTS" | "CRYPTO";
  marketClass: HistoricalMarketClass;
  venuePair: "POLYMARKET_LIMITLESS";
  coverageStart: Date;
  coverageEnd: Date;
  venueCoverage: { polymarketRows: number; limitlessRows: number };
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
  canonicalCategory: "SPORTS" | "CRYPTO" | "OTHER" | null;
  marketClass: HistoricalMarketClass | null;
  venueCoverage: ReadonlyArray<{ venue: string; rowCount: number; coverageStart: Date; coverageEnd: Date }>;
  pairedMarkets: ReadonlyArray<{ venue: string; venueMarketId: string; title: string | null }>;
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
}) => ({
  ...coverage,
  venueCoverage: coverage.venueCoverage.map((entry) => ({
    ...entry,
    coverageStart: entry.coverageStart.toISOString(),
    coverageEnd: entry.coverageEnd.toISOString()
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
  }
});
