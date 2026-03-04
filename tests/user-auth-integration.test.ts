import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import { describe, expect, it, vi } from "vitest";
import { registerRFQRoute } from "../src/api/routes/rfq.js";
import { createUserAuthMiddleware } from "../src/api/user-auth-middleware.js";

describe("RFQ Route JWT Integration", () => {
    const jwtSecret = "super-secret-key-at-least-thirty-two-chars-long";

    const setupApp = async () => {
        const app = Fastify({ logger: false });
        await app.register(fastifyJwt, { secret: jwtSecret });

        const userAuthMiddleware = createUserAuthMiddleware();
        await registerRFQRoute(app, userAuthMiddleware, {
            createRFQ: vi.fn(async () => ({
                sessionId: "session-1",
                state: "BROADCAST" as const,
                expiresAt: new Date().toISOString()
            })),
            acceptRFQ: vi.fn(async () => ({
                status: "PLAN_ACCEPTED" as const,
                plan_id: "plan-1",
                plan_state: "DRAFT",
                dispatch_mode: "background" as const
            }))
        });

        return app;
    };

    it("returns 401 when no token is provided", async () => {
        const app = await setupApp();
        const response = await app.inject({
            method: "POST",
            url: "/rfq",
            payload: {
                canonicalMarketId: "mkt-1",
                takerId: "taker-1",
                side: "buy",
                quantity: "100",
                idempotencyKey: "key-1",
                ttlSeconds: 60
            }
        });

        expect(response.statusCode).toBe(401);
        expect(response.json().code).toBe("UNAUTHORIZED");
        await app.close();
    });

    it("returns 401 when an invalid token is provided", async () => {
        const app = await setupApp();
        const response = await app.inject({
            method: "POST",
            url: "/rfq",
            headers: {
                authorization: "Bearer invalid-token"
            },
            payload: {
                canonicalMarketId: "mkt-1",
                takerId: "taker-1",
                side: "buy",
                quantity: "100",
                idempotencyKey: "key-1",
                ttlSeconds: 60
            }
        });

        expect(response.statusCode).toBe(401);
        await app.close();
    });

    it("returns 201 when a valid token is provided", async () => {
        const app = await setupApp();
        const token = app.jwt.sign({ userId: "user-123" });

        const response = await app.inject({
            method: "POST",
            url: "/rfq",
            headers: {
                authorization: `Bearer ${token}`
            },
            payload: {
                canonicalMarketId: "mkt-1",
                takerId: "taker-1",
                side: "buy",
                quantity: "100",
                idempotencyKey: "key-1",
                ttlSeconds: 60
            }
        });

        expect(response.statusCode).toBe(201);
        await app.close();
    });
});
