import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import {
  PoliticsGeopoliticalAdminService,
  PoliticsGeopoliticalLaneNotFoundError,
  PoliticsGeopoliticalLaneTransitionError
} from "./politics-geopolitical-admin-service.js";
import { politicsGeopoliticalLaneIds as politicsGeopoliticalChinaLaneIds } from "../../operations/semantic-expansion/politics-geopolitical-trump-visit-china-2026-04-30-limited-prod-shared.js";
import { politicsGeopoliticalTrumpAcquireGreenland20261231LaneIds } from "../../operations/semantic-expansion/politics-geopolitical-trump-acquire-greenland-2026-12-31-limited-prod-shared.js";

const laneIdSchema = z.union([
  z.enum(politicsGeopoliticalChinaLaneIds),
  z.enum(politicsGeopoliticalTrumpAcquireGreenland20261231LaneIds)
]);
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

export interface AdminPoliticsGeopoliticalRouteDeps {
  politicsGeopoliticalAdminService: PoliticsGeopoliticalAdminService;
}

export const registerAdminPoliticsGeopoliticalRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminPoliticsGeopoliticalRouteDeps
): Promise<void> => {
  app.get("/admin/politics-geopolitical-lanes", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      return reply.send({ lanes: await deps.politicsGeopoliticalAdminService.listLanes() });
    } catch (error) {
      app.log.error({ err: error }, "Failed to list politics geopolitical lanes.");
      return reply.status(500).send({ code: "POLITICS_GEOPOLITICAL_ADMIN_ERROR", message: "Failed to list politics geopolitical lanes." });
    }
  });

  app.get("/admin/politics-geopolitical-lanes/:laneId", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ lane: await deps.politicsGeopoliticalAdminService.getLane(parsed.data.laneId) });
    } catch (error) {
      if (error instanceof PoliticsGeopoliticalLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_GEOPOLITICAL_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load politics geopolitical lane.");
      return reply.status(500).send({ code: "POLITICS_GEOPOLITICAL_ADMIN_ERROR", message: "Failed to load politics geopolitical lane." });
    }
  });

  app.get("/admin/politics-geopolitical-lanes/:laneId/readiness", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ readiness: await deps.politicsGeopoliticalAdminService.getReadiness(parsed.data.laneId) });
    } catch (error) {
      if (error instanceof PoliticsGeopoliticalLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_GEOPOLITICAL_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load politics geopolitical readiness.");
      return reply.status(500).send({ code: "POLITICS_GEOPOLITICAL_ADMIN_ERROR", message: "Failed to load politics geopolitical readiness." });
    }
  });

  app.get("/admin/politics-geopolitical-lanes/:laneId/rollback-plan", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ rollbackPlan: await deps.politicsGeopoliticalAdminService.getRollbackPlan(parsed.data.laneId) });
    } catch (error) {
      if (error instanceof PoliticsGeopoliticalLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_GEOPOLITICAL_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load politics geopolitical rollback plan.");
      return reply.status(500).send({ code: "POLITICS_GEOPOLITICAL_ADMIN_ERROR", message: "Failed to load politics geopolitical rollback plan." });
    }
  });

  app.post("/admin/politics-geopolitical-lanes/:laneId/operator-approval-intent", { preHandler: adminMiddleware }, async (request, reply) => {
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
        approvalIntent: await deps.politicsGeopoliticalAdminService.recordOperatorApprovalIntent(
          parsedParams.data.laneId,
          request.user.userId,
          parsedBody.data.reason ?? null
        )
      });
    } catch (error) {
      if (error instanceof PoliticsGeopoliticalLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_GEOPOLITICAL_LANE_NOT_FOUND", message: error.message });
      }
      if (error instanceof PoliticsGeopoliticalLaneTransitionError) {
        return reply.status(409).send({ code: "POLITICS_GEOPOLITICAL_INVALID_TRANSITION", message: error.message });
      }
      app.log.error({ err: error }, "Failed to record politics geopolitical operator approval intent.");
      return reply.status(500).send({ code: "POLITICS_GEOPOLITICAL_ADMIN_ERROR", message: "Failed to record politics geopolitical operator approval intent." });
    }
  });

  app.post("/admin/politics-geopolitical-lanes/:laneId/hold", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = bodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success || !parsedBody.data.reason) {
      return reply.status(400).send({ code: "INVALID_REQUEST" });
    }
    if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }
    try {
      return reply.send(await deps.politicsGeopoliticalAdminService.holdLane(parsedParams.data.laneId, request.user.userId, parsedBody.data.reason));
    } catch (error) {
      if (error instanceof PoliticsGeopoliticalLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_GEOPOLITICAL_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to hold politics geopolitical lane.");
      return reply.status(500).send({ code: "POLITICS_GEOPOLITICAL_ADMIN_ERROR", message: "Failed to hold politics geopolitical lane." });
    }
  });

  app.post("/admin/politics-geopolitical-lanes/:laneId/rollback", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = bodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success || !parsedBody.data.reason) {
      return reply.status(400).send({ code: "INVALID_REQUEST" });
    }
    if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }
    try {
      return reply.send(await deps.politicsGeopoliticalAdminService.rollbackLane(parsedParams.data.laneId, request.user.userId, parsedBody.data.reason));
    } catch (error) {
      if (error instanceof PoliticsGeopoliticalLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_GEOPOLITICAL_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to roll back politics geopolitical lane.");
      return reply.status(500).send({ code: "POLITICS_GEOPOLITICAL_ADMIN_ERROR", message: "Failed to roll back politics geopolitical lane." });
    }
  });
};
