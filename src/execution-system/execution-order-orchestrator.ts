import { createHash, randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import type {
  ExecutableRouteService,
  ExecutableTradeQuote,
  SellQuoteService,
  TradeRouteCandidate,
  TradeSide
} from "./executable-routing.js";
import {
  SignedTradeBundleError,
  type LiveSubmitReadinessSnapshot,
  type SignedTradeBundleService,
  type SignedTradeBundleSubmitResult,
  type SignedTradeExecutionStatus,
  type SignedTradeLegPayload,
  type TradeSignatureRequest
} from "./signed-trade-bundle.js";

export const EXECUTION_ORCHESTRATOR_V1_ENABLED = true;

export type ExecutionOrderState =
  | "READY_TO_PLACE"
  | "NEEDS_SIGNATURE"
  | "NEEDS_VENUE_SETUP"
  | "WAITING_FOR_VENUE_READY"
  | "BLOCKED_ACTION_REQUIRED"
  | "SUBMITTING"
  | "SUBMITTED"
  | "FILLED"
  | "FAILED"
  | "EXPIRED";

export type ExecutionOrderPrimaryAction = "PLACE_ORDER" | "SIGN" | "ENABLE_VENUE" | "NONE";
export type ExecutionOrderVenuePreference = "BEST_ROUTE" | "POLYMARKET" | "LIMITLESS" | "PREDICT_FUN" | "OPINION";
export type ExecutionOrderSigningMode =
  | "NONE"
  | "USER_SIGNATURE_REQUIRED"
  | "BACKEND_SIGNABLE"
  | "MIXED"
  | "UNSUPPORTED";

export interface ExecutionOrderBlocker {
  code: string;
  message: string;
  venue?: string | undefined;
  actionable: boolean;
}

export interface ExecutionOrderVenueCapability {
  venue: string;
  accountReady: boolean;
  fundingReady: boolean;
  signingModel: ExecutionOrderSigningMode;
  submitSupported: boolean;
  fillStatusSupported: boolean;
  settlementSupported: boolean;
  status: "ready" | "waiting" | "blocked";
  blockers: string[];
}

export interface ExecutionOrderRecord {
  orderId: string;
  userId: string;
  quoteId: string | null;
  executionId: string | null;
  state: ExecutionOrderState;
  side: TradeSide;
  marketId: string;
  outcomeId: string;
  amount: string;
  venuePreference: ExecutionOrderVenuePreference;
  signingMode: ExecutionOrderSigningMode;
  primaryAction: ExecutionOrderPrimaryAction;
  readinessSummary: Record<string, unknown>;
  venueCapabilitySummary: { venues: ExecutionOrderVenueCapability[] };
  blockers: ExecutionOrderBlocker[];
  signatureRequestHash: string | null;
  lastError: string | null;
  expiresAt: string | null;
  nextPollAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionOrderRepository {
  saveOrder(order: ExecutionOrderRecord): Promise<void>;
  findOrder(input: { userId: string; orderId: string }): Promise<ExecutionOrderRecord | null>;
  updateOrder(input: {
    userId: string;
    orderId: string;
    patch: Partial<Omit<ExecutionOrderRecord, "orderId" | "userId" | "createdAt">>;
  }): Promise<ExecutionOrderRecord | null>;
  startSubmit(input: {
    userId: string;
    orderId: string;
    allowedStates: readonly ExecutionOrderState[];
  }): Promise<ExecutionOrderRecord | null>;
  listRefreshableOrders(input: { limit: number }): Promise<ExecutionOrderRecord[]>;
}

export interface ExecutionOrderLiveCandidateProvider {
  getCandidates(input: {
    userId: string;
    side: TradeSide;
    marketId: string;
    outcomeId: string;
    amount: string;
    venues?: readonly string[] | undefined;
  }): Promise<{
    generatedAt: string;
    marketId: string;
    outcomeId: string;
    amount: string;
    candidates: readonly TradeRouteCandidate[];
    blocked: readonly { venue: string; reason: string; detailsCode?: string | undefined }[];
  }>;
}

export interface ExecutionOrderPreviewInput {
  userId: string;
  marketId: string;
  outcomeId: string;
  side: TradeSide;
  amount: string;
  venuePreference: ExecutionOrderVenuePreference;
}

export interface ExecutionOrderResponse {
  orderId: string;
  quoteId: string | null;
  executionId: string | null;
  state: ExecutionOrderState;
  primaryAction: { type: ExecutionOrderPrimaryAction };
  signingMode: ExecutionOrderSigningMode;
  routeSummary: Record<string, unknown> | null;
  priceSummary: Record<string, unknown> | null;
  venuePreference: ExecutionOrderVenuePreference;
  readinessSummary: Record<string, unknown>;
  venueCapabilitySummary: { venues: ExecutionOrderVenueCapability[] };
  blockers: ExecutionOrderBlocker[];
  signatureRequests?: TradeSignatureRequest[] | undefined;
  nextPollAt?: string | null | undefined;
  canAutoRenew?: boolean | undefined;
  renewalReason?: "QUOTE_EXPIRED" | undefined;
}

export class ExecutionOrderError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 409
  ) {
    super(message);
    this.name = "ExecutionOrderError";
  }
}

export class ExecutionOrderOrchestratorV1 {
  private readonly previewIntentCache = new Map<string, { orderId: string; expiresAt: number }>();
  private readonly previewInFlight = new Map<string, Promise<ExecutionOrderResponse>>();
  private readonly signaturePrepCache = new Map<string, {
    expiresAt: number;
    hash: string;
    promise: Promise<readonly TradeSignatureRequest[]>;
  }>();
  private readonly submitInFlight = new Map<string, Promise<void>>();

