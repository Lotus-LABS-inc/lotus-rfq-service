import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import {
  ControlPlaneAdminService,
  ControlPlaneBucketNotFoundError,
  ControlPlaneOverrideValidationError,
  ControlPlaneShardNotFoundError,
  type Phase3AGuardrailShadowInspectionResult,
  type ControlPlaneOverrideScopeType,
  type PlannerShardDegradeMode,
  ReplayEnvelopeNotFoundError,
  type ReplayEnvelopeMetadata,
} from "./control-plane-admin-service.js";
import type { BucketState, ControlPlaneOverride, PlannerShardState } from "../../core/replay/control-plane.types.js";

const shardParamsSchema = z.object({
  id: z.string().min(1),
});

const bucketParamsSchema = z.object({
  id: z.string().min(1),
});

const replayParamsSchema = z.object({
  envelopeId: z.string().uuid(),
});

const bucketQuerySchema = z.object({
  type: z.string().min(1).optional(),
  mode: z.string().min(1).optional(),
});

const guardrailShadowQuerySchema = z.object({
  engine: z.enum(["SOR", "NETTING_PHASE2A", "CLEARING_PHASE2B"]),
  shardId: z.string().min(1),
  stableId: z.string().min(1),
  bucketId: z.string().min(1).optional(),
  marketId: z.string().min(1).optional(),
});

const isoDateSchema = z.string().datetime({ offset: true });

const twoFactorTokenSchema = z.string().min(6);

const mutateBucketBodySchema = z.object({
  twoFactorToken: twoFactorTokenSchema,
});

const degradeShardBodySchema = z.object({
  twoFactorToken: twoFactorTokenSchema,
  targetMode: z.enum([
    "FULL_MODE",
    "DISABLE_PHASE2B",
    "DISABLE_PHASE2A_AND_2B",
    "DISABLE_INTERNAL_CROSS",
    "SOR_ONLY",
    "SAFE_FALLBACK",
  ]),
});

const createOverrideBodySchema = z.object({
  twoFactorToken: twoFactorTokenSchema,
  scopeType: z.enum(["MARKET", "BUCKET", "SHARD", "ENGINE"]),
  scopeId: z.string().min(1),
  overrideType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  expiresAt: isoDateSchema.optional(),
});

const plannerShardStateResponseSchema = z.object({
  shardId: z.string(),
  mode: z.string(),
  activePlans: z.number().int(),
  activeBuckets: z.number().int(),
  staleReservations: z.number().int(),
  avgPlannerLatencyMs: z.string().nullable(),
  updatedAt: isoDateSchema,
});

const bucketStateResponseSchema = z.object({
  bucketId: z.string(),
  bucketType: z.string(),
  mode: z.string(),
  entityCount: z.number().int(),
  graphDensity: z.string().nullable(),
  degradationReason: z.string().nullable(),
  updatedAt: isoDateSchema,
});

const controlPlaneOverrideResponseSchema = z.object({
  id: z.string().uuid(),
  scopeType: z.string(),
  scopeId: z.string(),
  overrideType: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdBy: z.string(),
  createdAt: isoDateSchema,
  expiresAt: isoDateSchema.nullable(),
});

const replayEnvelopeMetadataResponseSchema = z.object({
  id: z.string().uuid(),
  decisionType: z.string(),
  entityId: z.string(),
  correlationId: z.string(),
  configVersion: z.string(),
  engineVersion: z.string(),
  createdAt: isoDateSchema,
});

const guardrailShadowConfigResponseSchema = z.object({
  enabled: z.boolean(),
  percent: z.number(),
  startAt: isoDateSchema.optional(),
  endAt: isoDateSchema.optional(),
});

const guardrailShadowResolutionResponseSchema = z.object({
  enforcementMode: z.enum(["ENFORCED", "SHADOW"]),
  source: z.enum(["override", "env", "default"]),
  sampled: z.boolean(),
  windowActive: z.boolean(),
  matchedOverrideId: z.string().uuid().optional(),
  reason: z.string(),
  context: z.object({
    engine: z.enum(["SOR", "NETTING_PHASE2A", "CLEARING_PHASE2B"]),
    shardId: z.string(),
    stableId: z.string(),
    bucketId: z.string().nullable(),
    marketId: z.string().nullable(),
  }),
});

