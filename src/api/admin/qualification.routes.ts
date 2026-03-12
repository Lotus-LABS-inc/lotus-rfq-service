import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import {
    QualificationAdminService,
    QualificationEvidenceInsufficientError,
    QualificationPromotionGateBlockedError,
    QualificationRunAdminTransitionError,
    QualificationRunNotFoundAdminError,
    type QualificationRunDetail
} from "./qualification-admin-service.js";
import { QualificationRunStatus, QualificationStage, type PromotionEvent, type StrategyDecisionEvaluation, type StrategyQualificationRun } from "../../core/qualification/qualification.types.js";

const runParamsSchema = z.object({
    id: z.string().uuid()
});

const runFiltersSchema = z.object({
    stage: z.nativeEnum(QualificationStage).optional(),
    status: z.nativeEnum(QualificationRunStatus).optional(),
    scopeType: z.string().min(1).optional(),
    scopeId: z.string().min(1).optional()
});

const twoFactorTokenSchema = z.string().min(6, "twoFactorToken is required for ADMIN+2FA operations");

const promoteBodySchema = z.object({
    twoFactorToken: twoFactorTokenSchema
});

const demoteBodySchema = z.object({
    twoFactorToken: twoFactorTokenSchema,
    targetStage: z.nativeEnum(QualificationStage),
    reason: z.string().min(1)
});

const pauseBodySchema = z.object({
    twoFactorToken: twoFactorTokenSchema,
    reason: z.string().min(1).optional()
});

const isoDateSchema = z.string().datetime({ offset: true });

const qualificationRunResponseSchema = z.object({
    id: z.string().uuid(),
    strategyKey: z.string(),
    scopeType: z.string(),
    scopeId: z.string(),
    stage: z.nativeEnum(QualificationStage),
    engineVersion: z.string(),
    configVersion: z.string(),
    startedAt: isoDateSchema,
    endedAt: isoDateSchema.nullable(),
    status: z.nativeEnum(QualificationRunStatus),
    metadata: z.record(z.string(), z.unknown())
});

const metricAggregateSchema = z.object({
    count: z.number().int(),
    numericTotals: z.record(z.string(), z.string())
});

const runDetailResponseSchema = z.object({
    run: qualificationRunResponseSchema,
    summary: z.object({
        evaluationCount: z.number().int(),
        countsByDecisionType: z.record(z.string(), z.number().int()),
        realized: metricAggregateSchema,
        counterfactual: metricAggregateSchema,
        improvement: metricAggregateSchema
    })
});

const evaluationResponseSchema = z.object({
    id: z.string().uuid(),
    qualificationRunId: z.string().uuid(),
    decisionType: z.string(),
    entityId: z.string(),
    replayEnvelopeId: z.string().uuid().nullable(),
    realizedMetrics: z.record(z.string(), z.unknown()),
    counterfactualMetrics: z.record(z.string(), z.unknown()),
    improvementMetrics: z.record(z.string(), z.unknown()),
    createdAt: isoDateSchema
});

const promotionEventResponseSchema = z.object({
    id: z.string().uuid(),
    strategyKey: z.string(),
    scopeType: z.string(),
    scopeId: z.string(),
    fromStage: z.nativeEnum(QualificationStage),
    toStage: z.nativeEnum(QualificationStage),
    reason: z.string(),
    createdBy: z.string(),
    createdAt: isoDateSchema,
    metadata: z.record(z.string(), z.unknown())
});

export interface AdminQualificationRouteDeps {
    qualificationAdminService: QualificationAdminService;
}

