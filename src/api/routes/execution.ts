import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type {
  ExecutableRouteService,
  ExecutableTradeQuote,
  SellQuoteService
} from "../../execution-system/executable-routing.js";
import {
  SignedTradeBundleError,
  type SignedTradeBundleService
} from "../../execution-system/signed-trade-bundle.js";

const candidateSchema = z.object({
  venue: z.string().min(1),
  venueMarketId: z.string().min(1).optional(),
  venueOutcomeId: z.string().min(1).optional(),
  price: z.number().gt(0),
  availableSize: z.string().regex(/^\d+(\.\d+)?$/),
  routeType: z.enum(["CROSS_VENUE", "SINGLE_VENUE"]).optional(),
  requiresUserSignature: z.boolean().optional(),
  activationRequired: z.boolean().optional(),
  settlementEvidenceSupported: z.boolean().optional(),
  recoveryRequired: z.boolean().optional(),
  feeBps: z.number().nonnegative().optional(),
  feeAmount: z.number().nonnegative().optional(),
  effectiveFeeBps: z.number().nonnegative().optional(),
  feeModel: z.string().optional(),
  feeSource: z.string().optional(),
  feeConfidence: z.string().optional(),
  fixedFee: z.number().nonnegative().optional(),
  spreadBps: z.number().nonnegative().optional(),
  slippageBps: z.number().nonnegative().optional(),
  liquidityScore: z.number().min(0).max(1).optional(),
  quoteQuality: z.string().optional(),
  freshnessMs: z.number().nonnegative().optional(),
  confidencePenaltyBps: z.number().nonnegative().optional(),
  quoteBlockers: z.array(z.string()).optional(),
  missingFactors: z.array(z.string()).optional()
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

const signedBundleSubmitSchema = z.object({
  signedLegs: z.array(z.object({
    legIndex: z.number().int().nonnegative(),
    venue: z.string().min(1),
    signedPayload: z.record(z.string(), z.unknown())
  })),
  dryRun: z.boolean().optional()
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
  signedTradeBundleService?: SignedTradeBundleService | undefined;
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

  app.post("/execution/:executionId/prepare-signatures", { preHandler: authMiddleware }, async (request, reply) => {
    if (!deps.signedTradeBundleService) {
      return reply.status(501).send({
        code: "SIGNED_TRADE_BUNDLE_NOT_CONFIGURED",
        message: "Signed trade bundle preparation is not configured on this backend."
      });
    }
    const { executionId } = request.params as { executionId: string };
    try {
      const bundle = await deps.signedTradeBundleService.prepare({
        userId: request.user.userId,
        quoteId: executionId
      });
      return reply.send(bundle);
    } catch (error) {
      if (error instanceof SignedTradeBundleError) {
        return reply.status(error.statusCode).send({ code: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.post("/execution/:executionId/submit-signed-bundle", { preHandler: authMiddleware }, async (request, reply) => {
    if (!deps.signedTradeBundleService) {
      return reply.status(501).send({
        code: "SIGNED_TRADE_BUNDLE_NOT_CONFIGURED",
        message: "Signed trade bundle submission is not configured on this backend."
      });
    }
    const parsed = signedBundleSubmitSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Signed trade bundle request validation failed.",
        details: parsed.error.flatten()
      });
    }
    const { executionId } = request.params as { executionId: string };
    try {
      const result = await deps.signedTradeBundleService.submit({
        userId: request.user.userId,
        quoteId: executionId,
        signedLegs: parsed.data.signedLegs,
        dryRun: parsed.data.dryRun
      });
      return reply.status(parsed.data.dryRun === true ? 200 : 202).send(result);
    } catch (error) {
      if (error instanceof SignedTradeBundleError) {
        return reply.status(error.statusCode).send({ code: error.code, message: error.message });
      }
      throw error;
    }
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
  effectivePrice: quote.effectivePrice,
  estimatedSavings: quote.estimatedSavings,
  savingsBreakdown: quote.savingsBreakdown,
  routeDecisionReason: quote.routeDecisionReason,
  expectedFees: {
    total: quote.legs.reduce((sum, leg) => sum + (leg.feeAmount ?? 0), 0),
    effectiveBpsByVenue: Object.fromEntries(quote.legs.map((leg) => [leg.venue, leg.effectiveFeeBps ?? null]))
  },
  requiredUserSignatureSteps: quote.requiredUserSignatureSteps,
  expiresAt: quote.expiresAt,
  legs: quote.legs.map((leg) => ({
    venue: leg.venue,
    venueMarketId: leg.venueMarketId,
    venueOutcomeId: leg.venueOutcomeId,
    size: leg.size,
    price: leg.price,
    feeAmount: leg.feeAmount,
    effectiveFeeBps: leg.effectiveFeeBps,
    feeConfidence: leg.feeConfidence,
    requiresUserSignature: leg.requiresUserSignature
  }))
});