  public constructor(
    private readonly repository: ExecutionOrderRepository,
    private readonly executableRouteService: ExecutableRouteService,
    private readonly sellQuoteService: SellQuoteService,
    private readonly signedTradeBundleService?: SignedTradeBundleService | undefined,
    private readonly liveCandidateProvider?: ExecutionOrderLiveCandidateProvider | undefined
  ) {}

  public async preview(input: ExecutionOrderPreviewInput): Promise<ExecutionOrderResponse> {
    const intentKey = executionOrderIntentKey(input);
    const cached = await this.loadCachedIntent(input.userId, intentKey);
    if (cached) {
      return cached;
    }
    const inFlight = this.previewInFlight.get(intentKey);
    if (inFlight) {
      return inFlight;
    }
    const promise = this.createPreview(input, intentKey);
    this.previewInFlight.set(intentKey, promise);
    try {
      return await promise;
    } finally {
      this.previewInFlight.delete(intentKey);
    }
  }

  private async createPreview(input: ExecutionOrderPreviewInput, intentKey: string): Promise<ExecutionOrderResponse> {
    const candidates = await this.loadCandidates(input);
    if (candidates.candidates.length === 0) {
      const order = this.newOrder(input, {
        quote: null,
        state: classifyCandidateBlockers(candidates.blocked),
        blockers: candidates.blocked.map(toCandidateBlocker),
        readiness: null,
        capabilities: { venues: [] }
      });
      await this.repository.saveOrder(order);
      return toOrderResponse(order, null, null);
    }

    const quote = await this.createQuote(input, candidates.candidates);
    const readiness = await this.readReadiness(input.userId, quote.quoteId);
    const capabilities = buildVenueCapabilities(quote, readiness, Boolean(this.signedTradeBundleService));
    const state = classifyReadiness(readiness, capabilities);
    const order = this.newOrder(input, {
      quote,
      state,
      blockers: [...blockersFromReadiness(readiness), ...blockersFromCapabilities(capabilities)],
      readiness,
      capabilities
    });
    await this.repository.saveOrder(order);
    this.previewIntentCache.set(intentKey, {
      orderId: order.orderId,
      expiresAt: Math.min(Date.parse(order.expiresAt ?? "") || (Date.now() + 5_000), Date.now() + 8_000)
    });
    this.warmSignatureRequests(input.userId, quote, state);
    return toOrderResponse(order, quote, null);
  }

  public async place(input: { userId: string; orderId: string }): Promise<ExecutionOrderResponse> {
    const order = await this.requireOrder(input);
    if (isTerminalOrPendingSubmit(order.state)) {
      return this.status(input);
    }
    const quote = await this.loadFreshQuote(order);
    if (!quote) {
      return this.expireOrder(order);
    }
    const sellGuard = polymarketSellTokenIdBlockers(quote);
    if (sellGuard.length > 0) {
      return this.blockOrder(order, quote, sellGuard);
    }
    await this.assertPolymarketFokBuyStillExecutable(input.userId, quote.quoteId);
    const readiness = await this.requireFreshReadiness(input.userId, quote.quoteId, quote);
    const capabilities = buildVenueCapabilities(quote, readiness, Boolean(this.signedTradeBundleService));
    const readinessState = classifyReadiness(readiness, capabilities);
    if (readinessState !== "READY_TO_PLACE") {
      const updated = await this.repository.updateOrder({
        userId: input.userId,
        orderId: input.orderId,
        patch: {
          state: readinessState,
          primaryAction: primaryActionForState(readinessState),
          readinessSummary: summarizeReadiness(readiness),
          venueCapabilitySummary: capabilities,
          blockers: [...blockersFromReadiness(readiness), ...blockersFromCapabilities(capabilities)],
          nextPollAt: nextPollAtForState(readinessState)
        }
      });
      return toOrderResponse(updated ?? order, quote, null);
    }
    if (quoteRequiresSignature(quote)) {
      const signatureRequests = await this.getPreparedSignatureRequests(input.userId, quote);
      const updated = await this.repository.updateOrder({
        userId: input.userId,
        orderId: input.orderId,
        patch: {
          state: "NEEDS_SIGNATURE",
          primaryAction: "SIGN",
          signingMode: signingModeForQuote(quote),
          readinessSummary: summarizeReadiness(readiness),
          venueCapabilitySummary: capabilities,
          blockers: [],
          signatureRequestHash: signatureRequestHash(signatureRequests),
          nextPollAt: null
        }
      });
      return toOrderResponse(updated ?? order, quote, signatureRequests);
    }
    return this.submitOrderAsync({ userId: input.userId, orderId: input.orderId, quote, signedLegs: [], allowedStates: ["READY_TO_PLACE"] });
  }

  public async submitSignatures(input: {
    userId: string;
    orderId: string;
    signedPayloads: readonly SignedTradeLegPayload[];
  }): Promise<ExecutionOrderResponse> {
    const order = await this.requireOrder(input);
    if (order.state !== "NEEDS_SIGNATURE") {
      if (isTerminalOrPendingSubmit(order.state)) {
        return this.status(input);
      }
      throw new ExecutionOrderError("EXECUTION_ORDER_NOT_SIGNABLE", "This order is not waiting for signatures.", 409);
    }
    const quote = await this.loadFreshQuote(order);
    if (!quote) {
      return this.expireOrder(order);
    }
    const sellGuard = polymarketSellTokenIdBlockers(quote);
    if (sellGuard.length > 0) {
      return this.blockOrder(order, quote, sellGuard);
    }
    this.assertSignedSellPayloadsMatchRoute(quote, input.signedPayloads);
    await this.assertPolymarketFokBuyStillExecutable(input.userId, quote.quoteId, input.signedPayloads);
    return this.submitOrderAsync({
      userId: input.userId,
      orderId: input.orderId,
      quote,
      signedLegs: input.signedPayloads,
      allowedStates: ["NEEDS_SIGNATURE"]
    });
  }

