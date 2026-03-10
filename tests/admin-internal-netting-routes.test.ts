import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerAdminInternalNettingRoutes } from "../src/api/admin/internal-netting.routes.js";
import {
  InternalNettingAmbiguityError,
  InternalNettingComboNotFoundError,
  InternalNettingGroupNotFoundError,
  type InternalNettingAdminService
} from "../src/api/admin/internal-netting-admin-service.js";

describe("Admin Internal Netting Routes", () => {
  const validGroupId = "64b02512-69d9-49d5-a566-f508a1fd7cd7";
  const validComboId = "f6932fb0-8211-42d2-b7e8-bbe3b051223c";

  const buildApp = async (adminMiddleware: preHandlerHookHandler) => {
    const app = Fastify({ logger: false });

    const internalNettingAdminService: InternalNettingAdminService = {
      getGroupInspection: vi.fn(async () => ({
        group: {
          id: validGroupId,
          incoming_combo_id: validComboId,
          matched_combo_id: "f1ed70ad-96b2-41a9-bd46-7a5e18aa85dc",
          state: "MATCHED",
          matched_size: "4",
          created_at: new Date()
        },
        matched_legs: [],
        exposure_journal_references: [],
        combo_states: {
          incoming_combo: {
            id: validComboId,
            user_id: "user-a",
            acceptance_policy: "ALL_OR_NONE",
            state: "PARTIALLY_EXECUTED",
            expires_at: new Date(),
            metadata: null,
            created_at: new Date()
          },
          matched_combo: {
            id: "f1ed70ad-96b2-41a9-bd46-7a5e18aa85dc",
            user_id: "user-b",
            acceptance_policy: "ALL_OR_NONE",
            state: "PARTIALLY_EXECUTED",
            expires_at: new Date(),
            metadata: null,
            created_at: new Date()
          }
        },
        residual_state: {
          incoming_combo: {
            total_remaining_size: "2",
            legs: [],
            redis_candidate_presence: []
          },
          matched_combo: {
            total_remaining_size: "1",
            legs: [],
            redis_candidate_presence: []
          }
        }
      })),
      getComboInspection: vi.fn(async () => ({
        combo: {
          id: validComboId,
          user_id: "user-a",
          acceptance_policy: "ALL_OR_NONE",
          state: "PARTIALLY_EXECUTED",
          expires_at: new Date(),
          metadata: null,
          created_at: new Date(),
          legs: []
        },
        linked_groups: [],
        netting_status: {
          total_groups: 1,
          incoming_group_count: 1,
          matched_group_count: 0,
          total_remaining_size: "2",
          redis_candidate_presence: []
        }
      })),
      reconcileGroup: vi.fn(async () => ({
        group_id: validGroupId,
        dry_run: true,
        force: false,
        discrepancies: [
          {
            code: "REDIS_RESIDUAL_MISMATCH",
            severity: "warning" as const,
            message: "Residual combo leg is missing from the Redis candidate registry."
          }
        ],
        admin_event_id: "de59bb7a-3e28-422d-aeeb-6a914537ab8b"
      })),
      createForceFailTask: vi.fn(async () => ({
        task_id: "143a80a6-07f3-48c4-a5ef-6ddfd50f9074",
        group_id: validGroupId,
        correlation_id: "164fed37-b0bc-4588-bf82-bc38d1a67560",
        status: "PENDING",
        admin_event_id: "de59bb7a-3e28-422d-aeeb-6a914537ab8b"
      }))
    } as unknown as InternalNettingAdminService;

    await registerAdminInternalNettingRoutes(app, adminMiddleware, {
      internalNettingAdminService
    });

    return { app, internalNettingAdminService };
  };

  it("denies access when admin middleware rejects", async () => {
    const rejectingAdmin: preHandlerHookHandler = async (_request, reply) => {
      return reply.status(403).send({ code: "FORBIDDEN" });
    };
    const { app } = await buildApp(rejectingAdmin);

    const response = await app.inject({
      method: "GET",
      url: `/admin/internal-netting/group/${validGroupId}`
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("returns group inspection for GET /admin/internal-netting/group/:id", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, internalNettingAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "GET",
      url: `/admin/internal-netting/group/${validGroupId}`
    });

    expect(response.statusCode).toBe(200);
    expect((internalNettingAdminService as unknown as { getGroupInspection: ReturnType<typeof vi.fn> }).getGroupInspection)
      .toHaveBeenCalledWith(validGroupId);
    await app.close();
  });

  it("returns combo inspection for GET /admin/internal-netting/combo/:id", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, internalNettingAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "GET",
      url: `/admin/internal-netting/combo/${validComboId}`
    });

    expect(response.statusCode).toBe(200);
    expect((internalNettingAdminService as unknown as { getComboInspection: ReturnType<typeof vi.fn> }).getComboInspection)
      .toHaveBeenCalledWith(validComboId);
    await app.close();
  });

  it("requires 2FA token for reconcile", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, internalNettingAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "POST",
      url: `/admin/internal-netting/group/${validGroupId}/reconcile`,
      payload: {
        dryRun: true,
        force: false
      }
    });

    expect(response.statusCode).toBe(400);
    expect((internalNettingAdminService as unknown as { reconcileGroup: ReturnType<typeof vi.fn> }).reconcileGroup)
      .not.toHaveBeenCalled();
    await app.close();
  });

  it("reconcile route returns discrepancy report", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, internalNettingAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "POST",
      url: `/admin/internal-netting/group/${validGroupId}/reconcile`,
      payload: {
        dryRun: true,
        force: false,
        twoFactorToken: "123456"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      group_id: validGroupId,
      discrepancies: [{ code: "REDIS_RESIDUAL_MISMATCH" }]
    });
    expect((internalNettingAdminService as unknown as { reconcileGroup: ReturnType<typeof vi.fn> }).reconcileGroup)
      .toHaveBeenCalledWith({
        groupId: validGroupId,
        requestedBy: "admin-1",
        dryRun: true,
        force: false
      });
    await app.close();
  });

  it("requires 2FA token for force-fail", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, internalNettingAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "POST",
      url: `/admin/internal-netting/group/${validGroupId}/force-fail`,
      payload: {
        reason: "manual unwind requested"
      }
    });

    expect(response.statusCode).toBe(400);
    expect((internalNettingAdminService as unknown as { createForceFailTask: ReturnType<typeof vi.fn> }).createForceFailTask)
      .not.toHaveBeenCalled();
    await app.close();
  });

  it("force-fail creates task only and does not mutate directly", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, internalNettingAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "POST",
      url: `/admin/internal-netting/group/${validGroupId}/force-fail`,
      payload: {
        reason: "manual unwind requested",
        twoFactorToken: "123456"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      group_id: validGroupId,
      status: "PENDING"
    });
    expect((internalNettingAdminService as unknown as { createForceFailTask: ReturnType<typeof vi.fn> }).createForceFailTask)
      .toHaveBeenCalledWith({
        groupId: validGroupId,
        requestedBy: "admin-1",
        reason: "manual unwind requested"
      });
    expect((internalNettingAdminService as unknown as { getGroupInspection: ReturnType<typeof vi.fn> }).getGroupInspection)
      .not.toHaveBeenCalled();
    expect((internalNettingAdminService as unknown as { reconcileGroup: ReturnType<typeof vi.fn> }).reconcileGroup)
      .not.toHaveBeenCalled();
    await app.close();
  });

  it("maps not-found and ambiguity errors", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, internalNettingAdminService } = await buildApp(passThroughAdmin);

    (internalNettingAdminService as unknown as { getGroupInspection: ReturnType<typeof vi.fn> }).getGroupInspection
      .mockRejectedValueOnce(new InternalNettingGroupNotFoundError(validGroupId));
    const groupNotFound = await app.inject({
      method: "GET",
      url: `/admin/internal-netting/group/${validGroupId}`
    });
    expect(groupNotFound.statusCode).toBe(404);

    (internalNettingAdminService as unknown as { getGroupInspection: ReturnType<typeof vi.fn> }).getGroupInspection
      .mockRejectedValueOnce(new InternalNettingAmbiguityError("ambiguous group"));
    const groupAmbiguous = await app.inject({
      method: "GET",
      url: `/admin/internal-netting/group/${validGroupId}`
    });
    expect(groupAmbiguous.statusCode).toBe(500);

    (internalNettingAdminService as unknown as { getComboInspection: ReturnType<typeof vi.fn> }).getComboInspection
      .mockRejectedValueOnce(new InternalNettingComboNotFoundError(validComboId));
    const comboNotFound = await app.inject({
      method: "GET",
      url: `/admin/internal-netting/combo/${validComboId}`
    });
    expect(comboNotFound.statusCode).toBe(404);

    await app.close();
  });
});
