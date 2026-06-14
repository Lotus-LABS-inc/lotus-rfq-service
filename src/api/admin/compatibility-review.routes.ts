import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import { CompatibilityOverrideService, CompatibilityOverrideServiceError } from "../../canonical/compatibility-override-service.js";
import { compatibilityClassValues } from "../../canonical/canonicalization-types.js";

const decisionParamsSchema = z.object({
    id: z.string().min(1)
});

const overrideParamsSchema = z.object({
    decisionId: z.string().min(1)
});

const historyParamsSchema = z.object({
    overrideId: z.string().uuid()
});

const twoFactorTokenSchema = z.string().min(6, "twoFactorToken is required for ADMIN+2FA operations");

const createOverrideBodySchema = z.object({
    twoFactorToken: twoFactorTokenSchema,
    targetDecisionId: z.string().min(1),
    forcedCompatibilityClass: z.enum(compatibilityClassValues),
    reason: z.string().min(1),
    evidencePayload: z.record(z.string(), z.unknown()).optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
    overrideVersion: z.string().min(1)
});

const deactivateOverrideBodySchema = z.object({
    twoFactorToken: twoFactorTokenSchema,
    overrideId: z.string().uuid()
});

export interface AdminCompatibilityReviewRouteDeps {
    compatibilityOverrideService: CompatibilityOverrideService;
}

const validateTwoFactorToken = (token: string): boolean => {
    const configuredToken = process.env.ADMIN_2FA_TOKEN;
    if (typeof configuredToken === "string" && configuredToken.length > 0) {
        return token === configuredToken;
    }
    return false;
};

export const registerAdminCompatibilityReviewRoutes = async (
    app: FastifyInstance,
    adminMiddleware: preHandlerHookHandler,
    deps: AdminCompatibilityReviewRouteDeps
): Promise<void> => {
    app.get("/admin/compatibility-review/overrides", { preHandler: adminMiddleware }, async (_request, reply) => {
        try {
            const overrides = await deps.compatibilityOverrideService.listActiveOverrides();
            return reply.send({ overrides });
        } catch (error) {
            app.log.error({ err: error }, "Failed to list compatibility overrides.");
            return reply.status(500).send({
                code: "COMPATIBILITY_OVERRIDE_ERROR",
                message: "Failed to list compatibility overrides."
            });
        }
    });

    app.get("/admin/compatibility-review/decision/:id", { preHandler: adminMiddleware }, async (request, reply) => {
        const parsedParams = decisionParamsSchema.safeParse(request.params);
        if (!parsedParams.success) {
            return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedParams.error.flatten() });
        }

        try {
            const decision = await deps.compatibilityOverrideService.resolveEffectiveDecision(parsedParams.data.id);
            return reply.send(decision);
        } catch (error) {
            if (error instanceof CompatibilityOverrideServiceError) {
                return reply.status(404).send({ code: "DECISION_NOT_FOUND", message: error.message });
            }
            app.log.error({ err: error, decisionId: parsedParams.data.id }, "Failed to inspect compatibility decision.");
            return reply.status(500).send({
                code: "COMPATIBILITY_OVERRIDE_ERROR",
                message: "Failed to inspect compatibility decision."
            });
        }
    });

    app.get("/admin/compatibility-review/history/:overrideId", { preHandler: adminMiddleware }, async (request, reply) => {
        const parsedParams = historyParamsSchema.safeParse(request.params);
        if (!parsedParams.success) {
            return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedParams.error.flatten() });
        }

        try {
            const history = await deps.compatibilityOverrideService.listOverrideHistory(parsedParams.data.overrideId);
            return reply.send({ history });
        } catch (error) {
            app.log.error({ err: error, overrideId: parsedParams.data.overrideId }, "Failed to inspect compatibility override history.");
            return reply.status(500).send({
                code: "COMPATIBILITY_OVERRIDE_ERROR",
                message: "Failed to inspect compatibility override history."
            });
        }
    });

    app.post("/admin/compatibility-review/override", { preHandler: adminMiddleware }, async (request, reply) => {
        const parsedBody = createOverrideBodySchema.safeParse(request.body);
        if (!parsedBody.success) {
            return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedBody.error.flatten() });
        }
        if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
            return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
        }

        try {
            const override = await deps.compatibilityOverrideService.createOverride({
                targetDecisionId: parsedBody.data.targetDecisionId,
                forcedCompatibilityClass: parsedBody.data.forcedCompatibilityClass,
                reviewerIdentity: request.user.userId,
                reason: parsedBody.data.reason,
                overrideVersion: parsedBody.data.overrideVersion,
                ...(parsedBody.data.evidencePayload ? { evidencePayload: parsedBody.data.evidencePayload } : {}),
                ...(parsedBody.data.expiresAt ? { expiresAt: new Date(parsedBody.data.expiresAt) } : {})
            });
            return reply.send({ override });
        } catch (error) {
            if (error instanceof CompatibilityOverrideServiceError) {
                return reply.status(404).send({ code: "DECISION_NOT_FOUND", message: error.message });
            }
            app.log.error({ err: error }, "Failed to create compatibility override.");
            return reply.status(500).send({
                code: "COMPATIBILITY_OVERRIDE_ERROR",
                message: "Failed to create compatibility override."
            });
        }
    });

    app.post("/admin/compatibility-review/deactivate", { preHandler: adminMiddleware }, async (request, reply) => {
        const parsedBody = deactivateOverrideBodySchema.safeParse(request.body);
        if (!parsedBody.success) {
            return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedBody.error.flatten() });
        }
        if (!validateTwoFactorToken(parsedBody.data.twoFactorToken)) {
            return reply.status(403).send({ code: "FORBIDDEN", message: "ADMIN+2FA required." });
        }

        try {
            const override = await deps.compatibilityOverrideService.deactivateOverride(
                parsedBody.data.overrideId,
                request.user.userId
            );
            if (!override) {
                return reply.status(404).send({ code: "OVERRIDE_NOT_FOUND", message: "Compatibility override not found." });
            }
            return reply.send({ override });
        } catch (error) {
            app.log.error({ err: error, overrideId: parsedBody.data.overrideId }, "Failed to deactivate compatibility override.");
            return reply.status(500).send({
                code: "COMPATIBILITY_OVERRIDE_ERROR",
                message: "Failed to deactivate compatibility override."
            });
        }
    });
};
