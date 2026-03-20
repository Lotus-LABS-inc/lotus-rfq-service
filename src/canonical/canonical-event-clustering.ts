import type {
    CanonicalEvent,
    PropositionFingerprint,
    VenueMarketProfile
} from "./canonicalization-types.js";
import {
    buildStableUuid,
    clampRatioString,
    normalizeCategory,
    normalizeMarketClass
} from "./canonicalization-types.js";

export interface CanonicalEventCluster {
    event: CanonicalEvent;
    members: readonly {
        market: VenueMarketProfile;
        fingerprint: PropositionFingerprint;
    }[];
}

export class CanonicalEventClusteringService {
    public cluster(
        inputs: readonly {
            market: VenueMarketProfile;
            fingerprint: PropositionFingerprint;
        }[]
    ): readonly CanonicalEventCluster[] {
        const grouped = new Map<string, Array<{ market: VenueMarketProfile; fingerprint: PropositionFingerprint }>>();

        for (const input of inputs) {
            const key = input.fingerprint.broadFingerprintKey;
            const existing = grouped.get(key);
            if (existing) {
                existing.push(input);
                continue;
            }
            grouped.set(key, [input]);
        }

        return [...grouped.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, members]) => ({
                event: this.buildEvent(key, members),
                members: members.sort((left, right) => left.market.id.localeCompare(right.market.id))
            }));
    }

    private buildEvent(
        propositionKey: string,
        members: readonly {
            market: VenueMarketProfile;
            fingerprint: PropositionFingerprint;
        }[]
    ): CanonicalEvent {
        const sortedMembers = [...members].sort((left, right) => left.market.id.localeCompare(right.market.id));
        const first = sortedMembers[0]!;
        const confidence = sortedMembers.reduce(
            (sum, member) => sum + Number(member.fingerprint.confidenceScore),
            0
        ) / sortedMembers.length;
        const startsAt = this.minDate(sortedMembers.map((member) => member.market.publishedAt));
        const expiresAt = this.maxDate(sortedMembers.map((member) => member.market.expiresAt));
        const resolvesAt = this.maxDate(sortedMembers.map((member) => member.market.resolvesAt));
        const now = new Date();

        return {
            id: buildStableUuid(`canonical-event:${propositionKey}`),
            propositionKey,
            title: first.fingerprint.normalizedPropositionText || first.market.title,
            normalizedPropositionText: first.fingerprint.normalizedPropositionText,
            category: normalizeCategory(first.market.category),
            marketClass: normalizeMarketClass(first.market.marketClass),
            propositionConfidenceScore: clampRatioString(confidence),
            startsAt,
            expiresAt,
            resolvesAt,
            sourceHints: {
                groupedVenueCount: sortedMembers.length,
                venues: sortedMembers.map((member) => member.market.venue)
            },
            metadata: {
                broadFingerprintKey: propositionKey
            },
            createdAt: now,
            updatedAt: now
        };
    }

    private minDate(values: readonly (Date | null)[]): Date | null {
        const dates = values.filter((value): value is Date => value instanceof Date);
        if (dates.length === 0) {
            return null;
        }
        return new Date(Math.min(...dates.map((value) => value.getTime())));
    }

    private maxDate(values: readonly (Date | null)[]): Date | null {
        const dates = values.filter((value): value is Date => value instanceof Date);
        if (dates.length === 0) {
            return null;
        }
        return new Date(Math.max(...dates.map((value) => value.getTime())));
    }
}
