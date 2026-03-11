import type { Logger } from "pino";

import {
    resolutionRiskEnforcementDisabledTotal,
    resolutionRiskInternalExclusionTotal,
    resolutionRiskShadowDivergenceTotal,
    resolutionRiskShadowMatchTotal,
    resolutionRiskShadowTotal
} from "../../observability/metrics.js";
import {
    resolveResolutionRiskRolloutMode,
    type ResolutionRiskRolloutWindowInput
} from "./resolution-risk-rollout-controls.js";
import type {
    ResolutionEquivalenceClass,
    ResolutionRiskPolicyDecision,
    ResolutionRiskPolicyDomain,
    ResolutionRiskPolicyOutcome,
    ResolutionRiskShadowDivergenceReason,
    ResolutionRiskVenueGrouping
} from "./resolution-risk.types.js";

export interface ResolutionRiskPolicyServiceDeps extends ResolutionRiskRolloutWindowInput {
    logger?: Pick<Logger, "info" | "warn" | "error">;
}

export interface ResolutionRiskSOREvaluationInput {
    stableKey: string;
    equivalenceClass?: ResolutionEquivalenceClass;
    reason: string;
    intendedDecision: ResolutionRiskPolicyOutcome;
    canonicalEventId?: string;
    profileAId?: string;
    profileBId?: string;
}

export interface ResolutionRiskInternalEvaluationInput {
    stableKey: string;
    equivalenceClass?: ResolutionEquivalenceClass;
    reason: string;
    intendedAllowed: boolean;
    canonicalEventId?: string;
    profileAId?: string;
    profileBId?: string;
}

export interface ResolutionRiskRFQGroupingResult {
    grouping: ResolutionRiskVenueGrouping;
    enforcementActive: boolean;
    mode: "disabled" | "shadow" | "enabled";
    shadowGrouping?: ResolutionRiskVenueGrouping;
}

export interface IResolutionRiskPolicyService {
    applyRFQGrouping(grouping: ResolutionRiskVenueGrouping, stableKey: string): ResolutionRiskRFQGroupingResult;
    evaluateSORDecision(input: ResolutionRiskSOREvaluationInput): ResolutionRiskPolicyDecision;
    evaluateInternalEligibility(input: ResolutionRiskInternalEvaluationInput): boolean;
}

export class ResolutionRiskPolicyService implements IResolutionRiskPolicyService {
    private readonly logger: Pick<Logger, "info" | "warn" | "error"> | undefined;
    private readonly rolloutInput: ResolutionRiskRolloutWindowInput;

    public constructor(deps: ResolutionRiskPolicyServiceDeps) {
        this.logger = deps.logger;
        this.rolloutInput = {
            enabled: deps.enabled,
            shadowEnabled: deps.shadowEnabled,
            shadowPercent: deps.shadowPercent,
            ...(deps.shadowStartAt ? { shadowStartAt: deps.shadowStartAt } : {}),
            ...(deps.shadowEndAt ? { shadowEndAt: deps.shadowEndAt } : {}),
            ...(deps.now ? { now: deps.now } : {})
        };
    }

