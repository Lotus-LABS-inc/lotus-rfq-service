import { describe, expect, it } from "vitest";

import { CanonicalEventClusteringService } from "../../src/canonical/canonical-event-clustering.js";
import { PropositionFingerprintBuilder } from "../../src/canonical/proposition-fingerprint.js";
import { CanonicalResolutionProfileNormalizer } from "../../src/canonical/resolution-profile-normalizer.js";
import { VenueMarketProfileFactory } from "../../src/canonical/venue-market-profile.js";

describe("CanonicalEventClusteringService", () => {
    it("clusters broad proposition matches into one canonical event", () => {
        const factory = new VenueMarketProfileFactory();
        const resolutionNormalizer = new CanonicalResolutionProfileNormalizer();
        const fingerprintBuilder = new PropositionFingerprintBuilder();
        const clustering = new CanonicalEventClusteringService();

        const marketA = factory.create({
            canonicalEventId: "11111111-1111-4111-8111-111111111111",
            venue: "POLYMARKET",
            venueMarketId: "poly-btc-120k",
            title: "Will BTC be above $120k by June 30, 2026?",
            marketClass: "BINARY",
            outcomes: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
            outcomeSchema: { type: "binary", outcomes: ["Yes", "No"] },
            sourceMetadataVersion: "test-v1"
        });
        const marketB = factory.create({
            canonicalEventId: "11111111-1111-4111-8111-111111111111",
            venue: "LIMITLESS",
            venueMarketId: "limitless-btc-120k",
            title: "BTC over 120k before 2026-06-30?",
            marketClass: "BINARY",
            outcomes: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
            outcomeSchema: { type: "binary", outcomes: ["Yes", "No"] },
            sourceMetadataVersion: "test-v1"
        });

        const inputs = [marketA, marketB].map((market) => {
            const resolutionProfile = resolutionNormalizer.normalize({
                venueMarketProfileId: market.id,
                resolutionAuthorityType: "exchange_price_feed",
                resolutionTitle: market.title,
                ruleText: "resolves yes if btc trades above 120k before june 30 2026",
                resolutionSource: "binance"
            });
            return {
                market,
                fingerprint: fingerprintBuilder.build({
                    market,
                    resolutionProfile,
                    propositionHints: {
                        subject: "btc",
                        condition: "above 120k",
                        timeBoundary: "2026-06-30",
                        normalizedPropositionText: "btc above 120k by june 30 2026"
                    }
                })
            };
        });

        const clusters = clustering.cluster(inputs);

        expect(clusters).toHaveLength(1);
        expect(clusters[0]?.members).toHaveLength(2);
    });
});
