import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type {
  ExecutableRouteService,
  ExecutableTradeQuote,
  SellQuoteService
} from "../../execution-system/executable-routing.js";

const candidateSchema = z.object({
  venue: z.string().min(1),
  price: z.number().gt(0),
  availableSize: z.string().regex(/^\d+(\.\d+)?$/),
  routeType: z.enum(["CROSS_VENUE", "SINGLE_VENUE"]).optional(),
  requiresUserSignature: z.boolean().optional(),
  activationRequired: z.boolean().optional(),
  settlementEvidenceSupported: z.boolean().optional(),
  recoveryRequired: z.boolean().optional()
});

const quoteRequestSchema = z.object({
  side: z.enum(["buy", "sell"]),
  marketId: z.string().min(1),
  outcomeId: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  candidates: z.array(candidateSchema).min(1)
});

const submitRequestSchema = z.object({
  quoteId: z.string().min(1)
});

const exitRequestSchema = z.object({
  sellMode: z.enum(["SINGLE_VENUE_SELL", "SELL_ALL"]),
  venue: z.string().min(1).optional(),
  sizeMode: z.enum(["PERCENT", "CUSTOM_AMOUNT"]),
  percent: z.union([z.literal(25), z.literal(50), z.literal(100)]).optional(),
  amount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  marketId: z.string().min(1),
  outcomeId: z.string().min(1),
  candidates: z.array(candidateSchema).min(1)
});

export interface ExecutionRouteDeps {
  executableRouteService: ExecutableRouteService;
  sellQuoteService: SellQuoteService;
}

export const registerExecutionRoutes = async (
  app: FastifyInstance,
  authMiddleware: preHandlerHookHandler,
  deps: ExecutionRouteDeps
): Promise<void> => {
  app.post("/execution/quote", { preHandler: authMiddleware }, async (request, reply) => {
    const parsed = quoteRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Execution quote request validation failed.",
        details: parsed.error.flatten()
      });
    }
    const result = await deps.executableRouteService.quote({
      userId: request.user.userId,
      ...parsed.data
    });
    if (!result.quote) {
      return reply.status(409).send({
        code: "NO_EXECUTABLE_ROUTE",
        message: result.userMessage ?? "No executable route available right now."
      });
    }
    return reply.status(201).send({
      quote: toUserQuote(result.quote)
    });
  });

  app.post("/execution/submit", { preHandler: authMiddleware }, async (request, reply) => {
    const parsed = submitRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Execution submit request validation failed.",
        details: parsed.error.flatten()
      });
    }
    const quote = await deps.executableRouteService.getQuote(request.user.userId, parsed.data.quoteId);
    if (!quote) {
      return reply.status(404).send({
        code: "EXECUTION_QUOTE_NOT_FOUND",
        message: "Execution quote was not found or has expired."
      });
    }
    return reply.status(202).send({
      executionId: quote.quoteId,
      status: "READY_FOR_EXECUTION_OR_SIGNATURE",
      route: toUserQuote(quote),
      message: quote.requiredUserSignatureSteps.length > 0
        ? "User signature is required before this route can be submitted."
        : "Quote is executable. Live submit remains controlled by venue adapter flags."
    });
  });

  app.get("/execution/:executionId/status", { preHandler: authMiddleware }, async (request, reply) => {
    const { executionId } = request.params as { executionId: string };
    const quote = await deps.executableRouteService.getQuote(request.user.userId, executionId);
    if (!quote) {
      return reply.status(404).send({
        code: "EXECUTION_NOT_FOUND",
        message: "Execution status was not found."
      });
    }
    return reply.send({
      executionId,
      userStatus: "quote_ready",
      settlementStatus: "SETTLEMENT_PENDING",
      ghostFillStatus: "NOT_APPLICABLE",
      recoveryStatus: "none",
      route: toUserQuote(quote)
    });
  });

  app.post("/execution/:executionId/prepare-exit", { preHandler: authMiddleware }, async (request, reply) => {
    const parsed = exitRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Execution exit request validation failed.",
        details: parsed.error.flatten()
      });
    }
    try {
      const result = await deps.sellQuoteService.prepareExit({
        userId: request.user.userId,
        ...parsed.data
      });
      if (!result.quote) {
        return reply.status(409).send({
          code: "NO_EXECUTABLE_EXIT_ROUTE",
          message: result.userMessage ?? "No executable exit route available right now.",
          skippedAmount: result.skippedAmount
        });
      }
      return reply.status(201).send({
        quote: toUserQuote(result.quote),
        allocations: result.allocations.map((allocation) => ({
          venue: allocation.venue,
          positionId: allocation.positionId,
          sellSize: allocation.sellSize,
          availableSize: allocation.availableSize
        })),
        skippedAmount: result.skippedAmount
      });
    } catch (error) {
      return reply.status(409).send({
        code: "EXIT_QUOTE_REJECTED",
        message: error instanceof Error ? error.message : "Exit quote request rejected."
      });
    }
  });
};

const toUserQuote = (quote: ExecutableTradeQuote): Record<string, unknown> => ({
  quoteId: quote.quoteId,
  side: quote.side,
  marketId: quote.marketId,
  outcomeId: quote.outcomeId,
  routeType: quote.routeType,
  venuePath: quote.venuePath,
  executableAmount: quote.executableAmount,
  skippedAmount: quote.skippedAmount,
  expectedPrice: quote.expectedPrice,
  expectedFees: {},
  requiredUserSignatureSteps: quote.requiredUserSignatureSteps,
  expiresAt: quote.expiresAt,
  legs: quote.legs.map((leg) => ({
    venue: leg.venue,
    size: leg.size,
    price: leg.price,
    requiresUserSignature: leg.requiresUserSignature
  }))
});
