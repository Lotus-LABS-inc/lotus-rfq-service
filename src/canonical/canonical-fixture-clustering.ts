import type { CanonicalEventCluster } from "./canonical-event-clustering.js";
import {
    buildStableTextId,
    buildStableUuid,
    type CanonicalCategory,
    type CanonicalFixtureEvent
} from "./canonicalization-types.js";

export interface CanonicalFixtureClusteringResult {
    canonicalFixtureEvents: readonly CanonicalFixtureEvent[];
    canonicalEventFixtureLinks: ReadonlyMap<string, string>;
}

interface FixtureCandidate {
    cluster: CanonicalEventCluster;
    semanticBoundaryKey: string;
    tokens: ReadonlySet<string>;
}

const FIXTURE_CATEGORIES = new Set<CanonicalCategory>(["SPORTS", "ESPORTS"]);

const TOKEN_STOPWORDS = new Set([
    "a",
    "an",
    "and",
    "at",
    "by",
    "draw",
    "game",
    "match",
    "market",
    "no",
    "of",
    "or",
    "the",
    "to",
    "v",
    "vs",
    "will",
    "win",
    "winner",
    "wins",
    "yes"
]);

const tokenize = (value: string): string[] =>
    value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 1 && !TOKEN_STOPWORDS.has(token));

const titleCase = (value: string): string =>
    value
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
        .join(" ");

const semanticBoundaryKeyForCluster = (cluster: CanonicalEventCluster): string | null => {
    for (const member of cluster.members) {
        const key = member.fingerprint.groupingHints["semanticBoundaryKey"];
        if (typeof key === "string" && key.trim().length > 0) {
            return key.trim();
        }
    }
    const date = cluster.event.resolvesAt ?? cluster.event.expiresAt;
    return date ? date.toISOString().slice(0, 10) : null;
};

const subjectTokensForCluster = (cluster: CanonicalEventCluster): ReadonlySet<string> => {
    const tokens = new Set<string>();
    for (const member of cluster.members) {
        const subject = member.fingerprint.broadFingerprintKey.split("|")[0] ?? "";
        for (const token of tokenize(subject)) {
            tokens.add(token);
        }
        const fixtureTitle = detectFixtureTitle([member.market.title, member.market.resolutionTitle]);
        if (fixtureTitle) {
            for (const token of tokenize(fixtureTitle)) {
                tokens.add(token);
            }
        }
    }
    return tokens;
};

const intersection = (left: ReadonlySet<string>, right: ReadonlySet<string>): string[] => {
    const shared: string[] = [];
    for (const token of left) {
        if (right.has(token)) {
            shared.push(token);
        }
    }
    return shared.sort((a, b) => a.localeCompare(b));
};

const detectFixtureTitle = (titles: readonly (string | null | undefined)[]): string | null => {
    for (const rawTitle of titles) {
        const title = rawTitle?.replace(/\s+/g, " ").trim();
        if (!title) {
            continue;
        }
        const match = title.match(
            /(?:^|[^a-z0-9])([a-z0-9][a-z0-9 '&.-]{1,80}?)\s+(?:vs\.?|v\.?)\s+([a-z0-9][a-z0-9 '&.-]{1,80}?)(?=$|[?:|(-]|\s+(?:win|wins|draw|moneyline|result)\b)/i
        );
        if (!match?.[1] || !match[2]) {
            continue;
        }
        const left = titleCase(match[1].replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ""));
        const right = titleCase(match[2].replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ""));
        if (left && right) {
            return `${left} vs ${right}`;
        }
    }
    return null;
};

