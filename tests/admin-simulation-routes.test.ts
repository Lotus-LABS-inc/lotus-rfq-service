import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerAdminSimulationRoutes } from "../src/api/admin/simulation.routes.js";
import { HistoricalMarketClass, HistoricalSimulationRunStatus } from "../src/core/historical-simulation/historical-simulation.types.js";
import {
  SimulationAdminConflictError,
  SimulationCanonicalCoverageNotFoundError,
  SimulationRunNotFoundError,
  type SimulationAdminService
} from "../src/api/admin/simulation-admin-service.js";

describe("Admin Simulation Routes", () => {
  const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const canonicalEventId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  const buildApp = async (adminMiddleware: preHandlerHookHandler) => {
    const app = Fastify({ logger: false });

    const simulationAdminService: SimulationAdminService = {
      listScopes: vi.fn(async () => ([
        {
          canonicalEventId,
          catalogScope: "live",
          canonicalCategory: "SPORTS",
          marketClass: HistoricalMarketClass.BINARY,
          routeMode: "POLYMARKET_LIMITLESS",
          coverageStart: new Date("2026-03-13T00:00:00.000Z"),
          coverageEnd: new Date("2026-03-13T01:00:00.000Z"),
          routeableMarketCount: 1,
          venueCoverage: { polymarketRows: 10, limitlessRows: 8, opinionRows: 0, myriadRows: 0 }
        }
      ])),
      runSimulation: vi.fn(async () => ({
        run: {
          id: runId,
          qualificationRunId: null,
          scopeType: "CANONICAL_EVENT",
          scopeId: canonicalEventId,
          routeMode: "POLYMARKET_LIMITLESS",
          marketClass: HistoricalMarketClass.BINARY,
          startedAt: new Date("2026-03-13T02:00:00.000Z"),
          endedAt: null,
          status: HistoricalSimulationRunStatus.RUNNING,
          metadata: { strategyKey: "strategy.sim.v1" }
        },
        simulationResult: {
          runId,
          dryRun: false,
          status: HistoricalSimulationRunStatus.RUNNING,
          sliceResults: [],
          sliceCount: 0,
          persistedResultCount: 0,
          blockedSliceCount: 0,
          metadata: {}
        }
      })),
      getRun: vi.fn(async () => ({
        id: runId,
        qualificationRunId: null,
        scopeType: "CANONICAL_EVENT",
        scopeId: canonicalEventId,
        routeMode: "POLYMARKET_LIMITLESS",
        marketClass: HistoricalMarketClass.BINARY,
        startedAt: new Date("2026-03-13T02:00:00.000Z"),
        endedAt: null,
        status: HistoricalSimulationRunStatus.RUNNING,
        metadata: {}
      })),
      listRunResults: vi.fn(async () => ([{
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        runId,
        canonicalEventId,
        timestamp: new Date("2026-03-13T02:00:00.000Z"),
        baselineResults: {},
        lotusResult: {},
        improvement: {},
        rolloutEligibility: {},
        createdAt: new Date("2026-03-13T02:00:01.000Z")
      }])),
      getCanonicalCoverage: vi.fn(async () => ({
        canonicalEventId,
        catalogScope: "live",
        canonicalMarketId: null,
        canonicalCategory: "SPORTS",
        marketClass: HistoricalMarketClass.BINARY,
        venueCoverage: [{
          venue: "LIMITLESS",
          rowCount: 8,
          coverageStart: new Date("2026-03-13T00:00:00.000Z"),
          coverageEnd: new Date("2026-03-13T01:00:00.000Z")
        }],
        resolutionRiskInspection: {
          canonicalEventId,
          profiles: [],
          assessments: [],
          scoringVersion: "resolution-risk-v1",
          freshness: {
            profileCount: 2,
            expectedPairCount: 1,
            persistedPairCount: 1,
            lastComputedAt: new Date("2026-03-13T01:30:00.000Z"),
            latestProfileUpdatedAt: new Date("2026-03-13T01:00:00.000Z"),
            isComplete: true,
            isStale: false,
            hasMixedVersions: false
          }
        },
        pairedMarkets: [
          { venue: "LIMITLESS", venueMarketId: "limitless-sports-m1", title: "Sports Market" },
          { venue: "POLYMARKET", venueMarketId: "polymarket-sports-m1", title: "Sports Market" }
        ],
        canonicalMarkets: [
          {
            canonicalMarketId: "POLYMARKET-NBA-LAL-ORL-2026-03-21-LAKERS-WIN",
            isRunnable: true,
            runnableRouteModes: ["POLYMARKET_ONLY", "LIMITLESS_ONLY", "POLYMARKET_LIMITLESS"],
            venues: [
              { venue: "LIMITLESS", venueMarketId: "limitless-sports-m1", title: "Sports Market" },
              { venue: "POLYMARKET", venueMarketId: "polymarket-sports-m1", title: "Sports Market" }
            ],
            routeModes: [
              {
                routeMode: "POLYMARKET_ONLY",
                label: "Predexon Only",
                cardinality: "single",
                requiredVenues: ["POLYMARKET"],
                runnable: true,
                reason: null
              },
              {
                routeMode: "LIMITLESS_ONLY",
                label: "Limitless Only",
                cardinality: "single",
                requiredVenues: ["LIMITLESS"],
                runnable: true,
                reason: null
              },
              {
                routeMode: "MYRIAD_ONLY",
                label: "Myriad Only",
                cardinality: "single",
                requiredVenues: ["MYRIAD"],
                runnable: false,
                reason: "missing_required_venue"
              },
              {
                routeMode: "POLYMARKET_LIMITLESS",
                label: "Predexon + Limitless",
                cardinality: "pair",
                requiredVenues: ["POLYMARKET", "LIMITLESS"],
                runnable: true,
                reason: null
              }
            ]
          }
        ],
        routeModeSummary: [
          {
            routeMode: "POLYMARKET_LIMITLESS",
            label: "Predexon + Limitless",
            cardinality: "pair",
            routeableMarketCount: 1,
            hasAnyRoute: true
          }
        ],
        hasTriVenueRoute: false,
        triVenueRouteableMarketCount: 0,
        ambiguity: {}
      })),
    } as unknown as SimulationAdminService;

    await registerAdminSimulationRoutes(app, adminMiddleware, { simulationAdminService });
    return { app, simulationAdminService };
  };

  it("enforces admin auth on all routes", async () => {
    const rejectingAdmin: preHandlerHookHandler = async (_request, reply) =>
      reply.status(403).send({ code: "FORBIDDEN" });
    const { app } = await buildApp(rejectingAdmin);

    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/admin/simulation/scopes" }),
      app.inject({
        method: "POST",
        url: "/admin/simulation/run",
        payload: {
          marketClass: "BINARY",
          routeMode: "POLYMARKET_LIMITLESS",
          canonicalEventId,
          side: "BUY",
          requestedNotional: "100",
          from: "2026-03-13T00:00:00.000Z",
          to: "2026-03-13T01:00:00.000Z",
          strategyKey: "strategy.sim.v1",
          dryRun: false
        }
      }),
      app.inject({ method: "GET", url: `/admin/simulation/run/${runId}` }),
      app.inject({ method: "GET", url: `/admin/simulation/run/${runId}/results` }),
      app.inject({ method: "GET", url: `/admin/simulation/canonical/${canonicalEventId}` })
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(403);
    }

    await app.close();
  });

  it("propagates unauthenticated middleware failures", async () => {
    const unauthenticated: preHandlerHookHandler = async (_request, reply) =>
      reply.status(401).send({ code: "UNAUTHORIZED" });
    const { app } = await buildApp(unauthenticated);

    const response = await app.inject({ method: "GET", url: "/admin/simulation/scopes" });
    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it("validates request bodies and params", async () => {
    const passThroughAdmin: preHandlerHookHandler = async () => {};
    const { app } = await buildApp(passThroughAdmin);

    const invalidRun = await app.inject({
      method: "POST",
      url: "/admin/simulation/run",
      payload: {
        marketClass: "BINARY",
        routeMode: "POLYMARKET_LIMITLESS",
        side: "BUY",
        requestedNotional: "100",
        from: "2026-03-13T01:00:00.000Z",
        to: "2026-03-13T00:00:00.000Z",
        strategyKey: "",
        dryRun: false
      }
    });
    expect(invalidRun.statusCode).toBe(400);

    const invalidRunId = await app.inject({ method: "GET", url: "/admin/simulation/run/not-a-uuid" });
    expect(invalidRunId.statusCode).toBe(400);

    const validHistoricalEventId = await app.inject({ method: "GET", url: "/admin/simulation/canonical/HISTSIM::demo-market" });
    expect(validHistoricalEventId.statusCode).toBe(200);

    await app.close();
  });

  it("delegates to the service and maps conflict/not-found errors", async () => {
    const passThroughAdmin: preHandlerHookHandler = async () => {};
    const { app, simulationAdminService } = await buildApp(passThroughAdmin);

    const scopes = await app.inject({ method: "GET", url: "/admin/simulation/scopes?category=SPORTS&marketClass=BINARY" });
    expect(scopes.statusCode).toBe(200);

    const triVenueScopes = await app.inject({
      method: "GET",
      url: "/admin/simulation/scopes?category=SPORTS&marketClass=BINARY&routeMode=POLYMARKET_LIMITLESS_OPINION"
    });
    expect(triVenueScopes.statusCode).toBe(200);
    expect(
      (simulationAdminService as unknown as { listScopes: ReturnType<typeof vi.fn> }).listScopes
    ).toHaveBeenCalledWith({
      category: "SPORTS",
      marketClass: HistoricalMarketClass.BINARY,
      routeMode: "POLYMARKET_LIMITLESS_OPINION"
    });

    const run = await app.inject({
      method: "POST",
      url: "/admin/simulation/run",
      payload: {
        marketClass: "BINARY",
        routeMode: "POLYMARKET_LIMITLESS",
        canonicalEventId,
        side: "BUY",
        requestedNotional: "100",
        from: "2026-03-13T00:00:00.000Z",
        to: "2026-03-13T01:00:00.000Z",
        strategyKey: "strategy.sim.v1",
        dryRun: false
      }
    });
    expect(run.statusCode).toBe(200);

    (simulationAdminService as unknown as { runSimulation: ReturnType<typeof vi.fn> }).runSimulation.mockRejectedValueOnce(
      new SimulationAdminConflictError("ambiguous scope")
    );
    const conflict = await app.inject({
      method: "POST",
      url: "/admin/simulation/run",
      payload: {
        marketClass: "BINARY",
        routeMode: "POLYMARKET_LIMITLESS",
        side: "BUY",
        requestedNotional: "100",
        from: "2026-03-13T00:00:00.000Z",
        to: "2026-03-13T01:00:00.000Z",
        strategyKey: "strategy.sim.v1",
        dryRun: true
      }
    });
    expect(conflict.statusCode).toBe(409);

    (simulationAdminService as unknown as { getRun: ReturnType<typeof vi.fn> }).getRun.mockRejectedValueOnce(
      new SimulationRunNotFoundError(runId)
    );
    const missingRun = await app.inject({ method: "GET", url: `/admin/simulation/run/${runId}` });
    expect(missingRun.statusCode).toBe(404);

    (simulationAdminService as unknown as { getCanonicalCoverage: ReturnType<typeof vi.fn> }).getCanonicalCoverage.mockRejectedValueOnce(
      new SimulationCanonicalCoverageNotFoundError(canonicalEventId)
    );
    const missingCoverage = await app.inject({ method: "GET", url: `/admin/simulation/canonical/${canonicalEventId}` });
    expect(missingCoverage.statusCode).toBe(404);

    await app.inject({ method: "GET", url: `/admin/simulation/canonical/${canonicalEventId}?canonicalMarketId=LIMITLESS-BTC-ABOVE-90K` });
    expect(
      (simulationAdminService as unknown as { getCanonicalCoverage: ReturnType<typeof vi.fn> }).getCanonicalCoverage
    ).toHaveBeenCalledWith(canonicalEventId, "LIMITLESS-BTC-ABOVE-90K");

    await app.close();
  });
});
