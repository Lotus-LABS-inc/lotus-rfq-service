import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import {
  InvalidDiffReplayRequestError,
  ReplayAdminService,
  ReplayEnvelopeNotFoundError,
} from "./replay-admin-service.js";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const twoFactorTokenSchema = z.string().min(6);
const runBodySchema = z.object({
  twoFactorToken: twoFactorTokenSchema,
});
const diffBodySchema = z
  .object({
    twoFactorToken: twoFactorTokenSchema,
    configVersion: z.string().min(1).optional(),
    engineVersion: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.configVersion || value.engineVersion), {
    message: "At least one of configVersion or engineVersion must be provided.",
    path: ["configVersion"],
  });

const isoDateSchema = z.string().datetime({ offset: true });

const envelopeMetadataResponseSchema = z.object({
  id: z.string().uuid(),
  decisionType: z.string(),
  entityId: z.string(),
  correlationId: z.string(),
  configVersion: z.string(),
  engineVersion: z.string(),
  createdAt: isoDateSchema,
});

const exactReplayResponseSchema = z.object({
  envelopeId: z.string().uuid(),
  status: z.enum(["MATCH", "DIFF", "ERROR"]),
  diffSummary: z.record(z.string(), z.unknown()).nullable(),
  replayOutput: z.record(z.string(), z.unknown()).nullable(),
});

const diffReplayResponseSchema = z.object({
  envelopeId: z.string().uuid(),
  status: z.enum(["MATCH", "DIFF", "ERROR"]),
  originalConfigVersion: z.string().nullable(),
  originalEngineVersion: z.string().nullable(),
  replayConfigVersion: z.string().nullable(),
  replayEngineVersion: z.string().nullable(),
  diffSummary: z.record(z.string(), z.unknown()).nullable(),
  originalOutput: z.record(z.string(), z.unknown()).nullable(),
  replayOutput: z.record(z.string(), z.unknown()).nullable(),
});

export interface AdminReplayRouteDeps {
  replayAdminService: ReplayAdminService;
}

export const registerAdminReplayRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminReplayRouteDeps
): Promise<void> => {
  app.get("/admin/replay/envelope/:id", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedParams.error.flatten() });
    }

    try {
      const envelope = await deps.replayAdminService.getReplayEnvelopeMetadata(parsedParams.data.id);
      return reply.send({
        envelope: envelopeMetadataResponseSchema.parse({
          ...envelope,
          createdAt: envelope.createdAt.toISOString(),
        }),
      });
    } catch (error) {
      if (error instanceof ReplayEnvelopeNotFoundError) {
        return reply.status(404).send({ code: "REPLAY_ENVELOPE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error, envelopeId: parsedParams.data.id }, "Failed to load replay envelope metadata.");
      return reply.status(500).send({ code: "REPLAY_ADMIN_ERROR", message: "Failed to load replay envelope metadata." });
    }
  });

  app.post("/admin/replay/envelope/:id/run", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = runBodySchema.safeParse(request.body);
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
      const result = await deps.replayAdminService.runExactReplay({
        envelopeId: parsedParams.data.id,
        requestedBy: request.user.userId,
      });
      return reply.send(
        exactReplayResponseSchema.parse({
          envelopeId: parsedParams.data.id,
          status: result.status,
          diffSummary: result.diffSummary,
          replayOutput: result.replayOutput,
        })
      );
    } catch (error) {
      if (error instanceof ReplayEnvelopeNotFoundError) {
        return reply.status(404).send({ code: "REPLAY_ENVELOPE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error, envelopeId: parsedParams.data.id }, "Failed to run exact replay.");
      return reply.status(500).send({ code: "REPLAY_ADMIN_ERROR", message: "Failed to run exact replay." });
    }
  });

  app.post("/admin/replay/envelope/:id/diff", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = diffBodySchema.safeParse(request.body);
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
      const result = await deps.replayAdminService.runDiffReplay({
        envelopeId: parsedParams.data.id,
        requestedBy: request.user.userId,
        ...(parsedBody.data.configVersion ? { configVersion: parsedBody.data.configVersion } : {}),
        ...(parsedBody.data.engineVersion ? { engineVersion: parsedBody.data.engineVersion } : {}),
      });
      return reply.send(
        diffReplayResponseSchema.parse({
          envelopeId: parsedParams.data.id,
          status: result.status,
          originalConfigVersion: result.originalConfigVersion,
          originalEngineVersion: result.originalEngineVersion,
          replayConfigVersion: result.replayConfigVersion,
          replayEngineVersion: result.replayEngineVersion,
          diffSummary: result.diffSummary,
          originalOutput: result.originalOutput,
          replayOutput: result.replayOutput,
        })
      );
    } catch (error) {
      if (error instanceof ReplayEnvelopeNotFoundError) {
        return reply.status(404).send({ code: "REPLAY_ENVELOPE_NOT_FOUND", message: error.message });
      }
      if (error instanceof InvalidDiffReplayRequestError) {
        return reply.status(400).send({ code: "INVALID_DIFF_REPLAY_REQUEST", message: error.message });
      }
      app.log.error({ err: error, envelopeId: parsedParams.data.id }, "Failed to run diff replay.");
      return reply.status(500).send({ code: "REPLAY_ADMIN_ERROR", message: "Failed to run diff replay." });
    }
  });
};
