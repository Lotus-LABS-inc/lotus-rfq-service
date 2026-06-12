import type {
    CanonicalCategory,
    CanonicalEvent,
    CanonicalExecutableMarket,
    CanonicalFeeProfile,
    CanonicalMarketClass,
    CanonicalOutcomeDefinition,
    CanonicalVenue,
    SettlementType
} from "./canonicalization-types.js";
import { clampRatioString, normalizeCategory, normalizeMarketClass } from "./canonicalization-types.js";
import { CanonicalEventClusteringService } from "./canonical-event-clustering.js";
import { CanonicalFixtureClusteringService } from "./canonical-fixture-clustering.js";
import { CompatibilityEdgeScorer } from "./compatibility-edge-scorer.js";
import { PropositionFingerprintBuilder } from "./proposition-fingerprint.js";
import { CanonicalResolutionProfileNormalizer } from "./resolution-profile-normalizer.js";
import { CanonicalSettlementProfileNormalizer } from "./settlement-profile-normalizer.js";
import { VenueMarketProfileFactory } from "./venue-market-profile.js";
import type { CanonicalGraphSnapshot } from "../repositories/canonical-graph.repository.js";

export interface CuratedCanonicalGraphSeed {
    canonicalEventId: string;
    canonicalMarketId: string;
    canonicalCategory: CanonicalCategory | string;
    venue: CanonicalVenue;
    venueMarketId: string;
    title: string;
    description?: string | null;
    marketType?: string | null;
    marketClass?: CanonicalMarketClass | string | null;
    outcomes?: readonly CanonicalOutcomeDefinition[];
    outcomeSchema?: Record<string, unknown>;
    topics?: readonly string[];
    publishedAt?: Date | null;
    expiresAt?: Date | null;
    resolvesAt?: Date | null;
    fees?: CanonicalFeeProfile;
    feeModel?: string | null;
    resolutionSource?: string | null;
    resolutionTitle?: string | null;
    resolutionRulesText?: string | null;
    resolutionAuthorityType?: string | null;
    sourceHierarchy?: Record<string, unknown> | null;
    disputeWindowHours?: string | number | null;
    ambiguousTimeBoundary?: boolean;
    ambiguousSourceReference?: boolean;
    ambiguousJurisdictionOrScope?: boolean;
    settlementType?: SettlementType | null;
    settlementLagHours?: string | number | null;
    finalityLagHours?: string | number | null;
    payoutTimingHours?: string | number | null;
    feeOnEntry?: boolean;
    feeOnExit?: boolean;
    timeSensitiveFeeBehavior?: string | null;
    requiresConservativeAnchor?: boolean;
    network?: string | null;
    chain?: string | null;
    rawSourcePayload?: Record<string, unknown>;
    normalizedPayload?: Record<string, unknown>;
    mappingLineage?: readonly string[];
    confidenceScore?: string;
    sourceMetadataVersion: string;
    propositionHints?: {
        subject?: string | null;
        condition?: string | null;
        timeBoundary?: string | null;
        normalizedPropositionText?: string | null;
        groupingHints?: Record<string, unknown>;
    };
    eventPropositionKey?: string;
    eventTitle?: string;
    eventNormalizedPropositionText?: string;
    eventSourceHints?: Record<string, unknown>;
    eventMetadata?: Record<string, unknown>;
    executableDisplayName?: string;
    executableMetadata?: Record<string, unknown>;
}

interface NormalizedSeedContext {
    seed: CuratedCanonicalGraphSeed;
    profile: ReturnType<VenueMarketProfileFactory["create"]>;
    resolutionProfile: ReturnType<CanonicalResolutionProfileNormalizer["normalize"]>;
    settlementProfile: ReturnType<CanonicalSettlementProfileNormalizer["normalize"]>;
    fingerprint: ReturnType<PropositionFingerprintBuilder["build"]>;
}

const averageRatio = (values: readonly string[]): string => {
    if (values.length === 0) {
        return "0";
    }
    const average =
        values.reduce((sum, value) => sum + Number(value || "0"), 0) / values.length;
    return clampRatioString(average);
};

