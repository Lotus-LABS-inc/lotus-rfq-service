import { describe, expect, it } from "vitest";

import { VenueMarketProfileFactory } from "../../src/canonical/venue-market-profile.js";
import { CanonicalResolutionProfileNormalizer } from "../../src/canonical/resolution-profile-normalizer.js";
import { CanonicalSettlementProfileNormalizer } from "../../src/canonical/settlement-profile-normalizer.js";
import { PropositionFingerprintBuilder } from "../../src/canonical/proposition-fingerprint.js";
import { InterpretedContractBuilder } from "../../src/canonical/interpreted-contract-builder.js";

describe("InterpretedContractBuilder", () => {
    it("builds a poolable interpreted contract when critical semantics are present", () => {
        const market = new VenueMarketProfileFactory().create({
            canonicalEventId: "11111111-1111-4111-8111-111111111111",
            venue: "POLYMARKET",
            venueMarketId: "btc-120k",
            title: "Will BTC be above 120k by June 30, 2026?",
            marketClass: "BINARY",
            outcomes: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
            outcomeSchema: { type: "binary" },
            expiresAt: new Date("2026-06-30T00:00:00.000Z"),
            resolvesAt: new Date("2026-06-30T01:00:00.000Z"),
            sourceMetadataVersion: "test-v1"
        });
        const resolutionProfile = new CanonicalResolutionProfileNormalizer().normalize({
            venueMarketProfileId: market.id,
            resolutionAuthorityType: "exchange_price_feed",
            resolutionSource: "binance",
            ruleText: "resolves yes if BTC trades above 120k before close"
        });
        const settlementProfile = new CanonicalSettlementProfileNormalizer().normalize({
            venueMarketProfileId: market.id,
            settlementType: "onchain",
            settlementLagHours: 24,
            finalityLagHours: 24
        });
        const fingerprint = new PropositionFingerprintBuilder().build({
            market,
            resolutionProfile,
            propositionHints: {
                subject: "btc",
                condition: "above 120k",
                timeBoundary: "2026-06-30",
                normalizedPropositionText: "btc above 120k by june 30 2026"
            }
        });

        const contract = new InterpretedContractBuilder().build({
            market,
            fingerprint,
            resolutionProfile,
            settlementProfile
        });

        expect(contract.isPoolable).toBe(true);
        expect(Number(contract.interpretationConfidence)).toBeGreaterThan(0.5);
    });

    it("fails closed when critical semantics are missing", () => {
        const market = new VenueMarketProfileFactory().create({
            canonicalEventId: "11111111-1111-4111-8111-111111111111",
            venue: "LIMITLESS",
            venueMarketId: "incomplete-market",
            title: "Incomplete market",
            marketClass: "UNKNOWN",
            outcomes: [],
            outcomeSchema: {},
            sourceMetadataVersion: "test-v1"
        });
        const resolutionProfile = new CanonicalResolutionProfileNormalizer().normalize({
            venueMarketProfileId: market.id
        });
        const settlementProfile = new CanonicalSettlementProfileNormalizer().normalize({
            venueMarketProfileId: market.id,
            settlementType: "unknown"
        });
        const fingerprint = new PropositionFingerprintBuilder().build({
            market,
            resolutionProfile
        });

        const contract = new InterpretedContractBuilder().build({
            market,
            fingerprint,
            resolutionProfile,
            settlementProfile
        });

        expect(contract.isPoolable).toBe(false);
        expect(contract.ambiguityFlags.missingCriticalOutcomeSemantics).toBe(true);
    });
});
