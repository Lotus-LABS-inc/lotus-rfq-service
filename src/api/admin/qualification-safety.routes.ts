import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import {
    QualificationSafetyActionNotFoundError,
    QualificationSafetyActionResolveError,
    QualificationSafetyAdminService
} from "./qualification-safety-admin-service.js";
import { AutoSafetyActionType, type AutoSafetyAction } from "../../core/qualification/qualification.types.js";

const actionParamsSchema = z.object({
    id: z.string().uuid()
});

const actionFiltersSchema = z.object({
    strategyKey: z.string().min(1).optional(),
    scopeType: z.string().min(1).optional(),
    scopeId: z.string().min(1).optional(),
    actionType: z.nativeEnum(AutoSafetyActionType).optional(),
    resolved: z.coerce.boolean().optional()
});

const resolveBodySchema = z.object({
    twoFactorToken: z.string().min(6, "twoFactorToken is required for ADMIN+2FA operations"),
    resolutionReason: z.string().min(1)
});

const isoDateSchema = z.string().datetime({ offset: true });

const actionResponseSchema = z.object({
    id: z.string().uuid(),
    strategyKey: z.string(),
    scopeType: z.string(),
    scopeId: z.string(),
    actionType: z.nativeEnum(AutoSafetyActionType),
    triggerReason: z.string(),
    createdAt: isoDateSchema,
    resolvedAt: isoDateSchema.nullable(),
    metadata: z.record(z.string(), z.unknown())
});

export interface AdminQualificationSafetyRouteDeps {
    qualificationSafetyAdminService: QualificationSafetyAdminService;
}

export const registerAdminQualificationSafetyRoutes = async (
    app: FastifyInstance,
    adminMiddleware: preHandlerHookHandler,
    deps: AdminQualificationSafetyRouteDeps
): Promise<void> => {
    app.get("/admin/qualification/safety-actions", { preHandler: adminMiddleware }, async (request, reply) => {
        const parsedQuery = actionFiltersSchema.safeParse(request.query);
        if (!parsedQuery.success) {
            return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedQuery.error.flatten() });
        }

        try {
            const actions = await deps.qualificationSafetyAdminService.listActions({
                ...(parsedQuery.data.strategyKey ? { strategyKey: parsedQuery.data.strategyKey } : {}),
                ...(parsedQuery.data.scopeType ? { scopeType: parsedQuery.data.scopeType } : {}),
                ...(parsedQuery.data.scopeId ? { scopeId: parsedQuery.data.scopeId } : {}),
                ...(parsedQuery.data.actionType ? { actionType: parsedQuery.data.actionType } : {}),
                ...(parsedQuery.data.resolved !== undefined ? { resolved: parsedQuery.data.resolved } : {})
            });
            return reply.send({
                actions: z.array(actionResponseSchema).parse(actions.map(serializeAction))
            });
        } catch (error) {
            app.log.error({ err: error, filters: parsedQuery.data }, "Failed to list qualification safety actions.");
            return reply.status(500).send({
                code: "QUALIFICATION_SAFETY_ADMIN_ERROR",
                message: "Failed to list qualification safety actions."
            });
        }
    });

    app.get("/admin/qualification/safety-action/:id", { preHandler: adminMiddleware }, async (request, reply) => {
        const parsedParams = actionParamsSchema.safeParse(request.params);
        if (!parsedParams.success) {
            return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedParams.error.flatten() });
        }

        try {
            const action = await deps.qualificationSafetyAdminService.getAction(parsedParams.data.id);
            return reply.send({
                action: actionResponseSchema.parse(serializeAction(action))
            });
        } catch (error) {
            if (error instanceof QualificationSafetyActionNotFoundError) {
                return reply.status(404).send({ code: "QUALIFICATION_SAFETY_ACTION_NOT_FOUND", message: error.message });
            }
            app.log.error({ err: error, actionId: parsedParams.data.id }, "Failed to load qualification safety action.");
            return reply.status(500).send({
                code: "QUALIFICATION_SAFETY_ADMIN_ERROR",
                message: "Failed to load qualification safety action."
            });
        }
    });

    app.post("/admin/qualification/safety-action/:id/resolve", { preHandler: adminMiddleware }, async (request, reply) => {
        const parsedParams = actionParamsSchema.safeParse(request.params);
        const parsedBody = resolveBodySchema.safeParse(request.body);
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
            const result = await deps.qualificationSafetyAdminService.resolveAction(
                parsedParams.data.id,
                parsedBody.data.resolutionReason,
                readRequestedBy(request)
            );
            return reply.send({
                action: actionResponseSchema.parse(serializeAction(result.action)),
                controlPlaneNote: result.controlPlaneNote
            });
        } catch (error) {
            if (error instanceof QualificationSafetyActionNotFoundError) {
                return reply.status(404).send({ code: "QUALIFICATION_SAFETY_ACTION_NOT_FOUND", message: error.message });
            }
            if (error instanceof QualificationSafetyActionResolveError) {
                return reply.status(409).send({ code: "INVALID_SAFETY_ACTION_TRANSITION", message: error.message });
            }
            app.log.error({ err: error, actionId: parsedParams.data.id }, "Failed to resolve qualification safety action.");
            return reply.status(500).send({
                code: "QUALIFICATION_SAFETY_ADMIN_ERROR",
                message: "Failed to resolve qualification safety action."
            });
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

const serializeAction = (action: AutoSafetyAction) => ({
    ...action,
    createdAt: action.createdAt.toISOString(),
    resolvedAt: action.resolvedAt ? action.resolvedAt.toISOString() : null
});
