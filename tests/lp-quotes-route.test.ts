import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  DuplicateQuoteIdError,
  InvalidRFQSessionStateError,
  LPIdentityMismatchError,
  ReceiveLPQuoteService,
  RFQSessionNotFoundError,
  ResolutionRiskQuoteRejectedError
} from "../src/lp/receive-lp-quote-service.js";
import type { LPAuthenticatedRequest } from "../src/lp/lp-auth-middleware.js";
import { registerLPQuotesRoute } from "../src/lp/routes/lp-quotes-route.js";

const fakeAuthPreHandler = async (request: unknown): Promise<void> => {
  const req = request as LPAuthenticatedRequest;
  req.lpAuth = {
    lpId: "lp-1",
    keyId: "api-key-1",
    lpKeyDbId: "lp-key-db-1"
  };
};

describe("POST /lp/:id/quotes", () => {
  it("returns 400 for invalid payload", async () => {
    const app = Fastify({ logger: false });
    const service = {
      execute: vi.fn()
    } as unknown as ReceiveLPQuoteService;

    await registerLPQuotesRoute(app, fakeAuthPreHandler, service);

    const response = await app.inject({
      method: "POST",
      url: "/lp/lp-1/quotes",
      payload: {
        sessionId: "not-a-uuid"
      }
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("returns 202 and delegates to service", async () => {
    const app = Fastify({ logger: false });
    const execute = vi.fn(async () => ({
      accepted: true as const,
      sessionId: "a0eb58b9-a89c-48a7-bda8-b08a050ad95e",
      quoteId: "quote-1"
    }));
    await registerLPQuotesRoute(
      app,
      fakeAuthPreHandler,
      {
        execute
      } as unknown as ReceiveLPQuoteService
    );

    const response = await app.inject({
      method: "POST",
      url: "/lp/lp-1/quotes",
      payload: {
        sessionId: "a0eb58b9-a89c-48a7-bda8-b08a050ad95e",
        quoteId: "quote-1",
        price: "1.23",
        quantity: "10",
        feeBps: 8,
        validUntil: "2026-02-25T16:00:00.000Z"
      }
    });

    expect(response.statusCode).toBe(202);
    expect(execute).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("maps service domain errors to http statuses", async () => {
    const app = Fastify({ logger: false });
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new LPIdentityMismatchError())
      .mockRejectedValueOnce(new RFQSessionNotFoundError("s1"))
      .mockRejectedValueOnce(new InvalidRFQSessionStateError("s2", "BROADCAST"))
      .mockRejectedValueOnce(new DuplicateQuoteIdError("q1"))
      .mockRejectedValueOnce(new ResolutionRiskQuoteRejectedError("blocked"));

    await registerLPQuotesRoute(
      app,
      fakeAuthPreHandler,
      {
        execute
      } as unknown as ReceiveLPQuoteService
    );

    const payload = {
      sessionId: "a0eb58b9-a89c-48a7-bda8-b08a050ad95e",
      quoteId: "quote-1",
      price: "1.23",
      quantity: "10",
      feeBps: 8,
      validUntil: "2026-02-25T16:00:00.000Z"
    };

    const r1 = await app.inject({ method: "POST", url: "/lp/lp-1/quotes", payload });
    const r2 = await app.inject({ method: "POST", url: "/lp/lp-1/quotes", payload });
    const r3 = await app.inject({ method: "POST", url: "/lp/lp-1/quotes", payload });
    const r4 = await app.inject({ method: "POST", url: "/lp/lp-1/quotes", payload });
    const r5 = await app.inject({ method: "POST", url: "/lp/lp-1/quotes", payload });

    expect(r1.statusCode).toBe(403);
    expect(r2.statusCode).toBe(404);
    expect(r3.statusCode).toBe(409);
    expect(r4.statusCode).toBe(409);
    expect(r5.statusCode).toBe(409);
    await app.close();
  });
});
