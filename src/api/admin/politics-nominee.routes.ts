import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import {
  PoliticsNomineeAdminService,
  PoliticsNomineeLaneNotFoundError,
  PoliticsNomineeLaneTransitionError
} from "./politics-nominee-admin-service.js";
import { politicsNomineeLaneIds } from "../../operations/semantic-expansion/politics-nominee-limited-prod-shared.js";

const laneIdSchema = z.enum(politicsNomineeLaneIds);
const paramsSchema = z.object({
  laneId: laneIdSchema
});
const bodySchema = z.object({
  twoFactorToken: z.string().min(6, "twoFactorToken is required for ADMIN+2FA operations"),
  reason: z.string().min(1).optional()
});

const validateTwoFactorToken = (token: string): boolean => {
  const configuredToken = process.env.ADMIN_2FA_TOKEN;
  if (typeof configuredToken === "string" && configuredToken.length > 0) {
    return token === configuredToken;
  }
  return false;
};

export interface AdminPoliticsNomineeRouteDeps {
  politicsNomineeAdminService: PoliticsNomineeAdminService;
}

export const registerAdminPoliticsNomineeRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminPoliticsNomineeRouteDeps
): Promise<void> => {
  app.get("/admin/politics-nominee-lanes", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      return reply.send({ lanes: await deps.politicsNomineeAdminService.listLanes() });
    } catch (error) {
      app.log.error({ err: error }, "Failed to list politics nominee lanes.");
      return reply.status(500).send({ code: "POLITICS_NOMINEE_ADMIN_ERROR", message: "Failed to list politics nominee lanes." });
    }
  });

  app.get("/admin/politics-nominee-lanes/:laneId", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ lane: await deps.politicsNomineeAdminService.getLane(parsed.data.laneId) });
    } catch (error) {
      if (error instanceof PoliticsNomineeLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_NOMINEE_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load politics nominee lane.");
      return reply.status(500).send({ code: "POLITICS_NOMINEE_ADMIN_ERROR", message: "Failed to load politics nominee lane." });
    }
  });

  app.get("/admin/politics-nominee-lanes/:laneId/readiness", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ readiness: await deps.politicsNomineeAdminService.getReadiness(parsed.data.laneId) });
    } catch (error) {
      if (error instanceof PoliticsNomineeLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_NOMINEE_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load politics nominee readiness.");
      return reply.status(500).send({ code: "POLITICS_NOMINEE_ADMIN_ERROR", message: "Failed to load politics nominee readiness." });
    }
  });

  app.get("/admin/politics-nominee-lanes/:laneId/canary-gates", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ canaryGates: await deps.politicsNomineeAdminService.getCanaryGates(parsed.data.laneId) });
    } catch (error) {
      if (error instanceof PoliticsNomineeLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_NOMINEE_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load politics nominee canary gates.");
      return reply.status(500).send({ code: "POLITICS_NOMINEE_ADMIN_ERROR", message: "Failed to load politics nominee canary gates." });
    }
  });

  app.get("/admin/politics-nominee-lanes/:laneId/rollback-plan", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ rollbackPlan: await deps.politicsNomineeAdminService.getRollbackPlan(parsed.data.laneId) });
    } catch (error) {
      if (error instanceof PoliticsNomineeLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_NOMINEE_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load politics nominee rollback plan.");
      return reply.status(500).send({ code: "POLITICS_NOMINEE_ADMIN_ERROR", message: "Failed to load politics nominee rollback plan." });
    }
  });

  app.post("/admin/politics-nominee-lanes/:laneId/operator-approval-intent", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = bodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST" });
    }
    if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }
    try {
      return reply.send({
        approvalIntent: await deps.politicsNomineeAdminService.recordOperatorApprovalIntent(
          parsedParams.data.laneId,
          request.user.userId,
          parsedBody.data.reason ?? null
        )
      });
    } catch (error) {
      if (error instanceof PoliticsNomineeLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_NOMINEE_LANE_NOT_FOUND", message: error.message });
      }
      if (error instanceof PoliticsNomineeLaneTransitionError) {
        return reply.status(409).send({ code: "POLITICS_NOMINEE_INVALID_TRANSITION", message: error.message });
      }
      app.log.error({ err: error }, "Failed to record politics nominee operator approval intent.");
      return reply.status(500).send({ code: "POLITICS_NOMINEE_ADMIN_ERROR", message: "Failed to record politics nominee operator approval intent." });
    }
  });

  app.post("/admin/politics-nominee-lanes/:laneId/hold", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = bodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success || !parsedBody.data.reason) {
      return reply.status(400).send({ code: "INVALID_REQUEST" });
    }
    if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }
    try {
      return reply.send(await deps.politicsNomineeAdminService.holdLane(parsedParams.data.laneId, request.user.userId, parsedBody.data.reason));
    } catch (error) {
      if (error instanceof PoliticsNomineeLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_NOMINEE_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to hold politics nominee lane.");
      return reply.status(500).send({ code: "POLITICS_NOMINEE_ADMIN_ERROR", message: "Failed to hold politics nominee lane." });
    }
  });

  app.post("/admin/politics-nominee-lanes/:laneId/rollback", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = bodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success || !parsedBody.data.reason) {
      return reply.status(400).send({ code: "INVALID_REQUEST" });
    }
    if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }
    try {
      return reply.send(await deps.politicsNomineeAdminService.rollbackLane(parsedParams.data.laneId, request.user.userId, parsedBody.data.reason));
    } catch (error) {
      if (error instanceof PoliticsNomineeLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_NOMINEE_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to roll back politics nominee lane.");
      return reply.status(500).send({ code: "POLITICS_NOMINEE_ADMIN_ERROR", message: "Failed to roll back politics nominee lane." });
    }
  });
};