  public async status(input: { userId: string; orderId: string }): Promise<ExecutionOrderResponse> {
    const order = await this.requireOrder(input);
    const quote = await this.loadFreshQuote(order);
    if (!quote && !["SUBMITTING", "SUBMITTED", "FILLED", "FAILED"].includes(order.state)) {
      return this.expireOrder(order);
    }
    if (this.signedTradeBundleService && (order.executionId ?? order.quoteId)) {
      const status = await this.signedTradeBundleService.getExecutionStatus({
        userId: input.userId,
        executionId: order.executionId ?? order.quoteId!
      });
      if (status) {
        const updated = await this.updateFromSignedStatus(order, status);
        return toOrderResponse(updated, status.route ?? quote, null);
      }
    }
    return toOrderResponse(order, quote, null);
  }

  public async refreshOpenOrders(input: { limit: number }): Promise<{ scanned: number; refreshed: number; failed: number }> {
    const orders = await this.repository.listRefreshableOrders({ limit: input.limit });
    let refreshed = 0;
    let failed = 0;
    for (const order of orders) {
      try {
        await this.status({ userId: order.userId, orderId: order.orderId });
        refreshed += 1;
      } catch {
        failed += 1;
      }
    }
    return { scanned: orders.length, refreshed, failed };
  }

  private async loadCandidates(input: ExecutionOrderPreviewInput): Promise<Awaited<ReturnType<ExecutionOrderLiveCandidateProvider["getCandidates"]>>> {
    if (!this.liveCandidateProvider) {
      throw new ExecutionOrderError(
        "LIVE_EXECUTION_CANDIDATES_NOT_CONFIGURED",
        "Live execution candidate sourcing is not configured on this backend.",
        501
      );
    }
    return this.liveCandidateProvider.getCandidates({
      userId: input.userId,
      side: input.side,
      marketId: input.marketId,
      outcomeId: input.outcomeId,
      amount: input.amount,
      ...(input.venuePreference === "BEST_ROUTE" ? {} : { venues: [input.venuePreference] })
    });
  }

  private async createQuote(
    input: ExecutionOrderPreviewInput,
    candidates: readonly TradeRouteCandidate[]
  ): Promise<ExecutableTradeQuote> {
    if (input.side === "sell") {
      const venue = input.venuePreference === "BEST_ROUTE" ? undefined : input.venuePreference;
      const result = await this.sellQuoteService.prepareExit({
        userId: input.userId,
        sellMode: venue ? "SINGLE_VENUE_SELL" : "SELL_ALL",
        ...(venue ? { venue } : {}),
        sizeMode: "CUSTOM_AMOUNT",
        amount: input.amount,
        marketId: input.marketId,
        outcomeId: input.outcomeId,
        candidates
      });
      if (!result.quote) {
        throw new ExecutionOrderError("NO_EXECUTABLE_EXIT_ROUTE", result.userMessage ?? "No executable exit route is available.", 409);
      }
      return result.quote;
    }
    const result = await this.executableRouteService.quote({
      userId: input.userId,
      side: input.side,
      marketId: input.marketId,
      outcomeId: input.outcomeId,
      amount: input.amount,
      candidates
    });
    if (!result.quote) {
      throw new ExecutionOrderError("NO_EXECUTABLE_ROUTE", result.userMessage ?? "No executable route is available.", 409);
    }
    return result.quote;
  }

  private async readReadiness(userId: string, quoteId: string): Promise<LiveSubmitReadinessSnapshot | null> {
    if (!this.signedTradeBundleService) {
      return null;
    }
    return this.signedTradeBundleService.getLiveReadiness({ userId, quoteId });
  }

  private async requireFreshReadiness(
    userId: string,
    quoteId: string,
    quote: ExecutableTradeQuote
  ): Promise<LiveSubmitReadinessSnapshot> {
    const readiness = await this.readReadiness(userId, quoteId);
    if (!readiness) {
      throw new ExecutionOrderError("SIGNED_TRADE_BUNDLE_NOT_CONFIGURED", "Signed trade bundle submission is not configured.", 501);
    }
    const capabilities = buildVenueCapabilities(quote, readiness, true);
    if (classifyReadiness(readiness, capabilities) === "READY_TO_PLACE") {
      return readiness;
    }
    return readiness;
  }

  private async submitOrder(input: {
    userId: string;
    orderId: string;
    quote: ExecutableTradeQuote;
    signedLegs: readonly SignedTradeLegPayload[];
    allowedStates: readonly ExecutionOrderState[];
  }): Promise<ExecutionOrderResponse> {
    if (!this.signedTradeBundleService) {
      throw new ExecutionOrderError("SIGNED_TRADE_BUNDLE_NOT_CONFIGURED", "Signed trade bundle submission is not configured.", 501);
    }
    const submitting = await this.repository.startSubmit({
      userId: input.userId,
      orderId: input.orderId,
      allowedStates: input.allowedStates
    });
    if (!submitting) {
      return this.status({ userId: input.userId, orderId: input.orderId });
    }
    try {
      const result = await this.signedTradeBundleService.submit({
        userId: input.userId,
        quoteId: input.quote.quoteId,
        signedLegs: input.signedLegs,
        dryRun: false
      });
      const updated = await this.updateFromSubmitResult(submitting, result);
      return toOrderResponse(updated, input.quote, null);
    } catch (error) {
      const normalized = normalizeSubmitError(error);
      const updated = await this.repository.updateOrder({
        userId: input.userId,
        orderId: input.orderId,
        patch: {
          state: "FAILED",
          primaryAction: "NONE",
          lastError: normalized.message,
          blockers: [{
            code: normalized.code,
            message: normalized.message,
            actionable: false
          }],
          nextPollAt: null
        }
      });
      return toOrderResponse(updated ?? submitting, input.quote, null);
    }
  }

