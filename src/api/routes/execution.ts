import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";
import Decimal from "decimal.js";
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
  type LiveSubmitReadinessSnapshot,
  type SignedTradeExecutionStatus,
  type SignedTradeBundleService
} from "../../execution-system/signed-trade-bundle.js";
import type { CalculatedVenueQuoteSnapshot, VenueQuoteSnapshotBlocker } from "../../core/sor/quote-snapshot.js";
import type { SettlementStatusV0 } from "../../execution-system/types.js";
import type { ExecutionVenueReadinessSummary } from "../admin/execution-venues-admin-service.js";
import { withLatencyStage } from "../../observability/latency.js";
import {
  EXECUTION_ORCHESTRATOR_V1_ENABLED,
  ExecutionOrderError,
  assertPolymarketFokStillExecutable,
  type ExecutionOrderOrchestratorV1
} from "../../execution-system/execution-order-orchestrator.js";

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
  limit: z.coerce.number().int().positive().max(500).optional(),
  markMode: z.enum(["cached", "live"]).optional()
}).refine((query) => !query.marketId === !query.outcomeId, {
  message: "marketId and outcomeId must be provided together.",
  path: ["outcomeId"]
});

const portfolioSummaryQuerySchema = z.object({
  markMode: z.enum(["cached", "live"]).optional()
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

const executionOrderPreviewSchema = z.object({
  marketId: z.string().min(1),
  outcomeId: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  venuePreference: z.enum(["BEST_ROUTE", "POLYMARKET", "LIMITLESS", "PREDICT_FUN", "OPINION"]),
  orderPolicy: z.enum(["FOK", "FAK"]).optional(),
  slippageToleranceBps: z.number().int().min(0).max(500).optional()
});

const executionOrderSignaturesSchema = z.object({
  signedPayloads: z.array(z.object({
    legIndex: z.number().int().nonnegative(),
    venue: z.string().min(1),
    requestType: z.string().min(1).optional(),
    signedPayload: z.record(z.string(), z.unknown())
  }))
});

const portfolioTimeSeriesQuerySchema = z.object({
  range: z.enum(["1D", "7D", "30D", "90D", "ALL"]).optional(),
  markMode: z.enum(["cached", "live"]).optional()
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
  executionOrderService?: ExecutionOrderOrchestratorV1 | undefined;
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

export type MarkFreshness = "live" | "stale" | "unavailable";
type PositionMarkMode = "cached" | "live";

export interface MarkedExecutionPosition extends VerifiedExecutionPosition {
  markPrice: number | null;
  markValue: string | null;
  unrealizedPnl: string | null;
  markSource: "LIVE_QUOTE_SOURCE" | null;
  markFreshness: MarkFreshness;
  markGeneratedAt: string | null;
  markBlocker: string | null;
}

const LIVE_CANDIDATE_CACHE_MS = 10_000;
const LIVE_CANDIDATE_STALE_MS = 90_000;
const LIVE_CANDIDATE_RESPONSE_TIMEOUT_MS = 500;
const POSITION_MARK_CACHE_MS = 15_000;
const POSITION_MARK_LIVE_TIMEOUT_MS = 700;
const POSITION_MARK_LIVE_READ_BUDGET = 20;
const DISPLAY_POSITION_MARK_LIVE_READ_BUDGET = 3;
const EXECUTION_DISPLAY_CACHE_MS = 3_000;
const EXECUTION_DISPLAY_STALE_MS = 45_000;
const ROUTE_RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMITS: Record<string, number> = {
  preview: 40,
  place: 12,
  signatures: 8,
  status: 120,
  liveCandidates: 80
};

const liveCandidateCache = new Map<string, {
  expiresAt: number;
  staleUntil: number;
  value?: LiveExecutionCandidatesResponse | undefined;
  promise?: Promise<LiveExecutionCandidatesResponse> | undefined;
}>();
const positionMarkCache = new Map<string, { expiresAt: number; position: MarkedExecutionPosition }>();
const routeRateLimitBuckets = new Map<string, { resetAt: number; count: number }>();

type ExecutionDisplayCacheEntry<T> = {
  expiresAt: number;
  staleUntil: number;
  value?: T | undefined;
  promise?: Promise<T> | undefined;
};

export const registerExecutionRoutes = async (
  app: FastifyInstance,
  authMiddleware: preHandlerHookHandler,
  deps: ExecutionRouteDeps
): Promise<void> => {
  const executionDisplayCache = new Map<string, ExecutionDisplayCacheEntry<Record<string, unknown>>>();

  app.addHook("onClose", async () => {
    liveCandidateCache.clear();
    positionMarkCache.clear();
    routeRateLimitBuckets.clear();
    executionDisplayCache.clear();
  });

  app.post("/execution/orders/preview", { preHandler: authMiddleware }, async (request, reply) => {
    if (!EXECUTION_ORCHESTRATOR_V1_ENABLED || !deps.executionOrderService) {
      return reply.status(501).send({
        code: "EXECUTION_ORCHESTRATOR_V1_NOT_CONFIGURED",
        message: "Execution order orchestration is not configured on this backend."
      });
    }
    const parsed = executionOrderPreviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Execution order preview request validation failed.",
        details: parsed.error.flatten()
      });
    }
    try {
      assertRouteRateLimit(request.user.userId, "preview");
      const result = await withLatencyStage("execution_order_preview", {
        endpoint: "POST /execution/orders/preview",
        canonicalMarketId: parsed.data.marketId,
        routeType: parsed.data.venuePreference
      }, () => deps.executionOrderService!.preview({
        userId: request.user.userId,
        marketId: parsed.data.marketId,
        outcomeId: parsed.data.outcomeId,
        side: parsed.data.side,
        amount: parsed.data.amount,
        venuePreference: parsed.data.venuePreference,
        ...(parsed.data.orderPolicy ? { orderPolicy: parsed.data.orderPolicy } : {}),
        ...(parsed.data.slippageToleranceBps !== undefined ? { slippageToleranceBps: parsed.data.slippageToleranceBps } : {})
      }));
      return reply.status(201).send(result);
    } catch (error) {
      return sendExecutionOrderError(reply, error);
    }
  });

  app.post("/execution/orders/:orderId/place", { preHandler: authMiddleware }, async (request, reply) => {
    if (!EXECUTION_ORCHESTRATOR_V1_ENABLED || !deps.executionOrderService) {
      return reply.status(501).send({
        code: "EXECUTION_ORCHESTRATOR_V1_NOT_CONFIGURED",
        message: "Execution order orchestration is not configured on this backend."
      });
    }
    const { orderId } = request.params as { orderId: string };
    try {
      assertRouteRateLimit(request.user.userId, "place");
      const result = await withLatencyStage("execution_order_place", {
        endpoint: "POST /execution/orders/:orderId/place"
      }, () => deps.executionOrderService!.place({
        userId: request.user.userId,
        orderId
      }));
      return reply.status(["SUBMITTING", "SUBMITTED", "FILLED"].includes(result.state) ? 202 : 200).send(result);
    } catch (error) {
      return sendExecutionOrderError(reply, error);
    }
  });

  app.post("/execution/orders/:orderId/signatures", { preHandler: authMiddleware }, async (request, reply) => {
    if (!EXECUTION_ORCHESTRATOR_V1_ENABLED || !deps.executionOrderService) {
      return reply.status(501).send({
        code: "EXECUTION_ORCHESTRATOR_V1_NOT_CONFIGURED",
        message: "Execution order orchestration is not configured on this backend."
      });
    }
    const parsed = executionOrderSignaturesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Execution order signature request validation failed.",
        details: parsed.error.flatten()
      });
    }
    const { orderId } = request.params as { orderId: string };
    try {
      assertRouteRateLimit(request.user.userId, "signatures");
      const result = await withLatencyStage("execution_order_signature_submit", {
        endpoint: "POST /execution/orders/:orderId/signatures",
        external: true
      }, () => deps.executionOrderService!.submitSignatures({
        userId: request.user.userId,
        orderId,
        signedPayloads: parsed.data.signedPayloads
      }));
      return reply.status(["SUBMITTING", "SUBMITTED", "FILLED"].includes(result.state) ? 202 : 200).send(result);
    } catch (error) {
      return sendExecutionOrderError(reply, error);
    }
  });

  app.get("/execution/orders/:orderId/status", { preHandler: authMiddleware }, async (request, reply) => {
    if (!EXECUTION_ORCHESTRATOR_V1_ENABLED || !deps.executionOrderService) {
      return reply.status(501).send({
        code: "EXECUTION_ORCHESTRATOR_V1_NOT_CONFIGURED",
        message: "Execution order orchestration is not configured on this backend."
      });
    }
    const { orderId } = request.params as { orderId: string };
    try {
      assertRouteRateLimit(request.user.userId, "status");
      const result = await withLatencyStage("execution_order_status", {
        endpoint: "GET /execution/orders/:orderId/status"
      }, () => deps.executionOrderService!.status({
        userId: request.user.userId,
        orderId
      }));
      return reply.send(result);
    } catch (error) {
      return sendExecutionOrderError(reply, error);
    }
  });

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
    if (!consumeRouteRateLimit(request.user.userId, "liveCandidates")) {
      return reply.status(429).send({
        code: "EXECUTION_RATE_LIMITED",
        message: "Too many live execution candidate refreshes. Please wait briefly and try again."
      });
    }
    const result = await withLatencyStage("route_preview_live_candidates", {
      endpoint: "POST /execution/live-candidates",
      canonicalMarketId: parsed.data.marketId
    }, () => getCachedLiveCandidates(deps.liveCandidateProvider!, request.user.userId, parsed.data));
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
    if (parsed.data.side === "sell") {
      try {
        const result = await withLatencyStage("route_preview_quote", {
          endpoint: "POST /execution/quote",
          canonicalMarketId: parsed.data.marketId,
          routeType: "SELL"
        }, () => deps.sellQuoteService.prepareExit({
          userId: request.user.userId,
          sellMode: "SELL_ALL",
          sizeMode: "CUSTOM_AMOUNT",
          amount: parsed.data.amount,
          marketId: parsed.data.marketId,
          outcomeId: parsed.data.outcomeId,
          candidates: parsed.data.candidates
        }));
        if (!result.quote) {
          return reply.status(409).send({
            code: "NO_EXECUTABLE_EXIT_ROUTE",
            message: result.userMessage ?? "No verified sellable position is available.",
            skippedAmount: result.skippedAmount
          });
        }
        const readiness = deps.signedTradeBundleService
          ? await deps.signedTradeBundleService.getLiveReadiness({
              userId: request.user.userId,
              quoteId: result.quote.quoteId
            }).catch(() => null)
          : null;
        if (isPolymarketSellShareBalanceBlocked(readiness)) {
          return reply.status(409).send({
            code: "NO_SELLABLE_SHARES",
            message: firstLiveReadinessBlocker(readiness) ?? "No verified Polymarket shares are available to sell for this outcome.",
            skippedAmount: result.skippedAmount,
            readiness
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
    }
    const result = await withLatencyStage("route_preview_quote", {
      endpoint: "POST /execution/quote",
      canonicalMarketId: parsed.data.marketId,
      routeType: "BUY"
    }, () => deps.executableRouteService.quote({
      userId: request.user.userId,
      ...parsed.data
    }));
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
    const quote = await withLatencyStage("execution_quote_load", {
      endpoint: "POST /execution/submit"
    }, () => deps.executableRouteService.getQuote(request.user.userId, parsed.data.quoteId));
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
      const quote = await deps.executableRouteService.getQuote(request.user.userId, executionId);
      await assertPolymarketFokStillExecutable({
        userId: request.user.userId,
        quote,
        liveCandidateProvider: deps.liveCandidateProvider
      });
      const bundle = await withLatencyStage("execution_signature_prepare", {
        endpoint: "POST /execution/:executionId/prepare-signatures",
        external: true
      }, () => deps.signedTradeBundleService!.prepare({
        userId: request.user.userId,
        quoteId: executionId
      }));
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
      const quote = await deps.executableRouteService.getQuote(request.user.userId, executionId);
      await assertPolymarketFokStillExecutable({
        userId: request.user.userId,
        quote,
        liveCandidateProvider: deps.liveCandidateProvider,
        signedLegs: parsed.data.signedLegs
      });
      const result = await withLatencyStage("execution_signed_bundle_submit", {
        endpoint: "POST /execution/:executionId/submit-signed-bundle",
        external: parsed.data.dryRun !== true
      }, () => deps.signedTradeBundleService!.submit({
        userId: request.user.userId,
        quoteId: executionId,
        signedLegs: parsed.data.signedLegs,
        dryRun: parsed.data.dryRun
      }));
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
      const readiness = await withLatencyStage("funding_readiness_lookup", {
        endpoint: "GET /execution/:executionId/live-readiness"
      }, () => deps.signedTradeBundleService!.getLiveReadiness({
        userId: request.user.userId,
        quoteId: executionId
      }));
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
    const parsed = portfolioSummaryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Execution portfolio summary query validation failed.",
        details: parsed.error.flatten()
      });
    }
    try {
      const markMode = parsed.data.markMode ?? "cached";
      const result = await getCachedExecutionDisplayData(
        executionDisplayCache,
        `portfolio-summary:${request.user.userId}:${markMode}`,
        async () => {
          const generatedAt = new Date().toISOString();
          const positions = await deps.positionRepository!.listUserVerifiedPositions!({
            userId: request.user.userId,
            limit: 500
          });
          const activePositions = positions.filter(isActiveVerifiedPosition);
          const markedPositions = await markPositions({
            positions: activePositions,
            generatedAt,
            liveCandidateProvider: deps.liveCandidateProvider,
            userId: request.user.userId,
            maxLiveReads: markLiveReadBudget(markMode)
          });
          const summary = summarizePortfolio(markedPositions);
          return {
            generatedAt,
            markPolicy: markPolicyLabel(markMode),
            ...summary,
            positions: markedPositions
          };
        }
      );
      return reply.send({ ...result.value, cache: result.cache, cacheGeneratedAt: result.generatedAt });
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
      const markMode = parsed.data.markMode ?? "cached";
      const range = parsed.data.range ?? "1D";
      const result = await getCachedExecutionDisplayData(
        executionDisplayCache,
        `portfolio-timeseries:${request.user.userId}:${range}:${markMode}`,
        async () => {
          const generatedAt = new Date().toISOString();
          const positions = await deps.positionRepository!.listUserVerifiedPositions!({
            userId: request.user.userId,
            limit: 500
          });
          const activePositions = positions.filter(isActiveVerifiedPosition);
          const markedPositions = await markPositions({
            positions: activePositions,
            generatedAt,
            liveCandidateProvider: deps.liveCandidateProvider,
            userId: request.user.userId,
            maxLiveReads: markLiveReadBudget(markMode)
          });
          const summary = summarizePortfolio(markedPositions);
          return {
            generatedAt,
            range,
            markPolicy: markPolicyLabel(markMode),
            seriesBasis: "CURRENT_MARK_TO_MARKET_SNAPSHOT",
            historyAvailable: false,
            points: [{
              timestamp: generatedAt,
              ...summary
            }]
          };
        }
      );
      return reply.send({ ...result.value, cache: result.cache, cacheGeneratedAt: result.generatedAt });
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
        settlementStatus: deriveExecutionSettlementStatus(signedStatus),
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
      const markMode = query.markMode ?? (query.marketId && query.outcomeId ? "live" : "cached");
      const result = await getCachedExecutionDisplayData(
        executionDisplayCache,
        [
          "positions",
          request.user.userId,
          query.marketId ?? "",
          query.outcomeId ?? "",
          query.venue ?? "",
          query.limit ?? "",
          markMode
        ].join("\u0000"),
        async () => {
          const positions = query.marketId && query.outcomeId
            ? await deps.positionRepository!.listVerifiedPositions({
                userId: request.user.userId,
                marketId: query.marketId,
                outcomeId: query.outcomeId,
                ...(query.venue ? { venue: query.venue } : {})
              })
            : deps.positionRepository!.listUserVerifiedPositions
              ? await deps.positionRepository!.listUserVerifiedPositions({
                  userId: request.user.userId,
                  ...(query.venue ? { venue: query.venue } : {}),
                  ...(query.limit ? { limit: query.limit } : {})
                })
              : [];
          const activePositions = positions.filter(isActiveVerifiedPosition);
          const generatedAt = new Date().toISOString();
          const markedPositions = deps.liveCandidateProvider
            ? await markPositions({
                positions: activePositions,
                generatedAt,
                liveCandidateProvider: deps.liveCandidateProvider,
                userId: request.user.userId,
                maxLiveReads: markLiveReadBudget(markMode)
              })
            : activePositions;
          return {
            generatedAt,
            markPolicy: markPolicyLabel(markMode),
            marketId: query.marketId ?? null,
            outcomeId: query.outcomeId ?? null,
            positions: markedPositions
          };
        }
      );
      return reply.send({ ...result.value, cache: result.cache, cacheGeneratedAt: result.generatedAt });
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
      const readiness = deps.signedTradeBundleService
        ? await deps.signedTradeBundleService.getLiveReadiness({
            userId: request.user.userId,
            quoteId: result.quote.quoteId
          }).catch(() => null)
        : null;
      if (isPolymarketSellShareBalanceBlocked(readiness)) {
        return reply.status(409).send({
          code: "NO_SELLABLE_SHARES",
          message: firstLiveReadinessBlocker(readiness) ?? "No verified Polymarket shares are available to sell for this outcome.",
          skippedAmount: result.skippedAmount,
          readiness
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

const recordField = (value: unknown, field: string): Record<string, unknown> | null => {
  const record = isRecord(value) ? value : null;
  const next = record?.[field];
  return isRecord(next) ? next : null;
};

const decimalFromRecord = (record: Record<string, unknown>, field: string): InstanceType<typeof Decimal> | null => {
  const value = record[field];
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const decimal = new Decimal(value);
  return decimal.isFinite() ? decimal : null;
};

const isPolymarketSellShareBalanceBlocked = (readiness: LiveSubmitReadinessSnapshot | null): boolean => {
  const venue = readiness?.venues.find((item) => item.venue.toUpperCase() === "POLYMARKET");
  if (!venue || venue.status !== "blocked") return false;
  const blockerText = venue.blockers.join(" ").toUpperCase();
  const tokenSymbol = String(venue.collateral.tokenSymbol ?? "").toUpperCase();
  const balance = Number(venue.collateral.balance ?? NaN);
  return /SHARE BALANCE|SELLABLE BALANCE|BELOW THE SELL AMOUNT/.test(blockerText) ||
    (tokenSymbol.includes("SHARE") && Number.isFinite(balance) && balance <= 0);
};

const firstLiveReadinessBlocker = (readiness: LiveSubmitReadinessSnapshot | null): string | null => {
  const venue = readiness?.venues.find((item) => item.status === "blocked" && item.blockers.length > 0);
  if (venue) return venue.blockers[0] ?? null;
  return readiness?.blockers[0] ?? null;
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

const sendExecutionOrderError = (reply: FastifyReply, error: unknown) => {
  if (error instanceof ExecutionOrderError) {
    return reply.status(error.statusCode).send({ code: error.code, message: error.message });
  }
  if (error instanceof SignedTradeBundleError) {
    return reply.status(error.statusCode).send({ code: error.code, message: error.message });
  }
  throw error;
};

const assertRouteRateLimit = (userId: string, action: keyof typeof RATE_LIMITS): void => {
  if (consumeRouteRateLimit(userId, action)) {
    return;
  }
  throw new ExecutionOrderError(
    "EXECUTION_RATE_LIMITED",
    "Too many execution requests are in flight. Please wait briefly and try again.",
    429
  );
};

const consumeRouteRateLimit = (userId: string, action: keyof typeof RATE_LIMITS): boolean => {
  const now = Date.now();
  const key = `${userId}\u0000${action}`;
  const current = routeRateLimitBuckets.get(key);
  if (!current || current.resetAt <= now) {
    routeRateLimitBuckets.set(key, { resetAt: now + ROUTE_RATE_LIMIT_WINDOW_MS, count: 1 });
    return true;
  }
  const limit = RATE_LIMITS[action] ?? 20;
  if (current.count >= limit) {
    return false;
  }
  current.count += 1;
  return true;
};

const getCachedLiveCandidates = async (
  provider: LiveExecutionCandidateProvider,
  userId: string,
  input: {
    side: "buy" | "sell";
    marketId: string;
    outcomeId: string;
    amount: string;
    venues?: readonly string[] | undefined;
  }
): Promise<LiveExecutionCandidatesResponse> => {
  const now = Date.now();
  const key = [
    userId,
    input.side,
    input.marketId,
    input.outcomeId,
    normalizeAmountKey(input.amount),
    [...(input.venues ?? [])].map((venue) => venue.toUpperCase()).sort().join(",")
  ].join("\u0000");
  const cached = liveCandidateCache.get(key);
  if (cached?.value && cached.expiresAt > now) {
    return cached.value;
  }
  if (cached?.promise) {
    if (cached.value && cached.staleUntil > now) {
      return withDeferredLiveCandidateBlocker(cached.value, "LIVE_CANDIDATES_REFRESH_IN_PROGRESS");
    }
    return withTimeout(
      cached.promise,
      LIVE_CANDIDATE_RESPONSE_TIMEOUT_MS,
      cached.value && cached.staleUntil > now
        ? withDeferredLiveCandidateBlocker(cached.value, "LIVE_CANDIDATES_REFRESH_DEFERRED")
        : deferredLiveCandidates(input, "LIVE_CANDIDATES_REFRESH_DEFERRED")
    );
  }
  const promise = provider.getCandidates({ userId, ...input });
  liveCandidateCache.set(key, {
    ...(cached?.value ? { value: cached.value } : {}),
    expiresAt: cached?.expiresAt ?? 0,
    staleUntil: cached?.staleUntil ?? 0,
    promise
  });
  void promise
    .then((value) => {
      const resolvedAt = Date.now();
      liveCandidateCache.set(key, {
        value,
        expiresAt: resolvedAt + LIVE_CANDIDATE_CACHE_MS,
        staleUntil: resolvedAt + LIVE_CANDIDATE_STALE_MS
      });
    })
    .catch(() => {
      const current = liveCandidateCache.get(key);
      if (current?.value && current.staleUntil > Date.now()) {
        liveCandidateCache.set(key, {
          value: current.value,
          expiresAt: 0,
          staleUntil: current.staleUntil
        });
        return;
      }
      liveCandidateCache.delete(key);
    });
  const fallback = cached?.value && cached.staleUntil > now
    ? withDeferredLiveCandidateBlocker(cached.value, "LIVE_CANDIDATES_REFRESH_DEFERRED")
    : deferredLiveCandidates(input, "LIVE_CANDIDATES_REFRESH_DEFERRED");
  return withTimeout(promise, LIVE_CANDIDATE_RESPONSE_TIMEOUT_MS, fallback);
};

const deferredLiveCandidates = (
  input: {
    marketId: string;
    outcomeId: string;
    amount: string;
  },
  reason: string
): LiveExecutionCandidatesResponse => ({
  generatedAt: new Date().toISOString(),
  marketId: input.marketId,
  outcomeId: input.outcomeId,
  amount: input.amount,
  source: "LIVE_QUOTE_SOURCE",
  candidates: [],
  blocked: [{
    venue: "LOTUS",
    reason,
    detailsCode: "request_time_budget_exhausted"
  }]
});

const withDeferredLiveCandidateBlocker = (
  response: LiveExecutionCandidatesResponse,
  reason: string
): LiveExecutionCandidatesResponse => ({
  ...response,
  generatedAt: new Date().toISOString(),
  blocked: [
    ...response.blocked,
    {
      venue: "LOTUS",
      reason,
      detailsCode: response.generatedAt
    }
  ]
});

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), timeoutMs);
        timeout.unref?.();
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const getCachedExecutionDisplayData = async <T extends Record<string, unknown>>(
  cache: Map<string, ExecutionDisplayCacheEntry<Record<string, unknown>>>,
  key: string,
  load: () => Promise<T>,
  now = Date.now()
): Promise<{ value: T; cache: "hit" | "miss" | "stale"; generatedAt: string }> => {
  const cached = cache.get(key) as ExecutionDisplayCacheEntry<T> | undefined;
  if (cached?.value !== undefined && cached.expiresAt > now) {
    return { value: cached.value, cache: "hit", generatedAt: new Date(now).toISOString() };
  }
  if (cached?.promise) {
    if (cached.value !== undefined && cached.staleUntil > now) {
      return { value: cached.value, cache: "stale", generatedAt: new Date(now).toISOString() };
    }
    const value = await cached.promise;
    return { value, cache: "hit", generatedAt: new Date().toISOString() };
  }

  const promise = load()
    .then((value) => {
      const updatedAt = Date.now();
      cache.set(key, {
        value,
        expiresAt: updatedAt + EXECUTION_DISPLAY_CACHE_MS,
        staleUntil: updatedAt + EXECUTION_DISPLAY_STALE_MS
      });
      return value;
    })
    .catch((error) => {
      const fallback = cache.get(key) as ExecutionDisplayCacheEntry<T> | undefined;
      if (fallback?.value !== undefined && fallback.staleUntil > Date.now()) {
        cache.set(key, {
          ...fallback,
          promise: undefined
        });
        return fallback.value;
      }
      cache.delete(key);
      throw error;
    })
    .finally(() => {
      const current = cache.get(key);
      if (current?.promise === promise) {
        cache.set(key, {
          ...current,
          promise: undefined
        });
      }
    });

  cache.set(key, {
    ...(cached?.value !== undefined ? { value: cached.value } : {}),
    expiresAt: cached?.expiresAt ?? 0,
    staleUntil: cached?.staleUntil ?? 0,
    promise
  });

  if (cached?.value !== undefined && cached.staleUntil > now) {
    void promise.catch(() => undefined);
    return {
      value: cached.value,
      cache: "stale",
      generatedAt: new Date(now).toISOString()
    };
  }

  try {
    const value = await promise;
    const current = cache.get(key) as ExecutionDisplayCacheEntry<T> | undefined;
    const servedStale = cached?.value !== undefined &&
      current?.value === cached.value &&
      current.expiresAt <= now &&
      current.staleUntil > now;
    return {
      value,
      cache: servedStale ? "stale" : "miss",
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    const fallback = cached?.value !== undefined && cached.staleUntil > Date.now()
      ? cached.value
      : undefined;
    if (fallback !== undefined) {
      return { value: fallback, cache: "stale", generatedAt: new Date().toISOString() };
    }
    throw error;
  }
};

const normalizeAmountKey = (value: string): string => {
  try {
    return new Decimal(value).toDecimalPlaces(8).toString();
  } catch {
    return value.trim();
  }
};

const markLiveReadBudget = (mode: PositionMarkMode): number =>
  mode === "live" ? POSITION_MARK_LIVE_READ_BUDGET : DISPLAY_POSITION_MARK_LIVE_READ_BUDGET;

const markPolicyLabel = (mode: PositionMarkMode): "CACHE_FIRST_DISPLAY_MARKS" | "LIVE_QUOTE_REQUIRED" =>
  mode === "live" ? "LIVE_QUOTE_REQUIRED" : "CACHE_FIRST_DISPLAY_MARKS";

const markPositions = async (input: {
  positions: readonly VerifiedExecutionPosition[];
  generatedAt: string;
  liveCandidateProvider?: LiveExecutionCandidateProvider | undefined;
  userId: string;
  maxLiveReads?: number | undefined;
}): Promise<MarkedExecutionPosition[]> => {
  let liveReadsRemaining = Math.max(0, input.maxLiveReads ?? POSITION_MARK_LIVE_READ_BUDGET);
  return Promise.all(input.positions.map(async (position) => {
    if (!input.liveCandidateProvider || Number(position.verifiedSize) <= 0) {
      return unavailableMarkedPosition(position, input.generatedAt, "LIVE_MARK_SOURCE_UNAVAILABLE");
    }
    const cacheKey = positionMarkCacheKey(input.userId, position);
    const cached = positionMarkCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.position;
    }
    if (liveReadsRemaining <= 0) {
      return lastGoodOrUnavailable(cacheKey, position, input.generatedAt, "LIVE_MARK_DEFERRED");
    }
    liveReadsRemaining -= 1;
    try {
      const candidates = await withMarkTimeout(
        getCachedLiveCandidates(input.liveCandidateProvider, input.userId, {
          side: "sell",
          marketId: position.marketId,
          outcomeId: position.outcomeId,
          amount: position.verifiedSize,
          venues: [position.venue]
        }),
        POSITION_MARK_LIVE_TIMEOUT_MS
      );
      const candidate = candidates.candidates[0];
      if (!candidate || !Number.isFinite(candidate.price)) {
        return lastGoodOrUnavailable(cacheKey, position, input.generatedAt, candidates.blocked[0]?.reason ?? "LIVE_MARK_QUOTE_UNAVAILABLE");
      }
      const size = Number(position.verifiedSize);
      const markValue = size * candidate.price;
      const entryValue = size * position.averageEntryPrice;
      const marked: MarkedExecutionPosition = {
        ...position,
        markPrice: candidate.price,
        markValue: fixedDecimal(markValue),
        unrealizedPnl: fixedDecimal(markValue - entryValue),
        markSource: "LIVE_QUOTE_SOURCE" as const,
        markFreshness: "live" as const,
        markGeneratedAt: candidates.generatedAt,
        markBlocker: null
      };
      positionMarkCache.set(cacheKey, { expiresAt: Date.now() + POSITION_MARK_CACHE_MS, position: marked });
      return marked;
    } catch (error) {
      return lastGoodOrUnavailable(cacheKey, position, input.generatedAt, error instanceof Error && error.message ? "LIVE_MARK_QUOTE_FAILED" : "LIVE_MARK_QUOTE_UNAVAILABLE");
    }
  }));
};

const withMarkTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("LIVE_MARK_QUOTE_TIMEOUT")), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const positionMarkCacheKey = (userId: string, position: VerifiedExecutionPosition): string =>
  [userId, position.venue.toUpperCase(), position.marketId, position.outcomeId, position.positionId, normalizeAmountKey(position.verifiedSize)].join("\u0000");

const lastGoodOrUnavailable = (
  cacheKey: string,
  position: VerifiedExecutionPosition,
  generatedAt: string,
  blocker: string
): MarkedExecutionPosition => {
  const cached = positionMarkCache.get(cacheKey);
  if (cached) {
    const hasDisplayMark = cached.position.markPrice !== null && cached.position.markValue !== null;
    return {
      ...cached.position,
      markFreshness: "stale",
      markGeneratedAt: generatedAt,
      markBlocker: hasDisplayMark ? null : blocker
    };
  }
  return unavailableMarkedPosition(position, generatedAt, blocker);
};

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
  settlementStatus: deriveExecutionSettlementStatus(status),
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
  settlementStatus: deriveExecutionSettlementStatus(status),
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
  reasonCode: leg.reasonCode,
  reason: leg.reason,
  fillState: leg.fillState,
  settlementState: leg.settlementState,
  lastStatusCheckedAt: leg.lastStatusCheckedAt,
  lastSettlementCheckedAt: leg.lastSettlementCheckedAt,
  lastWatcherError: leg.lastWatcherError
}));

