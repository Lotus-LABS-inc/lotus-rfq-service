import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  PolymarketFundingBalanceReadNotConfiguredError,
  type PolymarketFundingBalanceReadService
} from "../../core/funding/polymarket-balance-read-service.js";

const balanceQuerySchema = z.object({
  userId: z.string().min(1),
  fundingIntentId: z.string().min(1),
  routeLegId: z.string().min(1)
});

export interface InternalPolymarketFundingBalanceRouteConfig {
  bearerToken?: string | undefined;
  nodeEnv?: string | undefined;
}

const isLoopbackRequest = (request: FastifyRequest): boolean => {
  const hostHeader = typeof request.headers.host === "string" ? request.headers.host : "";
  const host = hostHeader.split(":")[0]?.toLowerCase() ?? "";
  return host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    request.ip === "127.0.0.1" ||
    request.ip === "::1" ||
    request.ip === "::ffff:127.0.0.1";
};

const authorizeInternalRead = (
  request: FastifyRequest,
  config: InternalPolymarketFundingBalanceRouteConfig
): boolean => {
  const token = config.bearerToken?.trim();
  if (token) {
    const authorization = typeof request.headers.authorization === "string" ? request.headers.authorization : "";
    return authorization === `Bearer ${token}`;
  }
  if (config.nodeEnv === "production") {
    return false;
  }
  return isLoopbackRequest(request);
};

export const registerInternalPolymarketFundingBalanceRoute = async (
  app: FastifyInstance,
  service: PolymarketFundingBalanceReadService,
  config: InternalPolymarketFundingBalanceRouteConfig = {}
): Promise<void> => {
  app.get("/internal/polymarket/funding-balance", async (request, reply) => {
    if (!authorizeInternalRead(request, config)) {
      return reply.status(401).send({
        code: "UNAUTHORIZED",
        message: "Internal Polymarket funding balance read is not authorized."
      });
    }

    const parsed = balanceQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Polymarket funding balance request validation failed.",
        details: parsed.error.flatten()
      });
    }

    try {
      const result = await service.readUsableBalance(parsed.data);
      return reply.status(200).send({ usableBalance: result.usableBalance });
    } catch (error) {
      return handlePolymarketFundingBalanceReadError(error, reply);
    }
  });
};

const handlePolymarketFundingBalanceReadError = (error: unknown, reply: FastifyReply) => {
  if (error instanceof PolymarketFundingBalanceReadNotConfiguredError) {
    return reply.status(503).send({
      code: "POLYMARKET_BALANCE_READ_NOT_CONFIGURED",
      message: "Polymarket funding balance read is disabled or incomplete."
    });
  }

  return reply.status(502).send({
    code: "POLYMARKET_BALANCE_READ_UNAVAILABLE",
    message: "Polymarket funding balance read is unavailable."
  });
};
