import type { RouteCandidate } from "../core/sor/types.js";
import { getResolutionProfileId } from "../core/sor/resolution-risk-routing-policy.js";
import type { CompatibilityOverrideService } from "../canonical/compatibility-override-service.js";

export interface FeasibilityFilterResult {
    acceptedCandidates: readonly RouteCandidate[];
    rejectedCandidates: readonly { candidate: RouteCandidate; reasonCode: string; reasonPayload: Record<string, unknown> }[];
    compatibilityDecisionIds: readonly string[];
    compatibilityVersionIds: readonly string[];
}

export class FeasibilityFilter {
    public constructor(private readonly compatibilityOverrideService?: CompatibilityOverrideService) {}

    public async filter(
        candidates: readonly RouteCandidate[],
        decisionIdsByResolutionProfileId: ReadonlyMap<string, string> = new Map()
    ): Promise<FeasibilityFilterResult> {
        const accepted: RouteCandidate[] = [];
        const rejected: Array<{ candidate: RouteCandidate; reasonCode: string; reasonPayload: Record<string, unknown> }> = [];
        const compatibilityDecisionIds = new Set<string>();
        const compatibilityVersionIds = new Set<string>();

        for (const candidate of candidates) {
            const resolutionProfileId = getResolutionProfileId(candidate);
            const candidateDecisionId =
                typeof candidate.metadata?.["compatibility_decision_id"] === "string"
                    ? String(candidate.metadata?.["compatibility_decision_id"])
                    : null;

            if (!resolutionProfileId && !candidateDecisionId) {
                accepted.push(candidate);
                continue;
            }

            const decisionId = candidateDecisionId ?? (resolutionProfileId ? decisionIdsByResolutionProfileId.get(resolutionProfileId) : undefined);
            if (!decisionId || !this.compatibilityOverrideService) {
                accepted.push(candidate);
                continue;
            }

            const effectiveDecision = await this.compatibilityOverrideService.resolveEffectiveDecision(decisionId);
            compatibilityDecisionIds.add(effectiveDecision.baseDecision.id);
            compatibilityVersionIds.add(effectiveDecision.baseDecision.compatibilityVersionId);

            if (effectiveDecision.overrideAmbiguous) {
                rejected.push({
                    candidate,
                    reasonCode: "COMPATIBILITY_OVERRIDE_AMBIGUOUS",
                    reasonPayload: { decisionId }
                });
                continue;
            }

            if (
                effectiveDecision.effectiveClass !== "EQUIVALENT" &&
                effectiveDecision.effectiveClass !== "COMPATIBLE_WITH_CAUTION"
            ) {
                rejected.push({
                    candidate,
                    reasonCode: "COMPATIBILITY_NOT_EQUIVALENT",
                    reasonPayload: {
                        decisionId,
                        compatibilityClass: effectiveDecision.effectiveClass
                    }
                });
                continue;
            }

            accepted.push(candidate);
        }

        return {
            acceptedCandidates: accepted,
            rejectedCandidates: rejected,
            compatibilityDecisionIds: [...compatibilityDecisionIds],
            compatibilityVersionIds: [...compatibilityVersionIds]
        };
    }
}
