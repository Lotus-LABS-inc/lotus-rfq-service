import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import {
  PoliticsPartyControlAdminService,
  PoliticsPartyControlLaneNotFoundError,
  PoliticsPartyControlLaneTransitionError
} from "./politics-party-control-admin-service.js";
import { politicsPartyControlLaneIds } from "../../operations/semantic-expansion/politics-party-control-limited-prod-shared.js";

const laneIdSchema = z.enum(politicsPartyControlLaneIds);
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

export interface AdminPoliticsPartyControlRouteDeps {
  politicsPartyControlAdminService: PoliticsPartyControlAdminService;
}

export const registerAdminPoliticsPartyControlRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminPoliticsPartyControlRouteDeps
): Promise<void> => {
  app.get("/admin/politics-party-control-lanes", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      return reply.send({ lanes: await deps.politicsPartyControlAdminService.listLanes() });
    } catch (error) {
      app.log.error({ err: error }, "Failed to list politics party-control lanes.");
      return reply.status(500).send({ code: "POLITICS_PARTY_CONTROL_ADMIN_ERROR", message: "Failed to list politics party-control lanes." });
    }
  });

  app.get("/admin/politics-party-control-lanes/:laneId", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ lane: await deps.politicsPartyControlAdminService.getLane(parsed.data.laneId) });
    } catch (error) {
      if (error instanceof PoliticsPartyControlLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_PARTY_CONTROL_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load politics party-control lane.");
      return reply.status(500).send({ code: "POLITICS_PARTY_CONTROL_ADMIN_ERROR", message: "Failed to load politics party-control lane." });
    }
  });

  app.get("/admin/politics-party-control-lanes/:laneId/readiness", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ readiness: await deps.politicsPartyControlAdminService.getReadiness(parsed.data.laneId) });
    } catch (error) {
      if (error instanceof PoliticsPartyControlLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_PARTY_CONTROL_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load politics party-control readiness.");
      return reply.status(500).send({ code: "POLITICS_PARTY_CONTROL_ADMIN_ERROR", message: "Failed to load politics party-control readiness." });
    }
  });

  app.get("/admin/politics-party-control-lanes/:laneId/rollback-plan", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      return reply.send({ rollbackPlan: await deps.politicsPartyControlAdminService.getRollbackPlan(parsed.data.laneId) });
    } catch (error) {
      if (error instanceof PoliticsPartyControlLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_PARTY_CONTROL_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to load politics party-control rollback plan.");
      return reply.status(500).send({ code: "POLITICS_PARTY_CONTROL_ADMIN_ERROR", message: "Failed to load politics party-control rollback plan." });
    }
  });

  app.post("/admin/politics-party-control-lanes/:laneId/operator-approval-intent", { preHandler: adminMiddleware }, async (request, reply) => {
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
        approvalIntent: await deps.politicsPartyControlAdminService.recordOperatorApprovalIntent(
          parsedParams.data.laneId,
          request.user.userId,
          parsedBody.data.reason ?? null
        )
      });
    } catch (error) {
      if (error instanceof PoliticsPartyControlLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_PARTY_CONTROL_LANE_NOT_FOUND", message: error.message });
      }
      if (error instanceof PoliticsPartyControlLaneTransitionError) {
        return reply.status(409).send({ code: "POLITICS_PARTY_CONTROL_INVALID_TRANSITION", message: error.message });
      }
      app.log.error({ err: error }, "Failed to record politics party-control operator approval intent.");
      return reply.status(500).send({ code: "POLITICS_PARTY_CONTROL_ADMIN_ERROR", message: "Failed to record politics party-control operator approval intent." });
    }
  });

  app.post("/admin/politics-party-control-lanes/:laneId/hold", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = bodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success || !parsedBody.data.reason) {
      return reply.status(400).send({ code: "INVALID_REQUEST" });
    }
    if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }
    try {
      return reply.send(await deps.politicsPartyControlAdminService.holdLane(parsedParams.data.laneId, request.user.userId, parsedBody.data.reason));
    } catch (error) {
      if (error instanceof PoliticsPartyControlLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_PARTY_CONTROL_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to hold politics party-control lane.");
      return reply.status(500).send({ code: "POLITICS_PARTY_CONTROL_ADMIN_ERROR", message: "Failed to hold politics party-control lane." });
    }
  });

  app.post("/admin/politics-party-control-lanes/:laneId/rollback", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = bodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success || !parsedBody.data.reason) {
      return reply.status(400).send({ code: "INVALID_REQUEST" });
    }
    if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }
    try {
      return reply.send(await deps.politicsPartyControlAdminService.rollbackLane(parsedParams.data.laneId, request.user.userId, parsedBody.data.reason));
    } catch (error) {
      if (error instanceof PoliticsPartyControlLaneNotFoundError) {
        return reply.status(404).send({ code: "POLITICS_PARTY_CONTROL_LANE_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to roll back politics party-control lane.");
      return reply.status(500).send({ code: "POLITICS_PARTY_CONTROL_ADMIN_ERROR", message: "Failed to roll back politics party-control lane." });
    }
  });
};