const guardrailShadowOverrideResponseSchema = z.object({
  id: z.string().uuid(),
  scopeType: z.string(),
  scopeId: z.string(),
  overrideType: z.literal("GUARDRAIL_ENFORCEMENT"),
  payload: z.object({
    enforcementMode: z.enum(["ENFORCED", "SHADOW"]),
    reason: z.string().optional(),
  }),
  createdBy: z.string(),
  createdAt: isoDateSchema,
  expiresAt: isoDateSchema.nullable(),
});

export interface AdminControlPlaneRouteDeps {
  controlPlaneAdminService: ControlPlaneAdminService;
}

export const registerAdminControlPlaneRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminControlPlaneRouteDeps,
): Promise<void> => {
  app.get("/admin/control-plane/shards", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      const shards = await deps.controlPlaneAdminService.listShards();
      return reply.send({
        shards: z.array(plannerShardStateResponseSchema).parse(shards.map(serializePlannerShardState)),
      });
    } catch (error) {
      app.log.error({ err: error }, "Failed to list planner shard state.");
      return reply.status(500).send({ code: "CONTROL_PLANE_ADMIN_ERROR", message: "Failed to list planner shard state." });
    }
  });

  app.get("/admin/control-plane/shard/:id", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = shardParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedParams.error.flatten() });
    }

    try {
      const shard = await deps.controlPlaneAdminService.getShard(parsedParams.data.id);
      return reply.send({ shard: plannerShardStateResponseSchema.parse(serializePlannerShardState(shard)) });
    } catch (error) {
      if (error instanceof ControlPlaneShardNotFoundError) {
        return reply.status(404).send({ code: "SHARD_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error, shardId: parsedParams.data.id }, "Failed to load planner shard state.");
      return reply.status(500).send({ code: "CONTROL_PLANE_ADMIN_ERROR", message: "Failed to load planner shard state." });
    }
  });

  app.get("/admin/control-plane/buckets", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedQuery = bucketQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedQuery.error.flatten() });
    }

    try {
      const buckets = await deps.controlPlaneAdminService.listBuckets({
        ...(parsedQuery.data.type ? { bucketType: parsedQuery.data.type } : {}),
        ...(parsedQuery.data.mode ? { mode: parsedQuery.data.mode } : {}),
      });

      return reply.send({
        buckets: z.array(bucketStateResponseSchema).parse(buckets.map(serializeBucketState)),
        filters: {
          ...(parsedQuery.data.type ? { bucketType: parsedQuery.data.type } : {}),
          ...(parsedQuery.data.mode ? { mode: parsedQuery.data.mode } : {}),
        },
      });
    } catch (error) {
      app.log.error({ err: error, filters: parsedQuery.data }, "Failed to list bucket state.");
      return reply.status(500).send({ code: "CONTROL_PLANE_ADMIN_ERROR", message: "Failed to list bucket state." });
    }
  });

  app.get("/admin/control-plane/bucket/:id", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = bucketParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedParams.error.flatten() });
    }

    try {
      const bucket = await deps.controlPlaneAdminService.getBucket(parsedParams.data.id);
      return reply.send({ bucket: bucketStateResponseSchema.parse(serializeBucketState(bucket)) });
    } catch (error) {
      if (error instanceof ControlPlaneBucketNotFoundError) {
        return reply.status(404).send({ code: "BUCKET_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error, bucketId: parsedParams.data.id }, "Failed to load bucket state.");
      return reply.status(500).send({ code: "CONTROL_PLANE_ADMIN_ERROR", message: "Failed to load bucket state." });
    }
  });

  app.get("/admin/control-plane/overrides", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      const overrides = await deps.controlPlaneAdminService.listActiveOverrides();
      return reply.send({
        overrides: z.array(controlPlaneOverrideResponseSchema).parse(overrides.map(serializeControlPlaneOverride)),
      });
    } catch (error) {
      app.log.error({ err: error }, "Failed to list active control plane overrides.");
      return reply.status(500).send({
        code: "CONTROL_PLANE_ADMIN_ERROR",
        message: "Failed to list active control plane overrides.",
      });
    }
  });

  app.get("/admin/control-plane/guardrail-shadow", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedQuery = guardrailShadowQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedQuery.error.flatten() });
    }

    try {
      const inspection = await deps.controlPlaneAdminService.getPhase3AGuardrailShadowInspection({
        engine: parsedQuery.data.engine,
        shardId: parsedQuery.data.shardId,
        stableId: parsedQuery.data.stableId,
        ...(parsedQuery.data.bucketId ? { bucketId: parsedQuery.data.bucketId } : {}),
        ...(parsedQuery.data.marketId ? { marketId: parsedQuery.data.marketId } : {}),
      });

      return reply.send(serializeGuardrailShadowInspection(inspection));
    } catch (error) {
      app.log.error({ err: error, query: parsedQuery.data }, "Failed to inspect Phase 3A guardrail shadow mode.");
      return reply.status(500).send({
        code: "CONTROL_PLANE_ADMIN_ERROR",
        message: "Failed to inspect Phase 3A guardrail shadow mode.",
      });
    }
  });

  app.get("/admin/control-plane/replay/:envelopeId", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = replayParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedParams.error.flatten() });
    }

    try {
      const envelope = await deps.controlPlaneAdminService.getReplayEnvelopeMetadata(parsedParams.data.envelopeId);
      return reply.send({ envelope: replayEnvelopeMetadataResponseSchema.parse(serializeReplayEnvelopeMetadata(envelope)) });
    } catch (error) {
      if (error instanceof ReplayEnvelopeNotFoundError) {
        return reply.status(404).send({ code: "REPLAY_ENVELOPE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error, envelopeId: parsedParams.data.envelopeId }, "Failed to load replay envelope metadata.");
      return reply.status(500).send({ code: "CONTROL_PLANE_ADMIN_ERROR", message: "Failed to load replay envelope metadata." });
    }
  });

  app.post("/admin/control-plane/bucket/:id/pause", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = bucketParamsSchema.safeParse(request.params);
    const parsedBody = mutateBucketBodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        details: {
          params: parsedParams.success ? undefined : parsedParams.error.flatten(),
          body: parsedBody.success ? undefined : parsedBody.error.flatten(),
        },
      });
    }

    try {
      const bucket = await deps.controlPlaneAdminService.pauseBucket(
        parsedParams.data.id,
        readRequestedBy(request),
      );
      return reply.send({ bucket: bucketStateResponseSchema.parse(serializeBucketState(bucket)) });
    } catch (error) {
      if (error instanceof ControlPlaneBucketNotFoundError) {
        return reply.status(404).send({ code: "BUCKET_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error, bucketId: parsedParams.data.id }, "Failed to pause control plane bucket.");
      return reply.status(500).send({ code: "CONTROL_PLANE_ADMIN_ERROR", message: "Failed to pause control plane bucket." });
    }
  });

  app.post("/admin/control-plane/bucket/:id/drain", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = bucketParamsSchema.safeParse(request.params);
    const parsedBody = mutateBucketBodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        details: {
          params: parsedParams.success ? undefined : parsedParams.error.flatten(),
          body: parsedBody.success ? undefined : parsedBody.error.flatten(),
        },
      });
    }

    try {
      const bucket = await deps.controlPlaneAdminService.drainBucket(
        parsedParams.data.id,
        readRequestedBy(request),
      );
      return reply.send({ bucket: bucketStateResponseSchema.parse(serializeBucketState(bucket)) });
    } catch (error) {
      if (error instanceof ControlPlaneBucketNotFoundError) {
        return reply.status(404).send({ code: "BUCKET_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error, bucketId: parsedParams.data.id }, "Failed to drain control plane bucket.");
      return reply.status(500).send({ code: "CONTROL_PLANE_ADMIN_ERROR", message: "Failed to drain control plane bucket." });
    }
  });

  app.post("/admin/control-plane/shard/:id/pause", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = shardParamsSchema.safeParse(request.params);
    const parsedBody = mutateBucketBodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        details: {
          params: parsedParams.success ? undefined : parsedParams.error.flatten(),
          body: parsedBody.success ? undefined : parsedBody.error.flatten(),
        },
      });
    }

    try {
      const shard = await deps.controlPlaneAdminService.pauseShard(
        parsedParams.data.id,
        readRequestedBy(request),
      );
      return reply.send({ shard: plannerShardStateResponseSchema.parse(serializePlannerShardState(shard)) });
    } catch (error) {
      if (error instanceof ControlPlaneShardNotFoundError) {
        return reply.status(404).send({ code: "SHARD_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error, shardId: parsedParams.data.id }, "Failed to pause control plane shard.");
      return reply.status(500).send({ code: "CONTROL_PLANE_ADMIN_ERROR", message: "Failed to pause control plane shard." });
    }
  });

  app.post("/admin/control-plane/shard/:id/degrade", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = shardParamsSchema.safeParse(request.params);
    const parsedBody = degradeShardBodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        details: {
          params: parsedParams.success ? undefined : parsedParams.error.flatten(),
          body: parsedBody.success ? undefined : parsedBody.error.flatten(),
        },
      });
    }

    try {
      const shard = await deps.controlPlaneAdminService.degradeShard({
        shardId: parsedParams.data.id,
        targetMode: parsedBody.data.targetMode as PlannerShardDegradeMode,
        requestedBy: readRequestedBy(request),
      });
      return reply.send({ shard: plannerShardStateResponseSchema.parse(serializePlannerShardState(shard)) });
    } catch (error) {
      if (error instanceof ControlPlaneShardNotFoundError) {
        return reply.status(404).send({ code: "SHARD_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error, shardId: parsedParams.data.id }, "Failed to degrade control plane shard.");
      return reply.status(500).send({ code: "CONTROL_PLANE_ADMIN_ERROR", message: "Failed to degrade control plane shard." });
    }
  });

  app.post("/admin/control-plane/override", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedBody = createOverrideBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        details: parsedBody.error.flatten(),
      });
    }

    try {
      const override = await deps.controlPlaneAdminService.createOverride({
        scopeType: parsedBody.data.scopeType as ControlPlaneOverrideScopeType,
        scopeId: parsedBody.data.scopeId,
        overrideType: parsedBody.data.overrideType,
        payload: parsedBody.data.payload,
        createdBy: readRequestedBy(request),
        expiresAt: parsedBody.data.expiresAt ? new Date(parsedBody.data.expiresAt) : null,
      });
      return reply.send({ override: controlPlaneOverrideResponseSchema.parse(serializeControlPlaneOverride(override)) });
    } catch (error) {
      if (error instanceof ControlPlaneOverrideValidationError) {
        return reply.status(400).send({ code: "INVALID_OVERRIDE", message: error.message });
      }
      app.log.error({ err: error }, "Failed to create control plane override.");
      return reply.status(500).send({ code: "CONTROL_PLANE_ADMIN_ERROR", message: "Failed to create control plane override." });
    }
  });
};