export class CuratedCanonicalGraphSnapshotBuilder {
    private readonly marketProfileFactory = new VenueMarketProfileFactory();
    private readonly resolutionNormalizer = new CanonicalResolutionProfileNormalizer();
    private readonly settlementNormalizer = new CanonicalSettlementProfileNormalizer();
    private readonly fingerprintBuilder = new PropositionFingerprintBuilder();
    private readonly clusteringService = new CanonicalEventClusteringService();
    private readonly fixtureClusteringService = new CanonicalFixtureClusteringService();
    private readonly edgeScorer = new CompatibilityEdgeScorer();

    public build(seeds: readonly CuratedCanonicalGraphSeed[]): CanonicalGraphSnapshot {
        const contexts = seeds.map((seed) => this.buildSeedContext(seed));
        const canonicalEventClusters = this.buildCanonicalEventClusters(contexts);
        const fixtureClustering = this.fixtureClusteringService.cluster(canonicalEventClusters);
        const canonicalEvents = canonicalEventClusters.map((cluster) => ({
            ...cluster.event,
            canonicalFixtureEventId: fixtureClustering.canonicalEventFixtureLinks.get(cluster.event.id) ?? null
        }));
        const executableMarkets = this.buildExecutableMarkets(contexts);
        const compatibilityEdges = this.buildCompatibilityEdges(contexts, executableMarkets);

        return {
            canonicalEvents,
            canonicalFixtureEvents: fixtureClustering.canonicalFixtureEvents,
            canonicalEventFixtureLinks: fixtureClustering.canonicalEventFixtureLinks,
            venueMarketProfiles: contexts.map((context) => context.profile),
            propositionFingerprints: contexts.map((context) => context.fingerprint),
            resolutionProfiles: contexts.map((context) => context.resolutionProfile),
            settlementProfiles: contexts.map((context) => context.settlementProfile),
            compatibilityEdges,
            executableMarkets
        };
    }

