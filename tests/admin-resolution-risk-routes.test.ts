import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerAdminResolutionRiskRoutes } from "../src/api/admin/resolution-risk.routes.js";
import {
    ResolutionRiskAdminProfileNotFoundError,
    ResolutionRiskKillSwitchActiveError,
    type ResolutionRiskAdminService,
} from "../src/api/admin/resolution-risk-admin-service.js";

describe("Admin Resolution Risk Routes", () => {
    const canonicalEventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const profileId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    const buildApp = async (adminMiddleware: preHandlerHookHandler) => {
        const app = Fastify({ logger: false });

        const resolutionRiskAdminService: ResolutionRiskAdminService = {
            getCanonicalInspection: vi.fn(async () => ({
                canonicalEventId,
                profiles: [],
                assessments: [],
                scoringVersion: "resolution-risk-v1",
                freshness: {
                    profileCount: 0,
                    expectedPairCount: 0,
                    persistedPairCount: 0,
                    lastComputedAt: null,
                    latestProfileUpdatedAt: null,
                    isComplete: false,
                    isStale: true,
                    hasMixedVersions: false,
                },
            })),
            recomputeProfileAssessments: vi.fn(async () => ({
                profileId,
                canonicalEventId,
                version: "resolution-risk-v1",
                assessmentCount: 3,
                lastComputedAt: new Date("2026-03-11T00:00:00.000Z"),
            })),
            recomputeCanonicalAssessments: vi.fn(async () => ({
                canonicalEventId,
                version: "resolution-risk-v1",
                assessmentCount: 3,
                lastComputedAt: new Date("2026-03-11T00:00:00.000Z"),
            })),
        } as unknown as ResolutionRiskAdminService;

        await registerAdminResolutionRiskRoutes(app, adminMiddleware, {
            resolutionRiskAdminService,
        });

        return { app, resolutionRiskAdminService };
    };

    it("denies access when admin middleware rejects", async () => {
        const rejectingAdmin: preHandlerHookHandler = async (_request, reply) => reply.status(403).send({ code: "FORBIDDEN" });
        const { app } = await buildApp(rejectingAdmin);

        const response = await app.inject({
            method: "GET",
            url: `/admin/resolution-risk/canonical/${canonicalEventId}`,
        });

        expect(response.statusCode).toBe(403);
        await app.close();
    });

    it("returns canonical inspection", async () => {
        const passThroughAdmin: preHandlerHookHandler = async (request) => {
            (request as { user?: { userId: string; role: "ADMIN" } }).user = { userId: "admin-1", role: "ADMIN" };
        };
        const { app, resolutionRiskAdminService } = await buildApp(passThroughAdmin);

        const response = await app.inject({
            method: "GET",
            url: `/admin/resolution-risk/canonical/${canonicalEventId}`,
        });

        expect(response.statusCode).toBe(200);
        expect((resolutionRiskAdminService as unknown as { getCanonicalInspection: ReturnType<typeof vi.fn> }).getCanonicalInspection)
            .toHaveBeenCalledWith(canonicalEventId);
        await app.close();
    });

    it("requires 2FA for profile recompute", async () => {
        const passThroughAdmin: preHandlerHookHandler = async (request) => {
            (request as { user?: { userId: string; role: "ADMIN" } }).user = { userId: "admin-1", role: "ADMIN" };
        };
        const { app, resolutionRiskAdminService } = await buildApp(passThroughAdmin);

        const response = await app.inject({
            method: "POST",
            url: `/admin/resolution-risk/recompute/${profileId}`,
            payload: {},
        });

        expect(response.statusCode).toBe(400);
        expect((resolutionRiskAdminService as unknown as { recomputeProfileAssessments: ReturnType<typeof vi.fn> }).recomputeProfileAssessments)
            .not.toHaveBeenCalled();
        await app.close();
    });

    it("recomputes full event for a profile", async () => {
        const passThroughAdmin: preHandlerHookHandler = async (request) => {
            (request as { user?: { userId: string; role: "ADMIN" } }).user = { userId: "admin-1", role: "ADMIN" };
        };
        const { app, resolutionRiskAdminService } = await buildApp(passThroughAdmin);

        const response = await app.inject({
            method: "POST",
            url: `/admin/resolution-risk/recompute/${profileId}`,
            payload: { twoFactorToken: "123456" },
        });

        expect(response.statusCode).toBe(200);
        expect((resolutionRiskAdminService as unknown as { recomputeProfileAssessments: ReturnType<typeof vi.fn> }).recomputeProfileAssessments)
            .toHaveBeenCalledWith({
                profileId,
                requestedBy: "admin-1",
            });
        await app.close();
    });

    it("recomputes canonical event", async () => {
        const passThroughAdmin: preHandlerHookHandler = async (request) => {
            (request as { user?: { userId: string; role: "ADMIN" } }).user = { userId: "admin-1", role: "ADMIN" };
        };
        const { app, resolutionRiskAdminService } = await buildApp(passThroughAdmin);

        const response = await app.inject({
            method: "POST",
            url: `/admin/resolution-risk/recompute/canonical/${canonicalEventId}`,
            payload: { twoFactorToken: "123456" },
        });

        expect(response.statusCode).toBe(200);
        expect((resolutionRiskAdminService as unknown as { recomputeCanonicalAssessments: ReturnType<typeof vi.fn> }).recomputeCanonicalAssessments)
            .toHaveBeenCalledWith({
                canonicalEventId,
                requestedBy: "admin-1",
            });
        await app.close();
    });

    it("maps kill switch and not-found errors", async () => {
        const passThroughAdmin: preHandlerHookHandler = async (request) => {
            (request as { user?: { userId: string; role: "ADMIN" } }).user = { userId: "admin-1", role: "ADMIN" };
        };
        const { app, resolutionRiskAdminService } = await buildApp(passThroughAdmin);

        (resolutionRiskAdminService as unknown as { recomputeProfileAssessments: ReturnType<typeof vi.fn> }).recomputeProfileAssessments
            .mockRejectedValueOnce(new ResolutionRiskKillSwitchActiveError())
            .mockRejectedValueOnce(new ResolutionRiskAdminProfileNotFoundError(profileId));

        const killSwitchResponse = await app.inject({
            method: "POST",
            url: `/admin/resolution-risk/recompute/${profileId}`,
            payload: { twoFactorToken: "123456" },
        });
        expect(killSwitchResponse.statusCode).toBe(409);

        const notFoundResponse = await app.inject({
            method: "POST",
            url: `/admin/resolution-risk/recompute/${profileId}`,
            payload: { twoFactorToken: "123456" },
        });
        expect(notFoundResponse.statusCode).toBe(404);

        await app.close();
    });
});
