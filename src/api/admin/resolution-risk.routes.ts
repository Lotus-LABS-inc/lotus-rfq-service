import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";

import {
    ResolutionRiskAdminProfileNotFoundError,
    ResolutionRiskAdminService,
    ResolutionRiskKillSwitchActiveError,
} from "./resolution-risk-admin-service.js";

const canonicalParamsSchema = z.object({
    eventId: z.string().uuid(),
});

const profileParamsSchema = z.object({
    profileId: z.string().uuid(),
});

const recomputeBodySchema = z.object({
    twoFactorToken: z.string().min(6, "twoFactorToken is required for ADMIN+2FA operations"),
});

export interface AdminResolutionRiskRouteDeps {
    resolutionRiskAdminService: ResolutionRiskAdminService;
}

export const registerAdminResolutionRiskRoutes = async (
    app: FastifyInstance,
    adminMiddleware: preHandlerHookHandler,
    deps: AdminResolutionRiskRouteDeps,
): Promise<void> => {
    app.get("/admin/resolution-risk/canonical/:eventId", { preHandler: adminMiddleware }, async (request, reply) => {
        const parsedParams = canonicalParamsSchema.safeParse(request.params);
        if (!parsedParams.success) {
            return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedParams.error.flatten() });
        }

        try {
            const inspection = await deps.resolutionRiskAdminService.getCanonicalInspection(parsedParams.data.eventId);
            return reply.send(inspection);
        } catch (error) {
            app.log.error({ err: error, canonicalEventId: parsedParams.data.eventId }, "Failed to inspect resolution risk canonical event.");
            return reply.status(500).send({
                code: "RESOLUTION_RISK_ADMIN_ERROR",
                message: "Failed to inspect resolution risk canonical event.",
            });
        }
    });

    app.post("/admin/resolution-risk/recompute/:profileId", { preHandler: adminMiddleware }, async (request, reply) => {
        const parsedParams = profileParamsSchema.safeParse(request.params);
        if (!parsedParams.success) {
            return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedParams.error.flatten() });
        }

        const parsedBody = recomputeBodySchema.safeParse(request.body);
        if (!parsedBody.success) {
            return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedBody.error.flatten() });
        }

        try {
            const result = await deps.resolutionRiskAdminService.recomputeProfileAssessments({
                profileId: parsedParams.data.profileId,
                requestedBy: request.user.userId,
            });
            return reply.send(result);
        } catch (error) {
            if (error instanceof ResolutionRiskAdminProfileNotFoundError) {
                return reply.status(404).send({ code: "PROFILE_NOT_FOUND", message: error.message });
            }
            if (error instanceof ResolutionRiskKillSwitchActiveError) {
                return reply.status(409).send({ code: "KILL_SWITCH_ACTIVE", message: error.message });
            }
            app.log.error({ err: error, profileId: parsedParams.data.profileId }, "Failed to recompute resolution risk assessments for profile.");
            return reply.status(500).send({
                code: "RESOLUTION_RISK_ADMIN_ERROR",
                message: "Failed to recompute resolution risk assessments for profile.",
            });
        }
    });

    app.post("/admin/resolution-risk/recompute/canonical/:eventId", { preHandler: adminMiddleware }, async (request, reply) => {
        const parsedParams = canonicalParamsSchema.safeParse(request.params);
        if (!parsedParams.success) {
            return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedParams.error.flatten() });
        }

        const parsedBody = recomputeBodySchema.safeParse(request.body);
        if (!parsedBody.success) {
            return reply.status(400).send({ code: "INVALID_REQUEST", details: parsedBody.error.flatten() });
        }

        try {
            const result = await deps.resolutionRiskAdminService.recomputeCanonicalAssessments({
                canonicalEventId: parsedParams.data.eventId,
                requestedBy: request.user.userId,
            });
            return reply.send(result);
        } catch (error) {
            if (error instanceof ResolutionRiskKillSwitchActiveError) {
                return reply.status(409).send({ code: "KILL_SWITCH_ACTIVE", message: error.message });
            }
            app.log.error({ err: error, canonicalEventId: parsedParams.data.eventId }, "Failed to recompute resolution risk assessments for canonical event.");
            return reply.status(500).send({
                code: "RESOLUTION_RISK_ADMIN_ERROR",
                message: "Failed to recompute resolution risk assessments for canonical event.",
            });
        }
    });
};
