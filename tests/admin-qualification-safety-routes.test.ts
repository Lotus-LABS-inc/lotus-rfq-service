import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerAdminQualificationSafetyRoutes } from "../src/api/admin/qualification-safety.routes.js";
import {
    QualificationSafetyActionNotFoundError,
    QualificationSafetyActionResolveError,
    type QualificationSafetyAdminService
} from "../src/api/admin/qualification-safety-admin-service.js";

describe("Admin Qualification Safety Routes", () => {
    const actionId = "11111111-1111-4111-8111-111111111111";

    const buildApp = async (adminMiddleware: preHandlerHookHandler) => {
        const app = Fastify({ logger: false });
        const qualificationSafetyAdminService: QualificationSafetyAdminService = {
            listActions: vi.fn(async () => ([{
                id: actionId,
                strategyKey: "strategy.phase3b",
                scopeType: "bucket",
                scopeId: "bucket-1",
                actionType: "DISABLE_PHASE2B",
                triggerReason: "replay_diff_spike",
                createdAt: new Date("2026-03-12T10:00:00.000Z"),
                resolvedAt: null,
                metadata: {}
            }])),
            getAction: vi.fn(async () => ({
                id: actionId,
                strategyKey: "strategy.phase3b",
                scopeType: "bucket",
                scopeId: "bucket-1",
                actionType: "DISABLE_PHASE2B",
                triggerReason: "replay_diff_spike",
                createdAt: new Date("2026-03-12T10:00:00.000Z"),
                resolvedAt: null,
                metadata: {}
            })),
            resolveAction: vi.fn(async () => ({
                action: {
                    id: actionId,
                    strategyKey: "strategy.phase3b",
                    scopeType: "bucket",
                    scopeId: "bucket-1",
                    actionType: "DISABLE_PHASE2B",
                    triggerReason: "replay_diff_spike",
                    createdAt: new Date("2026-03-12T10:00:00.000Z"),
                    resolvedAt: new Date("2026-03-12T10:05:00.000Z"),
                    metadata: {}
                },
                controlPlaneNote: "Inspect control-plane state separately."
            }))
        } as unknown as QualificationSafetyAdminService;

        await registerAdminQualificationSafetyRoutes(app, adminMiddleware, {
            qualificationSafetyAdminService
        });
        return { app, qualificationSafetyAdminService };
    };

    it("enforces admin auth on all safety action routes", async () => {
        const rejectingAdmin: preHandlerHookHandler = async (_request, reply) => reply.status(403).send({ code: "FORBIDDEN" });
        const { app } = await buildApp(rejectingAdmin);

        const responses = await Promise.all([
            app.inject({ method: "GET", url: "/admin/qualification/safety-actions" }),
            app.inject({ method: "GET", url: `/admin/qualification/safety-action/${actionId}` }),
            app.inject({
                method: "POST",
                url: `/admin/qualification/safety-action/${actionId}/resolve`,
                payload: { twoFactorToken: "123456", resolutionReason: "operator acknowledged" }
            })
        ]);

        for (const response of responses) {
            expect(response.statusCode).toBe(403);
        }

        await app.close();
    });

    it("lists, loads, and resolves safety actions with ADMIN+2FA", async () => {
        const passThroughAdmin: preHandlerHookHandler = async (request) => {
            (request as unknown as { user?: { email: string } }).user = { email: "ops-admin@example.com" };
        };
        const { app, qualificationSafetyAdminService } = await buildApp(passThroughAdmin);

        const listResponse = await app.inject({
            method: "GET",
            url: "/admin/qualification/safety-actions?actionType=DISABLE_PHASE2B&resolved=false"
        });
        expect(listResponse.statusCode).toBe(200);

        const detailResponse = await app.inject({
            method: "GET",
            url: `/admin/qualification/safety-action/${actionId}`
        });
        expect(detailResponse.statusCode).toBe(200);

        const resolveResponse = await app.inject({
            method: "POST",
            url: `/admin/qualification/safety-action/${actionId}/resolve`,
            payload: { twoFactorToken: "123456", resolutionReason: "operator acknowledged" }
        });
        expect(resolveResponse.statusCode).toBe(200);
        expect(
            (qualificationSafetyAdminService as unknown as { resolveAction: ReturnType<typeof vi.fn> }).resolveAction
        ).toHaveBeenCalledWith(actionId, "operator acknowledged", "ops-admin@example.com");

        await app.close();
    });

    it("maps invalid requests and missing/invalid action transitions", async () => {
        const passThroughAdmin: preHandlerHookHandler = async () => {};
        const { app, qualificationSafetyAdminService } = await buildApp(passThroughAdmin);

        const invalidResolve = await app.inject({
            method: "POST",
            url: `/admin/qualification/safety-action/${actionId}/resolve`,
            payload: { twoFactorToken: "123", resolutionReason: "" }
        });
        expect(invalidResolve.statusCode).toBe(400);

        (qualificationSafetyAdminService as unknown as { getAction: ReturnType<typeof vi.fn> }).getAction.mockRejectedValueOnce(
            new QualificationSafetyActionNotFoundError(actionId)
        );
        const notFound = await app.inject({
            method: "GET",
            url: `/admin/qualification/safety-action/${actionId}`
        });
        expect(notFound.statusCode).toBe(404);

        (qualificationSafetyAdminService as unknown as { resolveAction: ReturnType<typeof vi.fn> }).resolveAction.mockRejectedValueOnce(
            new QualificationSafetyActionResolveError("already resolved")
        );
        const invalidTransition = await app.inject({
            method: "POST",
            url: `/admin/qualification/safety-action/${actionId}/resolve`,
            payload: { twoFactorToken: "123456", resolutionReason: "operator acknowledged" }
        });
        expect(invalidTransition.statusCode).toBe(409);

        await app.close();
    });
});