  private async submitOrderAsync(input: {
    userId: string;
    orderId: string;
    quote: ExecutableTradeQuote;
    signedLegs: readonly SignedTradeLegPayload[];
    allowedStates: readonly ExecutionOrderState[];
  }): Promise<ExecutionOrderResponse> {
    if (!this.signedTradeBundleService) {
      throw new ExecutionOrderError("SIGNED_TRADE_BUNDLE_NOT_CONFIGURED", "Signed trade bundle submission is not configured.", 501);
    }
    const submitting = await this.repository.startSubmit({
      userId: input.userId,
      orderId: input.orderId,
      allowedStates: input.allowedStates
    });
    if (!submitting) {
      return this.status({ userId: input.userId, orderId: input.orderId });
    }
    const key = `${input.userId}:${input.orderId}`;
    if (!this.submitInFlight.has(key)) {
      const promise = this.runSubmitInBackground({
        submitting,
        quote: input.quote,
        signedLegs: input.signedLegs
      }).finally(() => {
        this.submitInFlight.delete(key);
      });
      this.submitInFlight.set(key, promise);
    }
    return toOrderResponse(submitting, input.quote, null);
  }

  private async runSubmitInBackground(input: {
    submitting: ExecutionOrderRecord;
    quote: ExecutableTradeQuote;
    signedLegs: readonly SignedTradeLegPayload[];
  }): Promise<void> {
    try {
      const result = await this.signedTradeBundleService!.submit({
        userId: input.submitting.userId,
        quoteId: input.quote.quoteId,
        signedLegs: input.signedLegs,
        dryRun: false
      });
      await this.updateFromSubmitResult(input.submitting, result);
    } catch (error) {
      const normalized = normalizeSubmitError(error);
      await this.repository.updateOrder({
        userId: input.submitting.userId,
        orderId: input.submitting.orderId,
        patch: {
          state: "FAILED",
          primaryAction: "NONE",
          lastError: normalized.message,
          blockers: [{
            code: normalized.code,
            message: normalized.message,
            actionable: false
          }],
          nextPollAt: null
        }
      });
    }
  }

  private async updateFromSubmitResult(
    order: ExecutionOrderRecord,
    result: SignedTradeBundleSubmitResult
  ): Promise<ExecutionOrderRecord> {
    const state = stateFromSubmitResult(result.status);
    const failureBlockers = result.status === "FAILED" ? blockersFromSubmittedLegs(result.submittedLegs) : [];
    return await this.repository.updateOrder({
      userId: order.userId,
      orderId: order.orderId,
      patch: {
        state,
        primaryAction: primaryActionForState(state),
        executionId: result.executionId,
        lastError: result.status === "FAILED" ? firstSubmitFailure(result) : null,
        blockers: failureBlockers.length > 0 ? failureBlockers : order.blockers,
        nextPollAt: nextPollAtForState(state)
      }
    }) ?? order;
  }

  private async updateFromSignedStatus(
    order: ExecutionOrderRecord,
    status: SignedTradeExecutionStatus
  ): Promise<ExecutionOrderRecord> {
    const state = stateFromSignedStatus(status.status);
    const failureBlockers = status.status === "FAILED" ? blockersFromSubmittedLegs(status.submittedLegs) : [];
    return await this.repository.updateOrder({
      userId: order.userId,
      orderId: order.orderId,
      patch: {
        state,
        primaryAction: primaryActionForState(state),
        executionId: status.executionId,
        lastError: status.status === "FAILED" ? firstStatusFailure(status) : null,
        blockers: failureBlockers.length > 0 ? failureBlockers : order.blockers,
        nextPollAt: nextPollAtForState(state)
      }
    }) ?? order;
  }

  private async loadFreshQuote(order: ExecutionOrderRecord): Promise<ExecutableTradeQuote | null> {
    if (!order.quoteId) {
      return null;
    }
    return this.executableRouteService.getQuote(order.userId, order.quoteId);
  }

  private async loadCachedIntent(userId: string, intentKey: string): Promise<ExecutionOrderResponse | null> {
    const cached = this.previewIntentCache.get(intentKey);
    if (!cached || cached.expiresAt <= Date.now()) {
      this.previewIntentCache.delete(intentKey);
      return null;
    }
    const order = await this.repository.findOrder({ userId, orderId: cached.orderId });
    if (!order || isTerminalOrPendingSubmit(order.state)) {
      this.previewIntentCache.delete(intentKey);
      return null;
    }
    const quote = await this.loadFreshQuote(order);
    if (order.quoteId && !quote) {
      this.previewIntentCache.delete(intentKey);
      return null;
    }
    return toOrderResponse(order, quote, null);
  }

  private warmSignatureRequests(userId: string, quote: ExecutableTradeQuote, state: ExecutionOrderState): void {
    if (!this.signedTradeBundleService || state !== "READY_TO_PLACE" || !quoteRequiresSignature(quote)) {
      return;
    }
    const key = signaturePrepCacheKey(userId, quote.quoteId);
    if (this.signaturePrepCache.has(key)) {
      return;
    }
    const promise = this.signedTradeBundleService.prepare({ userId, quoteId: quote.quoteId })
      .then((bundle) => bundle.signatureRequests);
    this.signaturePrepCache.set(key, {
      expiresAt: Math.min(Date.parse(quote.expiresAt ?? "") || (Date.now() + 10_000), Date.now() + 20_000),
      hash: "",
      promise
    });
    void promise.then((requests) => {
      const existing = this.signaturePrepCache.get(key);
      if (existing) {
        this.signaturePrepCache.set(key, { ...existing, hash: signatureRequestHash(requests) });
      }
    }).catch(() => {
      this.signaturePrepCache.delete(key);
    });
  }

