import type { IResolutionRiskReadService } from "./resolution-risk-read-service.js";
import type { IResolutionRiskPolicyService } from "./resolution-risk-policy-service.js";
import type { ResolutionEquivalenceClass } from "./resolution-risk.types.js";

export interface ResolutionRiskEligibilityContext {
    stableKey?: string;
    canonicalEventId?: string;
}

export interface IResolutionRiskEligibilityService {
    isSafeForInternalPooling(profileAId: string, profileBId: string, context?: ResolutionRiskEligibilityContext): Promise<boolean>;
    isSafeForCrossVenueNetting(profileAId: string, profileBId: string, context?: ResolutionRiskEligibilityContext): Promise<boolean>;
}

export interface ResolutionRiskEligibilityServiceDeps {
    readService: IResolutionRiskReadService;
    policyService?: IResolutionRiskPolicyService;
}

export class ResolutionRiskEligibilityService implements IResolutionRiskEligibilityService {
    private readonly readService: IResolutionRiskReadService;
    private readonly policyService: IResolutionRiskPolicyService | undefined;

    public constructor(deps: ResolutionRiskEligibilityServiceDeps) {
        this.readService = deps.readService;
        this.policyService = deps.policyService;
    }

    public async isSafeForInternalPooling(
        profileAId: string,
        profileBId: string,
        context?: ResolutionRiskEligibilityContext
    ): Promise<boolean> {
        return this.isSafeEquivalentPair(profileAId, profileBId, context);
    }

    public async isSafeForCrossVenueNetting(
        profileAId: string,
        profileBId: string,
        context?: ResolutionRiskEligibilityContext
    ): Promise<boolean> {
        return this.isSafeEquivalentPair(profileAId, profileBId, context);
    }

    private async isSafeEquivalentPair(
        profileAId: string,
        profileBId: string,
        context?: ResolutionRiskEligibilityContext
    ): Promise<boolean> {
        if (profileAId.trim().length === 0 || profileBId.trim().length === 0) {
            return this.applyPolicy(false, undefined, "missing_profile_mapping", profileAId, profileBId, context);
        }

        if (profileAId === profileBId) {
            return this.applyPolicy(true, "SAFE_EQUIVALENT", "same_resolution_profile_id", profileAId, profileBId, context);
        }

        const assessment = await this.readService.getAssessmentByProfilePair(profileAId, profileBId);
        if (!assessment) {
            return this.applyPolicy(false, undefined, "missing_assessment", profileAId, profileBId, context);
        }

        return this.applyPolicy(
            assessment.equivalenceClass === "SAFE_EQUIVALENT",
            assessment.equivalenceClass,
            assessment.equivalenceClass,
            profileAId,
            profileBId,
            context
        );
    }

    private applyPolicy(
        intendedAllowed: boolean,
        equivalenceClass: ResolutionEquivalenceClass | undefined,
        reason: string,
        profileAId: string,
        profileBId: string,
        context?: ResolutionRiskEligibilityContext
    ): boolean {
        if (!this.policyService) {
            return intendedAllowed;
        }

        return this.policyService.evaluateInternalEligibility({
            stableKey: context?.stableKey ?? `${profileAId}|${profileBId}`,
            intendedAllowed,
            reason,
            ...(equivalenceClass ? { equivalenceClass } : {}),
            ...(context?.canonicalEventId ? { canonicalEventId: context.canonicalEventId } : {}),
            profileAId,
            profileBId
        });
    }
}
