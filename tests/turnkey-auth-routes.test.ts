import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import { describe, expect, it, vi } from "vitest";
import { registerTurnkeyAuthRoutes } from "../src/api/routes/turnkey-auth.js";

const jwtSecret = "test-secret-at-least-thirty-two-characters";

const setupApp = async (verifySessionJwt = vi.fn(async () => true)) => {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: jwtSecret });
  await registerTurnkeyAuthRoutes(app, {
    jwtTtlSeconds: 3600,
    verifySessionJwt
  });
  return { app, verifySessionJwt };
};

const unsignedTurnkeySession = (payload: Record<string, unknown>) => {
  const header = Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = Buffer.from("test-signature").toString("base64url");
  return `${header}.${body}.${signature}`;
};

describe("Turnkey auth exchange route", () => {
  it("exchanges a valid Turnkey session for a Lotus user JWT", async () => {
    const { app, verifySessionJwt } = await setupApp();
    const session = unsignedTurnkeySession({
      userId: "turnkey-user-1",
      organizationId: "turnkey-org-1",
      exp: Math.floor(Date.now() / 1000) + 300
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/turnkey/exchange",
      payload: {
        turnkeySessionToken: session,
        turnkeyUserId: "turnkey-user-1",
        turnkeyOrganizationId: "turnkey-org-1"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.userJwt).toEqual(expect.any(String));
    expect(body.tokenType).toBe("Bearer");
    expect(body.expiresInSeconds).toBe(3600);
    expect(body.user.userId).toMatch(/^turnkey_[a-f0-9]{32}$/);
    expect(body.user.turnkeyUserId).toBe("turnkey-user-1");
    expect(body.user.turnkeyOrganizationId).toBe("turnkey-org-1");
    expect(verifySessionJwt).toHaveBeenCalledWith(session);

    const decoded = app.jwt.decode(body.userJwt) as Record<string, unknown>;
    expect(decoded.role).toBe("USER");
    expect(decoded.userId).toBe(body.user.userId);
    expect(decoded.turnkeyUserId).toBe("turnkey-user-1");
    expect(decoded.turnkeyOrganizationId).toBe("turnkey-org-1");
    await app.close();
  });

  it("rejects a mismatched Turnkey user", async () => {
    const { app } = await setupApp();
    const session = unsignedTurnkeySession({
      userId: "turnkey-user-1",
      organizationId: "turnkey-org-1",
      exp: Math.floor(Date.now() / 1000) + 300
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/turnkey/exchange",
      payload: {
        turnkeySessionToken: session,
        turnkeyUserId: "other-user",
        turnkeyOrganizationId: "turnkey-org-1"
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("TURNKEY_SESSION_MISMATCH");
    await app.close();
  });

  it("rejects an expired Turnkey session", async () => {
    const { app } = await setupApp();
    const session = unsignedTurnkeySession({
      userId: "turnkey-user-1",
      organizationId: "turnkey-org-1",
      exp: Math.floor(Date.now() / 1000) - 1
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/turnkey/exchange",
      payload: {
        turnkeySessionToken: session,
        turnkeyUserId: "turnkey-user-1",
        turnkeyOrganizationId: "turnkey-org-1"
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("TURNKEY_SESSION_EXPIRED");
    await app.close();
  });

  it("rejects an invalid Turnkey session signature", async () => {
    const { app } = await setupApp(vi.fn(async () => false));
    const session = unsignedTurnkeySession({
      userId: "turnkey-user-1",
      organizationId: "turnkey-org-1",
      exp: Math.floor(Date.now() / 1000) + 300
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/turnkey/exchange",
      payload: {
        turnkeySessionToken: session,
        turnkeyUserId: "turnkey-user-1",
        turnkeyOrganizationId: "turnkey-org-1"
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("INVALID_TURNKEY_SESSION");
    await app.close();
  });
});

