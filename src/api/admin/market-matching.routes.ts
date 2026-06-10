import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import { MarketMatchingService, MarketMatchingServiceError } from "./market-matching-service.js";

export interface AdminMarketMatchingRouteDeps {
  marketMatchingService: MarketMatchingService;
}

const approveBodySchema = z.object({
  twoFactorToken: z.string().min(6),
  promotionId: z.string().min(1),
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
  // Serve the last generated review queue. Read-only, cheap.
  app.get("/admin/market-matching/review-queue", { preHandler: adminMiddleware }, async (_request, reply) => {
    try {
      const queue = deps.marketMatchingService.getReviewQueue();
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
};