    private buildSeedContext(seed: CuratedCanonicalGraphSeed): NormalizedSeedContext {
        const profile = this.marketProfileFactory.create({
            canonicalEventId: seed.canonicalEventId,
            venue: seed.venue,
            venueMarketId: seed.venueMarketId,
            title: seed.title,
            ...(seed.description !== undefined ? { description: seed.description } : {}),
            ...(seed.marketType !== undefined ? { marketType: seed.marketType } : {}),
            ...(seed.marketClass !== undefined ? { marketClass: seed.marketClass } : {}),
            ...(seed.outcomes !== undefined ? { outcomes: seed.outcomes } : {}),
            ...(seed.outcomeSchema !== undefined ? { outcomeSchema: seed.outcomeSchema } : {}),
            ...(seed.topics !== undefined ? { topics: seed.topics } : {}),
            category: seed.canonicalCategory,
            ...(seed.publishedAt !== undefined ? { publishedAt: seed.publishedAt } : {}),
            ...(seed.expiresAt !== undefined ? { expiresAt: seed.expiresAt } : {}),
            ...(seed.resolvesAt !== undefined ? { resolvesAt: seed.resolvesAt } : {}),
            ...(seed.fees !== undefined ? { fees: seed.fees } : {}),
            ...(seed.feeModel !== undefined ? { feeModel: seed.feeModel } : {}),
            ...(seed.resolutionSource !== undefined ? { resolutionSource: seed.resolutionSource } : {}),
            resolutionTitle: seed.resolutionTitle ?? seed.title,
            ...(seed.resolutionRulesText !== undefined ? { resolutionRulesText: seed.resolutionRulesText } : {}),
            ...(seed.network !== undefined ? { network: seed.network } : {}),
            ...(seed.chain !== undefined ? { chain: seed.chain } : {}),
            ...(seed.rawSourcePayload !== undefined ? { rawSourcePayload: seed.rawSourcePayload } : {}),
            ...(seed.normalizedPayload !== undefined ? { normalizedPayload: seed.normalizedPayload } : {}),
            ...(seed.mappingLineage !== undefined ? { mappingLineage: seed.mappingLineage } : {}),
            ...(seed.confidenceScore !== undefined ? { confidenceScore: seed.confidenceScore } : {}),
            sourceMetadataVersion: seed.sourceMetadataVersion
        });

        const resolutionProfile = this.resolutionNormalizer.normalize({
            venueMarketProfileId: profile.id,
            ...(seed.resolutionSource !== undefined || profile.resolutionSource !== null
                ? { resolutionSource: seed.resolutionSource ?? profile.resolutionSource }
                : {}),
            resolutionTitle: seed.resolutionTitle ?? profile.resolutionTitle ?? profile.title,
            ...(seed.resolutionAuthorityType !== undefined ? { resolutionAuthorityType: seed.resolutionAuthorityType } : {}),
            ...(seed.resolutionRulesText !== undefined ? { ruleText: seed.resolutionRulesText } : {}),
            ...(seed.sourceHierarchy !== undefined ? { sourceHierarchy: seed.sourceHierarchy } : {}),
            ...(seed.disputeWindowHours !== undefined ? { disputeWindowHours: seed.disputeWindowHours } : {}),
            ...(seed.ambiguousTimeBoundary !== undefined ? { ambiguousTimeBoundary: seed.ambiguousTimeBoundary } : {}),
            ...(seed.ambiguousSourceReference !== undefined ? { ambiguousSourceReference: seed.ambiguousSourceReference } : {}),
            ...(seed.ambiguousJurisdictionOrScope !== undefined
                ? { ambiguousJurisdictionOrScope: seed.ambiguousJurisdictionOrScope }
                : {}),
            metadata: {
                canonicalCategory: normalizeCategory(seed.canonicalCategory),
                canonicalMarketId: seed.canonicalMarketId
            }
        });

        const settlementProfile = this.settlementNormalizer.normalize({
            venueMarketProfileId: profile.id,
            ...(seed.settlementType !== undefined ? { settlementType: seed.settlementType } : {}),
            ...(seed.settlementLagHours !== undefined ? { settlementLagHours: seed.settlementLagHours } : {}),
            ...(seed.disputeWindowHours !== undefined ? { disputeWindowHours: seed.disputeWindowHours } : {}),
            ...(seed.finalityLagHours !== undefined ? { finalityLagHours: seed.finalityLagHours } : {}),
            ...(seed.payoutTimingHours !== undefined ? { payoutTimingHours: seed.payoutTimingHours } : {}),
            ...(seed.feeOnEntry !== undefined ? { feeOnEntry: seed.feeOnEntry } : {}),
            ...(seed.feeOnExit !== undefined ? { feeOnExit: seed.feeOnExit } : {}),
            ...(seed.timeSensitiveFeeBehavior !== undefined
                ? { timeSensitiveFeeBehavior: seed.timeSensitiveFeeBehavior }
                : {}),
            ...(seed.requiresConservativeAnchor !== undefined
                ? { requiresConservativeAnchor: seed.requiresConservativeAnchor }
                : {}),
            metadata: {
                venue: profile.venue,
                network: profile.network,
                chain: profile.chain,
                canonicalCategory: normalizeCategory(seed.canonicalCategory),
                canonicalMarketId: seed.canonicalMarketId
            }
        });

        const fingerprint = this.fingerprintBuilder.build({
            market: profile,
            resolutionProfile,
            ...(seed.propositionHints !== undefined ? { propositionHints: seed.propositionHints } : {})
        });

        return {
            seed,
            profile,
            resolutionProfile,
            settlementProfile,
            fingerprint
        };
    }

    private buildCanonicalEventClusters(contexts: readonly NormalizedSeedContext[]) {
        const eventsById = new Map<string, NormalizedSeedContext[]>();

        for (const context of contexts) {
            const bucket = eventsById.get(context.seed.canonicalEventId);
            if (bucket) {
                bucket.push(context);
                continue;
            }
            eventsById.set(context.seed.canonicalEventId, [context]);
        }

        return [...eventsById.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([eventId, members]) => ({
                event: this.buildCanonicalEvent(eventId, members),
                members: members.map((member) => ({
                    market: member.profile,
                    fingerprint: member.fingerprint
                }))
            }));
    }

