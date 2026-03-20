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
});
