import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import {
  InternalCrossAdminService,
  InternalCrossAmbiguityError,
  InternalCrossOrderNotFoundError,
  InternalCrossTradeNotFoundError
} from "./internal-cross-admin-service.js";

const paramsSchema = z.object({
  id: z.string().uuid()
});

const removeFromBookBodySchema = z.object({
  reason: z.string().min(1).optional(),
  twoFactorToken: z.string().min(6, "twoFactorToken is required for ADMIN+2FA operations")
});

const reconcileBodySchema = z.object({
  dryRun: z.boolean().default(true),
  force: z.boolean().default(false),
  twoFactorToken: z.string().min(6, "twoFactorToken is required for ADMIN+2FA operations")
});

const forceUnwindBodySchema = z.object({
  reason: z.string().min(1, "reason is required"),
  twoFactorToken: z.string().min(6, "twoFactorToken is required for ADMIN+2FA operations")
});

export interface AdminInternalCrossRouteDeps {
  internalCrossAdminService: InternalCrossAdminService;
}

export const registerAdminInternalCrossRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminInternalCrossRouteDeps
): Promise<void> => {
  app.get("/admin/internal-cross/trade/:id", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send(parsedParams.error.flatten());
    }

    try {
      const inspection = await deps.internalCrossAdminService.getTradeInspection(parsedParams.data.id);
      return reply.send(inspection);
    } catch (error) {
      if (error instanceof InternalCrossTradeNotFoundError) {
        return reply.status(404).send({ code: "TRADE_NOT_FOUND", message: error.message });
      }
      if (error instanceof InternalCrossAmbiguityError) {
        return reply.status(500).send({ code: "INTERNAL_AMBIGUITY", message: error.message });
      }
      app.log.error({ err: error, tradeId: parsedParams.data.id }, "Failed to inspect internal cross trade.");
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Failed to inspect internal cross trade." });
    }
  });

  app.get("/admin/internal-cross/order/:id", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send(parsedParams.error.flatten());
    }

    try {
      const inspection = await deps.internalCrossAdminService.getOrderInspection(parsedParams.data.id);
      return reply.send(inspection);
    } catch (error) {
      if (error instanceof InternalCrossOrderNotFoundError) {
        return reply.status(404).send({ code: "ORDER_NOT_FOUND", message: error.message });
      }
      if (error instanceof InternalCrossAmbiguityError) {
        return reply.status(500).send({ code: "INTERNAL_AMBIGUITY", message: error.message });
      }
      app.log.error({ err: error, orderId: parsedParams.data.id }, "Failed to inspect internal cross order.");
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Failed to inspect internal cross order." });
    }
  });

  app.post("/admin/internal-cross/order/:id/remove-from-book", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send(parsedParams.error.flatten());
    }
    const parsedBody = removeFromBookBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.status(400).send(parsedBody.error.flatten());
    }

    try {
      const result = await deps.internalCrossAdminService.removeOrderFromBook({
        orderId: parsedParams.data.id,
        requestedBy: request.user.userId,
        ...(parsedBody.data.reason ? { reason: parsedBody.data.reason } : {})
      });
      return reply.send(result);
    } catch (error) {
      if (error instanceof InternalCrossOrderNotFoundError) {
        return reply.status(404).send({ code: "ORDER_NOT_FOUND", message: error.message });
      }
      if (error instanceof InternalCrossAmbiguityError) {
        return reply.status(500).send({ code: "INTERNAL_AMBIGUITY", message: error.message });
      }
      app.log.error({ err: error, orderId: parsedParams.data.id }, "Failed to remove internal cross order from book.");
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Failed to remove internal cross order from book." });
    }
  });

  app.post("/admin/internal-cross/trade/:id/reconcile", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send(parsedParams.error.flatten());
    }
    const parsedBody = reconcileBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.status(400).send(parsedBody.error.flatten());
    }

    try {
      const result = await deps.internalCrossAdminService.reconcileTrade({
        tradeId: parsedParams.data.id,
        requestedBy: request.user.userId,
        dryRun: parsedBody.data.dryRun,
        force: parsedBody.data.force
      });
      return reply.send(result);
    } catch (error) {
      if (error instanceof InternalCrossTradeNotFoundError) {
        return reply.status(404).send({ code: "TRADE_NOT_FOUND", message: error.message });
      }
      if (error instanceof InternalCrossAmbiguityError) {
        return reply.status(500).send({ code: "INTERNAL_AMBIGUITY", message: error.message });
      }
      app.log.error({ err: error, tradeId: parsedParams.data.id }, "Failed to reconcile internal cross trade.");
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Failed to reconcile internal cross trade." });
    }
  });

  app.post("/admin/internal-cross/trade/:id/force-unwind", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send(parsedParams.error.flatten());
    }
    const parsedBody = forceUnwindBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.status(400).send(parsedBody.error.flatten());
    }

    try {
      const result = await deps.internalCrossAdminService.createForceUnwindTask({
        tradeId: parsedParams.data.id,
        requestedBy: request.user.userId,
        reason: parsedBody.data.reason
      });
      return reply.send(result);
    } catch (error) {
      if (error instanceof InternalCrossTradeNotFoundError) {
        return reply.status(404).send({ code: "TRADE_NOT_FOUND", message: error.message });
      }
      if (error instanceof InternalCrossAmbiguityError) {
        return reply.status(500).send({ code: "INTERNAL_AMBIGUITY", message: error.message });
      }
      app.log.error({ err: error, tradeId: parsedParams.data.id }, "Failed to create internal cross unwind task.");
      return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Failed to create internal cross unwind task." });
    }
  });
};
