import Fastify, { type preHandlerHookHandler } from "fastify";
import { describe, expect, it } from "vitest";
import { registerAdminOpsRoutes } from "../src/api/admin/admin-ops.routes.js";
import type { ExecutionControlRepository } from "../src/repositories/execution-control.repository.js";
import type { ExecutionIntentRepository } from "../src/repositories/execution-intent.repository.js";
import type { ExecutionRecordRepository } from "../src/repositories/execution-record.repository.js";
import type { FundingReadinessAdminService } from "../src/api/admin/funding-readiness-admin-service.js";
import type { ExecutionVenuesAdminService } from "../src/api/admin/execution-venues-admin-service.js";

const adminMiddleware: preHandlerHookHandler = async (request) => {
  request.user = { userId: "admin-1", role: "ADMIN" };
};

const record = {
  id: "11111111-1111-4111-8111-111111111111",
  executionIntentId: "22222222-2222-4222-8222-222222222222",
  venue: "POLYMARKET",
  venueExecutionRef: null,
  executionState: "SETTLED",
  syncStatus: "synced",
  settlementStatus: "SETTLEMENT_VERIFIED",
  fillDetails: {},
  retryLineage: [],
  providerExecutionKey: null,
  replayEnvelopeId: null,
  metadata: {},
  createdAt: new Date("2026-04-29T00:00:00.000Z"),
  updatedAt: new Date("2026-04-29T00:00:00.000Z")
};

describe("admin ops routes", () => {
  it("returns execution and funding dashboard data without secrets", async () => {
    const app = Fastify({ logger: false });
    await registerAdminOpsRoutes(app, adminMiddleware, {
      executionRecordRepository: {
        list: async () => [record],
        findById: async () => record
      } as unknown as ExecutionRecordRepository,
      executionIntentRepository: {
        list: async () => [{ id: record.executionIntentId, metadata: {} }],
        findById: async () => ({ id: record.executionIntentId, metadata: {} })
      } as unknown as ExecutionIntentRepository,
      executionControlRepository: {
        listControlAuditByRecord: async () => [{ eventType: "SETTLED" }]
      } as unknown as ExecutionControlRepository,
      fundingReadinessAdminService: {
        getSummary: async () => ({
          totalFundingIntents: 1,
          readyToTrade: 1,
          venueCreditPending: 0,
          destinationNotConfirmed: 0,
          failed: 0,
          unknown: 0
        })
      } as unknown as FundingReadinessAdminService,
      executionVenuesAdminService: {
        listVenues: async () => [{ venue: "POLYMARKET", credentialsServerSideOnly: true }]
      } as unknown as ExecutionVenuesAdminService
    });

    const summary = await app.inject({ method: "GET", url: "/admin/ops/summary" });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().summary.executions.byVenue).toEqual({ POLYMARKET: 1 });

    const executions = await app.inject({ method: "GET", url: "/admin/executions?venue=polymarket" });
    expect(executions.statusCode).toBe(200);
    expect(executions.json().executions).toHaveLength(1);

    const detail = await app.inject({ method: "GET", url: `/admin/executions/${record.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).not.toContain("privateKey");
    expect(detail.body).not.toContain("API_SECRET");
    await app.close();
  });
});
