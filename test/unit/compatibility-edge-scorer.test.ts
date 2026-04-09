import { describe, expect, it } from "vitest";

import { CanonicalResolutionProfileNormalizer } from "../../src/canonical/resolution-profile-normalizer.js";
import { CanonicalSettlementProfileNormalizer } from "../../src/canonical/settlement-profile-normalizer.js";
import { CompatibilityEdgeScorer } from "../../src/canonical/compatibility-edge-scorer.js";
import { PropositionFingerprintBuilder } from "../../src/canonical/proposition-fingerprint.js";
import { VenueMarketProfileFactory } from "../../src/canonical/venue-market-profile.js";

const buildBinaryMarket = (venue: "POLYMARKET" | "LIMITLESS" | "OPINION", venueMarketId: string, title: string) =>
    new VenueMarketProfileFactory().create({
        canonicalEventId: "11111111-1111-4111-8111-111111111111",
        venue,
        venueMarketId,
        title,
        marketClass: "BINARY",
        outcomes: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
        outcomeSchema: { type: "binary", outcomes: ["Yes", "No"] },
        sourceMetadataVersion: "test-v1"
    });

describe("CompatibilityEdgeScorer", () => {
    it("keeps lag-only differences equivalent and computes liquidity cost", () => {
        const resolutionNormalizer = new CanonicalResolutionProfileNormalizer();
        const settlementNormalizer = new CanonicalSettlementProfileNormalizer();
        const fingerprintBuilder = new PropositionFingerprintBuilder();
        const scorer = new CompatibilityEdgeScorer();
        const marketA = buildBinaryMarket("POLYMARKET", "poly-btc-120k", "Will BTC be above 120k by June 30, 2026?");
        const marketB = buildBinaryMarket("LIMITLESS", "lim-btc-120k", "BTC above 120k by June 30, 2026?");
        const resolutionProfileA = resolutionNormalizer.normalize({
            venueMarketProfileId: marketA.id,
            resolutionAuthorityType: "exchange_price_feed",
            resolutionTitle: marketA.title,
            ruleText: "resolves yes if btc trades above 120k before june 30 2026",
            resolutionSource: "binance"
        });
        const resolutionProfileB = resolutionNormalizer.normalize({
            venueMarketProfileId: marketB.id,
            resolutionAuthorityType: "exchange_price_feed",
            resolutionTitle: marketB.title,
            ruleText: "resolves yes if btc trades above 120k before june 30 2026",
            resolutionSource: "binance"
        });
        const settlementProfileA = settlementNormalizer.normalize({
            venueMarketProfileId: marketA.id,
            settlementType: "onchain",
            settlementLagHours: 48,
            disputeWindowHours: 24,
            finalityLagHours: 72
        });
        const settlementProfileB = settlementNormalizer.normalize({
            venueMarketProfileId: marketB.id,
            settlementType: "onchain",
            settlementLagHours: 2,
            disputeWindowHours: 0,
            finalityLagHours: 2
        });
        const fingerprintA = fingerprintBuilder.build({
            market: marketA,
            resolutionProfile: resolutionProfileA,
            propositionHints: {
                subject: "btc",
                condition: "above 120k",
                timeBoundary: "2026-06-30",
                normalizedPropositionText: "btc above 120k by june 30 2026"
            }
        });
        const fingerprintB = fingerprintBuilder.build({
            market: marketB,
            resolutionProfile: resolutionProfileB,
            propositionHints: {
                subject: "btc",
                condition: "above 120k",
                timeBoundary: "2026-06-30",
                normalizedPropositionText: "btc above 120k by june 30 2026"
            }
        });

        const edge = scorer.score({
            canonicalEventId: marketA.canonicalEventId,
            marketA,
            marketB,
            fingerprintA,
            fingerprintB,
            resolutionProfileA,
            resolutionProfileB,
            settlementProfileA,
            settlementProfileB
        });

        expect(edge.compatibilityClass).toBe("EQUIVALENT");
        expect(Number(edge.liquidityCostBps ?? 0)).toBeGreaterThan(0);
        expect(edge.requiresConservativeSettlementAnchor).toBe(true);
    });

    it("blocks structural mismatches from pooling", () => {
        const factory = new VenueMarketProfileFactory();
        const resolutionNormalizer = new CanonicalResolutionProfileNormalizer();
        const settlementNormalizer = new CanonicalSettlementProfileNormalizer();
        const fingerprintBuilder = new PropositionFingerprintBuilder();
        const scorer = new CompatibilityEdgeScorer();

        const binaryMarket = buildBinaryMarket("POLYMARKET", "poly-btc-120k", "Will BTC be above 120k by June 30, 2026?");
        const categoricalMarket = factory.create({
            canonicalEventId: "11111111-1111-4111-8111-111111111111",
            venue: "MYRIAD",
            venueMarketId: "myriad-btc-bands",
            title: "Where will BTC close by June 30, 2026?",
            marketClass: "CATEGORICAL",
            outcomes: [{ id: "lt120", label: "Below 120k" }, { id: "gt120", label: "120k or above" }],
            outcomeSchema: { type: "categorical", outcomes: ["Below 120k", "120k or above"] },
            sourceMetadataVersion: "test-v1"
        });

        const resolutionProfileA = resolutionNormalizer.normalize({
            venueMarketProfileId: binaryMarket.id,
            resolutionAuthorityType: "exchange_price_feed",
            resolutionTitle: binaryMarket.title,
            ruleText: "resolves yes if btc trades above 120k before june 30 2026",
            resolutionSource: "binance"
        });
        const resolutionProfileB = resolutionNormalizer.normalize({
            venueMarketProfileId: categoricalMarket.id,
            resolutionAuthorityType: "exchange_price_feed",
            resolutionTitle: categoricalMarket.title,
            ruleText: "resolves by closing price bucket on june 30 2026",
            resolutionSource: "binance"
        });
        const settlementProfileA = settlementNormalizer.normalize({ venueMarketProfileId: binaryMarket.id, settlementType: "onchain" });
        const settlementProfileB = settlementNormalizer.normalize({ venueMarketProfileId: categoricalMarket.id, settlementType: "onchain" });
        const fingerprintA = fingerprintBuilder.build({ market: binaryMarket, resolutionProfile: resolutionProfileA });
        const fingerprintB = fingerprintBuilder.build({ market: categoricalMarket, resolutionProfile: resolutionProfileB });

        const edge = scorer.score({
            canonicalEventId: binaryMarket.canonicalEventId,
            marketA: binaryMarket,
            marketB: categoricalMarket,
            fingerprintA,
            fingerprintB,
            resolutionProfileA,
            resolutionProfileB,
            settlementProfileA,
            settlementProfileB
        });

        expect(edge.compatibilityClass).toBe("DO_NOT_POOL");
        expect(edge.liquidityCostBps).toBeNull();
    });

    it("does not hard-fail authority-aligned nomination markets on venue source labels alone", () => {
        const resolutionNormalizer = new CanonicalResolutionProfileNormalizer();
        const settlementNormalizer = new CanonicalSettlementProfileNormalizer();
        const fingerprintBuilder = new PropositionFingerprintBuilder();
        const scorer = new CompatibilityEdgeScorer();
        const factory = new VenueMarketProfileFactory();

        const marketA = factory.create({
            canonicalEventId: "11111111-1111-4111-8111-111111111111",
            venue: "POLYMARKET",
            venueMarketId: "poly-newsom",
            title: "Will Gavin Newsom win the 2028 Democratic presidential nomination?",
            marketClass: "BINARY",
            outcomes: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
            outcomeSchema: { type: "binary", outcomes: ["Yes", "No"] },
            category: "POLITICS",
            sourceMetadataVersion: "test-v1"
        });
        const marketB = factory.create({
            canonicalEventId: "11111111-1111-4111-8111-111111111111",
            venue: "LIMITLESS",
            venueMarketId: "lim-newsom",
            title: "Will Gavin Newsom win the 2028 Democratic presidential nomination?",
            marketClass: "BINARY",
            outcomes: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
            outcomeSchema: { type: "binary", outcomes: ["Yes", "No"] },
            category: "POLITICS",
            sourceMetadataVersion: "test-v1"
        });
        const resolutionRule = "This market resolves according to official Democratic Party sources and the Democratic National Convention.";
        const resolutionProfileA = resolutionNormalizer.normalize({
            venueMarketProfileId: marketA.id,
            resolutionAuthorityType: "CENTRAL",
            resolutionTitle: marketA.title,
            ruleText: resolutionRule,
            resolutionSource: "POLYMARKET"
        });
        const resolutionProfileB = resolutionNormalizer.normalize({
            venueMarketProfileId: marketB.id,
            resolutionAuthorityType: "CENTRAL",
            resolutionTitle: marketB.title,
            ruleText: resolutionRule,
            resolutionSource: "LIMITLESS"
        });
        const settlementProfileA = settlementNormalizer.normalize({ venueMarketProfileId: marketA.id, settlementType: "onchain" });
        const settlementProfileB = settlementNormalizer.normalize({ venueMarketProfileId: marketB.id, settlementType: "onchain" });
        const fingerprintA = fingerprintBuilder.build({
            market: marketA,
            resolutionProfile: resolutionProfileA,
            propositionHints: {
                subject: "gavin newsom",
                condition: "win 2028 democratic presidential nomination",
                timeBoundary: "2028-11-07T00:00:00.000Z",
                normalizedPropositionText: marketA.title
            }
        });
        const fingerprintB = fingerprintBuilder.build({
            market: marketB,
            resolutionProfile: resolutionProfileB,
            propositionHints: {
                subject: "gavin newsom",
                condition: "win 2028 democratic presidential nomination",
                timeBoundary: "2028-11-08T04:59:00.000Z",
                normalizedPropositionText: marketB.title
            }
        });

        const edge = scorer.score({
            canonicalEventId: marketA.canonicalEventId,
            marketA,
            marketB,
            fingerprintA,
            fingerprintB,
            resolutionProfileA,
            resolutionProfileB,
            settlementProfileA,
            settlementProfileB
        });

        expect(Number(edge.propositionSimilarityScore)).toBeGreaterThan(0.75);
        expect(Number(edge.resolutionRiskScore)).toBeLessThan(0.8);
    });

    it("ignores display-time suffixes when broad proposition identity already matches", () => {
        const resolutionNormalizer = new CanonicalResolutionProfileNormalizer();
        const settlementNormalizer = new CanonicalSettlementProfileNormalizer();
        const fingerprintBuilder = new PropositionFingerprintBuilder();
        const scorer = new CompatibilityEdgeScorer();
        const factory = new VenueMarketProfileFactory();

        const marketA = factory.create({
            canonicalEventId: "11111111-1111-4111-8111-111111111111",
            venue: "POLYMARKET",
            venueMarketId: "pm-btc-2026-03-21",
            title: "Bitcoin Up or Down on March 21?",
            marketClass: "BINARY",
            outcomes: [{ id: "up", label: "Up" }, { id: "down", label: "Down" }],
            outcomeSchema: { marketShape: "binary", outcomeLabels: ["Up", "Down"] },
            category: "CRYPTO",
            expiresAt: new Date("2026-03-21T16:00:00.000Z"),
            sourceMetadataVersion: "test-v1"
        });
        const marketB = factory.create({
            canonicalEventId: "11111111-1111-4111-8111-111111111111",
            venue: "OPINION",
            venueMarketId: "op-btc-2026-03-21",
            title: "Bitcoin Up or Down on March 21?(12:00 ET)",
            marketClass: "BINARY",
            outcomes: [{ id: "up", label: "Up" }, { id: "down", label: "Down" }],
            outcomeSchema: { marketShape: "binary", outcomeLabels: ["Up", "Down"] },
            category: "CRYPTO",
            expiresAt: new Date("2026-03-21T16:00:00.000Z"),
            sourceMetadataVersion: "test-v1"
        });

        const ruleText = "This market resolves using Binance BTC/USDT 1 minute candles.";
        const resolutionProfileA = resolutionNormalizer.normalize({
            venueMarketProfileId: marketA.id,
            resolutionAuthorityType: "CENTRAL",
            resolutionTitle: marketA.title,
            ruleText,
            resolutionSource: "POLYMARKET"
        });
        const resolutionProfileB = resolutionNormalizer.normalize({
            venueMarketProfileId: marketB.id,
            resolutionAuthorityType: "CENTRAL",
            resolutionTitle: marketB.title,
            ruleText,
            resolutionSource: "OPINION"
        });
        const settlementProfileA = settlementNormalizer.normalize({
            venueMarketProfileId: marketA.id,
            metadata: { venue: "POLYMARKET" }
        });
        const settlementProfileB = settlementNormalizer.normalize({
            venueMarketProfileId: marketB.id,
            settlementType: "onchain"
        });
        const fingerprintA = fingerprintBuilder.build({
            market: marketA,
            resolutionProfile: resolutionProfileA,
            propositionHints: {
                subject: "bitcoin up down march 21",
                condition: "Bitcoin Up or Down on March 21? (12:00 ET)",
                timeBoundary: "2026-03-21T16:00:00.000Z",
                normalizedPropositionText: marketA.title
            }
        });
        const fingerprintB = fingerprintBuilder.build({
            market: marketB,
            resolutionProfile: resolutionProfileB,
            propositionHints: {
                subject: "bitcoin up down march 21",
                condition: "Bitcoin Up or Down on March 21? (12:00 ET)",
                timeBoundary: "2026-03-21T16:00:00.000Z",
                normalizedPropositionText: marketB.title
            }
        });

        const edge = scorer.score({
            canonicalEventId: marketA.canonicalEventId,
            marketA,
            marketB,
            fingerprintA,
            fingerprintB,
            resolutionProfileA,
            resolutionProfileB,
            settlementProfileA,
            settlementProfileB
        });

        expect(fingerprintA.broadFingerprintKey).toBe(fingerprintB.broadFingerprintKey);
        expect(Number(edge.propositionSimilarityScore)).toBe(1);
    });
});