const readRequestedBy = (request: { user?: unknown }): string => {
  const user = isRecord(request.user) ? request.user : null;
  const email = typeof user?.email === "string" ? user.email : null;
  const id = typeof user?.id === "string" ? user.id : null;
  const sub = typeof user?.sub === "string" ? user.sub : null;
  return email ?? id ?? sub ?? "admin";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const serializePlannerShardState = (shard: PlannerShardState) => ({
  ...shard,
  updatedAt: shard.updatedAt.toISOString(),
});

const serializeBucketState = (bucket: BucketState) => ({
  ...bucket,
  updatedAt: bucket.updatedAt.toISOString(),
});

const serializeControlPlaneOverride = (override: ControlPlaneOverride) => ({
  ...override,
  createdAt: override.createdAt.toISOString(),
  expiresAt: override.expiresAt ? override.expiresAt.toISOString() : null,
});

const serializeReplayEnvelopeMetadata = (envelope: ReplayEnvelopeMetadata) => ({
  ...envelope,
  createdAt: envelope.createdAt.toISOString(),
});

const serializeGuardrailShadowInspection = (inspection: Phase3AGuardrailShadowInspectionResult) => ({
  config: guardrailShadowConfigResponseSchema.parse({
    ...inspection.config,
    ...(inspection.config.startAt ? { startAt: inspection.config.startAt } : {}),
    ...(inspection.config.endAt ? { endAt: inspection.config.endAt } : {}),
  }),
  effective: guardrailShadowResolutionResponseSchema.parse({
    ...inspection.effective,
  }),
  matchedOverride: inspection.matchedOverride
    ? guardrailShadowOverrideResponseSchema.parse({
        ...inspection.matchedOverride.override,
        payload: inspection.matchedOverride.payload,
        createdAt: inspection.matchedOverride.override.createdAt.toISOString(),
        expiresAt: inspection.matchedOverride.override.expiresAt
          ? inspection.matchedOverride.override.expiresAt.toISOString()
          : null,
      })
    : null,
  activeShadowOverrides: z.array(guardrailShadowOverrideResponseSchema).parse(
    inspection.activeShadowOverrides.map((override) => ({
      ...override.override,
      payload: override.payload,
      createdAt: override.override.createdAt.toISOString(),
      expiresAt: override.override.expiresAt ? override.override.expiresAt.toISOString() : null,
    }))
  ),
});
