import Fastify, { type preHandlerHookHandler } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerAdminCompatibilityReviewRoutes } from "../src/api/admin/compatibility-review.routes.js";

describe("Admin Compatibility Review Routes", () => {
    const originalAdmin2faToken = process.env.ADMIN_2FA_TOKEN;

    afterEach(() => {
        if (originalAdmin2faToken === undefined) {
            delete process.env.ADMIN_2FA_TOKEN;
        } else {
            process.env.ADMIN_2FA_TOKEN = originalAdmin2faToken;
        }
    });

    const buildApp = async (adminMiddleware: preHandlerHookHandler) => {
        const app = Fastify({ logger: false });
        const compatibilityOverrideService = {
            listActiveOverrides: vi.fn(async () => []),
            resolveEffectiveDecision: vi.fn(async () => ({
                baseDecision: { id: "decision-1" },
                effectiveClass: "EQUIVALENT",
                activeOverride: null,
                overrideAmbiguous: false
            })),
            listOverrideHistory: vi.fn(async () => []),
            createOverride: vi.fn(async () => ({ id: "override-1" })),
            deactivateOverride: vi.fn(async () => ({ id: "override-1", isActive: false }))
        } as any;

        await registerAdminCompatibilityReviewRoutes(app, adminMiddleware, {
            compatibilityOverrideService
        });

        return { app, compatibilityOverrideService };
    };

    it("enforces admin auth on all routes", async () => {
        const rejectingAdmin: preHandlerHookHandler = async (_request, reply) =>
            reply.status(403).send({ code: "FORBIDDEN" });
        const { app } = await buildApp(rejectingAdmin);

        const response = await app.inject({
            method: "POST",
            url: "/admin/compatibility-review/override",
            payload: {
                twoFactorToken: "123456",
                targetDecisionId: "decision-1",
                forcedCompatibilityClass: "EQUIVALENT",
                reason: "manual review",
                overrideVersion: "override-v1"
            }
        });

        expect(response.statusCode).toBe(403);
        await app.close();
    });

    it("creates overrides with ADMIN+2FA payload shape", async () => {
        process.env.ADMIN_2FA_TOKEN = "123456";
        const passThrough: preHandlerHookHandler = async (request) => {
            (request as typeof request & { user: { userId: string; role: string } }).user = {
                userId: "admin-user",
                role: "ADMIN"
            };
        };
        const { app, compatibilityOverrideService } = await buildApp(passThrough);

        const response = await app.inject({
            method: "POST",
            url: "/admin/compatibility-review/override",
            payload: {
                twoFactorToken: "123456",
                targetDecisionId: "decision-1",
                forcedCompatibilityClass: "EQUIVALENT",
                reason: "manual review",
                overrideVersion: "override-v1"
            }
        });

        expect(response.statusCode).toBe(200);
        expect(compatibilityOverrideService.createOverride).toHaveBeenCalled();
        await app.close();
    });

    it("rejects override mutations when the configured 2FA token does not match", async () => {
        process.env.ADMIN_2FA_TOKEN = "654321";
        const passThrough: preHandlerHookHandler = async (request) => {
            (request as typeof request & { user: { userId: string; role: string } }).user = {
                userId: "admin-user",
                role: "ADMIN"
            };
        };
        const { app, compatibilityOverrideService } = await buildApp(passThrough);

        const response = await app.inject({
            method: "POST",
            url: "/admin/compatibility-review/override",
            payload: {
                twoFactorToken: "123456",
                targetDecisionId: "decision-1",
                forcedCompatibilityClass: "EQUIVALENT",
                reason: "manual review",
                overrideVersion: "override-v1"
            }
        });

        expect(response.statusCode).toBe(403);
        expect(compatibilityOverrideService.createOverride).not.toHaveBeenCalled();
        await app.close();
    });
});
