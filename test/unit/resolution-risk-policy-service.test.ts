import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    metricsRegistry,
    resolutionRiskEnforcementDisabledTotal,
    resolutionRiskInternalExclusionTotal,
    resolutionRiskShadowDivergenceTotal,
    resolutionRiskShadowMatchTotal,
    resolutionRiskShadowTotal
} from "../../src/observability/metrics.js";
import { ResolutionRiskPolicyService } from "../../src/core/rfq-engine/resolution-risk-policy-service.js";
import type { ResolutionRiskVenueGrouping } from "../../src/core/rfq-engine/resolution-risk.types.js";

const makeGrouping = (): ResolutionRiskVenueGrouping => ({
    canonicalEventId: "event-1",
    safePools: [["profile-safe"]],
    cautionLanes: [["profile-caution"]],
    blockedProfiles: ["profile-blocked"],
    reasonsByProfile: {
        "profile-caution": ["pair:profile-caution|profile-safe: caution"],
        "profile-blocked": ["pair:profile-blocked|profile-safe: blocked"]
    },
    pairMatrix: {}
});

describe("ResolutionRiskPolicyService", () => {
    beforeEach(() => {
        metricsRegistry.resetMetrics();
    });

    it("returns a permissive RFQ grouping in shadow mode and preserves the original grouping as shadow output", async () => {
        const logger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn()
        };
        const service = new ResolutionRiskPolicyService({
            enabled: false,
            shadowEnabled: true,
            shadowPercent: 1,
            now: () => new Date("2026-03-11T12:00:00.000Z"),
            logger
        });

        const result = service.applyRFQGrouping(makeGrouping(), "rfq-shadow-1");

        expect(result.enforcementActive).toBe(false);
        expect(result.mode).toBe("shadow");
        expect(result.grouping.safePools).toEqual([["profile-blocked", "profile-caution", "profile-safe"]]);
        expect(result.grouping.cautionLanes).toEqual([]);
        expect(result.grouping.blockedProfiles).toEqual([]);
        expect(result.shadowGrouping).toEqual(makeGrouping());

        const shadowTotal = await resolutionRiskShadowTotal.get();
        const shadowValue = shadowTotal.values.find(
            (value) => value.labels.domain === "rfq" && value.labels.mode === "shadow"
        );
        expect(shadowValue?.value).toBe(1);

        const divergenceTotal = await resolutionRiskShadowDivergenceTotal.get();
        const divergenceValue = divergenceTotal.values.find(
            (value) => value.labels.domain === "rfq" && value.labels.reason === "blocked_vs_allowed"
        );
        expect(divergenceValue?.value).toBe(1);
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it("bypasses SOR enforcement in shadow mode but records the intended divergence", async () => {
        const logger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn()
        };
        const service = new ResolutionRiskPolicyService({
            enabled: false,
            shadowEnabled: true,
            shadowPercent: 1,
            now: () => new Date("2026-03-11T12:00:00.000Z"),
            logger
        });

        const result = service.evaluateSORDecision({
            stableKey: "sor-shadow-1",
            intendedDecision: "blocked",
            reason: "resolution_risk_do_not_pool",
            equivalenceClass: "DO_NOT_POOL",
            canonicalEventId: "event-1",
            profileAId: "profile-a",
            profileBId: "profile-b"
        });

        expect(result.enforcementActive).toBe(false);
        expect(result.enforcedDecision).toBe("normal");
        expect(result.shadowDecision).toMatchObject({
            outcome: "blocked",
            equivalenceClass: "DO_NOT_POOL"
        });
        expect(result.divergenceReason).toBe("blocked_vs_allowed");

        const divergenceTotal = await resolutionRiskShadowDivergenceTotal.get();
        const divergenceValue = divergenceTotal.values.find(
            (value) => value.labels.domain === "sor" && value.labels.reason === "blocked_vs_allowed"
        );
        expect(divergenceValue?.value).toBe(1);
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it("bypasses internal-execution exclusions in shadow mode and records the exclusion counter", async () => {
        const service = new ResolutionRiskPolicyService({
            enabled: false,
            shadowEnabled: true,
            shadowPercent: 1,
            now: () => new Date("2026-03-11T12:00:00.000Z"),
            logger: {
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn()
            }
        });

        const allowed = service.evaluateInternalEligibility({
            stableKey: "internal-shadow-1",
            intendedAllowed: false,
            reason: "missing_assessment",
            equivalenceClass: "CAUTION",
            canonicalEventId: "event-1",
            profileAId: "profile-a",
            profileBId: "profile-b"
        });

        expect(allowed).toBe(true);

        const exclusionTotal = await resolutionRiskInternalExclusionTotal.get();
        const exclusionValue = exclusionTotal.values.find(
            (value) =>
                value.labels.domain === "internal_execution" &&
                value.labels.equivalence_class === "CAUTION"
        );
        expect(exclusionValue?.value).toBe(1);

        const enforcementDisabled = await resolutionRiskEnforcementDisabledTotal.get();
        const enforcementDisabledValue = enforcementDisabled.values.find(
            (value) => value.labels.domain === "internal_execution"
        );
        expect(enforcementDisabledValue?.value).toBe(1);
    });

    it("keeps current behavior unchanged when enforcement is enabled", async () => {
        const service = new ResolutionRiskPolicyService({
            enabled: true,
            shadowEnabled: true,
            shadowPercent: 1,
            now: () => new Date("2026-03-11T12:00:00.000Z")
        });

        const sorDecision = service.evaluateSORDecision({
            stableKey: "sor-enabled-1",
            intendedDecision: "penalty",
            reason: "resolution_risk_caution",
            equivalenceClass: "CAUTION"
        });
        const internalAllowed = service.evaluateInternalEligibility({
            stableKey: "internal-enabled-1",
            intendedAllowed: false,
            reason: "resolution_risk_do_not_pool",
            equivalenceClass: "DO_NOT_POOL"
        });

        expect(sorDecision.enforcementActive).toBe(true);
        expect(sorDecision.enforcedDecision).toBe("penalty");
        expect(internalAllowed).toBe(false);

        const shadowMatches = await resolutionRiskShadowMatchTotal.get();
        expect(shadowMatches.values).toHaveLength(0);
    });

    it("emits qualification evaluations for shadowed SOR threshold decisions", async () => {
        const qualificationHook = {
            emitEvaluation: vi.fn(async () => null)
        };
        const service = new ResolutionRiskPolicyService({
            enabled: false,
            shadowEnabled: true,
            shadowPercent: 1,
            now: () => new Date("2026-03-11T12:00:00.000Z"),
            qualificationHook,
            qualificationConfig: {
                enabled: true,
                strategyKey: "strategy.resolution-risk",
                failMode: "ASYNC_BEST_EFFORT"
            }
        });

        service.evaluateSORDecision({
            stableKey: "sor-shadow-qualification-1",
            intendedDecision: "blocked",
            reason: "resolution_risk_do_not_pool",
            equivalenceClass: "DO_NOT_POOL",
            canonicalEventId: "event-shadow-qualification-1"
        });

        await Promise.resolve();

        expect(qualificationHook.emitEvaluation).toHaveBeenCalledWith(
            expect.objectContaining({
                strategyKey: "strategy.resolution-risk",
                scopeType: "EVENT",
                scopeId: "event-shadow-qualification-1",
                decisionType: "RESOLUTION_RISK_THRESHOLD_CHANGE",
                entityId: "sor-shadow-qualification-1",
                mode: "shadow_compare"
            })
        );
    });
});
