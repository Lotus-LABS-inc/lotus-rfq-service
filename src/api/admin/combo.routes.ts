import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { IComboRepository } from "../../repositories/combo.repository.js";
import type { IExposureRepository } from "../../repositories/exposure.repository.js";
import type { ExposureRedisCache } from "../../repositories/exposure-redis-cache.js";

const comboIdParamsSchema = z.object({
  id: z.string().min(1)
});

const forceFailBodySchema = z.object({
  reason: z.string().min(1, "reason is required"),
  correlationId: z.string().min(1).optional()
});

const forceCompleteBodySchema = z.object({
  reason: z.string().min(1, "reason is required"),
  correlationId: z.string().min(1).optional(),
  twoFactorToken: z.string().min(6, "twoFactorToken is required for ADMIN+2FA operations")
});

export interface AdminComboRouteDeps {
  comboRepo: IComboRepository;
  exposureRepo: IExposureRepository;
  exposureCache: ExposureRedisCache;
}

export const registerAdminComboRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminComboRouteDeps
): Promise<void> => {
  app.get(
    "/admin/combo/:id",
    { preHandler: adminMiddleware },
    async (request, reply) => {
      const parsedParams = comboIdParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(400).send(parsedParams.error.flatten());
      }

      const comboId = parsedParams.data.id;

      try {
        const session = await deps.comboRepo.getSession(comboId);
        if (!session) {
          return reply.status(404).send({ error: "Combo not found" });
        }

        const perLegExposure = await Promise.all(
          session.legs.map(async (leg) => {
            const [pgExposure, redisExposure] = await Promise.all([
              deps.exposureRepo.getExposure(session.userId, leg.canonicalMarketId, leg.side),
              deps.exposureCache.getRollingExposure(session.userId, leg.canonicalMarketId)
            ]);

            return {
              legId: leg.id,
              canonicalMarketId: leg.canonicalMarketId,
              side: leg.side,
              postgres: pgExposure
                ? {
                    gross: pgExposure.gross_notional,
                    net: pgExposure.net_notional,
                    lastUpdated: pgExposure.last_updated
                  }
                : null,
              redisRolling: redisExposure
            };
          })
        );

        return {
          comboId: session.id,
          state: session.state,
          acceptancePolicy: session.acceptancePolicy,
          expiresAt: session.expiresAt,
          legs: session.legs,
          exposure: perLegExposure,
          plan: null,
          executions: []
        };
      } catch (error) {
        app.log.error({ err: error, comboId }, "Failed to load combo admin snapshot.");
        return reply.status(500).send({ error: "Internal server error" });
      }
    }
  );

  app.post(
    "/admin/combo/:id/force-fail",
    { preHandler: adminMiddleware },
    async (request, reply) => {
      const parsedParams = comboIdParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(400).send(parsedParams.error.flatten());
      }

      const parsedBody = forceFailBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.status(400).send(parsedBody.error.flatten());
      }

      const comboId = parsedParams.data.id;
      const { reason, correlationId } = parsedBody.data;

      try {
        const session = await deps.comboRepo.getSession(comboId);
        if (!session) {
          return reply.status(404).send({ error: "Combo not found" });
        }

        if (session.state === "FAILED" || session.state === "EXECUTED") {
          return reply.status(409).send({
            error: "Combo is already terminal",
            state: session.state
          });
        }

        await deps.comboRepo.updateSessionState(comboId, "FAILED" as any);

        app.log.warn(
          {
            comboId,
            reason,
            correlationId,
            previousState: session.state
          },
          "Admin force-failed combo."
        );

        return { ok: true, comboId, state: "FAILED" };
      } catch (error) {
        app.log.error({ err: error, comboId }, "Failed to force-fail combo.");
        return reply.status(500).send({ error: "Internal server error" });
      }
    }
  );

  app.post(
    "/admin/combo/:id/force-complete",
    { preHandler: adminMiddleware },
    async (request, reply) => {
      const parsedParams = comboIdParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(400).send(parsedParams.error.flatten());
      }

      const parsedBody = forceCompleteBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.status(400).send(parsedBody.error.flatten());
      }

      const comboId = parsedParams.data.id;
      const { reason, correlationId, twoFactorToken } = parsedBody.data;

      if (!twoFactorToken || twoFactorToken.length < 6) {
        return reply.status(403).send({ error: "ADMIN+2FA required" });
      }

      try {
        const session = await deps.comboRepo.getSession(comboId);
        if (!session) {
          return reply.status(404).send({ error: "Combo not found" });
        }

        if (session.state === "FAILED" || session.state === "EXECUTED") {
          return reply.status(409).send({
            error: "Combo is already terminal",
            state: session.state
          });
        }

        await deps.comboRepo.updateSessionState(comboId, "EXECUTED" as any);

        app.log.warn(
          {
            comboId,
            reason,
            correlationId,
            previousState: session.state
          },
          "Admin force-completed combo via ADMIN+2FA."
        );

        return { ok: true, comboId, state: "EXECUTED" };
      } catch (error) {
        app.log.error({ err: error, comboId }, "Failed to force-complete combo.");
        return reply.status(500).send({ error: "Internal server error" });
      }
    }
  );
};