  private async getPreparedSignatureRequests(userId: string, quote: ExecutableTradeQuote): Promise<readonly TradeSignatureRequest[]> {
    const key = signaturePrepCacheKey(userId, quote.quoteId);
    const cached = this.signaturePrepCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.promise;
    }
    const promise = this.signedTradeBundleService!.prepare({ userId, quoteId: quote.quoteId })
      .then((bundle) => bundle.signatureRequests);
    this.signaturePrepCache.set(key, {
      expiresAt: Math.min(Date.parse(quote.expiresAt ?? "") || (Date.now() + 10_000), Date.now() + 20_000),
      hash: "",
      promise
    });
    try {
      const requests = await promise;
      const existing = this.signaturePrepCache.get(key);
      if (existing) {
        this.signaturePrepCache.set(key, { ...existing, hash: signatureRequestHash(requests) });
      }
      return requests;
    } catch (error) {
      this.signaturePrepCache.delete(key);
      throw error;
    }
  }

  private async blockOrder(
    order: ExecutionOrderRecord,
    quote: ExecutableTradeQuote,
    blockers: ExecutionOrderBlocker[]
  ): Promise<ExecutionOrderResponse> {
    const updated = await this.repository.updateOrder({
      userId: order.userId,
      orderId: order.orderId,
      patch: {
        state: "BLOCKED_ACTION_REQUIRED",
        primaryAction: "NONE",
        blockers,
        lastError: blockers[0]?.message ?? null,
        nextPollAt: null
      }
    });
    return toOrderResponse(updated ?? order, quote, null);
  }

  private assertSignedSellPayloadsMatchRoute(
    quote: ExecutableTradeQuote,
    signedLegs: readonly SignedTradeLegPayload[]
  ): void {
    if (quote.side !== "sell") {
      return;
    }
    for (const [index, leg] of quote.legs.entries()) {
      if (leg.venue.toUpperCase() !== "POLYMARKET" || !leg.venueOutcomeId) {
        continue;
      }
      const signed = findPolymarketSignedOrder(signedLegs, index);
      const signedTokenId = signed ? polymarketSignedOrderTokenId(signed) : null;
      if (signedTokenId && signedTokenId !== leg.venueOutcomeId) {
        throw new SignedTradeBundleError(
          "POLYMARKET_SELL_TOKEN_ID_MISMATCH",
          "Polymarket sell signature does not match the executable route token. Refresh route and sign again."
        );
      }
    }
  }

  private async requireOrder(input: { userId: string; orderId: string }): Promise<ExecutionOrderRecord> {
    const order = await this.repository.findOrder(input);
    if (!order) {
      throw new ExecutionOrderError("EXECUTION_ORDER_NOT_FOUND", "Execution order was not found.", 404);
    }
    return order;
  }

  private async expireOrder(order: ExecutionOrderRecord): Promise<ExecutionOrderResponse> {
    const updated = await this.repository.updateOrder({
      userId: order.userId,
      orderId: order.orderId,
      patch: {
        state: "EXPIRED",
        primaryAction: "NONE",
        nextPollAt: null,
        blockers: [{
          code: "QUOTE_EXPIRED",
          message: "Quote expired before execution. Refresh route and retry.",
          actionable: false
        }]
      }
    });
    return toOrderResponse(updated ?? order, null, null, { canAutoRenew: true, renewalReason: "QUOTE_EXPIRED" });
  }

  private newOrder(input: ExecutionOrderPreviewInput, details: {
    quote: ExecutableTradeQuote | null;
    state: ExecutionOrderState;
    blockers: ExecutionOrderBlocker[];
    readiness: LiveSubmitReadinessSnapshot | null;
    capabilities: { venues: ExecutionOrderVenueCapability[] };
  }): ExecutionOrderRecord {
    const now = new Date().toISOString();
    const quote = details.quote;
    return {
      orderId: quote?.quoteId ?? randomUUID(),
      userId: input.userId,
      quoteId: quote?.quoteId ?? null,
      executionId: null,
      state: details.state,
      side: input.side,
      marketId: input.marketId,
      outcomeId: input.outcomeId,
      amount: input.amount,
      venuePreference: input.venuePreference,
      signingMode: quote ? signingModeForQuote(quote) : "UNSUPPORTED",
      primaryAction: primaryActionForState(details.state),
      readinessSummary: summarizeReadiness(details.readiness),
      venueCapabilitySummary: details.capabilities,
      blockers: details.blockers,
      signatureRequestHash: null,
      lastError: null,
      expiresAt: quote?.expiresAt ?? null,
      nextPollAt: nextPollAtForState(details.state),
      createdAt: now,
      updatedAt: now
    };
  }

  private async assertPolymarketFokBuyStillExecutable(
    userId: string,
    quoteId: string,
    signedLegs?: readonly SignedTradeLegPayload[]
  ): Promise<void> {
    if (!this.liveCandidateProvider) {
      return;
    }
    const quote = await this.executableRouteService.getQuote(userId, quoteId);
    if (!quote || quote.side !== "buy") {
      return;
    }
    for (const [index, leg] of quote.legs.entries()) {
      if (leg.venue.toUpperCase() !== "POLYMARKET") {
        continue;
      }
      const signedOrder = signedLegs ? findPolymarketSignedOrder(signedLegs, index) : null;
      const signedOrderType = signedOrder ? asString(recordField(recordField(signedOrder.signedPayload, "data") ?? {}, "orderType")) : null;
      if (signedOrderType && signedOrderType.toUpperCase() !== "FOK") {
        continue;
      }
      const maxPrice = signedOrder ? polymarketSignedOrderLimitPrice(signedOrder) : polymarketRouteFokBuyLimitPrice(leg);
      if (maxPrice === null) {
        throw new SignedTradeBundleError(
          "POLYMARKET_FOK_ROUTE_NOT_EXECUTABLE",
          "Polymarket FOK route could not derive a signed limit price. Refresh route before signing."
        );
      }
      const live = await this.liveCandidateProvider.getCandidates({
        userId,
        side: "buy",
        marketId: quote.marketId,
        outcomeId: quote.outcomeId,
        amount: leg.size,
        venues: ["POLYMARKET"]
      });
      const candidate = live.candidates.find((item) =>
        item.venue.toUpperCase() === "POLYMARKET" &&
        (!leg.venueMarketId || item.venueMarketId === leg.venueMarketId) &&
        (!leg.venueOutcomeId || item.venueOutcomeId === leg.venueOutcomeId)
      );
      if (!candidate) {
        throw new SignedTradeBundleError(
          "POLYMARKET_FOK_ROUTE_NOT_EXECUTABLE",
          live.blocked.find((item) => item.venue.toUpperCase() === "POLYMARKET")?.reason ??
            "Polymarket FOK route is no longer executable. Refresh route before signing."
        );
      }
      if (new Decimal(candidate.availableSize).lt(new Decimal(leg.size))) {
        throw new SignedTradeBundleError(
          "POLYMARKET_FOK_ROUTE_NOT_EXECUTABLE",
          "Polymarket FOK depth changed before execution. Refresh route and retry."
        );
      }
      if (!Number.isFinite(candidate.price) || new Decimal(candidate.price).gt(maxPrice.plus("0.000000001"))) {
        throw new SignedTradeBundleError(
          "POLYMARKET_FOK_ROUTE_NOT_EXECUTABLE",
          "Polymarket FOK price moved before execution. Refresh route and retry."
        );
      }
    }
  }
}