    public applyRFQGrouping(grouping: ResolutionRiskVenueGrouping, stableKey: string): ResolutionRiskRFQGroupingResult {
        const mode = resolveResolutionRiskRolloutMode(stableKey, this.rolloutInput);
        if (mode === "enabled") {
            return {
                grouping,
                enforcementActive: true,
                mode
            };
        }

        resolutionRiskEnforcementDisabledTotal.labels("rfq").inc();
        if (mode === "shadow") {
            resolutionRiskShadowTotal.labels("rfq", mode).inc();
        }

        const effectiveGrouping = buildPermissiveGrouping(grouping);
        const hasDivergence = grouping.blockedProfiles.length > 0 || grouping.cautionLanes.length > 0;

        if (mode === "shadow") {
            if (hasDivergence) {
                const divergenceReason = grouping.blockedProfiles.length > 0 ? "blocked_vs_allowed" : "separated_vs_pooled";
                resolutionRiskShadowDivergenceTotal.labels("rfq", divergenceReason).inc();
                this.logShadowDivergence({
                    domain: "rfq",
                    mode,
                    enforcedDecision: "normal",
                    shadowDecision: {
                        outcome: grouping.blockedProfiles.length > 0 ? "blocked" : "separated",
                        reason: grouping.blockedProfiles.length > 0
                            ? "resolution-risk grouping would have blocked one or more venue profiles"
                            : "resolution-risk grouping would have separated one or more caution profiles",
                        equivalenceClass: grouping.blockedProfiles.length > 0 ? "DO_NOT_POOL" : "CAUTION"
                    },
                    reason: "resolution-risk RFQ grouping shadow evaluation",
                    divergenceReason,
                    enforcementActive: false,
                    canonicalEventId: grouping.canonicalEventId
                });
            } else {
                resolutionRiskShadowMatchTotal.labels("rfq").inc();
            }
        }

        return {
            grouping: effectiveGrouping,
            enforcementActive: false,
            mode,
            ...(mode === "shadow" ? { shadowGrouping: grouping } : {})
        };
    }

    public evaluateSORDecision(input: ResolutionRiskSOREvaluationInput): ResolutionRiskPolicyDecision {
        const mode = resolveResolutionRiskRolloutMode(input.stableKey, this.rolloutInput);
        if (mode === "enabled") {
            return {
                domain: "sor",
                mode,
                enforcementActive: true,
                enforcedDecision: input.intendedDecision,
                reason: input.reason
            };
        }

        resolutionRiskEnforcementDisabledTotal.labels("sor").inc();
        if (mode === "shadow") {
            resolutionRiskShadowTotal.labels("sor", mode).inc();
        }

        const divergenceReason = classifyShadowDivergence(input.intendedDecision, input.reason);
        if (mode === "shadow") {
            if (input.intendedDecision === "normal") {
                resolutionRiskShadowMatchTotal.labels("sor").inc();
            } else {
                resolutionRiskShadowDivergenceTotal.labels("sor", divergenceReason).inc();
                this.logShadowDivergence({
                    domain: "sor",
                    mode,
                    enforcedDecision: "normal",
                    shadowDecision: {
                        outcome: input.intendedDecision,
                        reason: input.reason,
                        ...(input.equivalenceClass ? { equivalenceClass: input.equivalenceClass } : {})
                    },
                    reason: input.reason,
                    divergenceReason,
                    enforcementActive: false,
                    ...(input.canonicalEventId ? { canonicalEventId: input.canonicalEventId } : {}),
                    ...(input.profileAId ? { profileAId: input.profileAId } : {}),
                    ...(input.profileBId ? { profileBId: input.profileBId } : {})
                });
            }
        }

        return {
            domain: "sor",
            mode,
            enforcementActive: false,
            enforcedDecision: "normal",
            reason: input.reason,
            ...(mode === "shadow"
                ? {
                    shadowDecision: {
                        outcome: input.intendedDecision,
                        reason: input.reason,
                        ...(input.equivalenceClass ? { equivalenceClass: input.equivalenceClass } : {})
                    },
                    ...(input.intendedDecision !== "normal" ? { divergenceReason } : {})
                }
                : {})
        };
    }

