import { describe, expect, it } from "vitest";

import {
    isResolutionRiskShadowSampled,
    isResolutionRiskShadowWindowActive,
    resolveResolutionRiskRolloutMode
} from "../../src/core/rfq-engine/resolution-risk-rollout-controls.js";

describe("resolution-risk rollout controls", () => {
    it("returns disabled when enforcement and shadow are both off", () => {
        expect(
            resolveResolutionRiskRolloutMode("stable-1", {
                enabled: false,
                shadowEnabled: false,
                shadowPercent: 0
            })
        ).toBe("disabled");
    });

    it("returns enabled when enforcement is on", () => {
        expect(
            resolveResolutionRiskRolloutMode("stable-1", {
                enabled: true,
                shadowEnabled: false,
                shadowPercent: 0
            })
        ).toBe("enabled");
    });

    it("evaluates the shadow window deterministically", () => {
        expect(
            isResolutionRiskShadowWindowActive({
                shadowEnabled: true,
                shadowPercent: 0.5,
                shadowStartAt: "2026-03-11T10:00:00.000Z",
                shadowEndAt: "2026-03-11T12:00:00.000Z",
                now: () => new Date("2026-03-11T11:00:00.000Z")
            })
        ).toBe(true);

        expect(
            isResolutionRiskShadowWindowActive({
                shadowEnabled: true,
                shadowPercent: 0.5,
                shadowStartAt: "2026-03-11T10:00:00.000Z",
                shadowEndAt: "2026-03-11T12:00:00.000Z",
                now: () => new Date("2026-03-11T09:59:00.000Z")
            })
        ).toBe(false);
    });

    it("samples deterministically for the same stable key", () => {
        const first = isResolutionRiskShadowSampled("stable-resolution-risk-key", 0.5);
        const second = isResolutionRiskShadowSampled("stable-resolution-risk-key", 0.5);

        expect(first).toBe(second);
    });

    it("returns shadow when shadow is active and the key is sampled", () => {
        expect(
            resolveResolutionRiskRolloutMode("stable-resolution-risk-key", {
                enabled: false,
                shadowEnabled: true,
                shadowPercent: 1,
                shadowStartAt: "2026-03-11T10:00:00.000Z",
                shadowEndAt: "2026-03-11T12:00:00.000Z",
                now: () => new Date("2026-03-11T11:00:00.000Z")
            })
        ).toBe("shadow");
    });
});
