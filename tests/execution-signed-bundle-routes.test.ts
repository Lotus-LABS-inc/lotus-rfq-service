import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerExecutionRoutes } from "../src/api/routes/execution.js";

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
});
