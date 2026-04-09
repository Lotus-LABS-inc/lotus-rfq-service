import { describe, expect, it } from "vitest";

import { CanonicalResolutionProfileNormalizer } from "../../src/canonical/resolution-profile-normalizer.js";
import { CanonicalSettlementProfileNormalizer } from "../../src/canonical/settlement-profile-normalizer.js";

describe("canonical normalizers", () => {
    it("normalizes resolution profile metadata and ambiguity flags", () => {
        const normalizer = new CanonicalResolutionProfileNormalizer();

        const profile = normalizer.normalize({
            venueMarketProfileId: "vmp_polymarket_btc",
            resolutionSource: "Binance API",
            resolutionTitle: "BTC above 120k by June 30",
            resolutionAuthorityType: "exchange_price_feed",
            ruleText: "Market resolves yes if BTC trades above 120k on Binance.",
            disputeWindowHours: 24,
            ambiguousTimeBoundary: false,
            ambiguousSourceReference: true,
            metadata: { from: "test" }
        });

        expect(profile.venueMarketProfileId).toBe("vmp_polymarket_btc");
        expect(profile.disputeWindowHours).toBe("24");
        expect(profile.ambiguityFlags.ambiguousSourceReference).toBe(true);
        expect(profile.metadataCompletenessScore).toBe("0.833333");
        expect(profile.metadata.semanticResolutionSourceClass).toBe("MARKET_DATA_AUTHORITY");
    });

    it("extracts normalized authority identity from aligned political authority rules", () => {
        const normalizer = new CanonicalResolutionProfileNormalizer();

        const profile = normalizer.normalize({
            venueMarketProfileId: "vmp_limitless_newsom",
            resolutionSource: "LIMITLESS",
            resolutionTitle: "Will Gavin Newsom win the 2028 Democratic presidential nomination?",
            resolutionAuthorityType: "CENTRAL",
            ruleText: "This market resolves according to official Democratic Party sources and the Democratic National Convention.",
            metadata: { from: "test" }
        });

        expect(profile.metadata.semanticResolutionSourceClass).toBe("OFFICIAL_POLITICAL_AUTHORITY");
        expect(profile.metadata.normalizedAuthorityPhrases).toEqual([
            "official_nomination_sources",
            "official_party_sources"
        ]);
        expect(profile.metadata.normalizedAuthorityIdentity).toContain("CENTRAL");
        expect(profile.metadata.resolutionSourceOverrideEligible).toBe(true);
    });

    it("normalizes settlement profiles with unknown-safe defaults", () => {
        const normalizer = new CanonicalSettlementProfileNormalizer();

        const profile = normalizer.normalize({
            venueMarketProfileId: "vmp_opinion_btc",
            settlementLagHours: 48,
            disputeWindowHours: 0,
            feeOnEntry: true
        });

        expect(profile.settlementType).toBe("unknown");
        expect(profile.settlementLagHours).toBe("48");
        expect(profile.feeOnEntry).toBe(true);
        expect(profile.metadataCompletenessScore).toBe("0.333333");
    });

    it("infers polymarket settlement as onchain when venue metadata is present", () => {
        const normalizer = new CanonicalSettlementProfileNormalizer();

        const profile = normalizer.normalize({
            venueMarketProfileId: "vmp_polymarket_btc",
            metadata: {
                venue: "POLYMARKET",
                chain: "polygon"
            }
        });

        expect(profile.settlementType).toBe("onchain");
        expect(profile.metadata.venue).toBe("POLYMARKET");
    });
});