const deriveExecutionSettlementStatus = (status: SignedTradeExecutionStatus): SettlementStatusV0 => {
  if (status.dryRun) {
    return "DRY_RUN_ONLY";
  }

  const settlementStatuses = status.submittedLegs
    .map((leg) => leg.settlementState?.status)
    .filter((settlementStatus): settlementStatus is SettlementStatusV0 => Boolean(settlementStatus));

  if (settlementStatuses.length === 0) {
    return "SETTLEMENT_PENDING";
  }
  if (settlementStatuses.includes("GHOST_FILL_CONFIRMED")) {
    return "GHOST_FILL_CONFIRMED";
  }
  if (settlementStatuses.includes("GHOST_FILL_SUSPECTED")) {
    return "GHOST_FILL_SUSPECTED";
  }
  if (settlementStatuses.includes("SETTLEMENT_TIMEOUT")) {
    return "SETTLEMENT_TIMEOUT";
  }
  if (settlementStatuses.includes("SETTLEMENT_UNKNOWN")) {
    return "SETTLEMENT_UNKNOWN";
  }

  const terminalSettlementStatuses = new Set<SettlementStatusV0>([
    "SETTLEMENT_VERIFIED",
    "NOT_APPLICABLE",
    "DRY_RUN_ONLY"
  ]);
  const allKnownLegsTerminal = settlementStatuses.every((settlementStatus) =>
    terminalSettlementStatuses.has(settlementStatus));
  const everyLegAccountedFor = settlementStatuses.length === status.submittedLegs.length;

  if (allKnownLegsTerminal && everyLegAccountedFor) {
    if (settlementStatuses.includes("SETTLEMENT_VERIFIED")) {
      return "SETTLEMENT_VERIFIED";
    }
    if (settlementStatuses.every((settlementStatus) => settlementStatus === "DRY_RUN_ONLY")) {
      return "DRY_RUN_ONLY";
    }
    return "NOT_APPLICABLE";
  }

  return "SETTLEMENT_PENDING";
};

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
        ...(asString(metadata.limitlessAdapterAddress) ? { limitlessAdapterAddress: asString(metadata.limitlessAdapterAddress) } : {}),
        ...(venue === "POLYMARKET" && asString(metadata.tickSize) ? { tickSize: asString(metadata.tickSize) } : {}),
        ...(venue === "POLYMARKET" && asString(metadata.polymarketTickSize) ? { polymarketTickSize: asString(metadata.polymarketTickSize) } : {}),
        ...(venue === "POLYMARKET" && asBoolean(metadata.negRisk) !== undefined ? { negRisk: asBoolean(metadata.negRisk) } : {}),
        ...(venue === "POLYMARKET" && asBoolean(metadata.polymarketNegRisk) !== undefined ? { polymarketNegRisk: asBoolean(metadata.polymarketNegRisk) } : {})
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
