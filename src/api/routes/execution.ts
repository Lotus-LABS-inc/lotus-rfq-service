import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type {
  ExecutableRouteService,
  ExecutableTradeQuote,
  SellQuoteService,
  TradeRouteCandidate
} from "../../execution-system/executable-routing.js";
import {
  SignedTradeBundleError,
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
  missingFactors: z.array(z.string()).optional()
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
  liveCandidateProvider?: LiveExecutionCandidateProvider | undefined;
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
  const allowedVenues = input.venues?.length
    ? new Set(input.venues.map((venue) => venue.toUpperCase()))
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
      ...(blocker.venueOutcomeId ? { venueOutcomeId: blocker.venueOutcomeId } : {})
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
      quoteBlockers
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
