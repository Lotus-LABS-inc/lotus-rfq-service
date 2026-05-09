import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { NotificationRepository } from "../../repositories/notification.repository.js";

const notificationListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().datetime().optional()
});

export const registerNotificationRoutes = async (
  app: FastifyInstance,
  authMiddleware: preHandlerHookHandler,
  notificationRepository: NotificationRepository
): Promise<void> => {
  app.get("/notifications", { preHandler: authMiddleware }, async (request, reply) => {
    const parsed = notificationListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Notification list query validation failed.",
        details: parsed.error.flatten()
      });
    }
    const result = await notificationRepository.listNotifications({
      userId: request.user.userId,
      limit: parsed.data.limit ?? 50,
      ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {})
    });
    return reply.send({
      generatedAt: new Date().toISOString(),
      ...result
    });
  });

  app.post("/notifications/read-all", { preHandler: authMiddleware }, async (request, reply) => {
    const updatedCount = await notificationRepository.markAllRead({
      userId: request.user.userId
    });
    return reply.send({ updatedCount });
  });

  app.post("/notifications/:id/read", { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const notification = await notificationRepository.markRead({
      userId: request.user.userId,
      notificationId: id
    });
    if (!notification) {
      return reply.status(404).send({
        code: "NOTIFICATION_NOT_FOUND",
        message: "Notification was not found."
      });
    }
    return reply.send({ notification });
  });
};
