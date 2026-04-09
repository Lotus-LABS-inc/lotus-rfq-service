import Decimal from "decimal.js";

import type { SettlementProfile, SettlementType } from "./canonicalization-types.js";
import { buildStableTextId, clampRatioString } from "./canonicalization-types.js";

export interface SettlementProfileNormalizationInput {
    venueMarketProfileId: string;
    settlementType?: SettlementType | null;
    settlementLagHours?: string | number | null;
    disputeWindowHours?: string | number | null;
    finalityLagHours?: string | number | null;
    payoutTimingHours?: string | number | null;
    feeOnEntry?: boolean;
    feeOnExit?: boolean;
    timeSensitiveFeeBehavior?: string | null;
    requiresConservativeAnchor?: boolean;
    metadata?: Record<string, unknown> | null;
}

export class CanonicalSettlementProfileNormalizer {
    public normalize(input: SettlementProfileNormalizationInput): SettlementProfile {
        const now = new Date();
        const settlementType = this.resolveSettlementType(input);
        const completeness = this.computeMetadataCompleteness(input);

        return {
            id: buildStableTextId("csp_", input.venueMarketProfileId),
            venueMarketProfileId: input.venueMarketProfileId,
            settlementType,
            settlementLagHours: this.optionalDecimalString(input.settlementLagHours),
            disputeWindowHours: this.optionalDecimalString(input.disputeWindowHours),
            finalityLagHours: this.optionalDecimalString(input.finalityLagHours),
            payoutTimingHours: this.optionalDecimalString(input.payoutTimingHours),
            feeOnEntry: input.feeOnEntry ?? false,
            feeOnExit: input.feeOnExit ?? false,
            timeSensitiveFeeBehavior: input.timeSensitiveFeeBehavior?.trim() || null,
            requiresConservativeAnchor: input.requiresConservativeAnchor ?? false,
            metadataCompletenessScore: clampRatioString(completeness),
            metadata: input.metadata ?? {},
            createdAt: now,
            updatedAt: now
        };
    }

    private resolveSettlementType(input: SettlementProfileNormalizationInput): SettlementType {
        if (input.settlementType) {
            return input.settlementType;
        }

        const metadata = input.metadata ?? {};
        const venue = typeof metadata.venue === "string" ? metadata.venue.toUpperCase() : null;
        if (venue === "POLYMARKET") {
            return "onchain";
        }

        return "unknown";
    }

    private optionalDecimalString(value: string | number | null | undefined): string | null {
        if (value === null || value === undefined || value === "") {
            return null;
        }
        const decimal = new Decimal(value);
        if (!decimal.isFinite() || decimal.isNegative()) {
            return null;
        }
        return decimal.toString();
    }

    private computeMetadataCompleteness(input: SettlementProfileNormalizationInput): number {
        const flags = [
            input.settlementType !== undefined && input.settlementType !== null,
            input.settlementLagHours !== undefined && input.settlementLagHours !== null,
            input.disputeWindowHours !== undefined && input.disputeWindowHours !== null,
            input.finalityLagHours !== undefined && input.finalityLagHours !== null,
            input.payoutTimingHours !== undefined && input.payoutTimingHours !== null,
            input.timeSensitiveFeeBehavior !== undefined && input.timeSensitiveFeeBehavior !== null
        ];

        return flags.filter(Boolean).length / flags.length;
    }
}
