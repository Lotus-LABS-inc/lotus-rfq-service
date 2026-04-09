import { describe, expect, it, vi } from "vitest";

import { ExecutionApprovalGate } from "../../src/execution-control/execution-approval-gate.js";
import { ExecutionFailSafeHandler } from "../../src/execution-control/execution-fail-safe-handler.js";
import { ExecutionFreshnessGuard } from "../../src/execution-control/execution-freshness-guard.js";
import { ExecutionIdempotencyService } from "../../src/execution-control/execution-idempotency-service.js";
import { ExecutionPolicyValidator } from "../../src/execution-control/execution-policy-validator.js";
import type { ExecutionControlRequest } from "../../src/execution-control/execution-control-types.js";

const buildRequest = (): ExecutionControlRequest => ({
    routePlanId: "11111111-1111-1111-1111-111111111111",
    canonicalEventId: "22222222-2222-2222-2222-222222222222",
    canonicalExecutableMarketId: "market-1",
    venueTargets: ["LP-1"],
    userWalletReference: {
        principalId: "user-1",
        walletRef: "wallet-1"
    },
    requestedSize: "10",
    requestedNotional: "100.00",
    configVersion: "execution-control-v1",
    engineVersion: "execution-infra-v2",
    routeFreshnessMetadata: {
        routeGeneratedAt: new Date("2026-03-27T00:00:00Z"),
        quoteObservedAt: new Date("2026-03-27T00:00:00Z"),
        quoteValidUntil: new Date("2026-03-27T00:05:00Z"),
        marketStateObservedAt: new Date("2026-03-27T00:00:00Z"),
        compatibilityEvaluatedAt: new Date("2026-03-27T00:00:00Z"),
        approvalGrantedAt: new Date("2026-03-27T00:00:00Z"),
        maxRouteAgeMs: 60_000,
        maxQuoteAgeMs: 60_000,
        maxMarketStateAgeMs: 60_000,
        maxCompatibilityAgeMs: 60_000,
        maxApprovalAgeMs: 60_000
    },
    compatibilityReferences: {
        decisionIds: ["decision-1"],
        versionIds: ["version-1"],
        compatibilityClass: "SAFE_EQUIVALENT"
    },
    approvalRequirements: {
        required: false,
        approvalGrantedAt: new Date("2026-03-27T00:00:00Z")
    },
    idempotencyKey: "idem-1",
    routeType: "SOR_PLAN",
    routeSelectionTraceId: "33333333-3333-3333-3333-333333333333",
    replayEnvelopeId: "44444444-4444-4444-4444-444444444444",
    submissionKind: "SOR_PLAN",
    submissionPayload: {
        planId: "plan-1"
    },
    policyContext: {
        routeTypeAllowed: true,
        venuesAllowed: true,
        compatibilityAllowed: true,
        settlementAllowed: true,
        killSwitchActive: false,
        accountAllowed: true,
        scopeAllowed: true,
        rolloutAllowed: true
    },
    metadata: {}
});

describe("execution control validators", () => {
    it("blocks policy-forbidden requests with structured reason codes", () => {
        const validator = new ExecutionPolicyValidator();
        const result = validator.validate({
            ...buildRequest(),
            policyContext: {
                routeTypeAllowed: false,
                venuesAllowed: false,
                compatibilityAllowed: true,
                settlementAllowed: true,
                killSwitchActive: true,
                accountAllowed: true,
                scopeAllowed: true,
                rolloutAllowed: true
            }
        });

        expect(result.allowed).toBe(false);
        expect(result.blockReasonCodes).toContain("ROUTE_TYPE_NOT_ALLOWED");
        expect(result.blockReasonCodes).toContain("VENUE_NOT_ALLOWED");
        expect(result.blockReasonCodes).toContain("KILL_SWITCH_ACTIVE");
    });

    it("marks stale routes deterministically", () => {
        const guard = new ExecutionFreshnessGuard(() => new Date("2026-03-27T00:02:00Z"));
        const result = guard.evaluate(buildRequest());

        expect(result.fresh).toBe(false);
        expect(result.status).toBe("STALE_ROUTE");
        expect(result.blockReasonCodes).toContain("ROUTE_PLAN_STALE");
    });

    it("rejects mismatched approval bindings", () => {
        const gate = new ExecutionApprovalGate();
        const baseRequest = buildRequest();
        const expectedHash = gate.buildBindingHash(baseRequest);
        const result = gate.evaluate({
            ...baseRequest,
            approvalRequirements: {
                required: true,
                approvalBindingHash: `${expectedHash}-mismatch`,
                approvalGrantedAt: new Date("2026-03-27T00:00:00Z")
            }
        });

        expect(result.status).toBe("MISMATCHED");
        expect(result.blockReasonCodes).toEqual(["APPROVAL_MISMATCH"]);
    });
});

describe("execution control support services", () => {
    it("reuses matching idempotency keys safely", async () => {
        const repository = {
            findIdempotencyKey: vi.fn(async () => ({
                id: "row-1",
                executionIntentId: "intent-1",
                routePlanId: "11111111-1111-1111-1111-111111111111",
                principalId: "user-1",
                walletRef: "wallet-1",
                venueTargets: ["LP-1"],
                requestedAction: "SOR_PLAN",
                bindingHash: "binding-hash",
                lastStatus: "ALLOCATED"
            })),
            upsertIdempotencyKey: vi.fn()
        } as any;
        const service = new ExecutionIdempotencyService(repository);
        vi.spyOn<any, any>(service as any, "buildBindingHash").mockReturnValue("binding-hash");

        const result = await service.reserve(buildRequest());

        expect(result.status).toBe("REUSED");
        expect(result.idempotencyKey).toBe("idem-1");
    });

    it("maps uncertain failures to sync pending or reconciling", () => {
        const handler = new ExecutionFailSafeHandler();

        expect(
            handler.mapSubmissionFailure({
                uncertain: true,
                reasons: ["UNCERTAIN_SUBMISSION_STATE"]
            }).status
        ).toBe("SYNC_PENDING");

        expect(
            handler.mapSubmissionFailure({
                uncertain: true,
                duplicateRisk: true,
                reasons: ["UNCERTAIN_SUBMISSION_STATE"]
            }).status
        ).toBe("RECONCILING");
    });
});
