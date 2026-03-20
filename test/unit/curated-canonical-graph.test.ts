import { describe, expect, it } from "vitest";

import { CuratedCanonicalGraphSnapshotBuilder } from "../../src/canonical/curated-canonical-graph.js";

describe("CuratedCanonicalGraphSnapshotBuilder", () => {
    it("preserves explicit executable-market ids and scores equivalent lagged members", () => {
        const builder = new CuratedCanonicalGraphSnapshotBuilder();
        const snapshot = builder.build([
            {
                canonicalEventId: "66666666-6666-4666-8666-666666666666",
                canonicalMarketId: "US-ELECTION-2028-DEMOCRATIC-WINS",
                canonicalCategory: "POLITICS",
                venue: "LIMITLESS",
                venueMarketId: "limitless-dem-wins",
                title: "US Election 2028: Democratic party wins",
                marketType: "BINARY",
                marketClass: "BINARY",
                outcomeSchema: { yes: true, no: true },
                resolutionSource: "decisiondesk",
                resolutionTitle: "US Election 2028: Democratic party wins",
                resolutionRulesText: "Resolve to yes if the Democratic party wins the 2028 presidential election.",
                resolutionAuthorityType: "CENTRAL",
                disputeWindowHours: "0",
                settlementType: "offchain",
                settlementLagHours: "2",
                finalityLagHours: "2",
                sourceMetadataVersion: "test-v1"
            },
            {
                canonicalEventId: "66666666-6666-4666-8666-666666666666",
                canonicalMarketId: "US-ELECTION-2028-DEMOCRATIC-WINS",
                canonicalCategory: "POLITICS",
                venue: "OPINION",
                venueMarketId: "6808",
                title: "US Election 2028: Democratic party wins",
                marketType: "BINARY",
                marketClass: "BINARY",
                outcomeSchema: { yes: true, no: true },
                resolutionSource: "decisiondesk",
                resolutionTitle: "US Election 2028: Democratic party wins",
                resolutionRulesText: "Resolve to yes if the Democratic party wins the 2028 presidential election.",
                resolutionAuthorityType: "CENTRAL",
                disputeWindowHours: "24",
                settlementType: "offchain",
                settlementLagHours: "2",
                finalityLagHours: "26",
                sourceMetadataVersion: "test-v1"
            }
        ]);

        expect(snapshot.canonicalEvents).toHaveLength(1);
        expect(snapshot.executableMarkets).toHaveLength(1);
        expect(snapshot.executableMarkets[0]?.id).toBe("US-ELECTION-2028-DEMOCRATIC-WINS");
        expect(snapshot.executableMarkets[0]?.memberProfileIds).toHaveLength(2);
        expect(snapshot.compatibilityEdges).toHaveLength(1);
        expect(snapshot.compatibilityEdges[0]?.compatibilityClass).toBe("EQUIVALENT");
        expect(Number(snapshot.compatibilityEdges[0]?.liquidityCostBps ?? "0")).toBeGreaterThan(0);
    });
});