    public evaluateInternalEligibility(input: ResolutionRiskInternalEvaluationInput): boolean {
        const mode = resolveResolutionRiskRolloutMode(input.stableKey, this.rolloutInput);
        const equivalenceClass = input.equivalenceClass ?? "UNKNOWN";
        if (!input.intendedAllowed) {
            resolutionRiskInternalExclusionTotal.labels("internal_execution", equivalenceClass).inc();
        }

        if (mode === "enabled") {
            return input.intendedAllowed;
        }

        resolutionRiskEnforcementDisabledTotal.labels("internal_execution").inc();
        if (mode === "shadow") {
            resolutionRiskShadowTotal.labels("internal_execution", mode).inc();
            if (input.intendedAllowed) {
                resolutionRiskShadowMatchTotal.labels("internal_execution").inc();
            } else {
                const divergenceReason = classifyShadowDivergence("blocked", input.reason);
                resolutionRiskShadowDivergenceTotal.labels("internal_execution", divergenceReason).inc();
                this.logShadowDivergence({
                    domain: "internal_execution",
                    mode,
                    enforcedDecision: "normal",
                    shadowDecision: {
                        outcome: "blocked",
                        reason: input.reason,
                        equivalenceClass
                    },
                    reason: input.reason,
                    divergenceReason,
                    enforcementActive: false,
                    ...(input.canonicalEventId ? { canonicalEventId: input.canonicalEventId } : {}),
                    ...(input.profileAId ? { profileAId: input.profileAId } : {}),
                    ...(input.profileBId ? { profileBId: input.profileBId } : {})
                });
            }
        }

        return true;
    }

    private logShadowDivergence(input: {
        domain: ResolutionRiskPolicyDomain;
        mode: "shadow";
        enforcedDecision: ResolutionRiskPolicyOutcome;
        shadowDecision: {
            outcome: ResolutionRiskPolicyOutcome;
            reason: string;
            equivalenceClass?: ResolutionEquivalenceClass | "UNKNOWN";
        };
        reason: string;
        divergenceReason: ResolutionRiskShadowDivergenceReason;
        enforcementActive: boolean;
        canonicalEventId?: string;
        profileAId?: string;
        profileBId?: string;
    }): void {
        this.logger?.warn(
            {
                domain: input.domain,
                mode: input.mode,
                enforcementActive: input.enforcementActive,
                enforcedDecision: input.enforcedDecision,
                shadowDecision: input.shadowDecision.outcome,
                equivalenceClass: input.shadowDecision.equivalenceClass ?? null,
                reason: input.reason,
                divergenceReason: input.divergenceReason,
                canonicalEventId: input.canonicalEventId ?? null,
                profileAId: input.profileAId ?? null,
                profileBId: input.profileBId ?? null
            },
            "Resolution-risk shadow decision diverged from enforced behavior."
        );
    }
}

const buildPermissiveGrouping = (grouping: ResolutionRiskVenueGrouping): ResolutionRiskVenueGrouping => {
    const allProfiles = [
        ...grouping.safePools.flatMap((lane) => lane),
        ...grouping.cautionLanes.flatMap((lane) => lane),
        ...grouping.blockedProfiles
    ].sort((left, right) => left.localeCompare(right));

    const dedupedProfiles = [...new Set(allProfiles)];

    return {
        canonicalEventId: grouping.canonicalEventId,
        safePools: dedupedProfiles.length > 0 ? [dedupedProfiles] : [],
        cautionLanes: [],
        blockedProfiles: [],
        reasonsByProfile: {},
        pairMatrix: grouping.pairMatrix
    };
};

const classifyShadowDivergence = (
    intendedDecision: ResolutionRiskPolicyOutcome,
    reason: string
): ResolutionRiskShadowDivergenceReason => {
    if (reason.includes("missing_resolution_profile_id") || reason.includes("missing_profile_mapping")) {
        return "missing_profile_mapping";
    }
    if (reason.includes("missing_resolution_risk_assessment") || reason.includes("missing_assessment")) {
        return "missing_assessment";
    }

    switch (intendedDecision) {
        case "blocked":
            return "blocked_vs_allowed";
        case "separated":
            return "separated_vs_pooled";
        case "penalty":
            return "penalty_vs_no_penalty";
        case "isolated_only":
            return "excluded_vs_allowed";
        case "normal":
            return "blocked_vs_allowed";
    }
};
