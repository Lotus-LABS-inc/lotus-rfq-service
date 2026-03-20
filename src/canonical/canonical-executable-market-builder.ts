import type { CanonicalExecutableMarket, CompatibilityEdge, VenueMarketProfile } from "./canonicalization-types.js";
import { buildStableTextId } from "./canonicalization-types.js";

export class CanonicalExecutableMarketBuilder {
    public build(params: {
        canonicalEventId: string;
        profiles: readonly VenueMarketProfile[];
        edges: readonly CompatibilityEdge[];
    }): readonly CanonicalExecutableMarket[] {
        const adjacency = new Map<string, Set<string>>();
        for (const profile of params.profiles) {
            adjacency.set(profile.id, new Set<string>([profile.id]));
        }

        for (const edge of params.edges) {
            if (edge.compatibilityClass !== "EQUIVALENT") {
                continue;
            }
            adjacency.get(edge.marketAProfileId)?.add(edge.marketBProfileId);
            adjacency.get(edge.marketBProfileId)?.add(edge.marketAProfileId);
        }

        const visited = new Set<string>();
        const executableMarkets: CanonicalExecutableMarket[] = [];

        for (const profile of [...params.profiles].sort((left, right) => left.id.localeCompare(right.id))) {
            if (visited.has(profile.id)) {
                continue;
            }
            const component = this.walkComponent(profile.id, adjacency, visited);
            const sortedMembers = component.sort((left, right) => left.localeCompare(right));
            const representative = params.profiles.find((candidate) => candidate.id === sortedMembers[0]) ?? profile;
            const now = new Date();

            executableMarkets.push({
                id: buildStableTextId("cem_", `${params.canonicalEventId}|${sortedMembers.join("|")}`),
                canonicalEventId: params.canonicalEventId,
                displayName: representative.title,
                marketClass: representative.marketClass,
                compatibilityPolicy: "EQUIVALENT_ONLY",
                riskClass: "EQUIVALENT",
                memberProfileIds: sortedMembers,
                metadata: {
                    memberCount: sortedMembers.length,
                    venues: sortedMembers
                        .map((memberId) => params.profiles.find((candidate) => candidate.id === memberId)?.venue)
                        .filter((venue): venue is VenueMarketProfile["venue"] => venue !== undefined)
                },
                createdAt: now,
                updatedAt: now
            });
        }

        return executableMarkets;
    }

    private walkComponent(
        rootId: string,
        adjacency: ReadonlyMap<string, ReadonlySet<string>>,
        visited: Set<string>
    ): string[] {
        const stack = [rootId];
        const members: string[] = [];

        while (stack.length > 0) {
            const current = stack.pop();
            if (!current || visited.has(current)) {
                continue;
            }
            visited.add(current);
            members.push(current);
            const neighbors = adjacency.get(current);
            if (!neighbors) {
                continue;
            }
            for (const neighbor of neighbors) {
                if (!visited.has(neighbor)) {
                    stack.push(neighbor);
                }
            }
        }

        return members;
    }
}
