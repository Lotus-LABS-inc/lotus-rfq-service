import type {
    NormalizedResolutionProfile,
    ResolutionEquivalenceClass,
    ResolutionRiskAssessment,
    ResolutionRiskVenueGrouping
} from "./resolution-risk.types.js";
import { pairKey } from "./resolution-risk-read-service.js";

const appendReason = (reasonsByProfile: Map<string, string[]>, profileId: string, reason: string): void => {
    const current = reasonsByProfile.get(profileId) ?? [];
    current.push(reason);
    reasonsByProfile.set(profileId, current);
};

const appendReasons = (
    reasonsByProfile: Map<string, string[]>,
    profileId: string,
    reasons: readonly string[]
): void => {
    for (const reason of reasons) {
        appendReason(reasonsByProfile, profileId, reason);
    }
};

export const buildResolutionRiskPairs = (
    profiles: readonly NormalizedResolutionProfile[]
): ReadonlyArray<{ profileAId: string; profileBId: string }> => {
    const pairs: Array<{ profileAId: string; profileBId: string }> = [];
    for (let index = 0; index < profiles.length; index += 1) {
        for (let cursor = index + 1; cursor < profiles.length; cursor += 1) {
            pairs.push({
                profileAId: profiles[index]!.id,
                profileBId: profiles[cursor]!.id
            });
        }
    }

    return pairs;
};

export const computeResolutionRiskVenueGrouping = (
    canonicalEventId: string,
    orderedProfiles: readonly NormalizedResolutionProfile[],
    assessmentMap: ReadonlyMap<string, ResolutionRiskAssessment>
): ResolutionRiskVenueGrouping => {
    const cautionProfiles = new Set<string>();
    const blockedProfiles = new Set<string>();
    const reasonsByProfile = new Map<string, string[]>();
    const pairMatrixEntries: Array<[string, { equivalenceClass: ResolutionEquivalenceClass; reasons: readonly string[] }]> = [];

    for (let index = 0; index < orderedProfiles.length; index += 1) {
        for (let cursor = index + 1; cursor < orderedProfiles.length; cursor += 1) {
            const left = orderedProfiles[index]!;
            const right = orderedProfiles[cursor]!;
            const key = pairKey(left.id, right.id);
            if (left.canonicalMarketId !== right.canonicalMarketId) {
                const reason = `pair:${key}: market identity mismatch (${left.canonicalMarketId} vs ${right.canonicalMarketId}); sub-markets cannot be pooled`;
                blockedProfiles.add(left.id);
                blockedProfiles.add(right.id);
                appendReason(reasonsByProfile, left.id, reason);
                appendReason(reasonsByProfile, right.id, reason);
                pairMatrixEntries.push([
                    key,
                    {
                        equivalenceClass: "DO_NOT_POOL",
                        reasons: [reason]
                    }
                ]);
                continue;
            }

            const assessment = assessmentMap.get(key);

            if (!assessment) {
                const reason = `pair:${key}: missing persisted resolution risk assessment; fail-closed for pooling`;
                cautionProfiles.add(left.id);
                cautionProfiles.add(right.id);
                appendReason(reasonsByProfile, left.id, reason);
                appendReason(reasonsByProfile, right.id, reason);
                pairMatrixEntries.push([
                    key,
                    {
                        equivalenceClass: "DO_NOT_POOL",
                        reasons: [reason]
                    }
                ]);
                continue;
            }

            const prefixedReasons =
                assessment.reasons.length > 0
                    ? assessment.reasons.map((reason) => `pair:${key}: ${reason}`)
                    : [`pair:${key}: ${assessment.equivalenceClass}`];

            pairMatrixEntries.push([
                key,
                {
                    equivalenceClass: assessment.equivalenceClass,
                    reasons: prefixedReasons
                }
            ]);

            switch (assessment.equivalenceClass) {
                case "SAFE_EQUIVALENT":
                case "EQUIVALENT_WITH_LAG":
                    break;
                case "CAUTION":
                    cautionProfiles.add(left.id);
                    cautionProfiles.add(right.id);
                    appendReasons(reasonsByProfile, left.id, prefixedReasons);
                    appendReasons(reasonsByProfile, right.id, prefixedReasons);
                    break;
                case "HIGH_RISK":
                case "DO_NOT_POOL":
                    blockedProfiles.add(left.id);
                    blockedProfiles.add(right.id);
                    appendReasons(reasonsByProfile, left.id, prefixedReasons);
                    appendReasons(reasonsByProfile, right.id, prefixedReasons);
                    break;
            }
        }
    }

    for (const blockedProfileId of blockedProfiles) {
        cautionProfiles.delete(blockedProfileId);
    }

    const safeCandidates = orderedProfiles
        .map((profile) => profile.id)
        .filter((profileId) => !blockedProfiles.has(profileId) && !cautionProfiles.has(profileId));

    const safePools = safeCandidates.length === 0 ? [] : [safeCandidates];
    const cautionLanes = [...cautionProfiles]
        .sort((left, right) => left.localeCompare(right))
        .map((profileId) => [profileId]);
    const groupedReasons = Object.fromEntries(
        [...reasonsByProfile.entries()]
            .sort((left, right) => left[0].localeCompare(right[0]))
            .map(([profileId, reasons]) => [profileId, [...new Set(reasons)].sort((left, right) => left.localeCompare(right))])
    );

    return {
        canonicalEventId,
        safePools,
        cautionLanes,
        blockedProfiles: [...blockedProfiles].sort((left, right) => left.localeCompare(right)),
        reasonsByProfile: groupedReasons,
        pairMatrix: Object.fromEntries(
            pairMatrixEntries.sort((left, right) => left[0].localeCompare(right[0]))
        )
    };
};