    private buildCanonicalEvent(eventId: string, members: readonly NormalizedSeedContext[]): CanonicalEvent {
        const clustered = this.clusteringService.cluster(
            members.map((member) => ({
                market: member.profile,
                fingerprint: member.fingerprint
            }))
        );
        const prototype = clustered[0]?.event;
        const first = members[0]!;
        const startsAt = this.minDate(members.map((member) => member.profile.publishedAt));
        const expiresAt = this.maxDate(members.map((member) => member.profile.expiresAt));
        const resolvesAt = this.maxDate(members.map((member) => member.profile.resolvesAt));
        const now = new Date();

        return {
            id: eventId,
            canonicalFixtureEventId: null,
            propositionKey: first.seed.eventPropositionKey ?? prototype?.propositionKey ?? `curated:${eventId}`,
            title:
                first.seed.eventTitle
                ?? prototype?.title
                ?? first.fingerprint.normalizedPropositionText
                ?? first.profile.title,
            normalizedPropositionText:
                first.seed.eventNormalizedPropositionText
                ?? prototype?.normalizedPropositionText
                ?? first.fingerprint.normalizedPropositionText,
            category: normalizeCategory(first.seed.canonicalCategory),
            marketClass: normalizeMarketClass(first.seed.marketClass ?? first.profile.marketClass),
            propositionConfidenceScore: averageRatio(members.map((member) => member.fingerprint.confidenceScore)),
            startsAt,
            expiresAt,
            resolvesAt,
            sourceHints: {
                ...(prototype?.sourceHints ?? {}),
                ...(first.seed.eventSourceHints ?? {}),
                venues: members.map((member) => member.profile.venue)
            },
            metadata: {
                ...(prototype?.metadata ?? {}),
                ...(first.seed.eventMetadata ?? {}),
                curated: true
            },
            createdAt: now,
            updatedAt: now
        };
    }

    private buildExecutableMarkets(
        contexts: readonly NormalizedSeedContext[]
    ): readonly CanonicalExecutableMarket[] {
        const marketsById = new Map<string, NormalizedSeedContext[]>();

        for (const context of contexts) {
            const bucket = marketsById.get(context.seed.canonicalMarketId);
            if (bucket) {
                bucket.push(context);
                continue;
            }
            marketsById.set(context.seed.canonicalMarketId, [context]);
        }

        return [...marketsById.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([canonicalMarketId, members]) => {
                const first = members[0]!;
                const memberProfileIds = members
                    .map((member) => member.profile.id)
                    .sort((left, right) => left.localeCompare(right));
                const now = new Date();

                return {
                    id: canonicalMarketId,
                    canonicalEventId: first.seed.canonicalEventId,
                    displayName: first.seed.executableDisplayName ?? first.profile.title,
                    marketClass: normalizeMarketClass(first.seed.marketClass ?? first.profile.marketClass),
                    compatibilityPolicy: "EQUIVALENT_ONLY",
                    riskClass: "EQUIVALENT",
                    memberProfileIds,
                    metadata: {
                        ...(first.seed.executableMetadata ?? {}),
                        curated: true,
                        canonicalCategory: normalizeCategory(first.seed.canonicalCategory)
                    },
                    createdAt: now,
                    updatedAt: now
                } satisfies CanonicalExecutableMarket;
            });
    }

    private buildCompatibilityEdges(
        contexts: readonly NormalizedSeedContext[],
        executableMarkets: readonly CanonicalExecutableMarket[]
    ) {
        const contextByProfileId = new Map(contexts.map((context) => [context.profile.id, context]));
        const edges = [];

        for (const market of executableMarkets) {
            if (market.memberProfileIds.length < 2) {
                continue;
            }
            for (let index = 0; index < market.memberProfileIds.length; index += 1) {
                for (let pairIndex = index + 1; pairIndex < market.memberProfileIds.length; pairIndex += 1) {
                    const left = contextByProfileId.get(market.memberProfileIds[index]!);
                    const right = contextByProfileId.get(market.memberProfileIds[pairIndex]!);
                    if (!left || !right) {
                        continue;
                    }

                    const edge = this.edgeScorer.score({
                        canonicalEventId: market.canonicalEventId,
                        marketA: left.profile,
                        marketB: right.profile,
                        fingerprintA: left.fingerprint,
                        fingerprintB: right.fingerprint,
                        resolutionProfileA: left.resolutionProfile,
                        resolutionProfileB: right.resolutionProfile,
                        settlementProfileA: left.settlementProfile,
                        settlementProfileB: right.settlementProfile
                    });

                    if (edge.compatibilityClass !== "EQUIVALENT") {
                        throw new Error(
                            `curated_canonical_market_not_equivalent:${market.id}:${left.profile.venue}:${right.profile.venue}:${edge.compatibilityClass}`
                        );
                    }

                    edges.push(edge);
                }
            }
        }

        return edges;
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
