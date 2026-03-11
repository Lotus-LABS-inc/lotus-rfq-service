import { describe, expect, it, vi } from "vitest";

import { ResolutionRiskEligibilityService } from "../../src/core/rfq-engine/resolution-risk-eligibility-service.js";
import { ResolutionRiskPolicyService } from "../../src/core/rfq-engine/resolution-risk-policy-service.js";

describe("ResolutionRiskEligibilityService", () => {
    it("returns true for the same profile id", async () => {
        const readService = {
            getAssessmentByProfilePair: vi.fn(),
            getAssessmentsByProfilePairs: vi.fn()
        };
        const service = new ResolutionRiskEligibilityService({ readService });

        await expect(service.isSafeForInternalPooling("profile-a", "profile-a")).resolves.toBe(true);
        expect(readService.getAssessmentByProfilePair).not.toHaveBeenCalled();
    });

    it("returns true only for SAFE_EQUIVALENT persisted assessments", async () => {
        const readService = {
            getAssessmentByProfilePair: vi.fn().mockResolvedValue({
                equivalenceClass: "SAFE_EQUIVALENT"
            }),
            getAssessmentsByProfilePairs: vi.fn()
        };
        const service = new ResolutionRiskEligibilityService({ readService });

        await expect(service.isSafeForCrossVenueNetting("profile-a", "profile-b")).resolves.toBe(true);
    });

    it.each(["CAUTION", "HIGH_RISK", "DO_NOT_POOL"] as const)(
        "returns false for %s",
        async (equivalenceClass) => {
            const readService = {
                getAssessmentByProfilePair: vi.fn().mockResolvedValue({
                    equivalenceClass
                }),
                getAssessmentsByProfilePairs: vi.fn()
            };
            const service = new ResolutionRiskEligibilityService({ readService });

            await expect(service.isSafeForCrossVenueNetting("profile-a", "profile-b")).resolves.toBe(false);
        }
    );

    it("returns false when the persisted assessment is missing", async () => {
        const readService = {
            getAssessmentByProfilePair: vi.fn().mockResolvedValue(null),
            getAssessmentsByProfilePairs: vi.fn()
        };
        const service = new ResolutionRiskEligibilityService({ readService });

        await expect(service.isSafeForInternalPooling("profile-a", "profile-b")).resolves.toBe(false);
    });

    it("bypasses enforcement in shadow mode while keeping canonical read-path decisions", async () => {
        const readService = {
            getAssessmentByProfilePair: vi.fn().mockResolvedValue({
                equivalenceClass: "HIGH_RISK"
            }),
            getAssessmentsByProfilePairs: vi.fn()
        };
        const policyService = new ResolutionRiskPolicyService({
            enabled: false,
            shadowEnabled: true,
            shadowPercent: 1,
            now: () => new Date("2026-03-11T12:00:00.000Z"),
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
        });
        const service = new ResolutionRiskEligibilityService({ readService, policyService });

        await expect(
            service.isSafeForCrossVenueNetting("profile-a", "profile-b", { stableKey: "shadow-eligibility-1" })
        ).resolves.toBe(true);
    });
});
