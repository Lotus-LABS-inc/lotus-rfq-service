import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerAdminInternalClearingRoutes } from "../src/api/admin/internal-clearing.routes.js";
import {
  InternalClearingAmbiguityError,
  InternalClearingEntityNotFoundError,
  InternalClearingRoundNotFoundError,
  type InternalClearingAdminService
} from "../src/api/admin/internal-clearing-admin-service.js";

describe("Admin Internal Clearing Routes", () => {
  const validRoundId = "e7be3498-f554-4ec3-b65a-f6f3ddcaac6f";
  const validEntityId = "b95de7d9-c7c6-493f-97d2-67d0227f9084";

  const buildApp = async (adminMiddleware: preHandlerHookHandler) => {
    const app = Fastify({ logger: false });

    const internalClearingAdminService: InternalClearingAdminService = {
      getRoundInspection: vi.fn(async () => ({
        round: {
          id: validRoundId,
          compatibility_bucket: "universe-a|daily|cash|standard",
          state: "MATCHED",
          participant_count: 3,
          unique_leg_count: 2,
          compression_score: "9.5",
          participant_set_hash: "participant-set-hash",
          match_signature_hash: "match-signature-hash",
          created_at: new Date()
        },
        participants: [],
        matched_legs: [],
        exposure_journal_references: [],
        residual_states: []
      })),
      getEntityInspection: vi.fn(async () => ({
        entity: {
          id: validEntityId,
          user_id: "user-a",
          acceptance_policy: "ALL_OR_NONE",
          state: "PARTIALLY_EXECUTED",
          expires_at: new Date(),
          metadata: null,
          created_at: new Date(),
          legs: []
        },
        residual_state: {
          total_remaining_size: "2",
          redis_bucket_status: {
            compatibility_bucket: "universe-a|daily|cash|standard",
            expected_present: true,
            snapshot_present: true,
            bucket_present: true
          }
        },
        participation_history: []
      })),
      reconcileRound: vi.fn(async () => ({
        round_id: validRoundId,
        dry_run: true,
        discrepancies: [
          {
            code: "REDIS_BUCKET_MISMATCH",
            severity: "warning" as const,
            message: "Redis bucket or entity snapshot does not match authoritative residual state."
          }
        ],
        admin_event_id: "68a8dd7e-8baa-4915-8500-4fe1d301907d"
      })),
      createForceFailTask: vi.fn(async () => ({
        task_id: "c57e44ef-87dd-4d8d-b95d-b4ba91332781",
        round_id: validRoundId,
        correlation_id: "4716b84d-cab4-4481-904d-40d4bcc73473",
        status: "PENDING",
        admin_event_id: "68a8dd7e-8baa-4915-8500-4fe1d301907d"
      }))
    } as unknown as InternalClearingAdminService;

    await registerAdminInternalClearingRoutes(app, adminMiddleware, {
      internalClearingAdminService
    });

    return { app, internalClearingAdminService };
  };

  it("denies access when admin middleware rejects", async () => {
    const rejectingAdmin: preHandlerHookHandler = async (_request, reply) => {
      return reply.status(403).send({ code: "FORBIDDEN" });
    };
    const { app } = await buildApp(rejectingAdmin);

    const response = await app.inject({
      method: "GET",
      url: `/admin/internal-clearing/round/${validRoundId}`
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("returns round inspection for GET /admin/internal-clearing/round/:id", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, internalClearingAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "GET",
      url: `/admin/internal-clearing/round/${validRoundId}`
    });

    expect(response.statusCode).toBe(200);
    expect((internalClearingAdminService as unknown as { getRoundInspection: ReturnType<typeof vi.fn> }).getRoundInspection)
      .toHaveBeenCalledWith(validRoundId);
    await app.close();
  });

  it("returns entity inspection for GET /admin/internal-clearing/entity/:id", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, internalClearingAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "GET",
      url: `/admin/internal-clearing/entity/${validEntityId}`
    });

    expect(response.statusCode).toBe(200);
    expect((internalClearingAdminService as unknown as { getEntityInspection: ReturnType<typeof vi.fn> }).getEntityInspection)
      .toHaveBeenCalledWith(validEntityId);
    await app.close();
  });

  it("requires 2FA token for reconcile", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, internalClearingAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "POST",
      url: `/admin/internal-clearing/round/${validRoundId}/reconcile`,
      payload: {
        dryRun: true
      }
    });

    expect(response.statusCode).toBe(400);
    expect((internalClearingAdminService as unknown as { reconcileRound: ReturnType<typeof vi.fn> }).reconcileRound)
      .not.toHaveBeenCalled();
    await app.close();
  });

  it("reconcile returns structured discrepancy report", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, internalClearingAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "POST",
      url: `/admin/internal-clearing/round/${validRoundId}/reconcile`,
      payload: {
        dryRun: true,
        twoFactorToken: "123456"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      round_id: validRoundId,
      discrepancies: [{ code: "REDIS_BUCKET_MISMATCH" }]
    });
    expect((internalClearingAdminService as unknown as { reconcileRound: ReturnType<typeof vi.fn> }).reconcileRound)
      .toHaveBeenCalledWith({
        roundId: validRoundId,
        requestedBy: "admin-1",
        dryRun: true
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
    const { app, internalClearingAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "POST",
      url: `/admin/internal-clearing/round/${validRoundId}/force-fail`,
      payload: {
        reason: "manual intervention required"
      }
    });

    expect(response.statusCode).toBe(400);
    expect((internalClearingAdminService as unknown as { createForceFailTask: ReturnType<typeof vi.fn> }).createForceFailTask)
      .not.toHaveBeenCalled();
    await app.close();
  });

  it("force-fail creates task only and does not mutate clearing state directly", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, internalClearingAdminService } = await buildApp(passThroughAdmin);

    const response = await app.inject({
      method: "POST",
      url: `/admin/internal-clearing/round/${validRoundId}/force-fail`,
      payload: {
        reason: "manual intervention required",
        twoFactorToken: "123456"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      round_id: validRoundId,
      status: "PENDING"
    });
    expect((internalClearingAdminService as unknown as { createForceFailTask: ReturnType<typeof vi.fn> }).createForceFailTask)
      .toHaveBeenCalledWith({
        roundId: validRoundId,
        requestedBy: "admin-1",
        reason: "manual intervention required"
      });
    await app.close();
  });

  it("maps not-found and ambiguity errors", async () => {
    const passThroughAdmin: preHandlerHookHandler = async (request) => {
      (request as { user?: { userId: string; role: "ADMIN" } }).user = {
        userId: "admin-1",
        role: "ADMIN"
      };
    };
    const { app, internalClearingAdminService } = await buildApp(passThroughAdmin);

    (internalClearingAdminService as unknown as { getRoundInspection: ReturnType<typeof vi.fn> }).getRoundInspection
      .mockRejectedValueOnce(new InternalClearingRoundNotFoundError(validRoundId));
    const roundNotFound = await app.inject({
      method: "GET",
      url: `/admin/internal-clearing/round/${validRoundId}`
    });
    expect(roundNotFound.statusCode).toBe(404);

    (internalClearingAdminService as unknown as { getRoundInspection: ReturnType<typeof vi.fn> }).getRoundInspection
      .mockRejectedValueOnce(new InternalClearingAmbiguityError("ambiguous round"));
    const roundAmbiguous = await app.inject({
      method: "GET",
      url: `/admin/internal-clearing/round/${validRoundId}`
    });
    expect(roundAmbiguous.statusCode).toBe(500);

    (internalClearingAdminService as unknown as { getEntityInspection: ReturnType<typeof vi.fn> }).getEntityInspection
      .mockRejectedValueOnce(new InternalClearingEntityNotFoundError(validEntityId));
    const entityNotFound = await app.inject({
      method: "GET",
      url: `/admin/internal-clearing/entity/${validEntityId}`
    });
    expect(entityNotFound.statusCode).toBe(404);

    await app.close();
  });
});
