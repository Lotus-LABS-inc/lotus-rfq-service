import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  buildLiveExecutionCandidatesResponse,
  registerExecutionRoutes
} from "../src/api/routes/execution.js";

describe("execution signed bundle routes", () => {
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
      price: 0.51
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
