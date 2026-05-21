import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type {
  ExecutableRouteService,
  ExecutableTradeQuote,
  SellQuoteService,
  TradeRouteCandidate,
  VerifiedExecutionPosition,
  VerifiedPositionRepository
} from "../../execution-system/executable-routing.js";
import {
  SignedTradeBundleError,
  type SignedTradeExecutionStatus,
  type SignedTradeBundleService
} from "../../execution-system/signed-trade-bundle.js";
import type { CalculatedVenueQuoteSnapshot, VenueQuoteSnapshotBlocker } from "../../core/sor/quote-snapshot.js";
import type { ExecutionVenueReadinessSummary } from "../admin/execution-venues-admin-service.js";

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
  missingFactors: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const quoteRequestSchema = z.object({
  side: z.enum(["buy", "sell"]),
  marketId: z.string().min(1),
  outcomeId: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  candidates: z.array(candidateSchema).min(1)
});

const liveCandidatesRequestSchema = z.object({
  side: z.enum(["buy", "sell"]),
  marketId: z.string().min(1),
  outcomeId: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  venues: z.array(z.string().min(1)).optional()
});

const submitRequestSchema = z.object({
  quoteId: z.string().min(1)
});

const signedBundleSubmitSchema = z.object({
  signedLegs: z.array(z.object({
    legIndex: z.number().int().nonnegative(),
    venue: z.string().min(1),
    requestType: z.string().min(1).optional(),
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

const positionsQuerySchema = z.object({
  marketId: z.string().min(1).optional(),
  outcomeId: z.string().min(1).optional(),
  venue: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(500).optional()
}).refine((query) => !query.marketId === !query.outcomeId, {
  message: "marketId and outcomeId must be provided together.",
  path: ["outcomeId"]
});

const executionHistoryQuerySchema = z.object({
  status: z.enum(["DRY_RUN_VERIFIED", "SUBMITTED", "PARTIAL", "FILLED", "FAILED"]).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().datetime().optional()
});

const openOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().datetime().optional()
});

const portfolioTimeSeriesQuerySchema = z.object({
  range: z.enum(["1D", "7D", "30D", "90D", "ALL"]).optional()
});

export interface ExecutionRouteDeps {
  executableRouteService: ExecutableRouteService;
  sellQuoteService: SellQuoteService;
  signedTradeBundleService?: SignedTradeBundleService | undefined;
  liveCandidateProvider?: LiveExecutionCandidateProvider | undefined;
  positionRepository?: (Pick<VerifiedPositionRepository, "listVerifiedPositions"> & {
    listUserVerifiedPositions?(input: {
      userId: string;
      marketId?: string | undefined;
      outcomeId?: string | undefined;
      venue?: string | undefined;
      limit?: number | undefined;
    }): Promise<VerifiedExecutionPosition[]>;
  }) | undefined;
  executionStatusRepository?: {
    listExecutionStatusesForUser(input: {
      userId: string;
      status?: SignedTradeExecutionStatus["status"] | undefined;
      limit: number;
      cursor?: string | undefined;
    }): Promise<SignedTradeExecutionStatus[]>;
    listOpenExecutionStatusesForUser?(input: {
      userId: string;
      limit: number;
      cursor?: string | undefined;
    }): Promise<SignedTradeExecutionStatus[]>;
  } | undefined;
}

export interface LiveExecutionCandidateProvider {
  getCandidates(input: {
    userId: string;
    side: "buy" | "sell";
    marketId: string;
    outcomeId: string;
    amount: string;
    venues?: readonly string[] | undefined;
  }): Promise<LiveExecutionCandidatesResponse>;
}

export interface LiveExecutionCandidatesResponse {
  generatedAt: string;
  marketId: string;
  outcomeId: string;
  amount: string;
  source: "LIVE_QUOTE_SOURCE";
  candidates: readonly TradeRouteCandidate[];
  blocked: readonly LiveExecutionCandidateBlocker[];
}

export interface LiveExecutionCandidateBlocker {
  venue: string;
  reason: string;
  venueMarketId?: string | undefined;
  venueOutcomeId?: string | undefined;
  detailsCode?: string | undefined;
}

export type MarkFreshness = "live" | "unavailable";

export interface MarkedExecutionPosition extends VerifiedExecutionPosition {
  markPrice: number | null;
  markValue: string | null;
  unrealizedPnl: string | null;
  markSource: "LIVE_QUOTE_SOURCE" | null;
  markFreshness: MarkFreshness;
  markGeneratedAt: string | null;
  markBlocker: string | null;
}

export const registerExecutionRoutes = async (
  app: FastifyInstance,
  authMiddleware: preHandlerHookHandler,
  deps: ExecutionRouteDeps
): Promise<void> => {
  app.post("/execution/live-candidates", { preHandler: authMiddleware }, async (request, reply) => {
    if (!deps.liveCandidateProvider) {
      return reply.status(501).send({
        code: "LIVE_EXECUTION_CANDIDATES_NOT_CONFIGURED",
        message: "Live execution candidate sourcing is not configured on this backend."
      });
    }
    const parsed = liveCandidatesRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Live execution candidate request validation failed.",
        details: parsed.error.flatten()
      });
    }
    const result = await deps.liveCandidateProvider.getCandidates({
      userId: request.user.userId,
      ...parsed.data
    });
    if (result.candidates.length === 0) {
      return reply.status(409).send({
        code: "NO_LIVE_EXECUTION_CANDIDATES",
        message: "No live-tradeable venue candidates are available for this market/outcome right now.",
        ...result
      });
    }
    return reply.send(result);
  });

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

  app.get("/execution/:executionId/live-readiness", { preHandler: authMiddleware }, async (request, reply) => {
    if (!deps.signedTradeBundleService) {
      return reply.status(501).send({
        code: "SIGNED_TRADE_BUNDLE_NOT_CONFIGURED",
        message: "Signed trade bundle readiness is not configured on this backend."
      });
    }
    const { executionId } = request.params as { executionId: string };
    try {
      const readiness = await deps.signedTradeBundleService.getLiveReadiness({
        userId: request.user.userId,
        quoteId: executionId
      });
      return reply.send(readiness);
    } catch (error) {
      if (error instanceof SignedTradeBundleError) {
        return reply.status(error.statusCode).send({ code: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.get("/execution/portfolio/summary", { preHandler: authMiddleware }, async (request, reply) => {
    if (!deps.positionRepository?.listUserVerifiedPositions) {
      return reply.status(501).send({
        code: "EXECUTION_PORTFOLIO_NOT_CONFIGURED",
        message: "Execution portfolio lookup is not configured on this backend."
      });
    }
    try {
      const generatedAt = new Date().toISOString();
      const positions = await deps.positionRepository.listUserVerifiedPositions({
        userId: request.user.userId,
        limit: 500
      });
      const activePositions = positions.filter(isActiveVerifiedPosition);
      const markedPositions = await markPositions({
        positions: activePositions,
        generatedAt,
        liveCandidateProvider: deps.liveCandidateProvider,
        userId: request.user.userId
      });
      const summary = summarizePortfolio(markedPositions);
      return reply.send({
        generatedAt,
        markPolicy: "LIVE_QUOTE_REQUIRED",
        ...summary,
        positions: markedPositions
      });
    } catch (error) {
      return sendExecutionDataUnavailable(app, reply, error, "portfolio summary");
    }
  });

  app.get("/execution/portfolio/timeseries", { preHandler: authMiddleware }, async (request, reply) => {
    if (!deps.positionRepository?.listUserVerifiedPositions) {
      return reply.status(501).send({
        code: "EXECUTION_PORTFOLIO_NOT_CONFIGURED",
        message: "Execution portfolio lookup is not configured on this backend."
      });
    }
    const parsed = portfolioTimeSeriesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Execution portfolio time-series query validation failed.",
        details: parsed.error.flatten()
      });
    }
    try {
      const generatedAt = new Date().toISOString();
      const positions = await deps.positionRepository.listUserVerifiedPositions({
        userId: request.user.userId,
        limit: 500
      });
      const activePositions = positions.filter(isActiveVerifiedPosition);
      const markedPositions = await markPositions({
        positions: activePositions,
        generatedAt,
        liveCandidateProvider: deps.liveCandidateProvider,
        userId: request.user.userId
      });
      const summary = summarizePortfolio(markedPositions);
      return reply.send({
        generatedAt,
        range: parsed.data.range ?? "1D",
        markPolicy: "LIVE_QUOTE_REQUIRED",
        seriesBasis: "CURRENT_MARK_TO_MARKET_SNAPSHOT",
        historyAvailable: false,
        points: [{
          timestamp: generatedAt,
          ...summary
        }]
      });
    } catch (error) {
      return sendExecutionDataUnavailable(app, reply, error, "portfolio time-series");
    }
  });

  app.get("/execution/history", { preHandler: authMiddleware }, async (request, reply) => {
    if (!deps.executionStatusRepository) {
      return reply.status(501).send({
        code: "EXECUTION_HISTORY_NOT_CONFIGURED",
        message: "Execution history lookup is not configured on this backend."
      });
    }
    const parsed = executionHistoryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Execution history query validation failed.",
        details: parsed.error.flatten()
      });
    }
    try {
      const limit = parsed.data.limit ?? 50;
      const rows = await deps.executionStatusRepository.listExecutionStatusesForUser({
        userId: request.user.userId,
        limit: limit + 1,
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {})
      });
      const items = rows.slice(0, limit).map(toExecutionHistoryItem);
      return reply.send({
        generatedAt: new Date().toISOString(),
        items,
        nextCursor: rows.length > limit ? items[items.length - 1]?.updatedAt ?? null : null
      });
    } catch (error) {
      return sendExecutionDataUnavailable(app, reply, error, "execution history");
    }
  });

  app.get("/execution/open-orders", { preHandler: authMiddleware }, async (request, reply) => {
    if (!deps.executionStatusRepository?.listOpenExecutionStatusesForUser) {
      return reply.status(501).send({
        code: "EXECUTION_OPEN_ORDERS_NOT_CONFIGURED",
        message: "Execution open order lookup is not configured on this backend."
      });
    }
    const parsed = openOrdersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Execution open orders query validation failed.",
        details: parsed.error.flatten()
      });
    }
    try {
      const limit = parsed.data.limit ?? 50;
      const rows = await deps.executionStatusRepository.listOpenExecutionStatusesForUser({
        userId: request.user.userId,
        limit: limit + 1,
        ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {})
      });
      const items = rows.slice(0, limit).map(toOpenOrderItem);
      return reply.send({
        generatedAt: new Date().toISOString(),
        items,
        nextCursor: rows.length > limit ? items[items.length - 1]?.updatedAt ?? null : null
      });
    } catch (error) {
      return sendExecutionDataUnavailable(app, reply, error, "open orders");
    }
  });

  app.get("/execution/:executionId/receipt", { preHandler: authMiddleware }, async (request, reply) => {
    const { executionId } = request.params as { executionId: string };
    const signedStatus = await deps.signedTradeBundleService?.getExecutionStatus({
      userId: request.user.userId,
      executionId
    });
    if (signedStatus) {
      return reply.send({
        generatedAt: new Date().toISOString(),
        receipt: toExecutionReceipt(signedStatus)
      });
    }
    const quote = await deps.executableRouteService.getQuote(request.user.userId, executionId);
    if (!quote) {
      return reply.status(404).send({
        code: "EXECUTION_NOT_FOUND",
        message: "Execution receipt was not found."
      });
    }
    return reply.send({
      generatedAt: new Date().toISOString(),
      receipt: {
        executionId,
        userStatus: "quote_ready",
        settlementStatus: "SETTLEMENT_PENDING",
        dryRun: false,
        submittedAt: null,
        updatedAt: null,
        route: toUserQuote(quote),
        submittedLegs: []
      }
    });
  });

  app.get("/execution/:executionId/status", { preHandler: authMiddleware }, async (request, reply) => {
    const { executionId } = request.params as { executionId: string };
    const signedStatus = await deps.signedTradeBundleService?.getExecutionStatus({
      userId: request.user.userId,
      executionId
    });
    if (signedStatus) {
      return reply.send({
        executionId,
        userStatus: signedStatus.status,
        settlementStatus: signedStatus.status === "FILLED" ? "SETTLEMENT_PENDING" : "SETTLEMENT_PENDING",
        ghostFillStatus: "NOT_APPLICABLE",
        recoveryStatus: "none",
        dryRun: signedStatus.dryRun,
        submittedAt: signedStatus.submittedAt,
        updatedAt: signedStatus.updatedAt,
        submittedLegs: signedStatus.submittedLegs
      });
    }
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

  app.get("/execution/positions", { preHandler: authMiddleware }, async (request, reply) => {
    if (!deps.positionRepository) {
      return reply.status(501).send({
        code: "EXECUTION_POSITIONS_NOT_CONFIGURED",
        message: "Execution position lookup is not configured on this backend."
      });
    }
    const parsed = positionsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Execution positions query validation failed.",
        details: parsed.error.flatten()
      });
    }
    try {
      const query = parsed.data;
      const positions = query.marketId && query.outcomeId
        ? await deps.positionRepository.listVerifiedPositions({
            userId: request.user.userId,
            marketId: query.marketId,
            outcomeId: query.outcomeId,
            ...(query.venue ? { venue: query.venue } : {})
          })
        : deps.positionRepository.listUserVerifiedPositions
          ? await deps.positionRepository.listUserVerifiedPositions({
              userId: request.user.userId,
              ...(query.venue ? { venue: query.venue } : {}),
              ...(query.limit ? { limit: query.limit } : {})
            })
          : [];
      const activePositions = positions.filter(isActiveVerifiedPosition);
      return reply.send({
        generatedAt: new Date().toISOString(),
        marketId: query.marketId ?? null,
        outcomeId: query.outcomeId ?? null,
        positions: activePositions
      });
    } catch (error) {
      return sendExecutionDataUnavailable(app, reply, error, "execution positions");
    }
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

const sendExecutionDataUnavailable = (
  app: FastifyInstance,
  reply: FastifyReply,
  error: unknown,
  resource: string
) => {
  app.log.error({ err: error, resource }, "Execution account data lookup failed.");
  return reply.status(503).send({
    code: "EXECUTION_ACCOUNT_DATA_UNAVAILABLE",
    message: "Execution account data is temporarily unavailable. Please try again shortly."
  });
};

const markPositions = async (input: {
  positions: readonly VerifiedExecutionPosition[];
  generatedAt: string;
  liveCandidateProvider?: LiveExecutionCandidateProvider | undefined;
  userId: string;
}): Promise<MarkedExecutionPosition[]> => Promise.all(input.positions.map(async (position) => {
  if (!input.liveCandidateProvider || Number(position.verifiedSize) <= 0) {
    return unavailableMarkedPosition(position, input.generatedAt, "LIVE_MARK_SOURCE_UNAVAILABLE");
  }
  try {
    const candidates = await input.liveCandidateProvider.getCandidates({
      userId: input.userId,
      side: "sell",
      marketId: position.marketId,
      outcomeId: position.outcomeId,
      amount: position.verifiedSize,
      venues: [position.venue]
    });
    const candidate = candidates.candidates[0];
    if (!candidate || !Number.isFinite(candidate.price)) {
      return unavailableMarkedPosition(position, input.generatedAt, candidates.blocked[0]?.reason ?? "LIVE_MARK_QUOTE_UNAVAILABLE");
    }
    const size = Number(position.verifiedSize);
    const markValue = size * candidate.price;
    const entryValue = size * position.averageEntryPrice;
    return {
      ...position,
      markPrice: candidate.price,
      markValue: fixedDecimal(markValue),
      unrealizedPnl: fixedDecimal(markValue - entryValue),
      markSource: "LIVE_QUOTE_SOURCE",
      markFreshness: "live",
      markGeneratedAt: candidates.generatedAt,
      markBlocker: null
    };
  } catch (error) {
    return unavailableMarkedPosition(
      position,
      input.generatedAt,
      error instanceof Error && error.message ? "LIVE_MARK_QUOTE_FAILED" : "LIVE_MARK_QUOTE_UNAVAILABLE"
    );
  }
}));

const isActiveVerifiedPosition = (position: VerifiedExecutionPosition): boolean =>
  position.status === "VERIFIED" && Number(position.verifiedSize) > 0;

const unavailableMarkedPosition = (
  position: VerifiedExecutionPosition,
  generatedAt: string,
  blocker: string
): MarkedExecutionPosition => ({
  ...position,
  markPrice: null,
  markValue: null,
  unrealizedPnl: null,
  markSource: null,
  markFreshness: "unavailable",
  markGeneratedAt: generatedAt,
  markBlocker: blocker
});

const summarizePortfolio = (positions: readonly MarkedExecutionPosition[]): Record<string, unknown> => {
  const totalCostBasis = positions.reduce((sum, position) =>
    sum + Number(position.verifiedSize) * position.averageEntryPrice, 0);
  const marked = positions.filter((position) => position.markValue !== null);
  const totalMarkValue = marked.reduce((sum, position) => sum + Number(position.markValue), 0);
  const markedCostBasis = marked.reduce((sum, position) =>
    sum + Number(position.verifiedSize) * position.averageEntryPrice, 0);
  return {
    positionCount: positions.length,
    markedPositionCount: marked.length,
    unavailableMarkCount: positions.length - marked.length,
    totalCostBasis: fixedDecimal(totalCostBasis),
    totalMarkValue: marked.length > 0 ? fixedDecimal(totalMarkValue) : null,
    totalUnrealizedPnl: marked.length > 0 ? fixedDecimal(totalMarkValue - markedCostBasis) : null
  };
};

const toExecutionHistoryItem = (status: SignedTradeExecutionStatus): Record<string, unknown> => ({
  executionId: status.executionId,
  status: status.status,
  dryRun: status.dryRun,
  submittedAt: status.submittedAt,
  updatedAt: status.updatedAt,
  route: status.route ? toUserQuote(status.route) : null,
  submittedLegs: sanitizeSubmittedLegs(status.submittedLegs)
});

const toOpenOrderItem = (status: SignedTradeExecutionStatus): Record<string, unknown> => ({
  ...toExecutionHistoryItem(status),
  openStatus: status.status,
  userStatus: status.status
});

const toExecutionReceipt = (status: SignedTradeExecutionStatus): Record<string, unknown> => ({
  executionId: status.executionId,
  userStatus: status.status,
  settlementStatus: status.status === "FILLED" ? "SETTLEMENT_PENDING" : "SETTLEMENT_PENDING",
  dryRun: status.dryRun,
  submittedAt: status.submittedAt,
  updatedAt: status.updatedAt,
  route: status.route ? toUserQuote(status.route) : null,
  submittedLegs: sanitizeSubmittedLegs(status.submittedLegs)
});

const sanitizeSubmittedLegs = (
  legs: SignedTradeExecutionStatus["submittedLegs"]
): Array<Record<string, unknown>> => legs.map((leg) => ({
  legIndex: leg.legIndex,
  venue: leg.venue,
  status: leg.status,
  venueOrderId: leg.venueOrderId,
  fillId: leg.fillId,
  reason: leg.reason,
  fillState: leg.fillState,
  settlementState: leg.settlementState,
  lastStatusCheckedAt: leg.lastStatusCheckedAt,
  lastSettlementCheckedAt: leg.lastSettlementCheckedAt,
  lastWatcherError: leg.lastWatcherError
}));

const fixedDecimal = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(8).replace(/\.?0+$/, "") : "0";

export const buildLiveExecutionCandidatesResponse = (input: {
  generatedAt?: Date | undefined;
  marketId: string;
  outcomeId: string;
  amount: string;
  snapshots: readonly CalculatedVenueQuoteSnapshot[];
  snapshotBlockers?: readonly VenueQuoteSnapshotBlocker[] | undefined;
  readiness: readonly ExecutionVenueReadinessSummary[];
  venues?: readonly string[] | undefined;
}): LiveExecutionCandidatesResponse => {
  const normalizeVenueFilter = (venue: string): string => {
    const normalized = venue.trim().toUpperCase().replace(/[\s.-]+/g, "_");
    if (normalized === "POLY" || normalized === "POLY_MARKET") {
      return "POLYMARKET";
    }
    if (normalized === "PREDICT" || normalized === "PREDICTFUN" || normalized === "PREDICT_DOT_FUN") {
      return "PREDICT_FUN";
    }
    return normalized;
  };
  const allowedVenues = input.venues?.length
    ? new Set(input.venues.map(normalizeVenueFilter))
    : null;
  const readinessByVenue = new Map(input.readiness.map((venue) => [venue.venue.toUpperCase(), venue]));
  const candidates: TradeRouteCandidate[] = [];
  const blocked: LiveExecutionCandidateBlocker[] = [];
  for (const blocker of input.snapshotBlockers ?? []) {
    const venue = blocker.venue.toUpperCase();
    if (allowedVenues && !allowedVenues.has(venue)) {
      continue;
    }
    blocked.push({
      venue,
      reason: blocker.reason,
      ...(blocker.venueMarketId ? { venueMarketId: blocker.venueMarketId } : {}),
      ...(blocker.venueOutcomeId ? { venueOutcomeId: blocker.venueOutcomeId } : {}),
      ...(blocker.detailsCode ? { detailsCode: blocker.detailsCode } : {})
    });
  }

  for (const snapshot of input.snapshots) {
    const venue = snapshot.venue.toUpperCase();
    if (allowedVenues && !allowedVenues.has(venue)) {
      continue;
    }
    const metadata = snapshot.metadata;
    const venueMarketId = asString(metadata.venueMarketId);
    const venueOutcomeId = asString(metadata.venueOutcomeId);
    if (!venueMarketId) {
      blocked.push({ venue, reason: "VENUE_MARKET_ID_MISSING_FROM_LIVE_QUOTE" });
      continue;
    }
    if (!venueOutcomeId) {
      blocked.push({ venue, reason: "VENUE_OUTCOME_ID_MISSING_FROM_LIVE_QUOTE", venueMarketId });
      continue;
    }
    const quoteBlockers = asStringArray(metadata.blockers);
    if (quoteBlockers.length > 0) {
      blocked.push({ venue, reason: quoteBlockers.join(","), venueMarketId, venueOutcomeId });
      continue;
    }
    const readiness = readinessByVenue.get(venue);
    const feeQuote = isRecord(metadata.feeQuote) ? metadata.feeQuote : {};
    candidates.push({
      venue,
      venueMarketId,
      venueOutcomeId,
      price: snapshot.quotedPrice,
      availableSize: String(snapshot.availableSize),
      requiresUserSignature: readiness?.executionSigningModel.includes("USER_SIGNED") === true,
      activationRequired: false,
      settlementEvidenceSupported: asBoolean(metadata.settlementEvidenceSupported) ?? readiness?.liveSubmissionSupported === true,
      recoveryRequired: false,
      ...(asNumber(metadata.feeAmount) !== undefined ? { feeAmount: asNumber(metadata.feeAmount) } : {}),
      ...(asNumber(metadata.effectiveFeeBps) !== undefined ? { effectiveFeeBps: asNumber(metadata.effectiveFeeBps) } : {}),
      ...(asString(feeQuote.feeModel) ? { feeModel: asString(feeQuote.feeModel) } : {}),
      ...(asString(feeQuote.source) ? { feeSource: asString(feeQuote.source) } : {}),
      ...(asString(feeQuote.confidence) ? { feeConfidence: asString(feeQuote.confidence) } : {}),
      ...(asNumber(metadata.spreadBps) !== undefined ? { spreadBps: asNumber(metadata.spreadBps) } : {}),
      ...(asNumber(metadata.slippageBps) !== undefined ? { slippageBps: asNumber(metadata.slippageBps) } : {}),
      ...(asNumber(metadata.liquidityScore) !== undefined ? { liquidityScore: asNumber(metadata.liquidityScore) } : {}),
      ...(asString(metadata.quoteQuality) ? { quoteQuality: asString(metadata.quoteQuality) } : {}),
      ...(asNumber(metadata.freshnessMs) !== undefined ? { freshnessMs: asNumber(metadata.freshnessMs) } : {}),
      ...(asNumber(metadata.confidencePenaltyBps) !== undefined ? { confidencePenaltyBps: asNumber(metadata.confidencePenaltyBps) } : {}),
      missingFactors: asStringArray(metadata.missingFactors),
      quoteBlockers,
      metadata: {
        ...(asString(metadata.limitlessExchangeAddress) ? { limitlessExchangeAddress: asString(metadata.limitlessExchangeAddress) } : {}),
        ...(asString(metadata.limitlessAdapterAddress) ? { limitlessAdapterAddress: asString(metadata.limitlessAdapterAddress) } : {})
      }
    });
  }

  return {
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    marketId: input.marketId,
    outcomeId: input.outcomeId,
    amount: input.amount,
    source: "LIVE_QUOTE_SOURCE",
    candidates,
    blocked
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
