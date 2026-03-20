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
});
