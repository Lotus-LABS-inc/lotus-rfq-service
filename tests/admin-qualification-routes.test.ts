import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerAdminQualificationRoutes } from "../src/api/admin/qualification.routes.js";
import {
    QualificationEvidenceInsufficientError,
    QualificationPromotionGateBlockedError,
    QualificationRunAdminTransitionError,
    QualificationRunNotFoundAdminError,
    type QualificationAdminService
} from "../src/api/admin/qualification-admin-service.js";
import { QualificationRunStatus, QualificationStage } from "../src/core/qualification/qualification.types.js";

describe("Admin Qualification Routes", () => {
    const runId = "11111111-1111-4111-8111-111111111111";

    const buildApp = async (adminMiddleware: preHandlerHookHandler) => {
        const app = Fastify({ logger: false });

        const qualificationAdminService: QualificationAdminService = {
            listRuns: vi.fn(async () => ([{
                id: runId,
                strategyKey: "strategy.phase3b",
                scopeType: "bucket",
                scopeId: "bucket-1",
                stage: QualificationStage.SHADOW,
                engineVersion: "eng-v1",
                configVersion: "cfg-v1",
                startedAt: new Date("2026-03-12T10:00:00.000Z"),
                endedAt: null,
                status: QualificationRunStatus.RUNNING,
                metadata: {}
            }])),
            getRunDetail: vi.fn(async () => ({
                run: {
                    id: runId,
                    strategyKey: "strategy.phase3b",
                    scopeType: "bucket",
                    scopeId: "bucket-1",
                    stage: QualificationStage.SHADOW,
                    engineVersion: "eng-v1",
                    configVersion: "cfg-v1",
                    startedAt: new Date("2026-03-12T10:00:00.000Z"),
                    endedAt: null,
                    status: QualificationRunStatus.RUNNING,
                    metadata: {}
                },
                summary: {
                    evaluationCount: 1,
                    countsByDecisionType: { SOR_CONFIG_CHANGE: 1 },
                    realized: { count: 1, numericTotals: { realizedFillPrice: "1.01" } },
                    counterfactual: { count: 1, numericTotals: { realizedFillPrice: "1.02" } },
                    improvement: { count: 1, numericTotals: { priceImprovement: "0.05" } }
                }
            })),
            listEvaluations: vi.fn(async () => ([{
                id: "22222222-2222-4222-8222-222222222222",
                qualificationRunId: runId,
                decisionType: "SOR_CONFIG_CHANGE",
                entityId: "rfq-1",
                replayEnvelopeId: null,
                realizedMetrics: {},
                counterfactualMetrics: {},
                improvementMetrics: {},
                createdAt: new Date("2026-03-12T10:05:00.000Z")
            }])),
            promoteRun: vi.fn(async () => ({
                run: {
                    id: runId,
                    strategyKey: "strategy.phase3b",
                    scopeType: "bucket",
                    scopeId: "bucket-1",
                    stage: QualificationStage.CANARY,
                    engineVersion: "eng-v1",
                    configVersion: "cfg-v1",
                    startedAt: new Date("2026-03-12T10:00:00.000Z"),
                    endedAt: null,
                    status: QualificationRunStatus.RUNNING,
                    metadata: {}
                },
                gateResult: {
                    promotable: true,
                    reasons: ["all promotion gates passed"],
                    failedGates: [],
                    recommendedStage: QualificationStage.CANARY
                },
                promotionEvent: {
                    id: "33333333-3333-4333-8333-333333333333",
                    strategyKey: "strategy.phase3b",
                    scopeType: "bucket",
                    scopeId: "bucket-1",
                    fromStage: QualificationStage.SHADOW,
                    toStage: QualificationStage.CANARY,
                    reason: "promotion_gate_passed",
                    createdBy: "ops-admin@example.com",
                    createdAt: new Date("2026-03-12T10:10:00.000Z"),
                    metadata: {}
                }
            })),
            demoteRun: vi.fn(async () => ({
                run: {
                    id: runId,
                    strategyKey: "strategy.phase3b",
                    scopeType: "bucket",
                    scopeId: "bucket-1",
                    stage: QualificationStage.INTERNAL_ONLY,
                    engineVersion: "eng-v1",
                    configVersion: "cfg-v1",
                    startedAt: new Date("2026-03-12T10:00:00.000Z"),
                    endedAt: null,
                    status: QualificationRunStatus.RUNNING,
                    metadata: {}
                },
                promotionEvent: {
                    id: "44444444-4444-4444-8444-444444444444",
                    strategyKey: "strategy.phase3b",
                    scopeType: "bucket",
                    scopeId: "bucket-1",
                    fromStage: QualificationStage.SHADOW,
                    toStage: QualificationStage.INTERNAL_ONLY,
                    reason: "manual demotion",
                    createdBy: "ops-admin@example.com",
                    createdAt: new Date("2026-03-12T10:15:00.000Z"),
                    metadata: {}
                }
            })),
            pauseRun: vi.fn(async () => ({
                run: {
                    id: runId,
                    strategyKey: "strategy.phase3b",
                    scopeType: "bucket",
                    scopeId: "bucket-1",
                    stage: QualificationStage.SHADOW,
                    engineVersion: "eng-v1",
                    configVersion: "cfg-v1",
                    startedAt: new Date("2026-03-12T10:00:00.000Z"),
                    endedAt: null,
                    status: QualificationRunStatus.PAUSED,
                    metadata: {}
                }
            }))
        } as unknown as QualificationAdminService;

        await registerAdminQualificationRoutes(app, adminMiddleware, { qualificationAdminService });
        return { app, qualificationAdminService };
    };

    it("enforces admin auth on all routes", async () => {
        const rejectingAdmin: preHandlerHookHandler = async (_request, reply) => reply.status(403).send({ code: "FORBIDDEN" });
        const { app } = await buildApp(rejectingAdmin);

        const responses = await Promise.all([
            app.inject({ method: "GET", url: "/admin/qualification/runs" }),
            app.inject({ method: "GET", url: `/admin/qualification/run/${runId}` }),
            app.inject({ method: "GET", url: `/admin/qualification/run/${runId}/evaluations` }),
            app.inject({ method: "POST", url: `/admin/qualification/run/${runId}/promote`, payload: { twoFactorToken: "123456" } }),
            app.inject({ method: "POST", url: `/admin/qualification/run/${runId}/demote`, payload: { twoFactorToken: "123456", targetStage: "INTERNAL_ONLY", reason: "x" } }),
            app.inject({ method: "POST", url: `/admin/qualification/run/${runId}/pause`, payload: { twoFactorToken: "123456" } })
        ]);

        for (const response of responses) {
            expect(response.statusCode).toBe(403);
        }

        await app.close();
    });

    it("returns runs and run detail", async () => {
        const passThroughAdmin: preHandlerHookHandler = async () => {};
        const { app, qualificationAdminService } = await buildApp(passThroughAdmin);

        const listResponse = await app.inject({ method: "GET", url: "/admin/qualification/runs?stage=SHADOW&status=RUNNING" });
        expect(listResponse.statusCode).toBe(200);
        expect((qualificationAdminService as unknown as { listRuns: ReturnType<typeof vi.fn> }).listRuns).toHaveBeenCalledWith({
            stage: "SHADOW",
            status: "RUNNING"
        });

        const detailResponse = await app.inject({ method: "GET", url: `/admin/qualification/run/${runId}` });
        expect(detailResponse.statusCode).toBe(200);

        const evalsResponse = await app.inject({ method: "GET", url: `/admin/qualification/run/${runId}/evaluations` });
        expect(evalsResponse.statusCode).toBe(200);

        await app.close();
    });

    it("returns 400 for malformed requests and 404 for missing runs", async () => {
        const passThroughAdmin: preHandlerHookHandler = async () => {};
        const { app, qualificationAdminService } = await buildApp(passThroughAdmin);

        const invalidPromote = await app.inject({
            method: "POST",
            url: `/admin/qualification/run/${runId}/promote`,
            payload: { twoFactorToken: "123" }
        });
        expect(invalidPromote.statusCode).toBe(400);

        (qualificationAdminService as unknown as { getRunDetail: ReturnType<typeof vi.fn> }).getRunDetail.mockRejectedValueOnce(
            new QualificationRunNotFoundAdminError(runId)
        );
        const notFound = await app.inject({ method: "GET", url: `/admin/qualification/run/${runId}` });
        expect(notFound.statusCode).toBe(404);

        await app.close();
    });

    it("promotes via ADMIN+2FA and maps blocked gate behavior", async () => {
        const passThroughAdmin: preHandlerHookHandler = async (request) => {
            (request as unknown as { user?: { email: string } }).user = { email: "ops-admin@example.com" };
        };
        const { app, qualificationAdminService } = await buildApp(passThroughAdmin);

        const okResponse = await app.inject({
            method: "POST",
            url: `/admin/qualification/run/${runId}/promote`,
            payload: { twoFactorToken: "123456" }
        });
        expect(okResponse.statusCode).toBe(200);
        expect((qualificationAdminService as unknown as { promoteRun: ReturnType<typeof vi.fn> }).promoteRun).toHaveBeenCalledWith(
            runId,
            "ops-admin@example.com"
        );

        (qualificationAdminService as unknown as { promoteRun: ReturnType<typeof vi.fn> }).promoteRun.mockRejectedValueOnce(
            new QualificationPromotionGateBlockedError({
                promotable: false,
                reasons: ["economic quality gate failed"],
                failedGates: [{
                    gate: "ECONOMIC_QUALITY",
                    reason: "economic quality gate failed",
                    observed: {},
                    threshold: {}
                }]
            })
        );
        const blockedResponse = await app.inject({
            method: "POST",
            url: `/admin/qualification/run/${runId}/promote`,
            payload: { twoFactorToken: "123456" }
        });
        expect(blockedResponse.statusCode).toBe(409);

        (qualificationAdminService as unknown as { promoteRun: ReturnType<typeof vi.fn> }).promoteRun.mockRejectedValueOnce(
            new QualificationEvidenceInsufficientError("missing signals")
        );
        const insufficientResponse = await app.inject({
            method: "POST",
            url: `/admin/qualification/run/${runId}/promote`,
            payload: { twoFactorToken: "123456" }
        });
        expect(insufficientResponse.statusCode).toBe(409);

        await app.close();
    });

    it("demotes and pauses with ADMIN+2FA and maps invalid transitions", async () => {
        const passThroughAdmin: preHandlerHookHandler = async (request) => {
            (request as unknown as { user?: { email: string } }).user = { email: "ops-admin@example.com" };
        };
        const { app, qualificationAdminService } = await buildApp(passThroughAdmin);

        const demoteResponse = await app.inject({
            method: "POST",
            url: `/admin/qualification/run/${runId}/demote`,
            payload: { twoFactorToken: "123456", targetStage: "INTERNAL_ONLY", reason: "manual demotion" }
        });
        expect(demoteResponse.statusCode).toBe(200);

        const pauseResponse = await app.inject({
            method: "POST",
            url: `/admin/qualification/run/${runId}/pause`,
            payload: { twoFactorToken: "123456", reason: "operator pause" }
        });
        expect(pauseResponse.statusCode).toBe(200);

        (qualificationAdminService as unknown as { demoteRun: ReturnType<typeof vi.fn> }).demoteRun.mockRejectedValueOnce(
            new QualificationRunAdminTransitionError("bad transition")
        );
        const invalidDemote = await app.inject({
            method: "POST",
            url: `/admin/qualification/run/${runId}/demote`,
            payload: { twoFactorToken: "123456", targetStage: "CANARY", reason: "bad" }
        });
        expect(invalidDemote.statusCode).toBe(409);

        await app.close();
    });
});
