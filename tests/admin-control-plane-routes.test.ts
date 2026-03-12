import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerAdminControlPlaneRoutes } from "../src/api/admin/control-plane.routes.js";
import {
  ControlPlaneBucketNotFoundError,
  ControlPlaneOverrideValidationError,
  ControlPlaneShardNotFoundError,
  ReplayEnvelopeNotFoundError,
  type ControlPlaneAdminService,
} from "../src/api/admin/control-plane-admin-service.js";

describe("Admin Control Plane Routes", () => {
  const shardId = "planner-shard-a";
  const bucketId = "bucket-alpha";
  const envelopeId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  const buildApp = async (adminMiddleware: preHandlerHookHandler) => {
    const app = Fastify({ logger: false });

    const controlPlaneAdminService: ControlPlaneAdminService = {
      listShards: vi.fn(async () => ([
        {
          shardId,
          mode: "NORMAL",
          activePlans: 2,
          activeBuckets: 1,
          staleReservations: 0,
          avgPlannerLatencyMs: "12.5",
          updatedAt: new Date("2026-03-11T00:00:00.000Z"),
        },
      ])),
      getShard: vi.fn(async () => ({
        shardId,
        mode: "NORMAL",
        activePlans: 2,
        activeBuckets: 1,
        staleReservations: 0,
        avgPlannerLatencyMs: "12.5",
        updatedAt: new Date("2026-03-11T00:00:00.000Z"),
      })),
      listBuckets: vi.fn(async (_filters?: unknown) => ([
        {
          bucketId,
          bucketType: "CLEARING",
          mode: "DEGRADED",
          entityCount: 11,
          graphDensity: "0.32",
          degradationReason: "density_guardrail",
          updatedAt: new Date("2026-03-11T00:00:00.000Z"),
        },
      ])),
      getBucket: vi.fn(async () => ({
        bucketId,
        bucketType: "CLEARING",
        mode: "DEGRADED",
        entityCount: 11,
        graphDensity: "0.32",
        degradationReason: "density_guardrail",
        updatedAt: new Date("2026-03-11T00:00:00.000Z"),
      })),
      listActiveOverrides: vi.fn(async () => ([
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          scopeType: "bucket",
          scopeId: bucketId,
          overrideType: "READ_ONLY",
          payload: { throttle: true },
          createdBy: "ops-admin",
          createdAt: new Date("2026-03-11T00:00:00.000Z"),
          expiresAt: null,
        },
      ])),
      getReplayEnvelopeMetadata: vi.fn(async () => ({
        id: envelopeId,
        decisionType: "SOR_PLAN",
        entityId: "rfq-123",
        correlationId: "corr-123",
        configVersion: "planner-v1",
        engineVersion: "sor-v1",
        createdAt: new Date("2026-03-11T00:00:00.000Z"),
      })),
      pauseBucket: vi.fn(async (_bucketId: string, _requestedBy: string) => ({
        bucketId,
        bucketType: "CLEARING",
        mode: "PAUSED",
        entityCount: 11,
        graphDensity: "0.32",
        degradationReason: "operator_pause",
        updatedAt: new Date("2026-03-11T00:00:00.000Z"),
      })),
      drainBucket: vi.fn(async (_bucketId: string, _requestedBy: string) => ({
        bucketId,
        bucketType: "CLEARING",
        mode: "DRAINING",
        entityCount: 11,
        graphDensity: "0.32",
        degradationReason: "operator_drain",
        updatedAt: new Date("2026-03-11T00:00:00.000Z"),
      })),
      pauseShard: vi.fn(async (_shardId: string, _requestedBy: string) => ({
        shardId,
        mode: "PAUSED",
        activePlans: 2,
        activeBuckets: 1,
        staleReservations: 0,
        avgPlannerLatencyMs: "12.5",
        updatedAt: new Date("2026-03-11T00:00:00.000Z"),
      })),
      degradeShard: vi.fn(async ({ shardId: inputShardId, targetMode }: { shardId: string; targetMode: string }) => ({
        shardId: inputShardId,
        mode: targetMode,
        activePlans: 2,
        activeBuckets: 1,
        staleReservations: 0,
        avgPlannerLatencyMs: "12.5",
        updatedAt: new Date("2026-03-11T00:00:00.000Z"),
      })),
      createOverride: vi.fn(async () => ({
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        scopeType: "BUCKET",
        scopeId: bucketId,
        overrideType: "SAFE_FALLBACK",
        payload: { mode: "SAFE_FALLBACK" },
        createdBy: "ops-admin@example.com",
        createdAt: new Date("2026-03-11T00:00:00.000Z"),
        expiresAt: new Date("2026-03-12T00:00:00.000Z"),
      })),
      getPhase3AGuardrailShadowConfig: vi.fn(() => ({
        enabled: true,
        percent: 0.1,
        startAt: "2026-03-11T00:00:00.000Z",
      })),
      getPhase3AGuardrailShadowInspection: vi.fn(async () => ({
        config: {
          enabled: true,
          percent: 0.1,
          startAt: "2026-03-11T00:00:00.000Z",
        },
        effective: {
          enforcementMode: "SHADOW",
          source: "override",
          sampled: true,
          windowActive: true,
          matchedOverrideId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          reason: "ops-shadow",
          context: {
            engine: "SOR",
            shardId,
            stableId: "rfq-123",
            bucketId: null,
            marketId: "market-1",
          },
        },
        matchedOverride: {
          override: {
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            scopeType: "ENGINE",
            scopeId: "SOR",
            overrideType: "GUARDRAIL_ENFORCEMENT",
            payload: { enforcementMode: "SHADOW", reason: "ops-shadow" },
            createdBy: "ops-admin",
            createdAt: new Date("2026-03-11T00:00:00.000Z"),
            expiresAt: null,
          },
          payload: { enforcementMode: "SHADOW", reason: "ops-shadow" },
        },
        activeShadowOverrides: [
          {
            override: {
              id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              scopeType: "ENGINE",
              scopeId: "SOR",
              overrideType: "GUARDRAIL_ENFORCEMENT",
              payload: { enforcementMode: "SHADOW", reason: "ops-shadow" },
              createdBy: "ops-admin",
              createdAt: new Date("2026-03-11T00:00:00.000Z"),
              expiresAt: null,
            },
            payload: { enforcementMode: "SHADOW", reason: "ops-shadow" },
          },
        ],
      })),
    } as unknown as ControlPlaneAdminService;

    await registerAdminControlPlaneRoutes(app, adminMiddleware, {
      controlPlaneAdminService,
    });

    return { app, controlPlaneAdminService };
  };

  it("enforces admin auth on all routes", async () => {
    const rejectingAdmin: preHandlerHookHandler = async (_request, reply) => reply.status(403).send({ code: "FORBIDDEN" });
    const { app } = await buildApp(rejectingAdmin);

    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/admin/control-plane/shards" }),
      app.inject({ method: "GET", url: `/admin/control-plane/shard/${shardId}` }),
      app.inject({ method: "GET", url: "/admin/control-plane/buckets" }),
      app.inject({ method: "GET", url: `/admin/control-plane/bucket/${bucketId}` }),
      app.inject({ method: "GET", url: "/admin/control-plane/overrides" }),
      app.inject({ method: "GET", url: `/admin/control-plane/guardrail-shadow?engine=SOR&shardId=${shardId}&stableId=rfq-123` }),
      app.inject({ method: "GET", url: `/admin/control-plane/replay/${envelopeId}` }),
      app.inject({ method: "POST", url: `/admin/control-plane/bucket/${bucketId}/pause`, payload: { twoFactorToken: "123456" } }),
      app.inject({ method: "POST", url: `/admin/control-plane/bucket/${bucketId}/drain`, payload: { twoFactorToken: "123456" } }),
      app.inject({ method: "POST", url: `/admin/control-plane/shard/${shardId}/pause`, payload: { twoFactorToken: "123456" } }),
      app.inject({
        method: "POST",
        url: `/admin/control-plane/shard/${shardId}/degrade`,
        payload: { twoFactorToken: "123456", targetMode: "DISABLE_INTERNAL_CROSS" },
      }),
      app.inject({
        method: "POST",
        url: "/admin/control-plane/override",
        payload: {
          twoFactorToken: "123456",
          scopeType: "BUCKET",
          scopeId: bucketId,
          overrideType: "SAFE_FALLBACK",
          payload: { mode: "SAFE_FALLBACK" },
        },
      }),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(403);
    }

    await app.close();
  });

  it("returns planner shard list", async () => {
    const passThroughAdmin: preHandlerHookHandler = async () => {};
    const { app, controlPlaneAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "GET",
      url: "/admin/control-plane/shards",
    });

    expect(response.statusCode).toBe(200);
    expect((controlPlaneAdminService as unknown as { listShards: ReturnType<typeof vi.fn> }).listShards).toHaveBeenCalled();
    expect(response.json()).toEqual({
      shards: [
        {
          shardId,
          mode: "NORMAL",
          activePlans: 2,
          activeBuckets: 1,
          staleReservations: 0,
          avgPlannerLatencyMs: "12.5",
          updatedAt: "2026-03-11T00:00:00.000Z",
        },
      ],
    });

    await app.close();
  });

  it("returns one shard and maps not found", async () => {
    const passThroughAdmin: preHandlerHookHandler = async () => {};
    const { app, controlPlaneAdminService } = await buildApp(passThroughAdmin);

    const okResponse = await app.inject({
      method: "GET",
      url: `/admin/control-plane/shard/${shardId}`,
    });

    expect(okResponse.statusCode).toBe(200);
    expect((controlPlaneAdminService as unknown as { getShard: ReturnType<typeof vi.fn> }).getShard).toHaveBeenCalledWith(shardId);

    (controlPlaneAdminService as unknown as { getShard: ReturnType<typeof vi.fn> }).getShard.mockRejectedValueOnce(
      new ControlPlaneShardNotFoundError(shardId)
    );

    const notFoundResponse = await app.inject({
      method: "GET",
      url: `/admin/control-plane/shard/${shardId}`,
    });

    expect(notFoundResponse.statusCode).toBe(404);
    await app.close();
  });

  it("returns buckets and supports filtering by type and mode", async () => {
    const passThroughAdmin: preHandlerHookHandler = async () => {};
    const { app, controlPlaneAdminService } = await buildApp(passThroughAdmin);

    const allResponse = await app.inject({
      method: "GET",
      url: "/admin/control-plane/buckets",
    });
    expect(allResponse.statusCode).toBe(200);
    expect((controlPlaneAdminService as unknown as { listBuckets: ReturnType<typeof vi.fn> }).listBuckets).toHaveBeenNthCalledWith(1, {});

    const typeResponse = await app.inject({
      method: "GET",
      url: "/admin/control-plane/buckets?type=CLEARING",
    });
    expect(typeResponse.statusCode).toBe(200);
    expect((controlPlaneAdminService as unknown as { listBuckets: ReturnType<typeof vi.fn> }).listBuckets).toHaveBeenNthCalledWith(2, {
      bucketType: "CLEARING",
    });

    const modeResponse = await app.inject({
      method: "GET",
      url: "/admin/control-plane/buckets?mode=DEGRADED",
    });
    expect(modeResponse.statusCode).toBe(200);
    expect((controlPlaneAdminService as unknown as { listBuckets: ReturnType<typeof vi.fn> }).listBuckets).toHaveBeenNthCalledWith(3, {
      mode: "DEGRADED",
    });

    const bothResponse = await app.inject({
      method: "GET",
      url: "/admin/control-plane/buckets?type=CLEARING&mode=DEGRADED",
    });
    expect(bothResponse.statusCode).toBe(200);
    expect((controlPlaneAdminService as unknown as { listBuckets: ReturnType<typeof vi.fn> }).listBuckets).toHaveBeenNthCalledWith(4, {
      bucketType: "CLEARING",
      mode: "DEGRADED",
    });

    await app.close();
  });

  it("returns one bucket and maps not found", async () => {
    const passThroughAdmin: preHandlerHookHandler = async () => {};
    const { app, controlPlaneAdminService } = await buildApp(passThroughAdmin);

    const okResponse = await app.inject({
      method: "GET",
      url: `/admin/control-plane/bucket/${bucketId}`,
    });

    expect(okResponse.statusCode).toBe(200);
    expect((controlPlaneAdminService as unknown as { getBucket: ReturnType<typeof vi.fn> }).getBucket).toHaveBeenCalledWith(bucketId);

    (controlPlaneAdminService as unknown as { getBucket: ReturnType<typeof vi.fn> }).getBucket.mockRejectedValueOnce(
      new ControlPlaneBucketNotFoundError(bucketId)
    );

    const notFoundResponse = await app.inject({
      method: "GET",
      url: `/admin/control-plane/bucket/${bucketId}`,
    });

    expect(notFoundResponse.statusCode).toBe(404);
    await app.close();
  });

  it("returns active overrides only", async () => {
    const passThroughAdmin: preHandlerHookHandler = async () => {};
    const { app, controlPlaneAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "GET",
      url: "/admin/control-plane/overrides",
    });

    expect(response.statusCode).toBe(200);
    expect((controlPlaneAdminService as unknown as { listActiveOverrides: ReturnType<typeof vi.fn> }).listActiveOverrides).toHaveBeenCalled();
    const body = response.json() as { overrides: Array<{ payload?: unknown; expiresAt?: string | null }> };
    expect(body.overrides).toHaveLength(1);
    expect(body.overrides[0]?.payload).toEqual({ throttle: true });
    expect(body.overrides[0]?.expiresAt).toBeNull();

    await app.close();
  });

  it("returns Phase 3A guardrail shadow inspection", async () => {
    const passThroughAdmin: preHandlerHookHandler = async () => {};
    const { app, controlPlaneAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "GET",
      url: `/admin/control-plane/guardrail-shadow?engine=SOR&shardId=${shardId}&stableId=rfq-123&marketId=market-1`,
    });

    expect(response.statusCode).toBe(200);
    expect((controlPlaneAdminService as unknown as {
      getPhase3AGuardrailShadowInspection: ReturnType<typeof vi.fn>;
    }).getPhase3AGuardrailShadowInspection).toHaveBeenCalledWith({
      engine: "SOR",
      shardId,
      stableId: "rfq-123",
      marketId: "market-1",
    });

    const body = response.json() as { effective: { enforcementMode: string }; activeShadowOverrides: unknown[] };
    expect(body.effective.enforcementMode).toBe("SHADOW");
    expect(body.activeShadowOverrides).toHaveLength(1);

    await app.close();
  });

  it("returns replay envelope metadata only and maps not found", async () => {
    const passThroughAdmin: preHandlerHookHandler = async () => {};
    const { app, controlPlaneAdminService } = await buildApp(passThroughAdmin);

    const okResponse = await app.inject({
      method: "GET",
      url: `/admin/control-plane/replay/${envelopeId}`,
    });

    expect(okResponse.statusCode).toBe(200);
    const body = okResponse.json() as { envelope: Record<string, unknown> };
    expect(body.envelope).toEqual({
      id: envelopeId,
      decisionType: "SOR_PLAN",
      entityId: "rfq-123",
      correlationId: "corr-123",
      configVersion: "planner-v1",
      engineVersion: "sor-v1",
      createdAt: "2026-03-11T00:00:00.000Z",
    });
    expect(body.envelope).not.toHaveProperty("featureFlags");
    expect(body.envelope).not.toHaveProperty("inputSnapshot");
    expect(body.envelope).not.toHaveProperty("decisionTrace");
    expect(body.envelope).not.toHaveProperty("outputSnapshot");

    (controlPlaneAdminService as unknown as { getReplayEnvelopeMetadata: ReturnType<typeof vi.fn> }).getReplayEnvelopeMetadata
      .mockRejectedValueOnce(new ReplayEnvelopeNotFoundError(envelopeId));

    const notFoundResponse = await app.inject({
      method: "GET",
      url: `/admin/control-plane/replay/${envelopeId}`,
    });

    expect(notFoundResponse.statusCode).toBe(404);
    await app.close();
  });

  it("returns 400 for malformed params and query", async () => {
    const passThroughAdmin: preHandlerHookHandler = async () => {};
    const { app } = await buildApp(passThroughAdmin);

    const invalidReplayResponse = await app.inject({
      method: "GET",
      url: "/admin/control-plane/replay/not-a-uuid",
    });
    expect(invalidReplayResponse.statusCode).toBe(400);

    const invalidBucketQueryResponse = await app.inject({
      method: "GET",
      url: "/admin/control-plane/buckets?type=",
    });
    expect(invalidBucketQueryResponse.statusCode).toBe(400);

    const invalidGuardrailShadowResponse = await app.inject({
      method: "GET",
      url: "/admin/control-plane/guardrail-shadow?engine=BAD&shardId=foo&stableId=bar",
    });
    expect(invalidGuardrailShadowResponse.statusCode).toBe(400);

    const invalidPauseResponse = await app.inject({
      method: "POST",
      url: `/admin/control-plane/bucket/${bucketId}/pause`,
      payload: { twoFactorToken: "123" },
    });
    expect(invalidPauseResponse.statusCode).toBe(400);

    const invalidDegradeResponse = await app.inject({
      method: "POST",
      url: `/admin/control-plane/shard/${shardId}/degrade`,
      payload: { twoFactorToken: "123456", targetMode: "INVALID" },
    });
    expect(invalidDegradeResponse.statusCode).toBe(400);

    await app.close();
  });

  it("enforces 2FA validation and returns updated bucket for pause/drain", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      ((request as unknown) as { user?: { email: string } }).user = { email: "ops-admin@example.com" };
    };
    const { app, controlPlaneAdminService } = await buildApp(passThroughAdmin);

    const pauseResponse = await app.inject({
      method: "POST",
      url: `/admin/control-plane/bucket/${bucketId}/pause`,
      payload: { twoFactorToken: "123456" },
    });
    expect(pauseResponse.statusCode).toBe(200);
    expect((controlPlaneAdminService as unknown as { pauseBucket: ReturnType<typeof vi.fn> }).pauseBucket).toHaveBeenCalledWith(
      bucketId,
      "ops-admin@example.com",
    );

    const drainResponse = await app.inject({
      method: "POST",
      url: `/admin/control-plane/bucket/${bucketId}/drain`,
      payload: { twoFactorToken: "123456" },
    });
    expect(drainResponse.statusCode).toBe(200);
    expect((controlPlaneAdminService as unknown as { drainBucket: ReturnType<typeof vi.fn> }).drainBucket).toHaveBeenCalledWith(
      bucketId,
      "ops-admin@example.com",
    );

    await app.close();
  });

  it("returns updated shard for pause/degrade and maps shard not found", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      ((request as unknown) as { user?: { email: string } }).user = { email: "ops-admin@example.com" };
    };
    const { app, controlPlaneAdminService } = await buildApp(passThroughAdmin);

    const pauseResponse = await app.inject({
      method: "POST",
      url: `/admin/control-plane/shard/${shardId}/pause`,
      payload: { twoFactorToken: "123456" },
    });
    expect(pauseResponse.statusCode).toBe(200);

    const degradeResponse = await app.inject({
      method: "POST",
      url: `/admin/control-plane/shard/${shardId}/degrade`,
      payload: { twoFactorToken: "123456", targetMode: "DISABLE_INTERNAL_CROSS" },
    });
    expect(degradeResponse.statusCode).toBe(200);
    expect((controlPlaneAdminService as unknown as { degradeShard: ReturnType<typeof vi.fn> }).degradeShard).toHaveBeenCalledWith({
      shardId,
      targetMode: "DISABLE_INTERNAL_CROSS",
      requestedBy: "ops-admin@example.com",
    });

    (controlPlaneAdminService as unknown as { pauseShard: ReturnType<typeof vi.fn> }).pauseShard.mockRejectedValueOnce(
      new ControlPlaneShardNotFoundError(shardId),
    );
    const notFoundResponse = await app.inject({
      method: "POST",
      url: `/admin/control-plane/shard/${shardId}/pause`,
      payload: { twoFactorToken: "123456" },
    });
    expect(notFoundResponse.statusCode).toBe(404);

    await app.close();
  });

  it("creates overrides and maps invalid override validation", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      ((request as unknown) as { user?: { email: string } }).user = { email: "ops-admin@example.com" };
    };
    const { app, controlPlaneAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "POST",
      url: "/admin/control-plane/override",
      payload: {
        twoFactorToken: "123456",
        scopeType: "BUCKET",
        scopeId: bucketId,
        overrideType: "SAFE_FALLBACK",
        payload: { mode: "SAFE_FALLBACK" },
        expiresAt: "2026-03-12T00:00:00.000Z",
      },
    });
    expect(response.statusCode).toBe(200);
    expect((controlPlaneAdminService as unknown as { createOverride: ReturnType<typeof vi.fn> }).createOverride).toHaveBeenCalledWith({
      scopeType: "BUCKET",
      scopeId: bucketId,
      overrideType: "SAFE_FALLBACK",
      payload: { mode: "SAFE_FALLBACK" },
      createdBy: "ops-admin@example.com",
      expiresAt: new Date("2026-03-12T00:00:00.000Z"),
    });

    (controlPlaneAdminService as unknown as { createOverride: ReturnType<typeof vi.fn> }).createOverride.mockRejectedValueOnce(
      new ControlPlaneOverrideValidationError("payload must be a structured JSON object."),
    );
    const invalidOverrideResponse = await app.inject({
      method: "POST",
      url: "/admin/control-plane/override",
      payload: {
        twoFactorToken: "123456",
        scopeType: "BUCKET",
        scopeId: bucketId,
        overrideType: "SAFE_FALLBACK",
        payload: { mode: "SAFE_FALLBACK" },
      },
    });
    expect(invalidOverrideResponse.statusCode).toBe(400);

    await app.close();
  });

  it("maps missing bucket on mutation to 404", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      ((request as unknown) as { user?: { email: string } }).user = { email: "ops-admin@example.com" };
    };
    const { app, controlPlaneAdminService } = await buildApp(passThroughAdmin);

    (controlPlaneAdminService as unknown as { pauseBucket: ReturnType<typeof vi.fn> }).pauseBucket.mockRejectedValueOnce(
      new ControlPlaneBucketNotFoundError(bucketId),
    );

    const response = await app.inject({
      method: "POST",
      url: `/admin/control-plane/bucket/${bucketId}/pause`,
      payload: { twoFactorToken: "123456" },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
