import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { CanonicalMarketFetchError } from "../../core/rfq-engine/canonical-market-client.js";
import {
  CanonicalMarketResolutionMetadataError,
  MarketInactiveError,
  type CreateRFQResult
} from "../../core/rfq-engine/create-rfq-service.js";
import { ResolutionRiskGroupingError } from "../../core/rfq-engine/resolution-risk-grouping-service.js";
import { RiskRejectedError } from "../../core/risk-engine.js";
import { InsufficientLiquidityError } from "../../core/sor/splitter.js";
import { MissingReservationTokenError } from "../../core/sor/order-router.js";
import {
  ExecutionScopeAuthorityError,
  ExecutionScopeTokenError,
  executionScopeKinds
} from "../../execution-control/execution-scope-token.js";

const createRFQRequestSchema = z.object({
  canonicalMarketId: z.string().min(1),
  takerId: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  quantity: z.string().regex(/^\d+(\.\d+)?$/),
  idempotencyKey: z.string().min(1),
  ttlSeconds: z.number().int().min(1).max(300)
});

type CreateRFQRequest = z.infer<typeof createRFQRequestSchema>;

const acceptRFQRequestSchema = z.object({
  quoteId: z.string().min(1),
  executionScopeToken: z.string().min(1).optional()
});

type AcceptRFQRequest = z.infer<typeof acceptRFQRequestSchema>;

const createExecutionScopeTokenRequestSchema = z.object({
  quoteId: z.string().min(1),
  scopeKind: z.enum(executionScopeKinds),
  scopeId: z.string().min(1),
  ttlSeconds: z.number().int().min(1).max(300).optional()
});

type CreateExecutionScopeTokenRequest = z.infer<typeof createExecutionScopeTokenRequestSchema>;

interface CreateExecutionScopeTokenResponse {
  token: string;
  expiresAt: string;
  singleUse: true;
  scope: {
    scopeKind: string;
    scopeId: string;
    topicKey: string;
    laneType: string;
    venueSet: readonly string[];
    candidateSet: readonly string[];
  };
}

interface AcceptRFQResponse {
  status: "PLAN_ACCEPTED";
  plan_id: string;
  plan_state: string;
  dispatch_mode: "awaited" | "background";
  final_status?: "COMPLETED" | "PARTIAL" | "FAILED" | "UNWOUND";
  execution_id?: string | null;
}

export interface RFQRouteHandlers {
  createRFQ(request: CreateRFQRequest): Promise<CreateRFQResult>;
  createExecutionScopeToken(
    sessionId: string,
    request: CreateExecutionScopeTokenRequest
  ): Promise<CreateExecutionScopeTokenResponse>;
  acceptRFQ(sessionId: string, request: AcceptRFQRequest): Promise<AcceptRFQResponse>;
  getExecutionStatus?(sessionId: string, executionId: string): Promise<unknown>;
}

export const registerRFQRoute = async (
  app: FastifyInstance,
  authMiddleware: preHandlerHookHandler,
  handlers: RFQRouteHandlers
): Promise<void> => {
  app.post("/rfq", { preHandler: authMiddleware }, async (request, reply) => {
    const parsed = createRFQRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "RFQ request validation failed.",
        details: parsed.error.flatten()
      });
    }

    try {
      const result = await handlers.createRFQ(parsed.data);
      return reply.status(201).send(result);
    } catch (error) {
      if (error instanceof RiskRejectedError) {
        return reply.status(403).send({
          error: "risk_rejected",
          reason: "quota_exceeded",
          message: error.message
        });
      }

      if (error instanceof MarketInactiveError) {
        return reply.status(409).send({
          code: "MARKET_INACTIVE",
          message: error.message
        });
      }

      if (error instanceof CanonicalMarketFetchError) {
        return reply.status(502).send({
          code: "CANONICAL_SERVICE_ERROR",
          message: error.message
        });
      }

      if (
        error instanceof CanonicalMarketResolutionMetadataError ||
        error instanceof ResolutionRiskGroupingError
      ) {
        return reply.status(409).send({
          code: "RESOLUTION_RISK_GROUPING_FAILED",
          message: error.message
        });
      }

      throw error;
    }
  });

  app.post("/rfq/:id/execution-scope-token", { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = createExecutionScopeTokenRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Execution scope token request validation failed.",
        details: parsed.error.flatten()
      });
    }

    try {
      const result = await handlers.createExecutionScopeToken(id, parsed.data);
      return reply.status(201).send(result);
    } catch (error) {
      if (error instanceof ExecutionScopeTokenError || error instanceof ExecutionScopeAuthorityError) {
        return reply.status(409).send({
          code: "EXECUTION_SCOPE_NOT_AVAILABLE",
          message: error.message
        });
      }
      throw error;
    }
  });

  app.post("/rfq/:id/accept", { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = acceptRFQRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Accept RFQ request validation failed.",
        details: parsed.error.flatten()
      });
    }

    try {
      const result = await handlers.acceptRFQ(id, parsed.data);
      return reply.status(202).send(result);
    } catch (error) {
      if (error instanceof InsufficientLiquidityError) {
        return reply.status(409).send({
          code: "PLAN_REJECTED",
          reason: "insufficient_liquidity",
          message: error.message,
          details: {
            legId: error.legId,
            remainingSize: error.remainingSize
          }
        });
      }

      if (error instanceof RiskRejectedError) {
        return reply.status(409).send({
          code: "PLAN_REJECTED",
          reason: "risk_rejected",
          message: error.message
        });
      }

      if (error instanceof MissingReservationTokenError) {
        return reply.status(409).send({
          code: "PLAN_REJECTED",
          reason: "risk_rejected",
          message: error.message
        });
      }
      if (error instanceof ExecutionScopeTokenError || error instanceof ExecutionScopeAuthorityError) {
        return reply.status(409).send({
          code: "PLAN_REJECTED",
          reason: "execution_scope_invalid",
          message: error.message
        });
      }
      throw error;
    }
  });

  app.get("/rfq/:id/executions/:executionId/status", { preHandler: authMiddleware }, async (request, reply) => {
    if (!handlers.getExecutionStatus) {
      return reply.status(404).send({
        code: "EXECUTION_STATUS_NOT_AVAILABLE",
        message: "Execution status lookup is not configured."
      });
    }

    const { id, executionId } = request.params as { id: string; executionId: string };
    const result = await handlers.getExecutionStatus(id, executionId);
    if (!result) {
      return reply.status(404).send({
        code: "EXECUTION_NOT_FOUND",
        message: "Execution status was not found."
      });
    }
    return reply.status(200).send(result);
  });
};
