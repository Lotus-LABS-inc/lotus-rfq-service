import { describe, expect, it } from "vitest";

import { PropositionFingerprintBuilder } from "../../src/canonical/proposition-fingerprint.js";
import { CanonicalResolutionProfileNormalizer } from "../../src/canonical/resolution-profile-normalizer.js";
import { VenueMarketProfileFactory } from "../../src/canonical/venue-market-profile.js";

describe("PropositionFingerprintBuilder", () => {
    it("derives stable broad and strict keys from venue profiles", () => {
        const profileFactory = new VenueMarketProfileFactory();
        const resolutionNormalizer = new CanonicalResolutionProfileNormalizer();
        const builder = new PropositionFingerprintBuilder();

        const market = profileFactory.create({
            canonicalEventId: "11111111-1111-4111-8111-111111111111",
            venue: "POLYMARKET",
            venueMarketId: "poly-btc-120k",
            title: "Will BTC be above $120k by June 30, 2026?",
            marketClass: "BINARY",
            outcomes: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
            outcomeSchema: { type: "binary", outcomes: ["Yes", "No"] },
            sourceMetadataVersion: "test-v1"
        });
        const resolutionProfile = resolutionNormalizer.normalize({
            venueMarketProfileId: market.id,
            resolutionAuthorityType: "exchange_price_feed",
            resolutionTitle: market.title,
            ruleText: "Resolves yes if BTC trades above 120k before June 30, 2026.",
            resolutionSource: "binance"
        });

        const fingerprint = builder.build({ market, resolutionProfile });

        expect(fingerprint.subject.length).toBeGreaterThan(0);
        expect(fingerprint.broadFingerprintKey).toContain("BINARY");
        expect(fingerprint.strictFingerprintKey).toContain("binary");
        expect(fingerprint.fingerprintHash.length).toBeGreaterThan(10);
    });

    it("normalizes nomination result windows with one-day venue cutoff drift", () => {
        const profileFactory = new VenueMarketProfileFactory();
        const resolutionNormalizer = new CanonicalResolutionProfileNormalizer();
        const builder = new PropositionFingerprintBuilder();

        const baseInput = {
            canonicalEventId: "11111111-1111-4111-8111-111111111111",
            title: "Will Gavin Newsom win the 2028 Democratic presidential nomination?",
            marketClass: "BINARY" as const,
            outcomes: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
            outcomeSchema: { type: "binary", outcomes: ["Yes", "No"] },
            category: "POLITICS" as const,
            sourceMetadataVersion: "test-v1"
        };

        const marketA = profileFactory.create({
            ...baseInput,
            venue: "POLYMARKET",
            venueMarketId: "poly-newsom",
            resolvesAt: new Date("2028-11-07T00:00:00.000Z")
        });
        const marketB = profileFactory.create({
            ...baseInput,
            venue: "LIMITLESS",
            venueMarketId: "limitless-newsom",
            resolvesAt: new Date("2028-11-08T04:59:00.000Z")
        });
        const resolutionProfileA = resolutionNormalizer.normalize({
            venueMarketProfileId: marketA.id,
            resolutionAuthorityType: "CENTRAL",
            resolutionTitle: marketA.title,
            ruleText: "Resolves according to official Democratic Party sources.",
            resolutionSource: "POLYMARKET"
        });
        const resolutionProfileB = resolutionNormalizer.normalize({
            venueMarketProfileId: marketB.id,
            resolutionAuthorityType: "CENTRAL",
            resolutionTitle: marketB.title,
            ruleText: "Resolves according to official Democratic Party sources.",
            resolutionSource: "LIMITLESS"
        });

        const fingerprintA = builder.build({ market: marketA, resolutionProfile: resolutionProfileA });
        const fingerprintB = builder.build({ market: marketB, resolutionProfile: resolutionProfileB });

        expect(fingerprintA.groupingHints.semanticBoundaryKey).toBe("politics_result_window:2028-11-7");
        expect(fingerprintB.groupingHints.semanticBoundaryKey).toBe("politics_result_window:2028-11-7");
        expect(fingerprintA.broadFingerprintKey).toBe(fingerprintB.broadFingerprintKey);
        expect(fingerprintA.timeBoundary).toBe("2028-11-07T00:00:00.000Z");
        expect(fingerprintB.timeBoundary).toBe("2028-11-08T04:59:00.000Z");
    });

    it("drops trailing display-time suffixes from broad identity inputs", () => {
        const profileFactory = new VenueMarketProfileFactory();
        const resolutionNormalizer = new CanonicalResolutionProfileNormalizer();
        const builder = new PropositionFingerprintBuilder();

        const baseInput = {
            canonicalEventId: "11111111-1111-4111-8111-111111111111",
            marketClass: "BINARY" as const,
            outcomes: [{ id: "up", label: "Up" }, { id: "down", label: "Down" }],
            outcomeSchema: { marketShape: "binary", outcomeLabels: ["Up", "Down"] },
            category: "CRYPTO" as const,
            sourceMetadataVersion: "test-v1",
            resolutionSource: "POLYMARKET",
            resolutionRulesText: "Resolves using Binance BTC/USDT 1m candles."
        };

        const marketA = profileFactory.create({
            ...baseInput,
            venue: "POLYMARKET",
            venueMarketId: "pm-btc-march-21",
            title: "Bitcoin Up or Down on March 21?"
        });
        const marketB = profileFactory.create({
            ...baseInput,
            venue: "OPINION",
            venueMarketId: "op-btc-march-21",
            title: "Bitcoin Up or Down on March 21?(12:00 ET)"
        });
        const resolutionProfileA = resolutionNormalizer.normalize({
            venueMarketProfileId: marketA.id,
            resolutionAuthorityType: "exchange_price_feed",
            resolutionTitle: marketA.title,
            ruleText: "Resolves using Binance BTC/USDT 1m candles.",
            resolutionSource: "binance"
        });
        const resolutionProfileB = resolutionNormalizer.normalize({
            venueMarketProfileId: marketB.id,
            resolutionAuthorityType: "exchange_price_feed",
            resolutionTitle: marketB.title,
            ruleText: "Resolves using Binance BTC/USDT 1m candles.",
            resolutionSource: "binance"
        });

        const fingerprintA = builder.build({ market: marketA, resolutionProfile: resolutionProfileA });
        const fingerprintB = builder.build({ market: marketB, resolutionProfile: resolutionProfileB });

        expect(fingerprintA.subject).toBe("21 bitcoin down march on or");
        expect(fingerprintB.subject).toBe("21 bitcoin down march on or");
        expect(fingerprintA.broadFingerprintKey).toBe(fingerprintB.broadFingerprintKey);
    });

    it("drops display-time markers from broad condition identity while preserving raw boundary", () => {
        const profileFactory = new VenueMarketProfileFactory();
        const resolutionNormalizer = new CanonicalResolutionProfileNormalizer();
        const builder = new PropositionFingerprintBuilder();

        const market = profileFactory.create({
            canonicalEventId: "11111111-1111-4111-8111-111111111111",
            venue: "OPINION",
            venueMarketId: "op-btc-march-21",
            title: "Bitcoin Up or Down on March 21?(12:00 ET)",
            marketClass: "BINARY",
            outcomes: [{ id: "up", label: "Up" }, { id: "down", label: "Down" }],
            outcomeSchema: { marketShape: "binary", outcomeLabels: ["Up", "Down"] },
            category: "CRYPTO",
            sourceMetadataVersion: "test-v1",
            resolvesAt: new Date("2026-03-21T16:00:00.000Z")
        });
        const resolutionProfile = resolutionNormalizer.normalize({
            venueMarketProfileId: market.id,
            resolutionAuthorityType: "exchange_price_feed",
            resolutionTitle: market.title,
            ruleText: "Bitcoin Up or Down on March 21? (12:00 ET)",
            resolutionSource: "binance"
        });
        const cleanResolutionProfile = resolutionNormalizer.normalize({
            venueMarketProfileId: `${market.id}-clean`,
            resolutionAuthorityType: "exchange_price_feed",
            resolutionTitle: "Bitcoin Up or Down on March 21?",
            ruleText: "Bitcoin Up or Down on March 21?",
            resolutionSource: "binance"
        });

        const fingerprint = builder.build({ market, resolutionProfile });
        const cleanFingerprint = builder.build({ market, resolutionProfile: cleanResolutionProfile });

        expect(fingerprint.broadFingerprintKey).not.toContain("et");
        expect(fingerprint.broadFingerprintKey).toBe(cleanFingerprint.broadFingerprintKey);
        expect(fingerprint.timeBoundary).toBe("2026-03-21T16:00:00.000Z");
    });
});
