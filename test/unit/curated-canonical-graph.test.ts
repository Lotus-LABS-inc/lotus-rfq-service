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

    it("adds fixture parents and links for sports outcome events", () => {
        const builder = new CuratedCanonicalGraphSnapshotBuilder();
        const snapshot = builder.build([
            {
                canonicalEventId: "11111111-1111-4111-8111-111111111111",
                canonicalMarketId: "CHELSEA-PALACE-CHELSEA-WINS",
                canonicalCategory: "SPORTS",
                venue: "POLYMARKET",
                venueMarketId: "chelsea-palace-chelsea",
                title: "Chelsea vs Crystal Palace: Chelsea wins",
                marketType: "BINARY",
                marketClass: "BINARY",
                outcomeSchema: { yes: true, no: true },
                resolvesAt: new Date("2026-08-16T20:00:00.000Z"),
                resolutionTitle: "Chelsea vs Crystal Palace: Chelsea wins",
                resolutionRulesText: "Resolves yes if Chelsea wins.",
                sourceMetadataVersion: "test-v1",
                propositionHints: {
                    subject: "chelsea crystal palace",
                    condition: "fixture outcome",
                    timeBoundary: "2026-08-16",
                    normalizedPropositionText: "Chelsea wins"
                }
            },
            {
                canonicalEventId: "22222222-2222-4222-8222-222222222222",
                canonicalMarketId: "CHELSEA-PALACE-DRAW",
                canonicalCategory: "SPORTS",
                venue: "POLYMARKET",
                venueMarketId: "chelsea-palace-draw",
                title: "Chelsea vs Crystal Palace: Draw",
                marketType: "BINARY",
                marketClass: "BINARY",
                outcomeSchema: { yes: true, no: true },
                resolvesAt: new Date("2026-08-16T20:00:00.000Z"),
                resolutionTitle: "Chelsea vs Crystal Palace: Draw",
                resolutionRulesText: "Resolves yes if the match is a draw.",
                sourceMetadataVersion: "test-v1",
                propositionHints: {
                    subject: "chelsea crystal palace",
                    condition: "fixture outcome",
                    timeBoundary: "2026-08-16",
                    normalizedPropositionText: "Draw"
                }
            }
        ]);

        expect(snapshot.canonicalFixtureEvents).toHaveLength(1);
        expect(snapshot.canonicalFixtureEvents[0]?.displayTitle).toBe("Chelsea vs Crystal Palace");
        expect(snapshot.canonicalEventFixtureLinks.size).toBe(2);
        expect(snapshot.canonicalEvents.every((event) => event.canonicalFixtureEventId === snapshot.canonicalFixtureEvents[0]?.id)).toBe(true);
    });
});