const scheduledAtFromBoundary = (semanticBoundaryKey: string): Date | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(semanticBoundaryKey)) {
        return null;
    }
    const date = new Date(`${semanticBoundaryKey}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
};

const fallbackDisplayTitle = (sharedTokens: readonly string[]): string => {
    const [left, right] = sharedTokens;
    if (left && right) {
        return `${titleCase(left)} vs ${titleCase(right)}`;
    }
    return titleCase(sharedTokens.join(" ")) || "Fixture";
};

export class CanonicalFixtureClusteringService {
    public cluster(clusters: readonly CanonicalEventCluster[]): CanonicalFixtureClusteringResult {
        const candidates = clusters
            .filter((cluster) => FIXTURE_CATEGORIES.has(cluster.event.category))
            .map((cluster): FixtureCandidate | null => {
                const semanticBoundaryKey = semanticBoundaryKeyForCluster(cluster);
                if (!semanticBoundaryKey) {
                    return null;
                }
                const tokens = subjectTokensForCluster(cluster);
                if (tokens.size < 2) {
                    return null;
                }
                return { cluster, semanticBoundaryKey, tokens };
            })
            .filter((candidate): candidate is FixtureCandidate => candidate !== null);

        const groups = this.connectedGroups(candidates);
        const now = new Date();
        const fixtureEvents: CanonicalFixtureEvent[] = [];
        const links = new Map<string, string>();

        for (const group of groups) {
            if (group.length < 2) {
                continue;
            }
            const category = group[0]!.cluster.event.category;
            const semanticBoundaryKey = group[0]!.semanticBoundaryKey;
            const sharedTokens = this.sharedTokens(group);
            if (sharedTokens.length < 2) {
                continue;
            }
            const fixtureKey = buildStableTextId(
                "fixture_",
                `${category}:${sharedTokens.join("-")}:${semanticBoundaryKey}`
            );
            const id = buildStableUuid(`canonical-fixture-event:${fixtureKey}`);
            const displayTitle =
                this.detectBestFixtureTitle(group) ?? fallbackDisplayTitle(sharedTokens);

            fixtureEvents.push({
                id,
                fixtureKey,
                displayTitle,
                category,
                scheduledAt: scheduledAtFromBoundary(semanticBoundaryKey),
                createdAt: now,
                updatedAt: now
            });
            for (const candidate of group) {
                links.set(candidate.cluster.event.id, id);
            }
        }

        return {
            canonicalFixtureEvents: fixtureEvents.sort((left, right) =>
                left.category.localeCompare(right.category) || left.displayTitle.localeCompare(right.displayTitle)
            ),
            canonicalEventFixtureLinks: links
        };
    }

    private connectedGroups(candidates: readonly FixtureCandidate[]): FixtureCandidate[][] {
        const groupsByBoundary = new Map<string, FixtureCandidate[]>();
        for (const candidate of candidates) {
            const key = `${candidate.cluster.event.category}:${candidate.semanticBoundaryKey}`;
            const bucket = groupsByBoundary.get(key) ?? [];
            bucket.push(candidate);
            groupsByBoundary.set(key, bucket);
        }

        const groups: FixtureCandidate[][] = [];
        for (const bucket of groupsByBoundary.values()) {
            const visited = new Set<number>();
            for (let index = 0; index < bucket.length; index += 1) {
                if (visited.has(index)) {
                    continue;
                }
                const component: FixtureCandidate[] = [];
                const queue = [index];
                visited.add(index);
                while (queue.length > 0) {
                    const currentIndex = queue.shift()!;
                    const current = bucket[currentIndex]!;
                    component.push(current);
                    for (let otherIndex = 0; otherIndex < bucket.length; otherIndex += 1) {
                        if (visited.has(otherIndex)) {
                            continue;
                        }
                        const other = bucket[otherIndex]!;
                        if (intersection(current.tokens, other.tokens).length >= 2) {
                            visited.add(otherIndex);
                            queue.push(otherIndex);
                        }
                    }
                }
                groups.push(component);
            }
        }
        return groups;
    }

    private sharedTokens(group: readonly FixtureCandidate[]): string[] {
        const [first, ...rest] = group;
        if (!first) {
            return [];
        }
        let shared = new Set(first.tokens);
        for (const candidate of rest) {
            shared = new Set([...shared].filter((token) => candidate.tokens.has(token)));
        }
        return [...shared].sort((left, right) => left.localeCompare(right));
    }

    private detectBestFixtureTitle(group: readonly FixtureCandidate[]): string | null {
        const candidates = new Map<string, number>();
        for (const candidate of group) {
            const title = detectFixtureTitle([
                candidate.cluster.event.title,
                ...candidate.cluster.members.flatMap((member) => [
                    member.market.title,
                    member.market.resolutionTitle
                ])
            ]);
            if (!title) {
                continue;
            }
            candidates.set(title, (candidates.get(title) ?? 0) + 1);
        }
        return [...candidates.entries()].sort(
            ([leftTitle, leftCount], [rightTitle, rightCount]) =>
                rightCount - leftCount || leftTitle.localeCompare(rightTitle)
        )[0]?.[0] ?? null;
    }
}
