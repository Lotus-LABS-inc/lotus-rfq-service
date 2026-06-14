import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import { ExecutionStateMachine } from "../../execution/execution-state-machine.js";
import { ExecutionControlRepository } from "../../repositories/execution-control.repository.js";
import { ExecutionIntentRepository } from "../../repositories/execution-intent.repository.js";
import { ExecutionRecordRepository } from "../../repositories/execution-record.repository.js";

const recordParamsSchema = z.object({
    recordId: z.string().uuid()
});

const intentParamsSchema = z.object({
    id: z.string().uuid()
});

const keyParamsSchema = z.object({
    key: z.string().min(1)
});

const twoFactorTokenSchema = z.string().min(6, "twoFactorToken is required for ADMIN+2FA operations");

const mutationBodySchema = z.object({
    twoFactorToken: twoFactorTokenSchema,
    reason: z.string().min(1).optional()
});

const validateTwoFactorToken = (token: string): boolean => {
    const configuredToken = process.env.ADMIN_2FA_TOKEN;
    if (typeof configuredToken === "string" && configuredToken.length > 0) {
        return token === configuredToken;
    }
    return false;
};

export interface AdminExecutionControlRouteDeps {
    executionIntentRepository: ExecutionIntentRepository;
    executionRecordRepository: ExecutionRecordRepository;
    executionControlRepository: ExecutionControlRepository;
}

export const registerAdminExecutionControlRoutes = async (
    app: FastifyInstance,
    adminMiddleware: preHandlerHookHandler,
    deps: AdminExecutionControlRouteDeps
): Promise<void> => {
    app.get("/admin/execution-control/intents", { preHandler: adminMiddleware }, async (_request, reply) => {
        try {
            const intents = await deps.executionIntentRepository.list(100);
            return reply.send({ intents });
        } catch (error) {
            app.log.error({ err: error }, "Failed to list execution intents.");
            return reply.status(500).send({ code: "EXECUTION_CONTROL_ERROR", message: "Failed to list execution intents." });
        }
    });

    app.get("/admin/execution-control/intent/:id", { preHandler: adminMiddleware }, async (request, reply) => {
        const parsedParams = intentParamsSchema.safeParse(request.params);
        if (!parsedParams.success) {
            return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedParams.error.flatten() });
        }

        const intent = await deps.executionIntentRepository.findById(parsedParams.data.id);
        if (!intent) {
            return reply.status(404).send({ code: "INTENT_NOT_FOUND", message: "Execution intent not found." });
        }
        return reply.send({ intent });
    });

    app.get("/admin/execution-control/records", { preHandler: adminMiddleware }, async (_request, reply) => {
        try {
            const records = await deps.executionRecordRepository.list(100);
            return reply.send({ records });
        } catch (error) {
            app.log.error({ err: error }, "Failed to list execution records.");
            return reply.status(500).send({ code: "EXECUTION_CONTROL_ERROR", message: "Failed to list execution records." });
        }
    });

    app.get("/admin/execution-control/record/:id", { preHandler: adminMiddleware }, async (request, reply) => {
        const parsedParams = intentParamsSchema.safeParse(request.params);
        if (!parsedParams.success) {
            return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedParams.error.flatten() });
        }

        const record = await deps.executionRecordRepository.findById(parsedParams.data.id);
        if (!record) {
            return reply.status(404).send({ code: "RECORD_NOT_FOUND", message: "Execution record not found." });
        }
        const audit = await deps.executionControlRepository.listControlAuditByRecord(record.id);
        return reply.send({ record, audit });
    });

    app.get("/admin/execution-control/idempotency/:key", { preHandler: adminMiddleware }, async (request, reply) => {
        const parsedParams = keyParamsSchema.safeParse(request.params);
        if (!parsedParams.success) {
            return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedParams.error.flatten() });
        }

        const key = await deps.executionControlRepository.findIdempotencyKey(parsedParams.data.key);
        if (!key) {
            return reply.status(404).send({ code: "IDEMPOTENCY_KEY_NOT_FOUND", message: "Idempotency key not found." });
        }
        const replayProtection = await deps.executionControlRepository.listReplayProtectionByIdempotencyKey(parsedParams.data.key);
        return reply.send({ key, replayProtection });
    });

    app.post("/admin/execution-control/reconcile/:recordId", { preHandler: adminMiddleware }, async (request, reply) => {
        return mutateExecutionRecord(app, request, reply, deps, "RECONCILING", "EXECUTION_CONTROL_RECONCILE_REQUESTED");
    });

    app.post("/admin/execution-control/mark-failed/:recordId", { preHandler: adminMiddleware }, async (request, reply) => {
        return mutateExecutionRecord(app, request, reply, deps, "FAILED", "EXECUTION_CONTROL_MARK_FAILED");
    });

    app.post("/admin/execution-control/retry-safe/:recordId", { preHandler: adminMiddleware }, async (request, reply) => {
        const parsedParams = recordParamsSchema.safeParse(request.params);
        const parsedBody = mutationBodySchema.safeParse(request.body);
        if (!parsedParams.success || !parsedBody.success) {
            return reply.status(400).send({
                code: "INVALID_REQUEST",
                details: parsedParams.success ? parsedBody.error?.flatten() : parsedParams.error.flatten()
            });
        }
        if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
            return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
        }

        const record = await deps.executionRecordRepository.findById(parsedParams.data.recordId);
        if (!record) {
            return reply.status(404).send({ code: "RECORD_NOT_FOUND", message: "Execution record not found." });
        }

        await deps.executionControlRepository.createAuditRecord({
            executionIntentId: record.executionIntentId,
            executionRecordId: record.id,
            idempotencyKey: record.providerExecutionKey ?? null,
            eventType: "EXECUTION_CONTROL_RETRY_SAFE_REQUESTED",
            actorIdentity: request.user.userId,
            payload: {
                ...(parsedBody.data.reason ? { reason: parsedBody.data.reason } : {})
            }
        });

        await deps.executionControlRepository.createReplayProtectionRecord({
            executionIntentId: record.executionIntentId,
            executionRecordId: record.id,
            idempotencyKey: record.providerExecutionKey ?? `record:${record.id}`,
            providerExecutionKey: record.providerExecutionKey,
            protectionStatus: "CLEAR",
            payload: {
                requestedBy: request.user.userId,
                ...(parsedBody.data.reason ? { reason: parsedBody.data.reason } : {})
            }
        });

        return reply.send({ recordId: record.id, status: "RETRY_SAFE_RECORDED" });
    });
};

