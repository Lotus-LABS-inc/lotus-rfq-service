import { describe, expect, it } from "vitest";

import { CanonicalFixtureClusteringService } from "../../src/canonical/canonical-fixture-clustering.js";
import { CanonicalEventClusteringService } from "../../src/canonical/canonical-event-clustering.js";
import { PropositionFingerprintBuilder } from "../../src/canonical/proposition-fingerprint.js";
import { CanonicalResolutionProfileNormalizer } from "../../src/canonical/resolution-profile-normalizer.js";
import { VenueMarketProfileFactory } from "../../src/canonical/venue-market-profile.js";
import type { CanonicalCategory } from "../../src/canonical/canonicalization-types.js";

const factory = new VenueMarketProfileFactory();
const resolutionNormalizer = new CanonicalResolutionProfileNormalizer();
const fingerprintBuilder = new PropositionFingerprintBuilder();
const eventClustering = new CanonicalEventClusteringService();
const fixtureClustering = new CanonicalFixtureClusteringService();

const buildCluster = ({
    canonicalEventId,
    category,
    title,
    subject,
    timeBoundary = "2026-08-16"
}: {
    canonicalEventId: string;
    category: CanonicalCategory;
    title: string;
    subject: string;
    timeBoundary?: string;
}) => {
    const market = factory.create({
        canonicalEventId,
        venue: "POLYMARKET",
        venueMarketId: `venue-${canonicalEventId}`,
        title,
        resolutionTitle: title,
        marketClass: "BINARY",
        category,
        resolvesAt: new Date(`${timeBoundary}T20:00:00.000Z`),
        outcomes: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
        outcomeSchema: { type: "binary", outcomes: ["Yes", "No"] },
        sourceMetadataVersion: "test-v1"
    });
    const resolutionProfile = resolutionNormalizer.normalize({
        venueMarketProfileId: market.id,
        resolutionTitle: title,
        resolutionSource: "venue",
        ruleText: title
    });
    const fingerprint = fingerprintBuilder.build({
        market,
        resolutionProfile,
        propositionHints: {
            subject,
            condition: "fixture outcome",
            timeBoundary,
            normalizedPropositionText: title
        }
    });
    const cluster = eventClustering.cluster([{ market, fingerprint }])[0]!;
    return {
        ...cluster,
        event: {
            ...cluster.event,
            id: canonicalEventId
        }
    };
};

describe("CanonicalFixtureClusteringService", () => {
    it("groups sports fixture outcome clusters sharing date, category, and fixture tokens", () => {
        const result = fixtureClustering.cluster([
            buildCluster({
                canonicalEventId: "11111111-1111-4111-8111-111111111111",
                category: "SPORTS",
                title: "Chelsea vs Crystal Palace: Chelsea wins",
                subject: "chelsea crystal palace"
            }),
            buildCluster({
                canonicalEventId: "22222222-2222-4222-8222-222222222222",
                category: "SPORTS",
                title: "Chelsea vs Crystal Palace: Draw",
                subject: "chelsea crystal palace"
            }),
            buildCluster({
                canonicalEventId: "33333333-3333-4333-8333-333333333333",
                category: "SPORTS",
                title: "Chelsea vs Crystal Palace: Crystal Palace wins",
                subject: "chelsea crystal palace"
            })
        ]);

        expect(result.canonicalFixtureEvents).toHaveLength(1);
        expect(result.canonicalFixtureEvents[0]?.displayTitle).toBe("Chelsea vs Crystal Palace");
        expect(result.canonicalFixtureEvents[0]?.scheduledAt?.toISOString().slice(0, 10)).toBe("2026-08-16");
        expect(result.canonicalEventFixtureLinks.size).toBe(3);
    });

    it("uses the same grouping behavior for esports", () => {
        const result = fixtureClustering.cluster([
            buildCluster({
                canonicalEventId: "44444444-4444-4444-8444-444444444444",
                category: "ESPORTS",
                title: "T1 vs Gen G: T1 wins",
                subject: "gen t1"
            }),
            buildCluster({
                canonicalEventId: "55555555-5555-4555-8555-555555555555",
                category: "ESPORTS",
                title: "T1 vs Gen G: Gen G wins",
                subject: "gen t1"
            })
        ]);

        expect(result.canonicalFixtureEvents).toHaveLength(1);
        expect(result.canonicalFixtureEvents[0]?.displayTitle).toBe("T1 vs Gen G");
    });

    it("does not create fixture parents for non-fixture categories", () => {
        const result = fixtureClustering.cluster([
            buildCluster({
                canonicalEventId: "66666666-6666-4666-8666-666666666666",
                category: "CRYPTO",
                title: "Bitcoin all time high by 2026-12-31",
                subject: "bitcoin high"
            }),
            buildCluster({
                canonicalEventId: "77777777-7777-4777-8777-777777777777",
                category: "CRYPTO",
                title: "Bitcoin over 120k by 2026-12-31",
                subject: "bitcoin high"
            })
        ]);

        expect(result.canonicalFixtureEvents).toHaveLength(0);
        expect(result.canonicalEventFixtureLinks.size).toBe(0);
    });

    it("does not group fixtures across different dates", () => {
        const result = fixtureClustering.cluster([
            buildCluster({
                canonicalEventId: "88888888-8888-4888-8888-888888888888",
                category: "SPORTS",
                title: "Chelsea vs Crystal Palace: Chelsea wins",
                subject: "chelsea crystal palace",
                timeBoundary: "2026-08-16"
            }),
            buildCluster({
                canonicalEventId: "99999999-9999-4999-8999-999999999999",
                category: "SPORTS",
                title: "Chelsea vs Crystal Palace: Chelsea wins",
                subject: "chelsea crystal palace",
                timeBoundary: "2026-08-17"
            })
        ]);

        expect(result.canonicalFixtureEvents).toHaveLength(0);
        expect(result.canonicalEventFixtureLinks.size).toBe(0);
    });

    it("does not group when token intersection is below threshold", () => {
        const result = fixtureClustering.cluster([
            buildCluster({
                canonicalEventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                category: "SPORTS",
                title: "Chelsea wins",
                subject: "chelsea"
            }),
            buildCluster({
                canonicalEventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                category: "SPORTS",
                title: "Draw",
                subject: "draw"
            })
        ]);

        expect(result.canonicalFixtureEvents).toHaveLength(0);
    });

    it("uses deterministic fixture ids for the same grouped inputs", () => {
        const clusters = [
            buildCluster({
                canonicalEventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                category: "SPORTS",
                title: "Arsenal vs Everton: Arsenal wins",
                subject: "arsenal everton"
            }),
            buildCluster({
                canonicalEventId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                category: "SPORTS",
                title: "Arsenal vs Everton: Everton wins",
                subject: "arsenal everton"
            })
        ];

        const first = fixtureClustering.cluster(clusters).canonicalFixtureEvents[0];
        const second = fixtureClustering.cluster([...clusters].reverse()).canonicalFixtureEvents[0];

        expect(first?.id).toBe(second?.id);
        expect(first?.fixtureKey).toBe(second?.fixtureKey);
    });
});
