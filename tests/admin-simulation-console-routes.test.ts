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
    expect(response.body).toContain('id="venue-pair"');
    expect(response.body).toContain('id="time-from"');
    expect(response.body).toContain('id="time-to"');
    expect(response.body).toContain('id="canonical-event"');
    expect(response.body).toContain('id="strategy-key"');
    expect(response.body).toContain('id="dry-run"');
    expect(response.body).toContain("/admin/simulation/scopes");
    expect(response.body).toContain("/admin/simulation/run");
    expect(response.body).toContain("/admin/simulation/canonical/");
    expect(response.body).toContain("/admin/simulation/run/");
    expect(response.body).toContain("Baseline Results");
    expect(response.body).toContain("Lotus Result");
    expect(response.body).toContain("Improvement Metrics");
    expect(response.body).toContain("Rollout Eligibility Outcome");

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
