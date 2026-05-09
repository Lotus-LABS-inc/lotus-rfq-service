import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  buildLiveExecutionCandidatesResponse,
  registerExecutionRoutes
} from "../src/api/routes/execution.js";

describe("execution signed bundle routes", () => {
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
      submittedLegs: [{
        venue: "PREDICT_FUN",
        status: "FILLED",
        fillState: {
          status: "FILLED",
          filledSize: "2.5"
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
    expect(positionRepository.listUserVerifiedPositions).toHaveBeenCalledWith({
      userId: "user-1",
      limit: 25
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
        fillState: { status: "FILLED" as const, filledSize: "2", averagePrice: 0.5 }
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
      items: [{ executionId: "exec-1", status: "FILLED", submittedLegs: [{ venue: "POLYMARKET" }] }],
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
        submittedLegs: [{ venue: "POLYMARKET", fillState: { filledSize: "2" } }]
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
