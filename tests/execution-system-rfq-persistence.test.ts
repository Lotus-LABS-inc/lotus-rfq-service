import { describe, expect, it } from "vitest";

import { ExecutionControlGateway } from "../src/execution-control/execution-control-gateway.js";
import type { ExecutionControlRequest } from "../src/execution-control/execution-control-types.js";
import { ExecutionSystemMetadataSchema, zeroFees, type ExecutionSystemMetadataV0 } from "../src/execution-system/index.js";

const metadata: ExecutionSystemMetadataV0 = {
  version: "execution-system-v0",
  executionId: "record-1",
  rfqId: "rfq-1",
  userId: "user-1",
  canonicalTopicKey: "CRYPTO|ATH_BY_DATE|BTC",
  candidateId: "2026-06-30",
  side: "buy",
  size: "1",
  selectedLaneId: "CRYPTO_BTC_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET",
  venuePath: ["LIMITLESS", "POLYMARKET"],
  executionMode: "PAIR",
  approvedScopeHash: "scope-hash",
  maxSlippage: 0,
  fastLaneEnabled: false,
  ghostFillProtectionEnabled: true,
  expectedPrice: 0.5,
  expectedFees: zeroFees(),
  idempotencyKey: "idempotency-1",
  executionState: "COMPLETED",
  settlementState: "SETTLEMENT_VERIFIED",
  ghostFillState: "CLEAR",
  fallbackState: "NOT_USED",
  executionRequest: {
    executionId: "record-1",
    rfqId: "rfq-1",
    userId: "user-1",
    canonicalTopicKey: "CRYPTO|ATH_BY_DATE|BTC",
    candidateId: "2026-06-30",
    side: "buy",
    size: "1",
    selectedLaneId: "CRYPTO_BTC_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET",
    venuePath: ["LIMITLESS", "POLYMARKET"],
    executionMode: "PAIR",
    approvedScopeHash: "scope-hash",
    maxSlippage: 0,
    fastLaneEnabled: false,
    ghostFillProtectionEnabled: true,
    expectedPrice: 0.5,
    expectedFees: zeroFees(),
    idempotencyKey: "idempotency-1",
    createdAt: "2026-04-24T00:00:00.000Z"
  },
  currentState: "COMPLETED",
  legs: [],
  settlementStatus: "SETTLEMENT_VERIFIED",
  ghostFillStatus: "CLEAR",
  fallbackUsed: false,
  feeSummary: zeroFees(),
  auditEventIds: ["audit-1"],
  receipt: {
    executionId: "record-1",
    userId: "user-1",
    state: "COMPLETED",
    filledSize: "1",
    averagePrice: 0.5,
    settlementStatus: "SETTLEMENT_VERIFIED",
    ghostFillStatus: "CLEAR",
    fees: zeroFees(),
    emittedAt: "2026-04-24T00:00:01.000Z"
  },
  updatedAt: "2026-04-24T00:00:01.000Z"
};

describe("Execution System v0 RFQ persistence bridge", () => {
  it("persists executionSystemV0 metadata returned by the submission handler into execution record metadata", async () => {
    let record = {
      id: "record-1",
      executionIntentId: "intent-1",
      venue: "MULTI_VENUE",
      venueExecutionRef: null,
      executionState: "CREATED" as const,
      syncStatus: "pending",
      settlementStatus: "pending",
      fillDetails: {},
      retryLineage: [],
      providerExecutionKey: "provider-key",
      replayEnvelopeId: null,
      metadata: {} as Record<string, unknown>,
      createdAt: new Date("2026-04-24T00:00:00.000Z"),
      updatedAt: new Date("2026-04-24T00:00:00.000Z")
    };

    const gateway = new ExecutionControlGateway({
      policyValidator: { validate: () => ({ allowed: true, status: "ALLOWED", blockReasonCodes: [], warningCodes: [] }) } as any,
      freshnessGuard: { evaluate: () => ({ fresh: true, status: "FRESH", blockReasonCodes: [] }) } as any,
      approvalGate: { evaluate: () => ({ status: "APPROVED", bindingHash: "scope-hash", blockReasonCodes: [] }) } as any,
      idempotencyService: {
        reserve: async () => ({ status: "ALLOCATED", idempotencyKey: "idempotency-1" }),
        attachIntent: async () => undefined
      } as any,
      replayProtector: {
        evaluate: async () => ({ status: "CLEAR", blockReasonCodes: [], recordId: null }),
        record: async () => "replay-1"
      } as any,
      submissionOrchestrator: {
        submit: async () => ({
          status: "COMPLETED",
          payload: { executionSystemV0: metadata }
        })
      } as any,
      failSafeHandler: {} as any,
      auditWriter: {
        initialize: async () => ({
          intent: { id: "intent-1" },
          getRecord: () => record,
          transition: async (nextState: string, _reason: string, options: { metadata?: Record<string, unknown> } = {}) => {
            record = {
              ...record,
              executionState: nextState as typeof record.executionState,
              metadata: {
                ...record.metadata,
                ...(options.metadata ?? {})
              }
            };
            return record;
          },
          recordRecovery: async () => undefined
        })
      } as any,
      executionControlRepository: {
        upsertApprovalState: async () => undefined,
        createAuditRecord: async () => "audit-control-1",
        createDecision: async () => "decision-1"
      } as any,
      logger: { error: () => undefined }
    });

    const request: ExecutionControlRequest = {
      routePlanId: null,
      canonicalEventId: null,
      canonicalExecutableMarketId: "canonical-market-1",
      venueTargets: ["LIMITLESS", "POLYMARKET"],
      userWalletReference: { principalId: "user-1" },
      requestedSize: "1",
      requestedNotional: "0.5",
      configVersion: "test",
      engineVersion: "test",
      routeFreshnessMetadata: {
        routeGeneratedAt: new Date(),
        maxRouteAgeMs: 1000
      },
      compatibilityReferences: { decisionIds: [], versionIds: [] },
      approvalRequirements: { required: false },
      idempotencyKey: "idempotency-1",
      routeType: "SOR_PLAN",
      submissionKind: "SOR_PLAN",
      submissionPayload: {},
      policyContext: {
        routeTypeAllowed: true,
        venuesAllowed: true,
        compatibilityAllowed: true,
        settlementAllowed: true,
        killSwitchActive: false,
        accountAllowed: true,
        scopeAllowed: true,
        rolloutAllowed: true
      }
    };

    const outcome = await gateway.execute(request);
    expect(outcome.status).toBe("SUBMITTED");
    expect(ExecutionSystemMetadataSchema.parse(record.metadata.executionSystemV0).executionState).toBe("COMPLETED");
    expect(ExecutionSystemMetadataSchema.parse(record.metadata.executionSystemV0).auditEventIds).toEqual(["audit-1"]);
  });
});
