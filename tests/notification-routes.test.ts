import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerNotificationRoutes } from "../src/api/routes/notifications.js";

describe("notification routes", () => {
  it("lists and marks authenticated user's notifications", async () => {
    const app = Fastify();
    const repository = {
      listNotifications: vi.fn(async () => ({
        items: [{
          notificationId: "notice-1",
          userId: "user-1",
          type: "EXECUTION_FILLED",
          title: "Execution filled",
          body: "Your execution filled.",
          severity: "success" as const,
          targetKind: "execution",
          targetId: "exec-1",
          payload: {},
          readAt: null,
          createdAt: "2026-05-09T00:00:00.000Z"
        }],
        nextCursor: null
      })),
      markRead: vi.fn(async () => ({
        notificationId: "notice-1",
        userId: "user-1",
        type: "EXECUTION_FILLED",
        title: "Execution filled",
        body: "Your execution filled.",
        severity: "success" as const,
        targetKind: "execution",
        targetId: "exec-1",
        payload: {},
        readAt: "2026-05-09T00:01:00.000Z",
        createdAt: "2026-05-09T00:00:00.000Z"
      })),
      markAllRead: vi.fn(async () => 3),
      createNotification: vi.fn()
    };

    await registerNotificationRoutes(app, async (request) => {
      request.user = { userId: "user-1", email: "user@example.com", role: "USER" };
    }, repository);

    const list = await app.inject({ method: "GET", url: "/notifications?limit=10" });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      items: [{ notificationId: "notice-1", userId: "user-1" }],
      nextCursor: null
    });
    expect(repository.listNotifications).toHaveBeenCalledWith({ userId: "user-1", limit: 10 });

    const read = await app.inject({ method: "POST", url: "/notifications/notice-1/read" });
    expect(read.statusCode).toBe(200);
    expect(repository.markRead).toHaveBeenCalledWith({ userId: "user-1", notificationId: "notice-1" });

    const all = await app.inject({ method: "POST", url: "/notifications/read-all" });
    expect(all.statusCode).toBe(200);
    expect(all.json()).toEqual({ updatedCount: 3 });
    expect(repository.markAllRead).toHaveBeenCalledWith({ userId: "user-1" });
  });
});
