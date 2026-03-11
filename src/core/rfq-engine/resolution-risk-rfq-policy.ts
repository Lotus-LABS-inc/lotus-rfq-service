import type { ResolutionRiskVenueGrouping } from "./resolution-risk.types.js";

export type ResolutionQuoteLaneDecision =
    | {
        allowed: true;
        laneType: "SAFE_POOL" | "CAUTION";
        laneId: string;
        reason?: string;
    }
    | {
        allowed: false;
        reason: string;
    };

export class ResolutionRiskQuotePolicyError extends Error {
    public readonly code: "missing_resolution_profile_id" | "blocked_resolution_profile";

    public constructor(code: "missing_resolution_profile_id" | "blocked_resolution_profile", reason?: string) {
        super(reason ?? code);
        this.name = "ResolutionRiskQuotePolicyError";
        this.code = code;
    }
}

export const evaluateResolutionQuoteLane = (
    grouping: ResolutionRiskVenueGrouping,
    resolutionProfileId: string | undefined
): ResolutionQuoteLaneDecision => {
    if (!resolutionProfileId || resolutionProfileId.trim().length === 0) {
        throw new ResolutionRiskQuotePolicyError(
            "missing_resolution_profile_id",
            "Quote payload is missing resolution_profile_id; fail-closed for pooled treatment."
        );
    }

    if (grouping.blockedProfiles.includes(resolutionProfileId)) {
        const reasons = grouping.reasonsByProfile[resolutionProfileId] ?? [];
        throw new ResolutionRiskQuotePolicyError(
            "blocked_resolution_profile",
            reasons[0] ?? `Resolution profile ${resolutionProfileId} is blocked for RFQ pooling.`
        );
    }

    const cautionIndex = grouping.cautionLanes.findIndex((lane) => lane.includes(resolutionProfileId));
    if (cautionIndex >= 0) {
        const reasons = grouping.reasonsByProfile[resolutionProfileId] ?? [];
        return {
            allowed: true,
            laneType: "CAUTION",
            laneId: `caution:${cautionIndex}`,
            ...(reasons[0] ? { reason: reasons[0] } : {})
        };
    }

    const safeIndex = grouping.safePools.findIndex((lane) => lane.includes(resolutionProfileId));
    if (safeIndex >= 0) {
        return {
            allowed: true,
            laneType: "SAFE_POOL",
            laneId: `safe:${safeIndex}`
        };
    }

    throw new ResolutionRiskQuotePolicyError(
        "blocked_resolution_profile",
        `Resolution profile ${resolutionProfileId} is not assigned to a valid RFQ resolution lane.`
    );
};
