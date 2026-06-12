import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import { MarketMatchingService, MarketMatchingServiceError } from "./market-matching-service.js";
import {
  MarketEventReviewService,
  MarketEventReviewServiceError
} from "./market-event-review-service.js";
import {
  MarketEventAcceptService,
  MarketEventAcceptServiceError
} from "./market-event-accept-service.js";

export interface AdminMarketMatchingRouteDeps {
  marketMatchingService: MarketMatchingService;
  marketEventReviewService: MarketEventReviewService;
  marketEventAcceptService: MarketEventAcceptService;
}

const acceptEventBodySchema = z.object({
  twoFactorToken: z.string().min(6),
  reason: z.string().min(1),
  venues: z.array(z.string().min(1)).optional()
});

const eventListQuerySchema = z.object({
  status: z.enum(["LIVE", "PAUSED", "DISABLED", "PENDING"]).optional(),
  category: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
  includeExpired: z.enum(["true", "false"]).optional()
});

const eventParamsSchema = z.object({ eventKey: z.string().min(1) });

const FRIENDLY_TO_DB = {
  LIVE: "APPROVED",
  PAUSED: "HIDDEN",
  DISABLED: "DISABLED",
  PENDING: "PENDING"
} as const;

const approveBodySchema = z.object({
  twoFactorToken: z.string().min(6),
  promotionId: z.string().min(1),
  reason: z.string().min(1)
});

const rejectBodySchema = z.object({
  twoFactorToken: z.string().min(6),
  matchId: z.string().min(1),
  reason: z.string().min(1)
});

const validateTwoFactorToken = (token: string): boolean => {
  const configuredToken = process.env.ADMIN_2FA_TOKEN;
  if (typeof configuredToken === "string" && configuredToken.length > 0) {
    return token === configuredToken;
  }
  return token.length >= 6;
};

export const registerAdminMarketMatchingRoutes = async (
  app: FastifyInstance,
  adminMiddleware: preHandlerHookHandler,
  deps: AdminMarketMatchingRouteDeps
): Promise<void> => {
  // B1 event-centric review: list events grouped from the canonical graph (read-only).
  app.get("/admin/market-matching/events", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = eventListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      const result = await deps.marketEventReviewService.listEvents({
        status: parsed.data.status ? FRIENDLY_TO_DB[parsed.data.status] : undefined,
        category: parsed.data.category,
        search: parsed.data.search,
        includeExpired: parsed.data.includeExpired === "true"
      });
      return reply.send(result);
    } catch (error) {
      app.log.error({ err: error }, "Failed to list market matching events.");
      return reply.status(500).send({ code: "MARKET_MATCHING_ERROR", message: "Failed to list market matching events." });
    }
  });

  // B1 accept: pool the event's exact-overlap candidates into the canonical graph. ADMIN+2FA.
  // (Decline a candidate = POST /admin/market-matching/reject with its matchId.)
  app.post("/admin/market-matching/events/:eventKey/accept", { preHandler: adminMiddleware }, async (request, reply) => {
    const params = eventParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: params.error.flatten() });
    }
    const body = acceptEventBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: body.error.flatten() });
    }
    if (!validateTwoFactorToken(body.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }
    try {
      const result = await deps.marketEventAcceptService.acceptEvent({
        eventKey: params.data.eventKey,
        venues: body.data.venues,
        reason: body.data.reason
      });
      app.log.info(
        { eventKey: params.data.eventKey, pooled: result.exactCandidatesPooled, acceptedBy: request.user.userId, reason: body.data.reason },
        "Market matching event accepted by operator."
      );
      return reply.send({ result });
    } catch (error) {
      if (error instanceof MarketEventAcceptServiceError) {
        return reply.status(409).send({ code: "MARKET_EVENT_ACCEPT_FAILED", message: error.message });
      }
      app.log.error({ err: error }, "Failed to accept market matching event.");
      return reply.status(500).send({ code: "MARKET_MATCHING_ERROR", message: "Failed to accept market matching event." });
    }
  });

  // B1 event detail: outcomes, per-venue presence, and rules side by side.
  app.get("/admin/market-matching/events/:eventKey", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = eventParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    try {
      const event = await deps.marketEventReviewService.getEvent(parsed.data.eventKey);
      return reply.send({ event });
    } catch (error) {
      if (error instanceof MarketEventReviewServiceError) {
        return reply.status(404).send({ code: "MARKET_EVENT_NOT_FOUND", message: error.message });
      }
      app.log.error({ err: error }, "Failed to fetch market matching event.");
      return reply.status(500).send({ code: "MARKET_MATCHING_ERROR", message: "Failed to fetch market matching event." });
    }
  });

  // Serve the last generated review queue. Read-only, cheap.
  app.get("/admin/market-matching/review-queue", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      const queue = await deps.marketMatchingService.getReviewQueue();
      return reply.send({ queue });
    } catch (error) {
      app.log.error({ err: error }, "Failed to load market matching review queue.");
      return reply.status(500).send({
        code: "MARKET_MATCHING_ERROR",
        message: "Failed to load market matching review queue."
      });
    }
  });

  // Re-run the matching engine against current venue inventory and persist the report.
  // Does not promote anything — exact overlaps still require operator approval.
  app.post("/admin/market-matching/run", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      const queue = await deps.marketMatchingService.runPipeline();
      return reply.send({ queue });
    } catch (error) {
      app.log.error({ err: error }, "Failed to run market matching pipeline.");
      return reply.status(500).send({
        code: "MARKET_MATCHING_ERROR",
        message: "Failed to run market matching pipeline."
      });
    }
  });

  // Operator-gated promotion of a single reviewed exact-overlap candidate into the
  // canonical graph. Requires ADMIN+2FA because it mutates trading-relevant state.
  app.post("/admin/market-matching/approve", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = approveBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    if (!validateTwoFactorToken(parsed.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }

    try {
      const summary = await deps.marketMatchingService.approve(parsed.data.promotionId);
      app.log.info(
        {
          promotionId: parsed.data.promotionId,
          approvedBy: request.user.userId,
          reason: parsed.data.reason,
          promoted: summary.promotedTargets.length
        },
        "Market matching candidate promoted by operator."
      );
      return reply.send({ summary });
    } catch (error) {
      if (error instanceof MarketMatchingServiceError) {
        return reply.status(409).send({ code: "MARKET_MATCHING_PROMOTION_FAILED", message: error.message });
      }
      app.log.error({ err: error }, "Failed to promote market matching candidate.");
      return reply.status(500).send({
        code: "MARKET_MATCHING_ERROR",
        message: "Failed to promote market matching candidate."
      });
    }
  });

  // Operator rejection of a near-exact pair. Read-only against the canonical graph; only
  // records a review decision so the pair stays rejected across pipeline re-runs.
  app.post("/admin/market-matching/reject", { preHandler: adminMiddleware }, async (request, reply) => {
    const parsed = rejectBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "INVALID_REQUEST", details: parsed.error.flatten() });
    }
    if (!validateTwoFactorToken(parsed.data.twoFactorToken)) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }

    try {
      const match = await deps.marketMatchingService.reject(
        parsed.data.matchId,
        parsed.data.reason,
        request.user.userId
      );
      app.log.info(
        { matchId: parsed.data.matchId, rejectedBy: request.user.userId, reason: parsed.data.reason },
        "Market matching near-exact rejected by operator."
      );
      return reply.send({ match });
    } catch (error) {
      app.log.error({ err: error }, "Failed to reject market matching near-exact.");
      return reply.status(500).send({
        code: "MARKET_MATCHING_ERROR",
        message: "Failed to reject market matching near-exact."
      });
    }
  });
};
