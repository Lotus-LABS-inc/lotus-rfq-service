import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { CanonicalMarketFetchError } from "../src/core/rfq-engine/canonical-market-client.js";
import { MarketInactiveError } from "../src/core/rfq-engine/create-rfq-service.js";
import { RiskRejectedError } from "../src/core/risk-engine.js";
import { InsufficientLiquidityError } from "../src/core/sor/splitter.js";
import { registerRFQRoute } from "../src/api/routes/rfq.js";

describe("POST /rfq", () => {
  it("returns 400 on invalid request payload", async () => {
    const app = Fastify({ logger: false });
    const passThroughAuth: preHandlerHookHandler = async () => { };
    await registerRFQRoute(app, passThroughAuth, {
      createRFQ: vi.fn(),
      createExecutionScopeToken: vi.fn(),
      acceptRFQ: vi.fn()
    });

    const response = await app.inject({
      method: "POST",
      url: "/rfq",
      payload: {
        canonicalMarketId: "",
        takerId: "taker-1"
      }
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("delegates to service and returns 201 on success", async () => {
    const app = Fastify({ logger: false });
    const createRFQ = vi.fn(async () => ({
      sessionId: "session-1",
      state: "BROADCAST" as const,
      expiresAt: "2026-02-25T12:00:00.000Z"
    }));

    const passThroughAuth: preHandlerHookHandler = async () => { };
    await registerRFQRoute(app, passThroughAuth, {
      createRFQ,
      createExecutionScopeToken: vi.fn(),
      acceptRFQ: vi.fn()
    });

    const response = await app.inject({
      method: "POST",
      url: "/rfq",
      payload: {
        canonicalMarketId: "mkt-1",
        takerId: "taker-1",
        side: "buy",
        quantity: "10.5",
        idempotencyKey: "idemp-1",
        ttlSeconds: 30
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      sessionId: "session-1",
      state: "BROADCAST"
    });
    expect(createRFQ).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("maps inactive market errors to 409", async () => {
    const app = Fastify({ logger: false });
    const passThroughAuth: preHandlerHookHandler = async () => { };
    await registerRFQRoute(app, passThroughAuth, {
      createRFQ: vi.fn(async () => {
        throw new MarketInactiveError("mkt-closed");
      }),
      createExecutionScopeToken: vi.fn(),
      acceptRFQ: vi.fn()
    });

    const response = await app.inject({
      method: "POST",
      url: "/rfq",
      payload: {
        canonicalMarketId: "mkt-closed",
        takerId: "taker-1",
        side: "buy",
        quantity: "1",
        idempotencyKey: "idemp-2",
        ttlSeconds: 30
      }
    });

    expect(response.statusCode).toBe(409);
    await app.close();
  });

  it("maps canonical service failures to 502", async () => {
    const app = Fastify({ logger: false });
    const passThroughAuth: preHandlerHookHandler = async () => { };
    await registerRFQRoute(app, passThroughAuth, {
      createRFQ: vi.fn(async () => {
        throw new CanonicalMarketFetchError("canonical service unavailable");
      }),
      createExecutionScopeToken: vi.fn(),
      acceptRFQ: vi.fn()
    });

    const response = await app.inject({
      method: "POST",
      url: "/rfq",
      payload: {
        canonicalMarketId: "mkt-1",
        takerId: "taker-1",
        side: "sell",
        quantity: "2",
        idempotencyKey: "idemp-3",
        ttlSeconds: 30
      }
    });

    expect(response.statusCode).toBe(502);
    await app.close();
  });
});

describe("POST /rfq/:id/accept", () => {
  it("issues execution scope tokens for exact approved lanes", async () => {
    const app = Fastify({ logger: false });
    const passThroughAuth: preHandlerHookHandler = async () => { };
    const createExecutionScopeToken = vi.fn(async () => ({
      token: "signed-token",
      expiresAt: "2026-04-04T12:00:00.000Z",
      singleUse: true as const,
      scope: {
        scopeKind: "POLITICS_NOMINEE_LANE",
        scopeId: "POLITICS_NOMINEE_REPUBLICAN_TRI_LIMITLESS_OPINION_POLYMARKET",
        topicKey: "NOMINEE|US_PRESIDENT|2028|REPUBLICAN",
        laneType: "TRI",
        venueSet: ["LIMITLESS", "OPINION", "POLYMARKET"],
        candidateSet: ["jd_vance", "marco_rubio", "ron_desantis"]
      }
    }));
    await registerRFQRoute(app, passThroughAuth, {
      createRFQ: vi.fn(),
      createExecutionScopeToken,
      acceptRFQ: vi.fn()
    });

    const response = await app.inject({
      method: "POST",
      url: "/rfq/session-1/execution-scope-token",
      payload: {
        quoteId: "quote-1",
        scopeKind: "POLITICS_NOMINEE_LANE",
        scopeId: "POLITICS_NOMINEE_REPUBLICAN_TRI_LIMITLESS_OPINION_POLYMARKET"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(createExecutionScopeToken).toHaveBeenCalledWith("session-1", {
      quoteId: "quote-1",
      scopeKind: "POLITICS_NOMINEE_LANE",
      scopeId: "POLITICS_NOMINEE_REPUBLICAN_TRI_LIMITLESS_OPINION_POLYMARKET"
    });
    await app.close();
  });

  it("returns 202 with plan response when accepted", async () => {
    const app = Fastify({ logger: false });
    const passThroughAuth: preHandlerHookHandler = async () => { };
    const acceptRFQ = vi.fn(async () => ({
      status: "PLAN_ACCEPTED" as const,
      plan_id: "plan-1",
      plan_state: "DRAFT",
      dispatch_mode: "background" as const
    }));
    await registerRFQRoute(app, passThroughAuth, {
      createRFQ: vi.fn(),
      createExecutionScopeToken: vi.fn(),
      acceptRFQ
    });

    const response = await app.inject({
      method: "POST",
      url: "/rfq/session-1/accept",
      payload: {
        quoteId: "quote-1",
        executionScopeToken: "signed-scope-token"
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      status: "PLAN_ACCEPTED",
      plan_id: "plan-1"
    });
    expect(acceptRFQ).toHaveBeenCalledWith("session-1", {
      quoteId: "quote-1",
      executionScopeToken: "signed-scope-token"
    });
    await app.close();
  });

  it("maps insufficient liquidity to structured 409", async () => {
    const app = Fastify({ logger: false });
    const passThroughAuth: preHandlerHookHandler = async () => { };
    await registerRFQRoute(app, passThroughAuth, {
      createRFQ: vi.fn(),
      createExecutionScopeToken: vi.fn(),
      acceptRFQ: vi.fn(async () => {
        throw new InsufficientLiquidityError("a0eb58b9-a89c-48a7-bda8-b08a050ad95e", 2);
      })
    });

    const response = await app.inject({
      method: "POST",
      url: "/rfq/session-1/accept",
      payload: {
        quoteId: "quote-1"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "PLAN_REJECTED",
      reason: "insufficient_liquidity"
    });
    await app.close();
  });

  it("maps risk rejection to structured 409", async () => {
    const app = Fastify({ logger: false });
    const passThroughAuth: preHandlerHookHandler = async () => { };
    await registerRFQRoute(app, passThroughAuth, {
      createRFQ: vi.fn(),
      createExecutionScopeToken: vi.fn(),
      acceptRFQ: vi.fn(async () => {
        throw new RiskRejectedError("quota_exceeded");
      })
    });

    const response = await app.inject({
      method: "POST",
      url: "/rfq/session-1/accept",
      payload: {
        quoteId: "quote-1"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "PLAN_REJECTED",
      reason: "risk_rejected"
    });
    await app.close();
  });
});