const buildVenueCapabilities = (
  quote: ExecutableTradeQuote,
  readiness: LiveSubmitReadinessSnapshot | null,
  signedSubmitConfigured: boolean
): { venues: ExecutionOrderVenueCapability[] } => {
  const readinessByVenue = new Map((readiness?.venues ?? []).map((venue) => [venue.venue.toUpperCase(), venue]));
  return {
    venues: quote.legs.map((leg) => {
      const venue = leg.venue.toUpperCase();
      const venueReadiness = readinessByVenue.get(venue);
      const sellTokenBlockers = polymarketSellTokenIdBlockersForLeg(quote, leg);
      const blockers = [
        ...(venueReadiness?.blockers ?? []),
        ...sellTokenBlockers.map((blocker) => blocker.message)
      ];
      const adapterMissing = blockers.some((blocker) => /NOT CONFIGURED|UNSUPPORTED|ADAPTER/i.test(blocker));
      const submitSupported = signedSubmitConfigured && venue !== "MYRIAD" && !adapterMissing;
      const status = !submitSupported || venueReadiness?.status === "blocked" || sellTokenBlockers.length > 0
        ? "blocked"
        : venueReadiness?.status === "stale" || !venueReadiness
        ? "waiting"
        : "ready";
      return {
        venue,
        accountReady: Boolean(venueReadiness?.account.venueAccountAddress ?? venueReadiness?.account.ownerAddress),
        fundingReady: venueReadiness?.status === "fresh",
        signingModel: leg.requiresUserSignature ? "USER_SIGNATURE_REQUIRED" : "BACKEND_SIGNABLE",
        submitSupported,
        fillStatusSupported: submitSupported,
        settlementSupported: submitSupported,
        status,
        blockers
      };
    })
  };
};

const classifyReadiness = (
  readiness: LiveSubmitReadinessSnapshot | null,
  capabilities: { venues: ExecutionOrderVenueCapability[] }
): ExecutionOrderState => {
  if (capabilities.venues.some((venue) => !venue.submitSupported)) {
    return "BLOCKED_ACTION_REQUIRED";
  }
  if (capabilities.venues.some((venue) => venue.status === "blocked")) {
    return "BLOCKED_ACTION_REQUIRED";
  }
  if (!readiness || readiness.status === "stale" || capabilities.venues.some((venue) => venue.status === "waiting")) {
    return "WAITING_FOR_VENUE_READY";
  }
  if (readiness.status === "fresh") {
    return "READY_TO_PLACE";
  }
  const text = readiness.blockers.join(" ").toUpperCase();
  if (/ACCOUNT|ACTIVATION|PROFILE|LINK|JWT|AUTH|ENABLE/.test(text)) {
    return "NEEDS_VENUE_SETUP";
  }
  if (/SYNC|PENDING|PROPAGATION|UNAVAILABLE|429|RATE/.test(text)) {
    return "WAITING_FOR_VENUE_READY";
  }
  return "BLOCKED_ACTION_REQUIRED";
};

const classifyCandidateBlockers = (
  blockers: readonly { reason: string; detailsCode?: string | undefined }[]
): ExecutionOrderState => {
  const text = blockers.map((blocker) => `${blocker.detailsCode ?? ""} ${blocker.reason}`).join(" ").toUpperCase();
  if (/ACCOUNT|ACTIVATION|PROFILE|LINK|JWT|AUTH|ENABLE/.test(text)) {
    return "NEEDS_VENUE_SETUP";
  }
  if (/SYNC|PENDING|PROPAGATION|UNAVAILABLE|429|RATE|STALE/.test(text)) {
    return "WAITING_FOR_VENUE_READY";
  }
  return "BLOCKED_ACTION_REQUIRED";
};