export const registerAdminQualificationRoutes = async (
    app: FastifyInstance,
    adminMiddleware: preHandlerHookHandler,
    deps: AdminQualificationRouteDeps
): Promise<void> => {
    app.get("/admin/qualification/runs", { preHandler: adminMiddleware }, async (request, reply) => {
        const parsedQuery = runFiltersSchema.safeParse(request.query);
        if (!parsedQuery.success) {
            return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedQuery.error.flatten() });
        }

        try {
            const runs = await deps.qualificationAdminService.listRuns({
                ...(parsedQuery.data.stage ? { stage: parsedQuery.data.stage } : {}),
                ...(parsedQuery.data.status ? { status: parsedQuery.data.status } : {}),
                ...(parsedQuery.data.scopeType ? { scopeType: parsedQuery.data.scopeType } : {}),
                ...(parsedQuery.data.scopeId ? { scopeId: parsedQuery.data.scopeId } : {})
            });
            return reply.send({
                runs: z.array(qualificationRunResponseSchema).parse(runs.map(serializeRun))
            });
        } catch (error) {
            app.log.error({ err: error, filters: parsedQuery.data }, "Failed to list qualification runs.");
            return reply.status(500).send({ code: "QUALIFICATION_ADMIN_ERROR", message: "Failed to list qualification runs." });
        }
    });

    app.get("/admin/qualification/run/:id", { preHandler: adminMiddleware }, async (request, reply) => {
        const parsedParams = runParamsSchema.safeParse(request.params);
        if (!parsedParams.success) {
            return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedParams.error.flatten() });
        }

        try {
            const detail = await deps.qualificationAdminService.getRunDetail(parsedParams.data.id);
            return reply.send(runDetailResponseSchema.parse(serializeRunDetail(detail)));
        } catch (error) {
            if (error instanceof QualificationRunNotFoundAdminError) {
                return reply.status(404).send({ code: "QUALIFICATION_RUN_NOT_FOUND", message: error.message });
            }
            app.log.error({ err: error, runId: parsedParams.data.id }, "Failed to load qualification run detail.");
            return reply.status(500).send({ code: "QUALIFICATION_ADMIN_ERROR", message: "Failed to load qualification run detail." });
        }
    });

    app.get("/admin/qualification/run/:id/evaluations", { preHandler: adminMiddleware }, async (request, reply) => {
        const parsedParams = runParamsSchema.safeParse(request.params);
        if (!parsedParams.success) {
            return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedParams.error.flatten() });
        }

        try {
            const evaluations = await deps.qualificationAdminService.listEvaluations(parsedParams.data.id);
            return reply.send({
                evaluations: z.array(evaluationResponseSchema).parse(evaluations.map(serializeEvaluation))
            });
        } catch (error) {
            if (error instanceof QualificationRunNotFoundAdminError) {
                return reply.status(404).send({ code: "QUALIFICATION_RUN_NOT_FOUND", message: error.message });
            }
            app.log.error({ err: error, runId: parsedParams.data.id }, "Failed to list qualification run evaluations.");
            return reply.status(500).send({ code: "QUALIFICATION_ADMIN_ERROR", message: "Failed to list qualification run evaluations." });
        }
    });

    app.post("/admin/qualification/run/:id/promote", { preHandler: adminMiddleware }, async (request, reply) => {
        const parsedParams = runParamsSchema.safeParse(request.params);
        const parsedBody = promoteBodySchema.safeParse(request.body);
        if (!parsedParams.success || !parsedBody.success) {
            return reply.status(400).send({
                code: "INVALID_REQUEST",
                details: {
                    params: parsedParams.success ? undefined : parsedParams.error.flatten(),
                    body: parsedBody.success ? undefined : parsedBody.error.flatten()
                }
            });
        }

        try {
            const result = await deps.qualificationAdminService.promoteRun(parsedParams.data.id, readRequestedBy(request));
            return reply.send({
                run: qualificationRunResponseSchema.parse(serializeRun(result.run)),
                gateResult: result.gateResult,
                promotionEvent: promotionEventResponseSchema.parse(serializePromotionEvent(result.promotionEvent))
            });
        } catch (error) {
            if (error instanceof QualificationRunNotFoundAdminError) {
                return reply.status(404).send({ code: "QUALIFICATION_RUN_NOT_FOUND", message: error.message });
            }
            if (error instanceof QualificationPromotionGateBlockedError) {
                return reply.status(409).send({ code: "PROMOTION_GATE_BLOCKED", gateResult: error.gateResult });
            }
            if (error instanceof QualificationEvidenceInsufficientError) {
                return reply.status(409).send({ code: "INSUFFICIENT_QUALIFICATION_EVIDENCE", message: error.message });
            }
            if (error instanceof QualificationRunAdminTransitionError) {
                return reply.status(409).send({ code: "INVALID_RUN_TRANSITION", message: error.message });
            }
            app.log.error({ err: error, runId: parsedParams.data.id }, "Failed to promote qualification run.");
            return reply.status(500).send({ code: "QUALIFICATION_ADMIN_ERROR", message: "Failed to promote qualification run." });
        }
    });

    app.post("/admin/qualification/run/:id/demote", { preHandler: adminMiddleware }, async (request, reply) => {
        const parsedParams = runParamsSchema.safeParse(request.params);
        const parsedBody = demoteBodySchema.safeParse(request.body);
        if (!parsedParams.success || !parsedBody.success) {
            return reply.status(400).send({
                code: "INVALID_REQUEST",
                details: {
                    params: parsedParams.success ? undefined : parsedParams.error.flatten(),
                    body: parsedBody.success ? undefined : parsedBody.error.flatten()
                }
            });
        }

        try {
            const result = await deps.qualificationAdminService.demoteRun(
                parsedParams.data.id,
                parsedBody.data.targetStage,
                parsedBody.data.reason,
                readRequestedBy(request)
            );
            return reply.send({
                run: qualificationRunResponseSchema.parse(serializeRun(result.run)),
                promotionEvent: promotionEventResponseSchema.parse(serializePromotionEvent(result.promotionEvent))
            });
        } catch (error) {
            if (error instanceof QualificationRunNotFoundAdminError) {
                return reply.status(404).send({ code: "QUALIFICATION_RUN_NOT_FOUND", message: error.message });
            }
            if (error instanceof QualificationRunAdminTransitionError) {
                return reply.status(409).send({ code: "INVALID_RUN_TRANSITION", message: error.message });
            }
            app.log.error({ err: error, runId: parsedParams.data.id }, "Failed to demote qualification run.");
            return reply.status(500).send({ code: "QUALIFICATION_ADMIN_ERROR", message: "Failed to demote qualification run." });
        }
    });

    app.post("/admin/qualification/run/:id/pause", { preHandler: adminMiddleware }, async (request, reply) => {
        const parsedParams = runParamsSchema.safeParse(request.params);
        const parsedBody = pauseBodySchema.safeParse(request.body);
        if (!parsedParams.success || !parsedBody.success) {
            return reply.status(400).send({
                code: "INVALID_REQUEST",
                details: {
                    params: parsedParams.success ? undefined : parsedParams.error.flatten(),
                    body: parsedBody.success ? undefined : parsedBody.error.flatten()
                }
            });
        }

        try {
            const result = await deps.qualificationAdminService.pauseRun(
                parsedParams.data.id,
                parsedBody.data.reason ?? null,
                readRequestedBy(request)
            );
            return reply.send({
                run: qualificationRunResponseSchema.parse(serializeRun(result.run))
            });
        } catch (error) {
            if (error instanceof QualificationRunNotFoundAdminError) {
                return reply.status(404).send({ code: "QUALIFICATION_RUN_NOT_FOUND", message: error.message });
            }
            if (error instanceof QualificationRunAdminTransitionError) {
                return reply.status(409).send({ code: "INVALID_RUN_TRANSITION", message: error.message });
            }
            app.log.error({ err: error, runId: parsedParams.data.id }, "Failed to pause qualification run.");
            return reply.status(500).send({ code: "QUALIFICATION_ADMIN_ERROR", message: "Failed to pause qualification run." });
        }
    });
};

const readRequestedBy = (request: { user?: unknown }): string => {
    const user = isRecord(request.user) ? request.user : null;
    const email = typeof user?.email === "string" ? user.email : null;
    const userId = typeof user?.userId === "string" ? user.userId : null;
    const id = typeof user?.id === "string" ? user.id : null;
    const sub = typeof user?.sub === "string" ? user.sub : null;
    return email ?? userId ?? id ?? sub ?? "admin";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

const serializeRun = (run: StrategyQualificationRun) => ({
    ...run,
    startedAt: run.startedAt.toISOString(),
    endedAt: run.endedAt ? run.endedAt.toISOString() : null
});

const serializeRunDetail = (detail: QualificationRunDetail) => ({
    run: serializeRun(detail.run),
    summary: detail.summary
});

const serializeEvaluation = (evaluation: StrategyDecisionEvaluation) => ({
    ...evaluation,
    createdAt: evaluation.createdAt.toISOString()
});

const serializePromotionEvent = (event: PromotionEvent) => ({
    ...event,
    createdAt: event.createdAt.toISOString()
});
