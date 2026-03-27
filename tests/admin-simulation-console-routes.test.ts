import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, expect, it } from "vitest";

import { registerAdminSimulationConsoleRoutes } from "../src/api/admin/simulation-console.routes.js";
import { createAdminSimulationPreviewMiddleware } from "../src/api/user-auth-middleware.js";

describe("Admin Simulation Console Routes", () => {
  const buildApp = async (adminMiddleware: preHandlerHookHandler) => {
    const app = Fastify({ logger: false });
    await registerAdminSimulationConsoleRoutes(app, adminMiddleware);
    return app;
  };

  it("enforces admin auth on the simulation console page", async () => {
    const rejectingAdmin: preHandlerHookHandler = async (_request, reply) =>
      reply.status(403).send({ code: "FORBIDDEN" });
    const app = await buildApp(rejectingAdmin);

    const response = await app.inject({ method: "GET", url: "/admin/simulation-console" });
    expect(response.statusCode).toBe(403);

    await app.close();
  });

  it("propagates unauthenticated middleware failures", async () => {
    const unauthenticated: preHandlerHookHandler = async (_request, reply) =>
      reply.status(401).send({ code: "UNAUTHORIZED" });
    const app = await buildApp(unauthenticated);

    const response = await app.inject({ method: "GET", url: "/admin/simulation-console" });
    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it("returns internal HTML with the required controls and endpoint references", async () => {
    const passThroughAdmin: preHandlerHookHandler = async () => {};
    const app = await buildApp(passThroughAdmin);

    const response = await app.inject({ method: "GET", url: "/admin/simulation-console" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Internal Historical Simulation Console");
    expect(response.body).toContain('id="market-class"');
    expect(response.body).toContain('id="route-mode"');
    expect(response.body).toContain('id="order-side"');
    expect(response.body).toContain('id="time-from"');
    expect(response.body).toContain('id="time-to"');
    expect(response.body).toContain('id="canonical-event"');
    expect(response.body).toContain('id="strategy-key"');
    expect(response.body).toContain('id="canonical-market"');
    expect(response.body).toContain('id="requested-notional"');
    expect(response.body).toContain('id="dry-run"');
    expect(response.body).toContain('value="MYRIAD_ONLY"');
    expect(response.body).toContain('value="LIMITLESS_OPINION"');
    expect(response.body).toContain('value="POLYMARKET_LIMITLESS_OPINION"');
    expect(response.body).toContain("No market-scoped IDs available for this event");
    expect(response.body).toContain("Route Mode");
    expect(response.body).toContain("Choose one exact canonical market before running this route mode");
    expect(response.body).toContain(">POLITICS<");
    expect(response.body).toContain(">ESPORTS<");
    expect(response.body).toContain("/admin/simulation/scopes");
    expect(response.body).toContain("/admin/simulation/run");
    expect(response.body).toContain("/admin/simulation/canonical/");
    expect(response.body).toContain("/admin/simulation/run/");
    expect(response.body).toContain("Predexon, Limitless, Opinion, Myriad, and Predict");
    expect(response.body).toContain("Baseline Results");
    expect(response.body).toContain("Lotus Result");
    expect(response.body).toContain("Improvement Metrics");
    expect(response.body).toContain("Rollout Eligibility Outcome");
    expect(response.body).toContain("Route mode summary");
    expect(response.body).toContain("3-platform routes");
    expect(response.body).toContain("Confidence grade");
    expect(response.body).toContain("Confidence: ");
    expect(response.body).toContain("HIGH");
    expect(response.body).toContain("MEDIUM");
    expect(response.body).toContain("LOW");
    expect(response.body).toContain("BLOCKED");
    expect(response.body).toContain("Provably fillable now");
    expect(response.body).toContain("Residual with unknown depth");
    expect(response.body).toContain("Price-only residual capacity is shown separately from provable fill");

    await app.close();
  });

  it("allows localhost preview when the dev simulation preview middleware is enabled", async () => {
    const app = await buildApp(createAdminSimulationPreviewMiddleware({ enabled: true }));

    const response = await app.inject({
      method: "GET",
      url: "/admin/simulation-console",
      headers: {
        host: "localhost:3000"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Internal Historical Simulation Console");

    await app.close();
  });
});