const primaryActionForState = (state: ExecutionOrderState): ExecutionOrderPrimaryAction => {
  if (state === "READY_TO_PLACE") return "PLACE_ORDER";
  if (state === "NEEDS_SIGNATURE") return "SIGN";
  if (state === "NEEDS_VENUE_SETUP") return "ENABLE_VENUE";
  return "NONE";
};

const signingModeForQuote = (quote: ExecutableTradeQuote): ExecutionOrderSigningMode => {
  const signed = quote.legs.filter((leg) => leg.requiresUserSignature).length;
  if (signed === 0) return "BACKEND_SIGNABLE";
  if (signed === quote.legs.length) return "USER_SIGNATURE_REQUIRED";
  return "MIXED";
};

const quoteRequiresSignature = (quote: ExecutableTradeQuote): boolean =>
  quote.requiredUserSignatureSteps.length > 0 || quote.legs.some((leg) => leg.requiresUserSignature);

const stateFromSubmitResult = (status: SignedTradeBundleSubmitResult["status"]): ExecutionOrderState => {
  if (status === "FAILED") return "FAILED";
  return "SUBMITTED";
};

const stateFromSignedStatus = (status: SignedTradeExecutionStatus["status"]): ExecutionOrderState => {
  if (status === "FAILED") return "FAILED";
  if (status === "FILLED") return "FILLED";
  return "SUBMITTED";
};

const isTerminalOrPendingSubmit = (state: ExecutionOrderState): boolean =>
  ["SUBMITTING", "SUBMITTED", "FILLED", "FAILED", "EXPIRED"].includes(state);

const nextPollAtForState = (state: ExecutionOrderState): string | null =>
  state === "SUBMITTING" || state === "SUBMITTED" || state === "WAITING_FOR_VENUE_READY"
    ? new Date(Date.now() + 2_000).toISOString()
    : null;

const summarizeReadiness = (readiness: LiveSubmitReadinessSnapshot | null): Record<string, unknown> => ({
  status: readiness?.status ?? "unavailable",
  generatedAt: readiness?.generatedAt ?? null,
  expiresAt: readiness?.expiresAt ?? null,
  venues: readiness?.venues.map((venue) => ({
    venue: venue.venue,
    status: venue.status,
    readinessCode: venue.readinessCode ?? null,
    nextAction: venue.nextAction ?? null,
    retryable: venue.retryable ?? null,
    requiresUserSync: venue.requiresUserSync ?? null
  })) ?? []
});

const blockersFromReadiness = (readiness: LiveSubmitReadinessSnapshot | null): ExecutionOrderBlocker[] =>
  (readiness?.venues.flatMap((venue) =>
    venue.blockers.map((message) => ({
      code: venue.readinessCode ?? readiness.status.toUpperCase(),
      message,
      venue: venue.venue,
      actionable: venue.status === "blocked"
    }))
  ) ?? []);

const blockersFromCapabilities = (capabilities: { venues: ExecutionOrderVenueCapability[] }): ExecutionOrderBlocker[] =>
  capabilities.venues.flatMap((venue) =>
    venue.blockers.map((message) => ({
      code: message.includes("conditional token id") ? "POLYMARKET_SELL_TOKEN_ID_MISSING" : "VENUE_CAPABILITY_BLOCKED",
      message,
      venue: venue.venue,
      actionable: false
    }))
  );

const executionOrderIntentKey = (input: ExecutionOrderPreviewInput): string =>
  [
    input.userId,
    input.marketId,
    input.outcomeId,
    input.side,
    normalizeAmountKey(input.amount),
    input.venuePreference
  ].join("\u0000");

const normalizeAmountKey = (value: string): string => {
  try {
    return new Decimal(value).toDecimalPlaces(8).toString();
  } catch {
    return value.trim();
  }
};

const signaturePrepCacheKey = (userId: string, quoteId: string): string => `${userId}\u0000${quoteId}`;

const polymarketSellTokenIdBlockers = (quote: ExecutableTradeQuote): ExecutionOrderBlocker[] =>
  quote.legs.flatMap((leg) => polymarketSellTokenIdBlockersForLeg(quote, leg));

const polymarketSellTokenIdBlockersForLeg = (
  quote: ExecutableTradeQuote,
  leg: ExecutableTradeQuote["legs"][number]
): ExecutionOrderBlocker[] => {
  if (quote.side !== "sell" || leg.venue.toUpperCase() !== "POLYMARKET" || leg.venueOutcomeId) {
    return [];
  }
  return [{
    code: "POLYMARKET_SELL_TOKEN_ID_MISSING",
    message: "Polymarket sell route is missing the executable conditional token id. Refresh market metadata before selling.",
    venue: "POLYMARKET",
    actionable: false
  }];
};

const toCandidateBlocker = (blocker: { venue: string; reason: string; detailsCode?: string | undefined }): ExecutionOrderBlocker => ({
  code: blocker.detailsCode ?? "LIVE_CANDIDATE_BLOCKED",
  message: blocker.reason,
  venue: blocker.venue,
  actionable: true
});

const signatureRequestHash = (requests: readonly TradeSignatureRequest[]): string =>
  createHash("sha256").update(JSON.stringify(requests)).digest("hex");

