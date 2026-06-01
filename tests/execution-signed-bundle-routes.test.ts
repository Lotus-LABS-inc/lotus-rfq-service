import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  buildLiveExecutionCandidatesResponse,
  registerExecutionRoutes
} from "../src/api/routes/execution.js";
import {
  assertPolymarketFokStillExecutable,
  ExecutionOrderOrchestratorV1,
  type ExecutionOrderRecord,
  type ExecutionOrderRepository
} from "../src/execution-system/execution-order-orchestrator.js";
import type { SignedTradeExecutionStatus } from "../src/execution-system/signed-trade-bundle.js";

describe("execution signed bundle routes", () => {
  class MemoryExecutionOrderRepository implements ExecutionOrderRepository {
    private readonly rows = new Map<string, ExecutionOrderRecord>();

    public async saveOrder(order: ExecutionOrderRecord): Promise<void> {
      this.rows.set(this.key(order.userId, order.orderId), { ...order });
    }

    public async findOrder(input: { userId: string; orderId: string }): Promise<ExecutionOrderRecord | null> {
      return this.rows.get(this.key(input.userId, input.orderId)) ?? null;
    }

    public async updateOrder(input: {
      userId: string;
      orderId: string;
      patch: Partial<Omit<ExecutionOrderRecord, "orderId" | "userId" | "createdAt">>;
    }): Promise<ExecutionOrderRecord | null> {
      const existing = await this.findOrder(input);
      if (!existing) return null;
      const next = { ...existing, ...input.patch, updatedAt: new Date().toISOString() };
      this.rows.set(this.key(input.userId, input.orderId), next);
      return next;
    }

    public async startSubmit(input: {
      userId: string;
      orderId: string;
      allowedStates: readonly ExecutionOrderRecord["state"][];
    }): Promise<ExecutionOrderRecord | null> {
      const existing = await this.findOrder(input);
      if (!existing || !input.allowedStates.includes(existing.state)) return null;
      return this.updateOrder({
        userId: input.userId,
        orderId: input.orderId,
        patch: {
          state: "SUBMITTING",
          primaryAction: "NONE",
          nextPollAt: new Date(Date.now() + 2_000).toISOString()
        }
      });
    }

    public async listRefreshableOrders(): Promise<ExecutionOrderRecord[]> {
      return [...this.rows.values()].filter((order) =>
        order.state === "SUBMITTING" ||
        order.state === "SUBMITTED" ||
        (order.state === "FAILED" && Boolean(order.executionId))
      );
    }

    private key(userId: string, orderId: string): string {
      return `${userId}:${orderId}`;
    }
  }

  const sellQuote = () => ({
    quoteId: "exec_quote_sell",
    userId: "user-1",
    side: "sell" as const,
    marketId: "market-1",
    outcomeId: "NO",
    routeType: "SINGLE_VENUE" as const,
    venuePath: ["POLYMARKET"],
    executableAmount: "2",
    skippedAmount: "0",
    expectedPrice: 0.99,
    effectivePrice: 0.99,
    requiredUserSignatureSteps: ["POLYMARKET user signature required"],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    legs: [{
      venue: "POLYMARKET",
      venueMarketId: "poly-market",
      venueOutcomeId: "12345678901234567890",
      size: "2",
      price: 0.99,
      requiresUserSignature: true
    }]
  });

  const buyQuote = (venue = "POLYMARKET", requiresUserSignature = true) => ({
    quoteId: `exec_quote_${venue.toLowerCase()}`,
    userId: "user-1",
    side: "buy" as const,
    marketId: "market-1",
    outcomeId: "YES",
    routeType: "SINGLE_VENUE" as const,
    venuePath: [venue],
    executableAmount: "1",
    skippedAmount: "0",
    expectedPrice: 0.5,
    effectivePrice: 0.5,
    requiredUserSignatureSteps: requiresUserSignature ? [`${venue} user signature required`] : [],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    legs: [{
      venue,
      venueMarketId: `${venue.toLowerCase()}-market`,
      venueOutcomeId: `${venue.toLowerCase()}-token`,
      size: "1",
      price: 0.5,
      requiresUserSignature
    }]
  });

  it("orchestrates Polymarket buy as Place then signature then backend submit", async () => {
    const app = Fastify();
    const quote = buyQuote("POLYMARKET", true);
    const executableRouteService = {
      quote: vi.fn(async () => ({ quote, rejectedCandidates: [], internalCandidateCount: 1 })),
      getQuote: vi.fn(async () => quote)
    };
    const getLiveReadiness = vi.fn(async () => ({
      quoteId: quote.quoteId,
      generatedAt: new Date().toISOString(),
      expiresAt: quote.expiresAt,
      status: "fresh",
      blockers: [],
      venues: [{
        venue: "POLYMARKET",
        status: "fresh",
        checkedAt: new Date().toISOString(),
        blockers: [],
        readinessCode: "POLYMARKET_CLOB_READY_FOR_SUBMIT",
        account: { walletAddress: "0xwallet", venueAccountAddress: "0xdeposit", ownerAddress: "0xdeposit" },
        collateral: {
          requiredNotional: "1",
          balance: "10",
          allowance: "10",
          tokenSymbol: "pUSD",
          tokenAddress: null,
          spenderAddress: null,
          chainId: 137
        }
      }]
    }));
    const prepare = vi.fn(async () => ({
      quoteId: quote.quoteId,
      expiresAt: quote.expiresAt,
      signatureRequests: [{
        legIndex: 0,
        venue: "POLYMARKET",
        requestType: "ORDER",
        account: "0xdeposit",
        message: "sign order",
        typedData: {},
        signedPayloadHint: {}
      }]
    }));
    const submit = vi.fn(async () => ({
      executionId: quote.quoteId,
      status: "SUBMITTED",
      dryRun: false,
      submittedLegs: [{ legIndex: 0, venue: "POLYMARKET", status: "SUBMITTED", venueOrderId: "poly-order" }]
    }));
    const service = new ExecutionOrderOrchestratorV1(
      new MemoryExecutionOrderRepository(),
      executableRouteService as never,
      { prepareExit: vi.fn() } as never,
      {
        getLiveReadiness,
        prepare,
        submit,
        getExecutionStatus: vi.fn(async () => null)
      } as never,
      {
        getCandidates: vi.fn(async () => ({
          generatedAt: new Date().toISOString(),
          marketId: "market-1",
          outcomeId: "YES",
          amount: "1",
          candidates: [{
            venue: "POLYMARKET",
            venueMarketId: "polymarket-market",
            venueOutcomeId: "polymarket-token",
            price: 0.5,
            availableSize: "10",
            requiresUserSignature: true,
            metadata: { polymarketTickSize: "0.001" }
          }],
          blocked: []
        }))
      }
    );
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: executableRouteService as never,
      sellQuoteService: { prepareExit: vi.fn() } as never,
      executionOrderService: service
    });

    const preview = await app.inject({
      method: "POST",
      url: "/execution/orders/preview",
      payload: {
        marketId: "market-1",
        outcomeId: "YES",
        side: "buy",
        amount: "1",
        venuePreference: "POLYMARKET",
        orderPolicy: "FOK",
        slippageToleranceBps: 50
      }
    });
    expect(preview.statusCode).toBe(201);
    expect(preview.json()).toMatchObject({
      state: "READY_TO_PLACE",
      primaryAction: { type: "PLACE_ORDER" },
      signingMode: "USER_SIGNATURE_REQUIRED",
      orderPolicy: "FOK",
      slippageToleranceBps: 50
    });

    const place = await app.inject({ method: "POST", url: `/execution/orders/${quote.quoteId}/place` });
    expect(place.statusCode).toBe(200);
    expect(place.json()).toMatchObject({
      state: "NEEDS_SIGNATURE",
      primaryAction: { type: "SIGN" }
    });
    expect(prepare).toHaveBeenCalledWith({
      userId: "user-1",
      quoteId: quote.quoteId,
      orderPolicy: "FOK",
      slippageToleranceBps: 50
    });

    const signed = await app.inject({
      method: "POST",
      url: `/execution/orders/${quote.quoteId}/signatures`,
      payload: {
        signedPayloads: [{
          legIndex: 0,
          venue: "POLYMARKET",
          requestType: "ORDER",
          signedPayload: {
            purpose: "POLYMARKET_ORDER",
            data: { order: { makerAmount: "503000", takerAmount: "1000000" }, orderType: "FOK" },
            signature: "0xsig",
            account: "0xdeposit"
          }
        }]
      }
    });
    expect(signed.statusCode).toBe(202);
    expect(signed.json()).toMatchObject({
      state: "SUBMITTING",
      primaryAction: { type: "NONE" },
    });
    await new Promise((resolve) => setImmediate(resolve));
    const status = await app.inject({ method: "GET", url: `/execution/orders/${quote.quoteId}/status` });
    expect(status.json()).toMatchObject({
      state: "SUBMITTED",
      executionId: quote.quoteId,
      blockers: []
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({
      userId: "user-1",
      quoteId: quote.quoteId,
      signedLegs: [{
        legIndex: 0,
        venue: "POLYMARKET",
        requestType: "ORDER",
        signedPayload: {
          purpose: "POLYMARKET_ORDER",
          data: { order: { makerAmount: "503000", takerAmount: "1000000" }, orderType: "FOK" },
          signature: "0xsig",
          account: "0xdeposit"
        }
      }],
      dryRun: false,
      orderPolicy: "FOK",
      slippageToleranceBps: 50
    });
  });

  it("returns submitted leg failure details from orchestrated signature submit", async () => {
    const app = Fastify();
    const quote = buyQuote("POLYMARKET", true);
    const executableRouteService = {
      quote: vi.fn(async () => ({ quote, rejectedCandidates: [], internalCandidateCount: 1 })),
      getQuote: vi.fn(async () => quote)
    };
    const service = new ExecutionOrderOrchestratorV1(
      new MemoryExecutionOrderRepository(),
      executableRouteService as never,
      { prepareExit: vi.fn() } as never,
      {
        getLiveReadiness: vi.fn(async () => ({
          quoteId: quote.quoteId,
          generatedAt: new Date().toISOString(),
          expiresAt: quote.expiresAt,
          status: "fresh",
          blockers: [],
          venues: [{
            venue: "POLYMARKET",
            status: "fresh",
            checkedAt: new Date().toISOString(),
            blockers: [],
            readinessCode: "POLYMARKET_CLOB_READY_FOR_SUBMIT",
            account: { walletAddress: "0xwallet", venueAccountAddress: "0xdeposit", ownerAddress: "0xdeposit" },
            collateral: {
              requiredNotional: "1",
              balance: "10",
              allowance: "10",
              tokenSymbol: "pUSD",
              tokenAddress: null,
              spenderAddress: null,
              chainId: 137
            }
          }]
        })),
        prepare: vi.fn(async () => ({
          quoteId: quote.quoteId,
          expiresAt: quote.expiresAt,
          signatureRequests: [{
            legIndex: 0,
            venue: "POLYMARKET",
            requestType: "ORDER",
            account: "0xdeposit",
            signer: "0xwallet",
            kind: "EIP712",
            expiresAt: quote.expiresAt,
            typedData: {},
            signedPayloadHint: {}
          }]
        })),
        submit: vi.fn(async () => ({
          executionId: quote.quoteId,
          status: "FAILED",
          dryRun: false,
          submittedLegs: [{
            legIndex: 0,
            venue: "POLYMARKET",
            status: "FAILED",
            reasonCode: "POLYMARKET_CLOB_ORDER_PARAMS_REJECTED",
            reason: "Polymarket rejected the order parameters."
          }]
        })),
        getExecutionStatus: vi.fn(async () => null)
      } as never,
      {
        getCandidates: vi.fn(async () => ({
          generatedAt: new Date().toISOString(),
          marketId: "market-1",
          outcomeId: "YES",
          amount: "1",
          candidates: [{
            venue: "POLYMARKET",
            venueMarketId: "polymarket-market",
            venueOutcomeId: "polymarket-token",
            price: 0.5,
            availableSize: "10",
            requiresUserSignature: true,
            metadata: { polymarketTickSize: "0.001" }
          }],
          blocked: []
        }))
      }
    );
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: executableRouteService as never,
      sellQuoteService: { prepareExit: vi.fn() } as never,
      executionOrderService: service
    });

    await app.inject({
      method: "POST",
      url: "/execution/orders/preview",
      payload: { marketId: "market-1", outcomeId: "YES", side: "buy", amount: "1", venuePreference: "POLYMARKET" }
    });
    await app.inject({ method: "POST", url: `/execution/orders/${quote.quoteId}/place` });
    const signed = await app.inject({
      method: "POST",
      url: `/execution/orders/${quote.quoteId}/signatures`,
      payload: {
        signedPayloads: [{
          legIndex: 0,
          venue: "POLYMARKET",
          requestType: "ORDER",
          signedPayload: {
            purpose: "POLYMARKET_ORDER",
            data: { order: { makerAmount: "505000", takerAmount: "1000000" }, orderType: "FOK" },
            signature: "0xsig",
            account: "0xdeposit"
          }
        }]
      }
    });

    expect(signed.statusCode).toBe(202);
    expect(signed.json()).toMatchObject({
      state: "SUBMITTING"
    });
    await new Promise((resolve) => setImmediate(resolve));
    const status = await app.inject({ method: "GET", url: `/execution/orders/${quote.quoteId}/status` });
    expect(status.json()).toMatchObject({
      state: "FAILED",
      lastError: "Polymarket rejected the order parameters.",
      blockers: [{
        code: "POLYMARKET_CLOB_ORDER_PARAMS_REJECTED",
        message: "Polymarket rejected the order parameters.",
        venue: "POLYMARKET",
        actionable: false
      }]
    });
  });

  it("reconciles a recent failed V1 order to filled when venue status later confirms fill", async () => {
    const quote = buyQuote("POLYMARKET", true);
    let executionStatus: SignedTradeExecutionStatus | null = null;
    const repository = new MemoryExecutionOrderRepository();
    const service = new ExecutionOrderOrchestratorV1(
      repository,
      {
        quote: vi.fn(async () => ({ quote, rejectedCandidates: [], internalCandidateCount: 1 })),
        getQuote: vi.fn(async () => quote)
      } as never,
      { prepareExit: vi.fn() } as never,
      {
        getLiveReadiness: vi.fn(async () => ({
          quoteId: quote.quoteId,
          generatedAt: new Date().toISOString(),
          expiresAt: quote.expiresAt,
          status: "fresh",
          blockers: [],
          venues: [{
            venue: "POLYMARKET",
            status: "fresh",
            checkedAt: new Date().toISOString(),
            blockers: [],
            account: { walletAddress: "0xwallet", venueAccountAddress: "0xdeposit", ownerAddress: "0xdeposit" },
            collateral: { requiredNotional: "1", balance: "10", allowance: "10", tokenSymbol: "pUSD", tokenAddress: null, spenderAddress: null, chainId: 137 }
          }]
        })),
        prepare: vi.fn(async () => ({
          quoteId: quote.quoteId,
          expiresAt: quote.expiresAt,
          signatureRequests: [{
            legIndex: 0,
            venue: "POLYMARKET",
            requestType: "ORDER",
            account: "0xdeposit",
            signer: "0xwallet",
            kind: "EIP712",
            expiresAt: quote.expiresAt,
            typedData: {},
            signedPayloadHint: {}
          }]
        })),
        submit: vi.fn(async () => ({
          executionId: quote.quoteId,
          status: "FAILED",
          dryRun: false,
          submittedLegs: [{
            legIndex: 0,
            venue: "POLYMARKET",
            status: "FAILED",
            reasonCode: "POLYMARKET_CLOB_ORDER_PARAMS_REJECTED",
            reason: "Polymarket rejected the order parameters."
          }]
        })),
        getExecutionStatus: vi.fn(async () => executionStatus)
      } as never,
      {
        getCandidates: vi.fn(async () => ({
          generatedAt: new Date().toISOString(),
          marketId: quote.marketId,
          outcomeId: quote.outcomeId,
          amount: quote.legs[0]!.size,
          candidates: [{
            venue: "POLYMARKET",
            venueMarketId: quote.legs[0]!.venueMarketId,
            venueOutcomeId: quote.legs[0]!.venueOutcomeId,
            price: quote.legs[0]!.price,
            availableSize: "10",
            requiresUserSignature: true,
            metadata: { polymarketTickSize: "0.001" }
          }],
          blocked: []
        }))
      }
    );

    const preview = await service.preview({
      userId: "user-1",
      marketId: quote.marketId,
      outcomeId: quote.outcomeId,
      side: "buy",
      amount: "1",
      venuePreference: "POLYMARKET"
    });
    await service.place({ userId: "user-1", orderId: preview.orderId });
    await service.submitSignatures({
      userId: "user-1",
      orderId: preview.orderId,
      signedPayloads: [{
        legIndex: 0,
        venue: "POLYMARKET",
        requestType: "ORDER",
        signedPayload: {
          purpose: "POLYMARKET_ORDER",
          data: { order: { makerAmount: "505000", takerAmount: "1000000" }, orderType: "FOK" },
          signature: "0xsig",
          account: "0xdeposit"
        }
      }]
    });
    await new Promise((resolve) => setImmediate(resolve));
    const failed = await service.status({ userId: "user-1", orderId: preview.orderId });
    expect(failed).toMatchObject({ state: "FAILED", blockers: [{ code: "POLYMARKET_CLOB_ORDER_PARAMS_REJECTED" }] });

    executionStatus = {
      executionId: quote.quoteId,
      userId: "user-1",
      status: "FILLED",
      dryRun: false,
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      route: quote,
      submittedLegs: [{
        legIndex: 0,
        venue: "POLYMARKET",
        status: "FILLED",
        venueOrderId: "poly-filled-order",
        fillState: { status: "FILLED", filledSize: "1", averagePrice: 0.5 }
      }]
    };

    const refreshed = await service.refreshOpenOrders({ limit: 10 });
    const filled = await service.status({ userId: "user-1", orderId: preview.orderId });

    expect(refreshed).toMatchObject({ scanned: 1, refreshed: 1, failed: 0 });
    expect(filled).toMatchObject({
      state: "FILLED",
      executionId: quote.quoteId,
      blockers: []
    });

    executionStatus = {
      executionId: quote.quoteId,
      userId: "user-1",
      status: "FAILED",
      dryRun: false,
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      route: quote,
      submittedLegs: [{
        legIndex: 0,
        venue: "POLYMARKET",
        status: "FAILED",
        reasonCode: "POLYMARKET_CLOB_ORDER_PARAMS_REJECTED",
        reason: "Price moved before execution. Refresh route and retry."
      }]
    };

    const staleFailure = await service.status({ userId: "user-1", orderId: preview.orderId });

    expect(staleFailure).toMatchObject({
      state: "FILLED",
      executionId: quote.quoteId,
      blockers: []
    });
    expect(staleFailure).not.toHaveProperty("lastError");

    executionStatus = null;
    await repository.updateOrder({
      userId: "user-1",
      orderId: preview.orderId,
      patch: {
        state: "FILLED",
        blockers: [{
          code: "POLYMARKET_CLOB_ORDER_PARAMS_REJECTED",
          venue: "POLYMARKET",
          message: "Price moved before execution. Refresh route and retry.",
          actionable: false
        }],
        lastError: "Price moved before execution. Refresh route and retry."
      }
    });
    const storedFilled = await service.status({ userId: "user-1", orderId: preview.orderId });

    expect(storedFilled).toMatchObject({
      state: "FILLED",
      executionId: quote.quoteId,
      blockers: []
    });
    expect(storedFilled).not.toHaveProperty("lastError");
  });

  it("does not submit duplicate signed orders while the first submit is pending", async () => {
    const app = Fastify();
    const quote = buyQuote("POLYMARKET", true);
    let resolveSubmit: ((value: unknown) => void) | undefined;
    const submit = vi.fn(() => new Promise((resolve) => {
      resolveSubmit = resolve;
    }));
    const service = new ExecutionOrderOrchestratorV1(
      new MemoryExecutionOrderRepository(),
      {
        quote: vi.fn(async () => ({ quote, rejectedCandidates: [], internalCandidateCount: 1 })),
        getQuote: vi.fn(async () => quote)
      } as never,
      { prepareExit: vi.fn() } as never,
      {
        getLiveReadiness: vi.fn(async () => ({
          quoteId: quote.quoteId,
          generatedAt: new Date().toISOString(),
          expiresAt: quote.expiresAt,
          status: "fresh",
          blockers: [],
          venues: [{
            venue: "POLYMARKET",
            status: "fresh",
            checkedAt: new Date().toISOString(),
            blockers: [],
            readinessCode: "POLYMARKET_CLOB_READY_FOR_SUBMIT",
            account: { walletAddress: "0xwallet", venueAccountAddress: "0xdeposit", ownerAddress: "0xdeposit" },
            collateral: { requiredNotional: "1", balance: "10", allowance: "10", tokenSymbol: "pUSD", tokenAddress: null, spenderAddress: null, chainId: 137 }
          }]
        })),
        prepare: vi.fn(async () => ({
          quoteId: quote.quoteId,
          expiresAt: quote.expiresAt,
          signatureRequests: [{
            legIndex: 0,
            venue: "POLYMARKET",
            requestType: "ORDER",
            account: "0xdeposit",
            message: "sign order",
            typedData: {},
            signedPayloadHint: {}
          }]
        })),
        submit,
        getExecutionStatus: vi.fn(async () => null)
      } as never,
      {
        getCandidates: vi.fn(async () => ({
          generatedAt: new Date().toISOString(),
          marketId: "market-1",
          outcomeId: "YES",
          amount: "1",
          candidates: [{
            venue: "POLYMARKET",
            venueMarketId: "polymarket-market",
            venueOutcomeId: "polymarket-token",
            price: 0.5,
            availableSize: "10",
            requiresUserSignature: true,
            metadata: { polymarketTickSize: "0.001" }
          }],
          blocked: []
        }))
      }
    );
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: { quote: vi.fn(), getQuote: vi.fn() } as never,
      sellQuoteService: { prepareExit: vi.fn() } as never,
      executionOrderService: service
    });

    await app.inject({
      method: "POST",
      url: "/execution/orders/preview",
      payload: { marketId: "market-1", outcomeId: "YES", side: "buy", amount: "1", venuePreference: "POLYMARKET" }
    });
    await app.inject({ method: "POST", url: `/execution/orders/${quote.quoteId}/place` });
    const payload = {
      signedPayloads: [{
        legIndex: 0,
        venue: "POLYMARKET",
        requestType: "ORDER",
        signedPayload: {
          purpose: "POLYMARKET_ORDER",
          data: { order: { makerAmount: "505000", takerAmount: "1000000" }, orderType: "FOK" },
          signature: "0xsig",
          account: "0xdeposit"
        }
      }]
    };
    const first = await app.inject({ method: "POST", url: `/execution/orders/${quote.quoteId}/signatures`, payload });
    const second = await app.inject({ method: "POST", url: `/execution/orders/${quote.quoteId}/signatures`, payload });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json()).toMatchObject({ state: "SUBMITTING" });
    expect(submit).toHaveBeenCalledTimes(1);
    resolveSubmit?.({
      executionId: quote.quoteId,
      status: "SUBMITTED",
      dryRun: false,
      submittedLegs: [{ legIndex: 0, venue: "POLYMARKET", status: "SUBMITTED", venueOrderId: "poly-order" }]
    });
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("fails closed when async submit was interrupted before an execution id was persisted", async () => {
    const quote = buyQuote("POLYMARKET", true);
    const repo = new MemoryExecutionOrderRepository();
    const staleTime = new Date(Date.now() - 60_000).toISOString();
    await repo.saveOrder({
      orderId: quote.quoteId,
      userId: "user-1",
      quoteId: quote.quoteId,
      executionId: null,
      state: "SUBMITTING",
      side: "buy",
      marketId: quote.marketId,
      outcomeId: quote.outcomeId,
      amount: quote.executableAmount,
      venuePreference: "POLYMARKET",
      orderPolicy: "FOK",
      slippageToleranceBps: 50,
      signingMode: "USER_SIGNATURE_REQUIRED",
      primaryAction: "NONE",
      readinessSummary: {},
      venueCapabilitySummary: { venues: [] },
      blockers: [],
      signatureRequestHash: "sig-hash",
      lastError: null,
      expiresAt: quote.expiresAt,
      nextPollAt: staleTime,
      createdAt: staleTime,
      updatedAt: staleTime
    });
    const getQuote = vi.fn(async () => quote);
    const getExecutionStatus = vi.fn(async () => null);
    const service = new ExecutionOrderOrchestratorV1(
      repo,
      { quote: vi.fn(), getQuote } as never,
      { prepareExit: vi.fn() } as never,
      {
        getLiveReadiness: vi.fn(),
        prepare: vi.fn(),
        submit: vi.fn(),
        getExecutionStatus
      } as never
    );

    const status = await service.status({ userId: "user-1", orderId: quote.quoteId });

    expect(status).toMatchObject({
      state: "FAILED",
      primaryAction: { type: "NONE" },
      lastError: "Order submit was interrupted before the venue received it. Refresh route and place again.",
      blockers: [{
        code: "EXECUTION_ORDER_SUBMIT_INTERRUPTED",
        actionable: true
      }]
    });
    expect(getQuote).not.toHaveBeenCalled();
    expect(getExecutionStatus).not.toHaveBeenCalled();
  });

  it("blocks Polymarket sell previews when the executable conditional token id is missing", async () => {
    const app = Fastify();
    const quote = {
      ...sellQuote(),
      quoteId: "exec_quote_missing_token",
      legs: [{ ...sellQuote().legs[0]!, venueOutcomeId: undefined }]
    };
    const prepareExit = vi.fn(async () => ({
      quote,
      allocations: [],
      skippedAmount: "0",
      rejectedCandidates: []
    }));
    const service = new ExecutionOrderOrchestratorV1(
      new MemoryExecutionOrderRepository(),
      { quote: vi.fn(), getQuote: vi.fn(async () => quote) } as never,
      { prepareExit } as never,
      {
        getLiveReadiness: vi.fn(async () => ({
          quoteId: quote.quoteId,
          generatedAt: new Date().toISOString(),
          expiresAt: quote.expiresAt,
          status: "fresh",
          blockers: ["Polymarket sell preflight could not derive the conditional token id."],
          venues: [{
            venue: "POLYMARKET",
            status: "fresh",
            checkedAt: new Date().toISOString(),
            readinessCode: "BLOCKED",
            blockers: ["Polymarket sell preflight could not derive the conditional token id."],
            account: { walletAddress: "0xwallet", venueAccountAddress: "0xdeposit", ownerAddress: "0xdeposit" },
            collateral: { requiredNotional: "1", balance: "10", allowance: "10", tokenSymbol: "shares", tokenAddress: null, spenderAddress: null, chainId: 137 }
          }]
        })),
        prepare: vi.fn(),
        submit: vi.fn(),
        getExecutionStatus: vi.fn(async () => null)
      } as never,
      {
        getCandidates: vi.fn(async () => ({
          generatedAt: new Date().toISOString(),
          marketId: "market-1",
          outcomeId: "NO",
          amount: "2",
          candidates: [{
            venue: "POLYMARKET",
            venueMarketId: "poly-market",
            price: 0.99,
            availableSize: "100",
            requiresUserSignature: true
          }],
          blocked: []
        }))
      }
    );
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: { quote: vi.fn(), getQuote: vi.fn() } as never,
      sellQuoteService: { prepareExit } as never,
      executionOrderService: service
    });

    const response = await app.inject({
      method: "POST",
      url: "/execution/orders/preview",
      payload: { marketId: "market-1", outcomeId: "NO", side: "sell", amount: "2", venuePreference: "POLYMARKET" }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({
      state: "BLOCKED_ACTION_REQUIRED",
      blockers: [{
        code: "POLYMARKET_SELL_TOKEN_ID_MISSING",
        venue: "POLYMARKET",
        actionable: false
      }]
    });
    expect(body.blockers).toHaveLength(1);
    expect(body.blockers.filter((blocker: { code: string }) => blocker.code === "POLYMARKET_SELL_TOKEN_ID_MISSING")).toHaveLength(1);
    expect(body.blockers.some((blocker: { code: string }) => blocker.code === "BLOCKED")).toBe(false);
  });

  it("rechecks Polymarket sell depth before preparing signatures and does not use warmed sell signatures", async () => {
    const quote = sellQuote();
    const prepare = vi.fn(async () => ({
      quoteId: quote.quoteId,
      expiresAt: quote.expiresAt,
      signatureRequests: [{
        legIndex: 0,
        venue: "POLYMARKET",
        requestType: "ORDER",
        account: "0xdeposit",
        message: "sign sell order",
        typedData: {},
        signedPayloadHint: {}
      }]
    }));
    const liveCandidateProvider = {
      getCandidates: vi.fn(async () => ({
        generatedAt: new Date().toISOString(),
        marketId: quote.marketId,
        outcomeId: quote.outcomeId,
        amount: quote.legs[0]!.size,
        candidates: [{
          venue: "POLYMARKET",
          venueMarketId: quote.legs[0]!.venueMarketId,
          venueOutcomeId: quote.legs[0]!.venueOutcomeId,
          price: quote.legs[0]!.price,
          availableSize: "10",
          requiresUserSignature: true
        }],
        blocked: []
      }))
    };
    const service = new ExecutionOrderOrchestratorV1(
      new MemoryExecutionOrderRepository(),
      { quote: vi.fn(), getQuote: vi.fn(async () => quote) } as never,
      { prepareExit: vi.fn(async () => ({ quote, allocations: [], skippedAmount: "0", rejectedCandidates: [] })) } as never,
      {
        getLiveReadiness: vi.fn(async () => ({
          quoteId: quote.quoteId,
          generatedAt: new Date().toISOString(),
          expiresAt: quote.expiresAt,
          status: "fresh",
          blockers: [],
          venues: [{
            venue: "POLYMARKET",
            status: "fresh",
            checkedAt: new Date().toISOString(),
            blockers: [],
            account: { walletAddress: "0xwallet", venueAccountAddress: "0xdeposit", ownerAddress: "0xdeposit" },
            collateral: { requiredNotional: "2", balance: "10", allowance: "10", tokenSymbol: "shares", tokenAddress: null, spenderAddress: null, chainId: 137 }
          }]
        })),
        prepare,
        submit: vi.fn(),
        getExecutionStatus: vi.fn(async () => null)
      } as never,
      liveCandidateProvider
    );

    await service.preview({ userId: "user-1", marketId: "market-1", outcomeId: "NO", side: "sell", amount: "2", venuePreference: "POLYMARKET" });
    expect(prepare).not.toHaveBeenCalled();

    const placed = await service.place({ userId: "user-1", orderId: quote.quoteId });

    expect(placed).toMatchObject({ state: "NEEDS_SIGNATURE" });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(liveCandidateProvider.getCandidates).toHaveBeenCalledWith({
      userId: "user-1",
      side: "sell",
      marketId: quote.marketId,
      outcomeId: quote.outcomeId,
      amount: "2",
      venues: ["POLYMARKET"]
    });
  });

  it("blocks Polymarket sell signature preparation when FOK sell depth moved", async () => {
    const quote = sellQuote();
    const prepare = vi.fn();
    const service = new ExecutionOrderOrchestratorV1(
      new MemoryExecutionOrderRepository(),
      { quote: vi.fn(), getQuote: vi.fn(async () => quote) } as never,
      { prepareExit: vi.fn(async () => ({ quote, allocations: [], skippedAmount: "0", rejectedCandidates: [] })) } as never,
      {
        getLiveReadiness: vi.fn(async () => ({
          quoteId: quote.quoteId,
          generatedAt: new Date().toISOString(),
          expiresAt: quote.expiresAt,
          status: "fresh",
          blockers: [],
          venues: [{
            venue: "POLYMARKET",
            status: "fresh",
            checkedAt: new Date().toISOString(),
            blockers: [],
            account: { walletAddress: "0xwallet", venueAccountAddress: "0xdeposit", ownerAddress: "0xdeposit" },
            collateral: { requiredNotional: "2", balance: "10", allowance: "10", tokenSymbol: "shares", tokenAddress: null, spenderAddress: null, chainId: 137 }
          }]
        })),
        prepare,
        submit: vi.fn(),
        getExecutionStatus: vi.fn(async () => null)
      } as never,
      {
        getCandidates: vi.fn(async () => ({
          generatedAt: new Date().toISOString(),
          marketId: quote.marketId,
          outcomeId: quote.outcomeId,
          amount: quote.legs[0]!.size,
          candidates: [{
            venue: "POLYMARKET",
            venueMarketId: quote.legs[0]!.venueMarketId,
            venueOutcomeId: quote.legs[0]!.venueOutcomeId,
            price: 0.97,
            availableSize: "10",
            requiresUserSignature: true
          }],
          blocked: []
        }))
      }
    );

    await service.preview({ userId: "user-1", marketId: "market-1", outcomeId: "NO", side: "sell", amount: "2", venuePreference: "POLYMARKET" });
    const placed = await service.place({ userId: "user-1", orderId: quote.quoteId });

    expect(placed).toMatchObject({
      state: "BLOCKED_ACTION_REQUIRED",
      blockers: [{
        code: "POLYMARKET_FOK_ROUTE_NOT_EXECUTABLE",
        message: "Polymarket FOK sell price moved before execution. Refresh route and retry."
      }]
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("blocks Polymarket sell FOK when no slippage tick buffer remains", async () => {
    const quote = sellQuote();
    await expect(assertPolymarketFokStillExecutable({
      userId: "user-1",
      quote,
      slippageToleranceBps: 50,
      liveCandidateProvider: {
        getCandidates: vi.fn(async () => ({
          generatedAt: new Date().toISOString(),
          marketId: quote.marketId,
          outcomeId: quote.outcomeId,
          amount: quote.legs[0]!.size,
          candidates: [{
            venue: "POLYMARKET",
            venueMarketId: quote.legs[0]!.venueMarketId,
            venueOutcomeId: quote.legs[0]!.venueOutcomeId,
            price: 0.985,
            availableSize: "10",
            requiresUserSignature: true
          }],
          blocked: []
        }))
      }
    })).rejects.toMatchObject({
      code: "POLYMARKET_FOK_ROUTE_NOT_EXECUTABLE",
      message: "Polymarket FOK sell price moved before execution. Refresh route and retry."
    });
  });

  it("keeps venue-specific order previews on the requested venue", async () => {
    const app = Fastify();
    const quote = buyQuote("LIMITLESS", false);
    const getCandidates = vi.fn(async (input) => ({
      generatedAt: new Date().toISOString(),
      marketId: input.marketId,
      outcomeId: input.outcomeId,
      amount: input.amount,
      candidates: [{
        venue: "LIMITLESS",
        venueMarketId: "limitless-market",
        venueOutcomeId: "limitless-token",
        price: 0.5,
        availableSize: "10",
        requiresUserSignature: false
      }],
      blocked: []
    }));
    const service = new ExecutionOrderOrchestratorV1(
      new MemoryExecutionOrderRepository(),
      {
        quote: vi.fn(async () => ({ quote, rejectedCandidates: [], internalCandidateCount: 1 })),
        getQuote: vi.fn(async () => quote)
      } as never,
      { prepareExit: vi.fn() } as never,
      {
        getLiveReadiness: vi.fn(async () => ({
          quoteId: quote.quoteId,
          generatedAt: new Date().toISOString(),
          expiresAt: quote.expiresAt,
          status: "fresh",
          blockers: [],
          venues: [{
            venue: "LIMITLESS",
            status: "fresh",
            checkedAt: new Date().toISOString(),
            blockers: [],
            account: { walletAddress: "0xwallet", venueAccountAddress: "0xsafe", ownerAddress: "0xwallet" },
            collateral: { requiredNotional: "1", balance: "5", allowance: "5", tokenSymbol: "USDC", tokenAddress: null, spenderAddress: null, chainId: 8453 }
          }]
        })),
        prepare: vi.fn(),
        submit: vi.fn(),
        getExecutionStatus: vi.fn(async () => null)
      } as never,
      { getCandidates }
    );
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: { quote: vi.fn(), getQuote: vi.fn() } as never,
      sellQuoteService: { prepareExit: vi.fn() } as never,
      executionOrderService: service
    });

    const response = await app.inject({
      method: "POST",
      url: "/execution/orders/preview",
      payload: { marketId: "market-1", outcomeId: "YES", side: "buy", amount: "1", venuePreference: "LIMITLESS" }
    });
    expect(response.statusCode).toBe(201);
    expect(getCandidates).toHaveBeenCalledWith(expect.objectContaining({ venues: ["LIMITLESS"] }));
    expect(response.json()).toMatchObject({
      state: "READY_TO_PLACE",
      venuePreference: "LIMITLESS",
      routeSummary: { venuePath: ["LIMITLESS"] }
    });
  });

  it("reports venue setup blockers without submitting", async () => {
    const app = Fastify();
    const service = new ExecutionOrderOrchestratorV1(
      new MemoryExecutionOrderRepository(),
      { quote: vi.fn(), getQuote: vi.fn() } as never,
      { prepareExit: vi.fn() } as never,
      undefined,
      {
        getCandidates: vi.fn(async () => ({
          generatedAt: new Date().toISOString(),
          marketId: "market-1",
          outcomeId: "YES",
          amount: "1",
          candidates: [],
          blocked: [{ venue: "PREDICT_FUN", reason: "Predict.fun account auth is required.", detailsCode: "PREDICT_AUTH_REQUIRED" }]
        }))
      }
    );
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: { quote: vi.fn(), getQuote: vi.fn() } as never,
      sellQuoteService: { prepareExit: vi.fn() } as never,
      executionOrderService: service
    });

    const response = await app.inject({
      method: "POST",
      url: "/execution/orders/preview",
      payload: { marketId: "market-1", outcomeId: "YES", side: "buy", amount: "1", venuePreference: "PREDICT_FUN" }
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      state: "NEEDS_VENUE_SETUP",
      primaryAction: { type: "ENABLE_VENUE" },
      quoteId: null
    });
  });

  it("routes sell quote creation through verified position exits", async () => {
    const app = Fastify();
    const quote = vi.fn();
    const prepareExit = vi.fn(async () => ({
      quote: sellQuote(),
      allocations: [{
        venue: "POLYMARKET",
        positionId: "position-1",
        sellSize: "2",
        availableSize: "2"
      }],
      skippedAmount: "0",
      rejectedCandidates: []
    }));
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: {
        quote,
        getQuote: vi.fn()
      } as never,
      sellQuoteService: {
        prepareExit
      } as never
    });

    const response = await app.inject({
      method: "POST",
      url: "/execution/quote",
      payload: {
        side: "sell",
        marketId: "market-1",
        outcomeId: "NO",
        amount: "2",
        candidates: [{
          venue: "POLYMARKET",
          venueMarketId: "poly-market",
          venueOutcomeId: "12345678901234567890",
          price: 0.99,
          availableSize: "100",
          requiresUserSignature: true
        }]
      }
    });

    expect(response.statusCode).toBe(201);
    expect(quote).not.toHaveBeenCalled();
    expect(prepareExit).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      sellMode: "SELL_ALL",
      sizeMode: "CUSTOM_AMOUNT",
      amount: "2",
      marketId: "market-1",
      outcomeId: "NO"
    }));
    expect(response.json()).toMatchObject({
      quote: {
        side: "sell",
        venuePath: ["POLYMARKET"]
      },
      allocations: [{
        venue: "POLYMARKET",
        positionId: "position-1",
        sellSize: "2",
        availableSize: "2"
      }]
    });
  });

  it("rejects sell quote creation when live Polymarket share balance is zero", async () => {
    const app = Fastify();
    const prepareExit = vi.fn(async () => ({
      quote: sellQuote(),
      allocations: [{
        venue: "POLYMARKET",
        positionId: "position-1",
        sellSize: "2",
        availableSize: "2"
      }],
      skippedAmount: "0",
      rejectedCandidates: []
    }));
    const getLiveReadiness = vi.fn(async () => ({
      quoteId: "exec_quote_sell",
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      status: "blocked",
      blockers: ["POLYMARKET: Polymarket share balance is below the sell amount. Sellable balance: 0 shares."],
      venues: [{
        venue: "POLYMARKET",
        status: "blocked",
        checkedAt: new Date().toISOString(),
        blockers: ["Polymarket share balance is below the sell amount. Sellable balance: 0 shares."],
        account: {
          walletAddress: "0xwallet",
          venueAccountAddress: "0xdeposit",
          ownerAddress: "0xdeposit"
        },
        collateral: {
          requiredNotional: "2",
          balance: "0",
          allowance: "0",
          tokenSymbol: "Polymarket shares",
          tokenAddress: null,
          spenderAddress: null,
          chainId: 137,
          approvalMethod: "ERC1155_SET_APPROVAL_FOR_ALL"
        }
      }]
    }));
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: {
        quote: vi.fn(),
        getQuote: vi.fn()
      } as never,
      sellQuoteService: {
        prepareExit
      } as never,
      signedTradeBundleService: {
        getLiveReadiness
      } as never
    });

    const response = await app.inject({
      method: "POST",
      url: "/execution/quote",
      payload: {
        side: "sell",
        marketId: "market-1",
        outcomeId: "NO",
        amount: "2",
        candidates: [{
          venue: "POLYMARKET",
          venueMarketId: "poly-market",
          venueOutcomeId: "12345678901234567890",
          price: 0.99,
          availableSize: "100",
          requiresUserSignature: true
        }]
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "NO_SELLABLE_SHARES",
      message: "Polymarket share balance is below the sell amount. Sellable balance: 0 shares."
    });
    expect(getLiveReadiness).toHaveBeenCalledWith({
      userId: "user-1",
      quoteId: "exec_quote_sell"
    });
  });

  it("preserves live candidate metadata when creating execution quotes", async () => {
    const app = Fastify();
    const quote = vi.fn(async () => ({
      quote: {
        quoteId: "exec_quote_limitless_metadata",
        userId: "user-1",
        side: "buy",
        marketId: "canonical-market",
        outcomeId: "YES",
        routeType: "SINGLE_VENUE",
        venuePath: ["LIMITLESS"],
        executableAmount: "1",
        skippedAmount: "0",
        expectedPrice: 0.1,
        effectivePrice: 0.1,
        requiredUserSignatureSteps: ["LIMITLESS user signature required"],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        legs: [{
          venue: "LIMITLESS",
          venueMarketId: "limitless-market",
          venueOutcomeId: "limitless-token",
          size: "10",
          price: 0.1,
          requiresUserSignature: true,
          metadata: {
            limitlessExchangeAddress: "0xe3E00BA3a9888d1DE4834269f62ac008b4BB5C47"
          }
        }]
      },
      rejectedCandidates: [],
      internalCandidateCount: 1
    }));
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: {
        quote,
        getQuote: vi.fn()
      } as never,
      sellQuoteService: {
        prepareExit: vi.fn()
      } as never
    });

    const response = await app.inject({
      method: "POST",
      url: "/execution/quote",
      payload: {
        side: "buy",
        marketId: "canonical-market",
        outcomeId: "YES",
        amount: "1",
        candidates: [{
          venue: "LIMITLESS",
          venueMarketId: "limitless-market",
          venueOutcomeId: "limitless-token",
          price: 0.1,
          availableSize: "10",
          requiresUserSignature: true,
          metadata: {
            limitlessExchangeAddress: "0xe3E00BA3a9888d1DE4834269f62ac008b4BB5C47"
          }
        }]
      }
    });

    expect(response.statusCode).toBe(201);
    expect(quote).toHaveBeenCalledWith(expect.objectContaining({
      candidates: [expect.objectContaining({
        metadata: {
          limitlessExchangeAddress: "0xe3E00BA3a9888d1DE4834269f62ac008b4BB5C47"
        }
      })]
    }));
  });

  it("wires prepare-signatures and submit-signed-bundle through the signed bundle service", async () => {
    const app = Fastify();
    const signedTradeBundleService = {
      prepare: vi.fn(async () => ({
        quoteId: "exec_quote_1",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        signatureRequests: []
      })),
      submit: vi.fn(async () => ({
        executionId: "exec_quote_1",
        status: "DRY_RUN_VERIFIED",
        dryRun: true,
        submittedLegs: []
      })),
      getExecutionStatus: vi.fn(async () => null)
    };
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: {
        quote: vi.fn(),
        getQuote: vi.fn()
      } as never,
      sellQuoteService: {
        prepareExit: vi.fn()
      } as never,
      signedTradeBundleService: signedTradeBundleService as never
    });

    const prepared = await app.inject({
      method: "POST",
      url: "/execution/exec_quote_1/prepare-signatures"
    });
    expect(prepared.statusCode).toBe(200);
    expect(signedTradeBundleService.prepare).toHaveBeenCalledWith({
      userId: "user-1",
      quoteId: "exec_quote_1"
    });

    const submitted = await app.inject({
      method: "POST",
      url: "/execution/exec_quote_1/submit-signed-bundle",
      payload: { dryRun: true, signedLegs: [] }
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json()).toMatchObject({ status: "DRY_RUN_VERIFIED", dryRun: true });
    expect(signedTradeBundleService.submit).toHaveBeenCalledWith({
      userId: "user-1",
      quoteId: "exec_quote_1",
      signedLegs: [],
      dryRun: true
    });
  });

  it("blocks Polymarket FOK signature preparation when live price no longer fits the FOK limit", async () => {
    const app = Fastify();
    const quote = {
      ...sellQuote(),
      quoteId: "exec_quote_poly_buy",
      side: "buy" as const,
      executableAmount: "2.02020202",
      expectedPrice: 0.992,
      effectivePrice: 0.996272,
      legs: [{
        venue: "POLYMARKET",
        venueMarketId: "poly-market",
        venueOutcomeId: "12345678901234567890",
        size: "2.02020202",
        price: 0.992,
        requiresUserSignature: true,
        metadata: {
          tickSize: "0.001",
          polymarketTickSize: "0.001"
        }
      }]
    };
    const prepare = vi.fn();
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: {
        quote: vi.fn(),
        getQuote: vi.fn(async () => quote)
      } as never,
      sellQuoteService: {
        prepareExit: vi.fn()
      } as never,
      signedTradeBundleService: {
        prepare,
        getExecutionStatus: vi.fn(async () => null)
      } as never,
      liveCandidateProvider: {
        getCandidates: vi.fn(async () => ({
          generatedAt: new Date().toISOString(),
          marketId: quote.marketId,
          outcomeId: quote.outcomeId,
          amount: "2.02020202",
          source: "LIVE_QUOTE_SOURCE" as const,
          candidates: [{
            venue: "POLYMARKET",
            venueMarketId: "poly-market",
            venueOutcomeId: "12345678901234567890",
            price: 1,
            availableSize: "100",
            requiresUserSignature: true
          }],
          blocked: []
        }))
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/execution/exec_quote_poly_buy/prepare-signatures"
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "POLYMARKET_FOK_ROUTE_NOT_EXECUTABLE",
      message: "Polymarket FOK price moved before execution. Refresh route and retry."
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("blocks Polymarket FOK signed submit when current live price exceeds the signed limit", async () => {
    const app = Fastify();
    const quote = {
      ...sellQuote(),
      quoteId: "exec_quote_poly_buy",
      side: "buy" as const,
      executableAmount: "2",
      expectedPrice: 0.992,
      effectivePrice: 0.996272,
      legs: [{
        venue: "POLYMARKET",
        venueMarketId: "poly-market",
        venueOutcomeId: "12345678901234567890",
        size: "2",
        price: 0.992,
        requiresUserSignature: true,
        metadata: {
          tickSize: "0.001",
          polymarketTickSize: "0.001"
        }
      }]
    };
    const submit = vi.fn();
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: {
        quote: vi.fn(),
        getQuote: vi.fn(async () => quote)
      } as never,
      sellQuoteService: {
        prepareExit: vi.fn()
      } as never,
      signedTradeBundleService: {
        submit,
        getExecutionStatus: vi.fn(async () => null)
      } as never,
      liveCandidateProvider: {
        getCandidates: vi.fn(async () => ({
          generatedAt: new Date().toISOString(),
          marketId: quote.marketId,
          outcomeId: quote.outcomeId,
          amount: "2",
          source: "LIVE_QUOTE_SOURCE" as const,
          candidates: [{
            venue: "POLYMARKET",
            venueMarketId: "poly-market",
            venueOutcomeId: "12345678901234567890",
            price: 1,
            availableSize: "100",
            requiresUserSignature: true
          }],
          blocked: []
        }))
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/execution/exec_quote_poly_buy/submit-signed-bundle",
      payload: {
        signedLegs: [{
          legIndex: 0,
          venue: "POLYMARKET",
          requestType: "ORDER",
          signedPayload: {
            purpose: "POLYMARKET_ORDER",
            data: {
              order: {
                makerAmount: "1998000",
                takerAmount: "2000000"
              },
              orderType: "FOK"
            }
          }
        }]
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "POLYMARKET_FOK_ROUTE_NOT_EXECUTABLE",
      message: "Polymarket FOK price moved before execution. Refresh route and retry."
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it("blocks Polymarket FOK sell signed submit when current live price is below the signed floor", async () => {
    const app = Fastify();
    const quote = sellQuote();
    const submit = vi.fn();
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: {
        quote: vi.fn(),
        getQuote: vi.fn(async () => quote)
      } as never,
      sellQuoteService: {
        prepareExit: vi.fn()
      } as never,
      signedTradeBundleService: {
        submit,
        getExecutionStatus: vi.fn(async () => null)
      } as never,
      liveCandidateProvider: {
        getCandidates: vi.fn(async () => ({
          generatedAt: new Date().toISOString(),
          marketId: quote.marketId,
          outcomeId: quote.outcomeId,
          amount: "2",
          source: "LIVE_QUOTE_SOURCE" as const,
          candidates: [{
            venue: "POLYMARKET",
            venueMarketId: "poly-market",
            venueOutcomeId: "12345678901234567890",
            price: 0.98,
            availableSize: "100",
            requiresUserSignature: true
          }],
          blocked: []
        }))
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/execution/exec_quote_sell/submit-signed-bundle",
      payload: {
        signedLegs: [{
          legIndex: 0,
          venue: "POLYMARKET",
          requestType: "ORDER",
          signedPayload: {
            purpose: "POLYMARKET_ORDER",
            data: {
              order: {
                tokenId: "12345678901234567890",
                makerAmount: "2000000",
                takerAmount: "1980000"
              },
              orderType: "FOK"
            }
          }
        }]
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "POLYMARKET_FOK_ROUTE_NOT_EXECUTABLE",
      message: "Polymarket FOK sell price moved before execution. Refresh route and retry."
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it("blocks Polymarket sell submit when the signed token id no longer matches the route", async () => {
    const app = Fastify();
    const quote = sellQuote();
    const submit = vi.fn();
    const getCandidates = vi.fn();
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: {
        quote: vi.fn(),
        getQuote: vi.fn(async () => quote)
      } as never,
      sellQuoteService: {
        prepareExit: vi.fn()
      } as never,
      signedTradeBundleService: {
        submit,
        getExecutionStatus: vi.fn(async () => null)
      } as never,
      liveCandidateProvider: { getCandidates }
    });

    const response = await app.inject({
      method: "POST",
      url: "/execution/exec_quote_sell/submit-signed-bundle",
      payload: {
        signedLegs: [{
          legIndex: 0,
          venue: "POLYMARKET",
          requestType: "ORDER",
          signedPayload: {
            purpose: "POLYMARKET_ORDER",
            data: {
              order: {
                tokenId: "different-token",
                makerAmount: "2000000",
                takerAmount: "1980000"
              },
              orderType: "FOK"
            }
          }
        }]
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "POLYMARKET_SELL_TOKEN_ID_MISMATCH",
      message: "Polymarket signed sell token id no longer matches the route token id. Refresh route and sign again."
    });
    expect(getCandidates).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("serves persisted signed-bundle execution status after quote cache expiry", async () => {
    const app = Fastify();
    const signedTradeBundleService = {
      getExecutionStatus: vi.fn(async () => ({
        executionId: "exec_quote_submitted",
        userId: "user-1",
        status: "FILLED",
        dryRun: false,
        submittedAt: "2026-05-07T21:00:00.000Z",
        updatedAt: "2026-05-07T21:01:00.000Z",
        submittedLegs: [{
          legIndex: 0,
          venue: "PREDICT_FUN",
          status: "FILLED",
          venueOrderId: `0x${"a".repeat(64)}`,
          reasonCode: "VENUE_TEST_REASON",
          reason: "Sanitized venue reason.",
          fillState: {
            status: "FILLED",
            filledSize: "2.5",
            averagePrice: 0.388
          },
          settlementState: {
            status: "SETTLEMENT_VERIFIED",
            evidence: {
              source: "venue_settlement_api"
            }
          }
        }]
      }))
    };
    const getQuote = vi.fn(async () => null);
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: {
        quote: vi.fn(),
        getQuote
      } as never,
      sellQuoteService: {
        prepareExit: vi.fn()
      } as never,
      signedTradeBundleService: signedTradeBundleService as never
    });

    const response = await app.inject({
      method: "GET",
      url: "/execution/exec_quote_submitted/status"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      executionId: "exec_quote_submitted",
      userStatus: "FILLED",
      settlementStatus: "SETTLEMENT_VERIFIED",
      submittedLegs: [{
        venue: "PREDICT_FUN",
        status: "FILLED",
        reasonCode: "VENUE_TEST_REASON",
        reason: "Sanitized venue reason.",
        fillState: {
          status: "FILLED",
          filledSize: "2.5"
        },
        settlementState: {
          status: "SETTLEMENT_VERIFIED"
        }
      }]
    });
    expect(getQuote).not.toHaveBeenCalled();
    expect(signedTradeBundleService.getExecutionStatus).toHaveBeenCalledWith({
      userId: "user-1",
      executionId: "exec_quote_submitted"
    });
  });

  it("serves verified execution positions for the selected market outcome", async () => {
    const app = Fastify();
    const positionRepository = {
      listVerifiedPositions: vi.fn(async () => ([{
        positionId: "position-1",
        userId: "user-1",
        venue: "PREDICT_FUN",
        marketId: "market-1",
        outcomeId: "YES",
        venueAccountAddress: "0xabc",
        verifiedSize: "2.5",
        averageEntryPrice: 0.388,
        sellableSize: "2.5",
        lastSettlementEvidenceId: "order-1",
        status: "VERIFIED" as const,
        metadata: {}
      }]))
    };
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: {
        quote: vi.fn(),
        getQuote: vi.fn()
      } as never,
      sellQuoteService: {
        prepareExit: vi.fn()
      } as never,
      positionRepository
    });

    const response = await app.inject({
      method: "GET",
      url: "/execution/positions?marketId=market-1&outcomeId=YES&venue=PREDICT_FUN"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      marketId: "market-1",
      outcomeId: "YES",
      positions: [{
        positionId: "position-1",
        venue: "PREDICT_FUN",
        verifiedSize: "2.5",
        sellableSize: "2.5"
      }]
    });
    expect(positionRepository.listVerifiedPositions).toHaveBeenCalledWith({
      userId: "user-1",
      marketId: "market-1",
      outcomeId: "YES",
      venue: "PREDICT_FUN"
    });
  });

  it("adds typed mark freshness to selected positions when live marks are unavailable", async () => {
    const app = Fastify();
    const positionRepository = {
      listVerifiedPositions: vi.fn(async () => ([{
        positionId: "position-1",
        userId: "user-1",
        venue: "POLYMARKET",
        marketId: "market-1",
        outcomeId: "YES",
        venueAccountAddress: "0xabc",
        verifiedSize: "2.5",
        averageEntryPrice: 0.388,
        sellableSize: "2.5",
        lastSettlementEvidenceId: "order-1",
        status: "VERIFIED" as const,
        metadata: {}
      }]))
    };
    const liveCandidateProvider = {
      getCandidates: vi.fn(async () => ({
        generatedAt: "2026-05-06T00:00:00.000Z",
        marketId: "market-1",
        outcomeId: "YES",
        amount: "2.5",
        source: "LIVE_QUOTE_SOURCE" as const,
        candidates: [],
        blocked: [{ venue: "POLYMARKET", reason: "POLYMARKET_SOURCE_MATCH_MISSING" }]
      }))
    };
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: { quote: vi.fn(), getQuote: vi.fn() } as never,
      sellQuoteService: { prepareExit: vi.fn() } as never,
      positionRepository,
      liveCandidateProvider
    });

    const response = await app.inject({
      method: "GET",
      url: "/execution/positions?marketId=market-1&outcomeId=YES&venue=POLYMARKET"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      positions: [{
        positionId: "position-1",
        markPrice: null,
        markValue: null,
        markFreshness: "unavailable",
        markBlocker: "POLYMARKET_SOURCE_MATCH_MISSING"
      }]
    });
  });

  it("serves user-wide positions when market filters are omitted", async () => {
    const app = Fastify();
    const positionRepository = {
      listVerifiedPositions: vi.fn(),
      listUserVerifiedPositions: vi.fn(async () => ([{
        positionId: "position-1",
        userId: "user-1",
        venue: "POLYMARKET",
        marketId: "market-1",
        outcomeId: "YES",
        venueAccountAddress: null,
        verifiedSize: "3",
        averageEntryPrice: 0.4,
        sellableSize: "3",
        lastSettlementEvidenceId: "order-1",
        status: "VERIFIED" as const,
        metadata: {}
      }, {
        positionId: "position-closed",
        userId: "user-1",
        venue: "POLYMARKET",
        marketId: "market-closed",
        outcomeId: "YES",
        venueAccountAddress: null,
        verifiedSize: "0",
        averageEntryPrice: 0.4,
        sellableSize: "0",
        lastSettlementEvidenceId: "order-closed",
        status: "VERIFIED" as const,
        metadata: {}
      }]))
    };
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: { quote: vi.fn(), getQuote: vi.fn() } as never,
      sellQuoteService: { prepareExit: vi.fn() } as never,
      positionRepository
    });

    const response = await app.inject({ method: "GET", url: "/execution/positions?limit=25" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      marketId: null,
      outcomeId: null,
      positions: [{ positionId: "position-1", venue: "POLYMARKET" }]
    });
    expect(response.json().positions).toHaveLength(1);
    expect(positionRepository.listUserVerifiedPositions).toHaveBeenCalledWith({
      userId: "user-1",
      limit: 25
    });
  });

  it("does not expose database errors from execution account routes", async () => {
    const app = Fastify({ logger: false });
    const positionRepository = {
      listVerifiedPositions: vi.fn(),
      listUserVerifiedPositions: vi.fn(async () => {
        throw new Error('relation "user_execution_positions" does not exist');
      })
    };
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: { quote: vi.fn(), getQuote: vi.fn() } as never,
      sellQuoteService: { prepareExit: vi.fn() } as never,
      positionRepository
    });

    const response = await app.inject({ method: "GET", url: "/execution/positions?limit=25" });

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("user_execution_positions");
    expect(response.json()).toEqual({
      code: "EXECUTION_ACCOUNT_DATA_UNAVAILABLE",
      message: "Execution account data is temporarily unavailable. Please try again shortly."
    });
  });

  it("serves portfolio summary with live marks and unavailable mark fallbacks", async () => {
    const app = Fastify();
    const positionRepository = {
      listVerifiedPositions: vi.fn(),
      listUserVerifiedPositions: vi.fn(async () => ([{
        positionId: "position-1",
        userId: "user-1",
        venue: "POLYMARKET",
        marketId: "market-1",
        outcomeId: "YES",
        venueAccountAddress: null,
        verifiedSize: "2",
        averageEntryPrice: 0.4,
        sellableSize: "2",
        lastSettlementEvidenceId: "order-1",
        status: "VERIFIED" as const,
        metadata: {}
      }, {
        positionId: "position-2",
        userId: "user-1",
        venue: "PREDICT_FUN",
        marketId: "market-2",
        outcomeId: "NO",
        venueAccountAddress: null,
        verifiedSize: "1",
        averageEntryPrice: 0.7,
        sellableSize: "1",
        lastSettlementEvidenceId: "order-2",
        status: "VERIFIED" as const,
        metadata: {}
      }]))
    };
    const liveCandidateProvider = {
      getCandidates: vi.fn(async (input) => input.marketId === "market-1"
        ? {
            generatedAt: "2026-05-06T00:00:00.000Z",
            marketId: input.marketId,
            outcomeId: input.outcomeId,
            amount: input.amount,
            source: "LIVE_QUOTE_SOURCE" as const,
            candidates: [{ venue: input.venues?.[0] ?? "POLYMARKET", price: 0.55, availableSize: "10" }],
            blocked: []
          }
        : {
            generatedAt: "2026-05-06T00:00:00.000Z",
            marketId: input.marketId,
            outcomeId: input.outcomeId,
            amount: input.amount,
            source: "LIVE_QUOTE_SOURCE" as const,
            candidates: [],
            blocked: [{ venue: input.venues?.[0] ?? "PREDICT_FUN", reason: "NO_LIVE_QUOTE" }]
          })
    };
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: { quote: vi.fn(), getQuote: vi.fn() } as never,
      sellQuoteService: { prepareExit: vi.fn() } as never,
      positionRepository,
      liveCandidateProvider
    });

    const response = await app.inject({ method: "GET", url: "/execution/portfolio/summary" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      markPolicy: "LIVE_QUOTE_REQUIRED",
      positionCount: 2,
      markedPositionCount: 1,
      unavailableMarkCount: 1,
      totalMarkValue: "1.1",
      positions: [
        { positionId: "position-1", markPrice: 0.55, markFreshness: "live", unrealizedPnl: "0.3" },
        { positionId: "position-2", markPrice: null, markFreshness: "unavailable", markBlocker: "NO_LIVE_QUOTE" }
      ]
    });
  });

  it("bounds portfolio live mark fanout and defers uncached overflow positions", async () => {
    const app = Fastify();
    const positions = Array.from({ length: 25 }, (_, index) => ({
      positionId: `budget-position-${index}`,
      userId: "user-1",
      venue: "POLYMARKET",
      marketId: `budget-market-${index}`,
      outcomeId: "YES",
      venueAccountAddress: null,
      verifiedSize: "1",
      averageEntryPrice: 0.4,
      sellableSize: "1",
      lastSettlementEvidenceId: `budget-order-${index}`,
      status: "VERIFIED" as const,
      metadata: {}
    }));
    const positionRepository = {
      listVerifiedPositions: vi.fn(),
      listUserVerifiedPositions: vi.fn(async () => positions)
    };
    const liveCandidateProvider = {
      getCandidates: vi.fn(async (input) => ({
        generatedAt: "2026-05-06T00:00:00.000Z",
        marketId: input.marketId,
        outcomeId: input.outcomeId,
        amount: input.amount,
        source: "LIVE_QUOTE_SOURCE" as const,
        candidates: [{ venue: input.venues?.[0] ?? "POLYMARKET", price: 0.5, availableSize: "10" }],
        blocked: []
      }))
    };
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: { quote: vi.fn(), getQuote: vi.fn() } as never,
      sellQuoteService: { prepareExit: vi.fn() } as never,
      positionRepository,
      liveCandidateProvider
    });

    const response = await app.inject({ method: "GET", url: "/execution/portfolio/summary" });

    expect(response.statusCode).toBe(200);
    expect(liveCandidateProvider.getCandidates).toHaveBeenCalledTimes(20);
    const body = response.json();
    expect(body.markedPositionCount).toBe(20);
    expect(body.unavailableMarkCount).toBe(5);
    expect(body.positions.slice(20)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          markFreshness: "unavailable",
          markBlocker: "LIVE_MARK_DEFERRED"
        })
      ])
    );
  });

  it("serves portfolio time series as a backend MTM snapshot without historical fabrication", async () => {
    const app = Fastify();
    const positionRepository = {
      listVerifiedPositions: vi.fn(),
      listUserVerifiedPositions: vi.fn(async () => ([{
        positionId: "position-1",
        userId: "user-1",
        venue: "POLYMARKET",
        marketId: "market-1",
        outcomeId: "YES",
        venueAccountAddress: null,
        verifiedSize: "2",
        averageEntryPrice: 0.4,
        sellableSize: "2",
        lastSettlementEvidenceId: "order-1",
        status: "VERIFIED" as const,
        metadata: {}
      }]))
    };
    const liveCandidateProvider = {
      getCandidates: vi.fn(async (input) => ({
        generatedAt: "2026-05-06T00:00:00.000Z",
        marketId: input.marketId,
        outcomeId: input.outcomeId,
        amount: input.amount,
        source: "LIVE_QUOTE_SOURCE" as const,
        candidates: [{ venue: input.venues?.[0] ?? "POLYMARKET", price: 0.55, availableSize: "10" }],
        blocked: []
      }))
    };
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: { quote: vi.fn(), getQuote: vi.fn() } as never,
      sellQuoteService: { prepareExit: vi.fn() } as never,
      positionRepository,
      liveCandidateProvider
    });

    const response = await app.inject({ method: "GET", url: "/execution/portfolio/timeseries?range=7D" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      range: "7D",
      markPolicy: "LIVE_QUOTE_REQUIRED",
      seriesBasis: "CURRENT_MARK_TO_MARKET_SNAPSHOT",
      historyAvailable: false,
      points: [{
        positionCount: 1,
        markedPositionCount: 1,
        unavailableMarkCount: 0,
        totalCostBasis: "0.8",
        totalMarkValue: "1.1",
        totalUnrealizedPnl: "0.3"
      }]
    });
    expect(positionRepository.listUserVerifiedPositions).toHaveBeenCalledWith({
      userId: "user-1",
      limit: 500
    });
  });

  it("serves user execution history and execution receipts", async () => {
    const app = Fastify();
    const status = {
      executionId: "exec-1",
      userId: "user-1",
      status: "FILLED" as const,
      dryRun: false,
      submittedAt: "2026-05-07T21:00:00.000Z",
      updatedAt: "2026-05-07T21:01:00.000Z",
      submittedLegs: [{
        legIndex: 0,
        venue: "POLYMARKET",
        status: "FILLED",
        venueOrderId: "order-1",
        fillState: { status: "FILLED" as const, filledSize: "2", averagePrice: 0.5 },
        settlementState: {
          status: "SETTLEMENT_VERIFIED" as const,
          evidence: {
            source: "polymarket_data_api_activity"
          }
        }
      }]
    };
    const signedTradeBundleService = {
      getExecutionStatus: vi.fn(async () => status)
    };
    const executionStatusRepository = {
      listExecutionStatusesForUser: vi.fn(async () => [status])
    };
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: { quote: vi.fn(), getQuote: vi.fn() } as never,
      sellQuoteService: { prepareExit: vi.fn() } as never,
      signedTradeBundleService: signedTradeBundleService as never,
      executionStatusRepository
    });

    const history = await app.inject({ method: "GET", url: "/execution/history?status=FILLED&limit=10" });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toMatchObject({
      items: [{
        executionId: "exec-1",
        status: "FILLED",
        settlementStatus: "SETTLEMENT_VERIFIED",
        submittedLegs: [{
          venue: "POLYMARKET",
          settlementState: { status: "SETTLEMENT_VERIFIED" }
        }]
      }],
      nextCursor: null
    });
    expect(executionStatusRepository.listExecutionStatusesForUser).toHaveBeenCalledWith({
      userId: "user-1",
      status: "FILLED",
      limit: 11
    });

    const receipt = await app.inject({ method: "GET", url: "/execution/exec-1/receipt" });
    expect(receipt.statusCode).toBe(200);
    expect(receipt.json()).toMatchObject({
      receipt: {
        executionId: "exec-1",
        userStatus: "FILLED",
        settlementStatus: "SETTLEMENT_VERIFIED",
        submittedLegs: [{
          venue: "POLYMARKET",
          fillState: { filledSize: "2" },
          settlementState: { status: "SETTLEMENT_VERIFIED" }
        }]
      }
    });
  });

  it("serves user open orders from active signed-bundle statuses", async () => {
    const app = Fastify();
    const status = {
      executionId: "exec-open-1",
      userId: "user-1",
      status: "SUBMITTED" as const,
      dryRun: false,
      submittedAt: "2026-05-07T21:00:00.000Z",
      updatedAt: "2026-05-07T21:01:00.000Z",
      submittedLegs: [{
        legIndex: 0,
        venue: "POLYMARKET",
        status: "SUBMITTED",
        venueOrderId: "order-open-1"
      }]
    };
    const executionStatusRepository = {
      listExecutionStatusesForUser: vi.fn(),
      listOpenExecutionStatusesForUser: vi.fn(async () => [status])
    };
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: { quote: vi.fn(), getQuote: vi.fn() } as never,
      sellQuoteService: { prepareExit: vi.fn() } as never,
      executionStatusRepository
    });

    const response = await app.inject({ method: "GET", url: "/execution/open-orders?limit=10" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{
        executionId: "exec-open-1",
        status: "SUBMITTED",
        openStatus: "SUBMITTED",
        userStatus: "SUBMITTED",
        dryRun: false,
        submittedLegs: [{ venue: "POLYMARKET", venueOrderId: "order-open-1" }]
      }],
      nextCursor: null
    });
    expect(executionStatusRepository.listOpenExecutionStatusesForUser).toHaveBeenCalledWith({
      userId: "user-1",
      limit: 11
    });
  });

  it("serves live execution candidates from backend quote evidence", async () => {
    const app = Fastify();
    const liveCandidateProvider = {
      getCandidates: vi.fn(async () => ({
        generatedAt: "2026-05-06T00:00:00.000Z",
        marketId: "canonical-market",
        outcomeId: "YES",
        amount: "1",
        source: "LIVE_QUOTE_SOURCE" as const,
        candidates: [{
          venue: "POLYMARKET",
          venueMarketId: "condition-1",
          venueOutcomeId: "token-1",
          price: 0.52,
          availableSize: "10"
        }],
        blocked: []
      }))
    };
    await registerExecutionRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, {
      executableRouteService: {
        quote: vi.fn(),
        getQuote: vi.fn()
      } as never,
      sellQuoteService: {
        prepareExit: vi.fn()
      } as never,
      liveCandidateProvider
    });

    const response = await app.inject({
      method: "POST",
      url: "/execution/live-candidates",
      payload: {
        side: "buy",
        marketId: "canonical-market",
        outcomeId: "YES",
        amount: "1"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      source: "LIVE_QUOTE_SOURCE",
      candidates: [{
        venue: "POLYMARKET",
        venueMarketId: "condition-1",
        venueOutcomeId: "token-1",
        price: 0.52
      }]
    });
    expect(liveCandidateProvider.getCandidates).toHaveBeenCalledWith({
      userId: "user-1",
      side: "buy",
      marketId: "canonical-market",
      outcomeId: "YES",
      amount: "1"
    });
  });

  it("builds live candidates only when executable venue ids are present", () => {
    const response = buildLiveExecutionCandidatesResponse({
      generatedAt: new Date("2026-05-06T00:00:00.000Z"),
      marketId: "canonical-market",
      outcomeId: "YES",
      amount: "1",
      snapshots: [
        {
          venue: "POLYMARKET",
          availableSize: 4,
          quotedPrice: 0.51,
          fees: {},
          latencyMs: 40,
          fillProb: 0.9,
          metadata: {
            venueMarketId: "condition-1",
            venueOutcomeId: "token-1",
            quoteQuality: "FULL_DEPTH_REST",
            freshnessMs: 40,
            tickSize: "0.001",
            polymarketTickSize: "0.001",
            negRisk: false,
            polymarketNegRisk: false,
            blockers: []
          }
        },
        {
          venue: "LIMITLESS",
          availableSize: 4,
          quotedPrice: 0.53,
          fees: {},
          latencyMs: 45,
          fillProb: 0.9,
          metadata: {
            venueMarketId: "limitless-market",
            blockers: []
          }
        }
      ],
      snapshotBlockers: [
        {
          venue: "PREDICT_FUN",
          reason: "QUOTE_READER_FAILED",
          venueMarketId: "predict-market",
          venueOutcomeId: "yes"
        }
      ],
      readiness: [
        {
          venue: "POLYMARKET",
          executionSigningModel: "BACKEND_SIGNER",
          liveSubmissionSupported: true
        },
        {
          venue: "LIMITLESS",
          executionSigningModel: "USER_SIGNED_BACKEND_RELAY",
          liveSubmissionSupported: true
        }
      ] as never
    });

    expect(response.candidates).toHaveLength(1);
    expect(response.candidates[0]).toMatchObject({
      venue: "POLYMARKET",
      venueMarketId: "condition-1",
      venueOutcomeId: "token-1",
      price: 0.51,
      metadata: {
        tickSize: "0.001",
        polymarketTickSize: "0.001",
        negRisk: false,
        polymarketNegRisk: false
      }
    });
    expect(response.blocked).toEqual([{
      venue: "PREDICT_FUN",
      reason: "QUOTE_READER_FAILED",
      venueMarketId: "predict-market",
      venueOutcomeId: "yes"
    }, {
      venue: "LIMITLESS",
      reason: "VENUE_OUTCOME_ID_MISSING_FROM_LIVE_QUOTE",
      venueMarketId: "limitless-market"
    }]);
  });
});
