import { createHash } from "node:crypto";

import type { ResolutionRiskRolloutMode } from "./resolution-risk.types.js";

export interface ResolutionRiskRolloutWindowInput {
    enabled: boolean;
    shadowEnabled: boolean;
    shadowPercent: number;
    shadowStartAt?: string;
    shadowEndAt?: string;
    now?: () => Date;
}

const toUint32 = (hex: string): number => Number.parseInt(hex, 16) >>> 0;

export const isResolutionRiskShadowWindowActive = (
    input: Omit<ResolutionRiskRolloutWindowInput, "enabled">
): boolean => {
    if (!input.shadowEnabled || input.shadowPercent <= 0) {
        return false;
    }

    const now = (input.now ?? (() => new Date()))().getTime();

    if (input.shadowStartAt) {
        const start = Date.parse(input.shadowStartAt);
        if (Number.isFinite(start) && now < start) {
            return false;
        }
    }

    if (input.shadowEndAt) {
        const end = Date.parse(input.shadowEndAt);
        if (Number.isFinite(end) && now > end) {
            return false;
        }
    }

    return true;
};

export const isResolutionRiskShadowSampled = (stableId: string, percent: number): boolean => {
    if (percent <= 0) {
        return false;
    }
    if (percent >= 1) {
        return true;
    }

    const digest = createHash("sha256").update(stableId).digest("hex");
    const bucket = toUint32(digest.slice(0, 8)) / 0xffffffff;
    return bucket < percent;
};

export const resolveResolutionRiskRolloutMode = (
    stableId: string,
    input: ResolutionRiskRolloutWindowInput
): ResolutionRiskRolloutMode => {
    if (input.enabled) {
        return "enabled";
    }

    if (
        isResolutionRiskShadowWindowActive({
            shadowEnabled: input.shadowEnabled,
            shadowPercent: input.shadowPercent,
            ...(input.shadowStartAt ? { shadowStartAt: input.shadowStartAt } : {}),
            ...(input.shadowEndAt ? { shadowEndAt: input.shadowEndAt } : {}),
            ...(input.now ? { now: input.now } : {})
        }) &&
        isResolutionRiskShadowSampled(stableId, input.shadowPercent)
    ) {
        return "shadow";
    }

    return "disabled";
};
