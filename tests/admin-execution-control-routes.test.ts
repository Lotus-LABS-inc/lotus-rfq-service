import Fastify, { type preHandlerHookHandler } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerAdminExecutionControlRoutes } from "../src/api/admin/execution-control.routes.js";

describe("Admin Execution Control Routes", () => {
    const originalAdmin2faToken = process.env.ADMIN_2FA_TOKEN;
    const validRecordId = "11111111-1111-4111-8111-111111111111";

    afterEach(() => {
        if (originalAdmin2faToken === undefined) {
            delete process.env.ADMIN_2FA_TOKEN;
        } else {
            process.env.ADMIN_2FA_TOKEN = originalAdmin2faToken;
        }
    });

    const buildApp = async (adminMiddleware: preHandlerHookHandler) => {
        const app = Fastify({ logger: false });
        const executionIntentRepository = {
            list: vi.fn(async () => [{ id: "intent-1" }]),
            findById: vi.fn(async () => ({ id: "intent-1" }))
        } as any;
        const executionRecordRepository = {
            list: vi.fn(async () => [{ id: "record-1", executionIntentId: "intent-1", executionState: "FAILED" }]),
            findById: vi.fn(async () => ({
                id: "record-1",
                executionIntentId: "intent-1",
                venue: "LP",
                venueExecutionRef: null,
                executionState: "FAILED",
                syncStatus: "pending",
                settlementStatus: "pending",
                fillDetails: {},
                retryLineage: [],
                providerExecutionKey: "provider-key",
                replayEnvelopeId: null,
                metadata: {}
            })),
            create: vi.fn(async (input) => ({
                id: "record-1",
                ...input
            })),
            appendStateTransition: vi.fn(async () => undefined)
        } as any;
        const executionControlRepository = {
            listControlAuditByRecord: vi.fn(async () => []),
            findIdempotencyKey: vi.fn(async () => ({ id: "key-row", idempotencyKey: "provider-key" })),
            listReplayProtectionByIdempotencyKey: vi.fn(async () => []),
            createAuditRecord: vi.fn(async () => "audit-1"),
            createReplayProtectionRecord: vi.fn(async () => "replay-1")
        } as any;

        await registerAdminExecutionControlRoutes(app, adminMiddleware, {
            executionIntentRepository,
            executionRecordRepository,
            executionControlRepository
        });

        return { app, executionRecordRepository, executionControlRepository };
    };

    it("lists intents behind admin auth", async () => {
        const passThrough: preHandlerHookHandler = async (request) => {
            (request as typeof request & { user: { userId: string; role: string } }).user = {
                userId: "admin-user",
                role: "ADMIN"
            };
        };
        const { app } = await buildApp(passThrough);

        const response = await app.inject({
            method: "GET",
            url: "/admin/execution-control/intents"
        });

        expect(response.statusCode).toBe(200);
        await app.close();
    });

    it("rejects mutation routes when 2FA does not match", async () => {
        process.env.ADMIN_2FA_TOKEN = "654321";
        const passThrough: preHandlerHookHandler = async (request) => {
            (request as typeof request & { user: { userId: string; role: string } }).user = {
                userId: "admin-user",
                role: "ADMIN"
            };
        };
        const { app, executionRecordRepository } = await buildApp(passThrough);

        const response = await app.inject({
            method: "POST",
            url: `/admin/execution-control/mark-failed/${validRecordId}`,
            payload: {
                twoFactorToken: "123456",
                reason: "manual block"
            }
        });

        expect(response.statusCode).toBe(403);
        expect(executionRecordRepository.create).not.toHaveBeenCalled();
        await app.close();
    });

    it("allows reconcile mutations with ADMIN + 2FA", async () => {
        process.env.ADMIN_2FA_TOKEN = "123456";
        const passThrough: preHandlerHookHandler = async (request) => {
            (request as typeof request & { user: { userId: string; role: string } }).user = {
                userId: "admin-user",
                role: "ADMIN"
            };
        };
        const { app, executionControlRepository } = await buildApp(passThrough);

        const response = await app.inject({
            method: "POST",
            url: `/admin/execution-control/reconcile/${validRecordId}`,
            payload: {
                twoFactorToken: "123456",
                reason: "manual reconcile"
            }
        });

        expect(response.statusCode).toBe(200);
        expect(executionControlRepository.createAuditRecord).toHaveBeenCalled();
        await app.close();
    });
});
