import { describe, expect, it } from "vitest";

import { CanonicalExecutableMarketBuilder } from "../../src/canonical/canonical-executable-market-builder.js";
import { VenueMarketProfileFactory } from "../../src/canonical/venue-market-profile.js";

describe("CanonicalExecutableMarketBuilder", () => {
    it("groups only equivalent connected components", () => {
        const factory = new VenueMarketProfileFactory();
        const builder = new CanonicalExecutableMarketBuilder();
        const profileA = factory.create({
            canonicalEventId: "11111111-1111-4111-8111-111111111111",
            venue: "POLYMARKET",
            venueMarketId: "poly-a",
            title: "A",
            marketClass: "BINARY",
            outcomes: [],
            outcomeSchema: {},
            sourceMetadataVersion: "test-v1"
        });
        const profileB = factory.create({
            canonicalEventId: profileA.canonicalEventId,
            venue: "LIMITLESS",
            venueMarketId: "limitless-b",
            title: "B",
            marketClass: "BINARY",
            outcomes: [],
            outcomeSchema: {},
            sourceMetadataVersion: "test-v1"
        });
        const profileC = factory.create({
            canonicalEventId: profileA.canonicalEventId,
            venue: "OPINION",
            venueMarketId: "opinion-c",
            title: "C",
            marketClass: "BINARY",
            outcomes: [],
            outcomeSchema: {},
            sourceMetadataVersion: "test-v1"
        });

        const executableMarkets = builder.build({
            canonicalEventId: profileA.canonicalEventId,
            profiles: [profileA, profileB, profileC],
            edges: [
                {
                    id: "edge-a-b",
                    canonicalEventId: profileA.canonicalEventId,
                    marketAProfileId: profileA.id,
                    marketBProfileId: profileB.id,
                    compatibilityClass: "EQUIVALENT",
                    reasons: [],
                    propositionSimilarityScore: "1",
                    outcomeSchemaCompatibilityScore: "1",
                    timingCompatibilityScore: "1",
                    resolutionRiskScore: "0",
                    settlementRiskScore: "0",
                    structureRiskScore: "0",
                    feeCompatibilityScore: "1",
                    confidenceScore: "1",
                    capitalLockHours: "0",
                    maxSettlementDelayHours: "0",
                    liquidityCostModelVersion: null,
                    liquidityCostBps: null,
                    anchoredFinalityHours: "0",
                    requiresConservativeSettlementAnchor: false,
                    factorBreakdown: {},
                    scoringVersion: "v1",
                    computedAt: new Date()
                },
                {
                    id: "edge-a-c",
                    canonicalEventId: profileA.canonicalEventId,
                    marketAProfileId: profileA.id,
                    marketBProfileId: profileC.id,
                    compatibilityClass: "COMPATIBLE_WITH_CAUTION",
                    reasons: [],
                    propositionSimilarityScore: "1",
                    outcomeSchemaCompatibilityScore: "1",
                    timingCompatibilityScore: "0.5",
                    resolutionRiskScore: "0.5",
                    settlementRiskScore: "0.5",
                    structureRiskScore: "0",
                    feeCompatibilityScore: "1",
                    confidenceScore: "1",
                    capitalLockHours: null,
                    maxSettlementDelayHours: null,
                    liquidityCostModelVersion: null,
                    liquidityCostBps: null,
                    anchoredFinalityHours: null,
                    requiresConservativeSettlementAnchor: false,
                    factorBreakdown: {},
                    scoringVersion: "v1",
                    computedAt: new Date()
                }
            ]
        });

        expect(executableMarkets).toHaveLength(2);
        expect(executableMarkets.some((market) => market.memberProfileIds.length === 2)).toBe(true);
        expect(executableMarkets.some((market) => market.memberProfileIds.length === 1)).toBe(true);
    });
});