const mutateExecutionRecord = async (
    app: FastifyInstance,
    request: FastifyRequest,
    reply: FastifyReply,
    deps: AdminExecutionControlRouteDeps,
    nextState: "RECONCILING" | "FAILED",
    eventType: string
) => {
    const parsedParams = recordParamsSchema.safeParse(request.params);
    const parsedBody = mutationBodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
        return reply.status(400).send({
            code: "INVALID_REQUEST",
            details: parsedParams.success ? parsedBody.error?.flatten() : parsedParams.error.flatten()
        });
    }
    if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
        return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
    }

    const record = await deps.executionRecordRepository.findById(parsedParams.data.recordId);
    if (!record) {
        return reply.status(404).send({ code: "RECORD_NOT_FOUND", message: "Execution record not found." });
    }

    try {
        const stateMachine = new ExecutionStateMachine({ initialState: record.executionState });
        const fromState = stateMachine.getState();
        stateMachine.transitionTo(nextState, {
            reason: parsedBody.data.reason ?? eventType.toLowerCase()
        });

        const updated = await deps.executionRecordRepository.create({
            executionIntentId: record.executionIntentId,
            venue: record.venue,
            venueExecutionRef: record.venueExecutionRef,
            executionState: nextState,
            syncStatus: nextState === "RECONCILING" ? "reconciling" : record.syncStatus,
            settlementStatus: record.settlementStatus,
            fillDetails: record.fillDetails,
            retryLineage: record.retryLineage,
            providerExecutionKey: record.providerExecutionKey,
            replayEnvelopeId: record.replayEnvelopeId,
            metadata: record.metadata
        });
        await deps.executionRecordRepository.appendStateTransition(
            updated.id,
            fromState,
            nextState,
            {
                reason: parsedBody.data.reason ?? eventType.toLowerCase(),
                actorIdentity: request.user.userId
            },
            updated.replayEnvelopeId
        );
        await deps.executionControlRepository.createAuditRecord({
            executionIntentId: updated.executionIntentId,
            executionRecordId: updated.id,
            idempotencyKey: updated.providerExecutionKey ?? null,
            eventType,
            actorIdentity: request.user.userId,
            payload: {
                fromState,
                toState: nextState,
                ...(parsedBody.data.reason ? { reason: parsedBody.data.reason } : {})
            }
        });

        return reply.send({ record: updated });
    } catch (error) {
        app.log.error({ err: error, recordId: record.id, nextState }, "Failed to mutate execution control record.");
        return reply.status(409).send({ code: "INVALID_STATE_TRANSITION", message: "Invalid execution state transition." });
    }
};
