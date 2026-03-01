import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { RiskEngine } from "../../core/risk-engine.js";
import type { IExposureRepository } from "../../repositories/exposure.repository.js";
import type { ExposureRedisCache } from "../../repositories/exposure-redis-cache.js";
import { adminRiskActionsTotal } from "../../observability/metrics.js";

const adjustExposureSchema = z.object({
    userId: z.string().uuid(),
    marketId: z.string().uuid(),
    side: z.enum(["buy", "sell"]),
    delta: z.number(),
    reason: z.string().min(1)
});

const clearReservationSchema = z.object({
    reservationId: z.string().min(1)
});

export const registerAdminRiskRoutes = async (
    app: FastifyInstance,
    adminMiddleware: preHandlerHookHandler,
    deps: {
        riskEngine: RiskEngine;
        exposureRepo: IExposureRepository;
        exposureCache: ExposureRedisCache;
    }
) => {
    app.get("/admin/risk/exposure", { preHandler: adminMiddleware }, async (request, reply) => {
        const query = request.query as { userId?: string; marketId?: string; side?: string };

        if (!query.userId || !query.marketId || !query.side) {
            return reply.status(400).send({ error: "userId, marketId, and side are required" });
        }

        const userId = query.userId;
        const marketId = query.marketId;
        const side = query.side as "buy" | "sell";

        try {
            const pgExposure = await deps.exposureRepo.getExposure(userId, marketId, side);
            const redisExposure = await deps.exposureCache.getRollingExposure(userId, marketId);

            return {
                userId,
                marketId,
                side,
                postgres: pgExposure ? {
                    gross: pgExposure.gross_notional,
                    net: pgExposure.net_notional,
                    lastUpdated: pgExposure.last_updated
                } : null,
                redisRolling: redisExposure
            };
        } catch (error) {
            app.log.error({ err: error, userId, marketId, side }, "Failed to fetch exposure for admin.");
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    app.post("/admin/risk/adjust", { preHandler: adminMiddleware }, async (request, reply) => {
        const parsed = adjustExposureSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send(parsed.error.flatten());
        }

        const { userId, marketId, side, delta, reason } = parsed.data;

        try {
            await deps.exposureRepo.updateExposureWithJournal(
                userId,
                marketId,
                side,
                Math.abs(delta),
                delta,
                "admin-adjust",
                `admin-${Date.now()}`,
                { reason, adminId: (request.user as any).userId }
            );

            adminRiskActionsTotal.inc({ action: "adjust_exposure" });
            app.log.info({ userId, marketId, side, delta, reason }, "Admin manually adjusted risk exposure.");

            return { ok: true };
        } catch (error) {
            app.log.error({ err: error, userId, marketId, side }, "Failed to adjust exposure by admin.");
            return reply.status(500).send({ error: "Internal server error" });
        }
    });

    app.post("/admin/risk/clear-reservation", { preHandler: adminMiddleware }, async (request, reply) => {
        const parsed = clearReservationSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send(parsed.error.flatten());
        }

        const { reservationId } = parsed.data;
        const lockKey = `risk:lock:exec:${reservationId}`;

        try {
            await deps.exposureCache.forceUnlock(lockKey);

            adminRiskActionsTotal.inc({ action: "clear_reservation" });
            app.log.info({ reservationId }, "Admin cleared risk reservation lock.");

            return { ok: true };
        } catch (error) {
            app.log.error({ err: error, reservationId }, "Failed to clear reservation lock by admin.");
            return reply.status(500).send({ error: "Internal server error" });
        }
    });
};
