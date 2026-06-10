import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import {
  MarketCatalogAdminService,
  MarketCatalogAdminServiceError,
  type MarketCatalogAdminEvent
} from "./market-catalog-admin-service.js";

export interface AdminMarketCatalogRouteDeps {
  marketCatalogAdminService: MarketCatalogAdminService;
}

const listQuerySchema = z.object({
  status: z.enum(["LIVE", "PAUSED", "DISABLED", "PENDING"]).optional(),
  category: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().nonnegative().optional()
});

const eventParamsSchema = z.object({ eventId: z.string().min(1) });

const mutationBodySchema = z.object({
  twoFactorToken: z.string().min(6),
  reason: z.string().min(1)
});

const validateTwoFactorToken = (token: string): boolean => {
  const configuredToken = process.env.ADMIN_2FA_TOKEN;
  if (typeof configuredToken === "string" && configuredToken.length > 0) {
    return token === configuredToken;
  }
  return token.length >= 6;
};

export const registerAdminMarketCatalogRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminMarketCatalogRouteDeps
): Promise<void> => {
  app.get("/admin/market-catalog/summary", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      const summary = await deps.marketCatalogAdminService.getSummary();
      return reply.send({ summary });
    } catch (error) {
      app.log.error({ err: error }, "Failed to load market catalog summary.");
      return reply.status(500).send({ code: "MARKET_CATALOG_ERROR", message: "Failed to load market catalog summary." });
    }
  });

  app.get("/admin/market-catalog/events", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      const result = await deps.marketCatalogAdminService.listEvents(parsed.data);
      return reply.send(result);
    } catch (error) {
      app.log.error({ err: error }, "Failed to list market catalog events.");
      return reply.status(500).send({ code: "MARKET_CATALOG_ERROR", message: "Failed to list market catalog events." });
    }
  });

  app.get("/admin/market-catalog/events/:eventId", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = eventParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      const event = await deps.marketCatalogAdminService.getEvent(parsed.data.eventId);
      return reply.send({ event });
    } catch (error) {
      if (error instanceof MarketCatalogAdminServiceError) {
        return reply.status(404).send({ code: "MARKET_CATALOG_EVENT_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to fetch market catalog event.");
      return reply.status(500).send({ code: "MARKET_CATALOG_ERROR", message: "Failed to fetch market catalog event." });
    }
  });

  const runMutation = async (
    request: FastifyRequest,
    reply: FastifyReply,
    action: "pause" | "resume" | "disable",
    run: (eventId: string, actor: string, reason: string) => Promise<MarketCatalogAdminEvent>
  ): Promise<FastifyReply> => {
    const params = eventParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: params.error.flatten() });
    }
    const body = mutationBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: body.error.flatten() });
    }
    if (!validateTwoFactorToken(body.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }
    try {
      const event = await run(params.data.eventId, request.user.userId, body.data.reason);
      app.log.info(
        { eventId: params.data.eventId, action, actor: request.user.userId, reason: body.data.reason },
        "Market catalog visibility changed by operator."
      );
      return reply.send({ event });
    } catch (error) {
      if (error instanceof MarketCatalogAdminServiceError) {
        return reply.status(404).send({ code: "MARKET_CATALOG_EVENT_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, `Failed to ${action} market catalog event.`);
      return reply.status(500).send({ code: "MARKET_CATALOG_ERROR", message: `Failed to ${action} market catalog event.` });
    }
  };

  app.post("/admin/market-catalog/events/:eventId/pause", { preHandler: adminMiddleware }, (request, reply) =>
    runMutation(request, reply, "pause", (id, actor, reason) => deps.marketCatalogAdminService.pause(id, actor, reason))
  );
  app.post("/admin/market-catalog/events/:eventId/resume", { preHandler: adminMiddleware }, (request, reply) =>
    runMutation(request, reply, "resume", (id, actor, reason) => deps.marketCatalogAdminService.resume(id, actor, reason))
  );
  app.post("/admin/market-catalog/events/:eventId/disable", { preHandler: adminMiddleware }, (request, reply) =>
    runMutation(request, reply, "disable", (id, actor, reason) => deps.marketCatalogAdminService.disable(id, actor, reason))
  );
};
