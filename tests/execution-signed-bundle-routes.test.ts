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