const toOrderResponse = (
  order: ExecutionOrderRecord,
  quote: ExecutableTradeQuote | null,
  signatureRequests: readonly TradeSignatureRequest[] | null,
  override?: { canAutoRenew?: boolean | undefined; renewalReason?: "QUOTE_EXPIRED" | undefined }
): ExecutionOrderResponse => ({
  orderId: order.orderId,
  quoteId: order.quoteId,
  executionId: order.executionId,
  state: order.state,
  primaryAction: { type: order.primaryAction },
  signingMode: order.signingMode,
  routeSummary: quote ? routeSummary(quote) : null,
  priceSummary: quote ? priceSummary(quote) : null,
  venuePreference: order.venuePreference,
  readinessSummary: order.readinessSummary,
  venueCapabilitySummary: order.venueCapabilitySummary,
  blockers: order.blockers,
  ...(order.lastError ? { lastError: order.lastError } : {}),
  ...(signatureRequests ? { signatureRequests: [...signatureRequests] } : {}),
  ...(order.nextPollAt ? { nextPollAt: order.nextPollAt } : {}),
  ...(override?.canAutoRenew ? { canAutoRenew: true } : {}),
  ...(override?.renewalReason ? { renewalReason: override.renewalReason } : {})
});

const routeSummary = (quote: ExecutableTradeQuote): Record<string, unknown> => ({
  routeType: quote.routeType,
  venuePath: quote.venuePath,
  executableAmount: quote.executableAmount,
  skippedAmount: quote.skippedAmount,
  legs: quote.legs.map((leg) => ({
    venue: leg.venue,
    size: leg.size,
    price: leg.price,
    requiresUserSignature: leg.requiresUserSignature
  }))
});

const priceSummary = (quote: ExecutableTradeQuote): Record<string, unknown> => ({
  expectedPrice: quote.expectedPrice,
  effectivePrice: quote.effectivePrice ?? quote.expectedPrice,
  estimatedSavings: quote.estimatedSavings ?? null,
  expectedFees: quote.legs.reduce((sum, leg) => sum + (leg.feeAmount ?? 0), 0)
});

const normalizeSubmitError = (error: unknown): { code: string; message: string } => {
  if (error instanceof SignedTradeBundleError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "EXECUTION_ORDER_SUBMIT_FAILED",
    message: error instanceof Error ? error.message : "Execution order submit failed."
  };
};

const firstSubmitFailure = (result: SignedTradeBundleSubmitResult): string | null =>
  result.submittedLegs.find((leg) => leg.reason)?.reason ??
  result.submittedLegs.find((leg) => leg.reasonCode)?.reasonCode ??
  result.submittedLegs.find((leg) => leg.status === "FAILED")?.status ??
  null;

const firstStatusFailure = (status: SignedTradeExecutionStatus): string | null =>
  status.submittedLegs.find((leg) => leg.reason)?.reason ??
  status.submittedLegs.find((leg) => leg.reasonCode)?.reasonCode ??
  status.submittedLegs.find((leg) => leg.status === "FAILED")?.status ??
  null;

const blockersFromSubmittedLegs = (
  legs: ReadonlyArray<{ venue: string; reasonCode?: string | undefined; reason?: string | undefined; status?: string | undefined }>
): ExecutionOrderBlocker[] =>
  legs
    .filter((leg) => leg.reason || leg.reasonCode || leg.status === "FAILED")
    .map((leg) => ({
      code: leg.reasonCode ?? leg.status ?? "VENUE_SUBMIT_FAILED",
      message: leg.reason ?? leg.reasonCode ?? "Venue submit failed.",
      venue: leg.venue,
      actionable: false
    }));

const findPolymarketSignedOrder = (
  signedLegs: readonly SignedTradeLegPayload[],
  legIndex: number
): SignedTradeLegPayload | null =>
  signedLegs.find((payload) => {
    if (payload.legIndex !== legIndex || payload.venue.toUpperCase() !== "POLYMARKET") {
      return false;
    }
    const data = recordField(payload.signedPayload, "data");
    return payload.requestType === "ORDER" ||
      asString(payload.signedPayload.purpose) === "POLYMARKET_ORDER" ||
      Boolean(recordField(data ?? {}, "order"));
  }) ?? null;

const polymarketSignedOrderLimitPrice = (signedLeg: SignedTradeLegPayload): InstanceType<typeof Decimal> | null => {
  const data = recordField(signedLeg.signedPayload, "data");
  const order = data ? recordField(data, "order") : null;
  const makerAmount = order ? decimalFromRecord(order, "makerAmount") : null;
  const takerAmount = order ? decimalFromRecord(order, "takerAmount") : null;
  if (!makerAmount || !takerAmount || takerAmount.lte(0)) {
    return null;
  }
  return makerAmount.div(takerAmount);
};

const polymarketSignedOrderTokenId = (signedLeg: SignedTradeLegPayload): string | null => {
  const data = recordField(signedLeg.signedPayload, "data");
  const order = data ? recordField(data, "order") : null;
  if (!order) {
    return null;
  }
  return asString(order.tokenId) ?? asString(order.assetId) ?? asString(order.makerAssetId) ?? asString(order.takerAssetId) ?? null;
};

const polymarketRouteFokBuyLimitPrice = (leg: ExecutableTradeQuote["legs"][number]): InstanceType<typeof Decimal> | null => {
  if (!Number.isFinite(leg.price) || leg.price <= 0 || leg.price >= 1) {
    return null;
  }
  const tick = new Decimal(polymarketTickSizeFromMetadata(leg.metadata) ?? "0.001");
  const maxPrice = Decimal.max(0, new Decimal(1).minus(tick));
  const cushioned = new Decimal(leg.price).times(new Decimal(1).plus(new Decimal(100).div(10_000)));
  return Decimal.min(maxPrice, cushioned).div(tick).ceil().times(tick);
};

const polymarketTickSizeFromMetadata = (metadata: Readonly<Record<string, unknown>> | undefined): string | null => {
  const value = asString(metadata?.polymarketTickSize) ?? asString(metadata?.tickSize);
  return value === "0.1" || value === "0.01" || value === "0.001" || value === "0.0001" ? value : null;
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
