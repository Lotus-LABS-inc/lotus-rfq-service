import { pino } from "pino";
import crypto from "crypto";
import { Decimal } from "decimal.js";
import { ComboRFQSession, ComboQuote, LPComboQuoteRequest } from "../core/combo-engine/types.js";
import { computeEffectiveCostFromLPQuote } from "../core/combo-engine/pricing-engine.js";
import { metrics } from "../observability/metrics.js"; // Assuming metric instance exists, we'll proxy it or rely on existing pattern

// Extend ComboQuote interface to include isApproximate feature request
export interface NormalizedComboQuote extends ComboQuote {
    isApproximate: boolean; // True if using naive linear per-leg pricing instead of explicit combo pricing
}

export class ComboQuoteNormalizer {
    public constructor(private readonly logger: pino.Logger) { }

    /**
     * Accepts an LP submission (whole-combo or per-leg) and normalizes it to a unified combo-level schema.
     * Validates per-leg price consistency (size match, price bounds).
     * 
     * @param lpPayload The raw validated quote from the LP API
     * @param session The authoritative RFQ Session requested by the Taker
     * @returns NormalizedComboQuote
     * @throws Error if validation fails (e.g. missing legs, size mismatches)
     */
    public normalizeLPQuote(lpPayload: LPComboQuoteRequest, session: ComboRFQSession): NormalizedComboQuote {

        // 1. Expiry Validation
        const quoteExpiry = new Date(lpPayload.validUntil);
        if (quoteExpiry < new Date()) {
            this.logger.warn({ lpId: lpPayload.lpId, comboSessionId: session.id }, "Quote expired before normalization");
            throw new Error("Quote has already expired");
        }
        if (quoteExpiry > session.expiresAt) {
            // Cap expiry to session expiry
            quoteExpiry.setTime(session.expiresAt.getTime());
        }

        let isApproximate = false;

        // 2. Validation based on quote type
        if (lpPayload.isComboQuote) {
            if (!lpPayload.comboPrice) {
                throw new Error("Combo quote must provide a single comboPrice");
            }
        } else {
            // Per-leg validation
            isApproximate = true; // Flagged as approximate since it relies on linear fallback per requested spec

            if (!lpPayload.perLegPrices || lpPayload.perLegPrices.length !== session.legs.length) {
                this.logger.error({ required: session.legs.length, provided: lpPayload.perLegPrices?.length ?? 0 }, "Mismatch in leg quantities provided");
                throw new Error("Per-leg quote must provide pricing for exactly the number of requested combo legs");
            }

            // Map provided legs for quick lookup
            const providedLegs = new Map(lpPayload.perLegPrices.map(l => [l.legId, l]));

            // Ensure every requested leg is accounted for and sizes match EXACTLY.
            // Using Decimal strings to guarantee lossless comparison.
            for (const requestedLeg of session.legs) {
                const provided = providedLegs.get(requestedLeg.id);
                if (!provided) {
                    throw new Error(`Missing quote for leg ID: ${requestedLeg.id}`);
                }

                // Compare numeric magnitudes using Decimal to avoid string format issues ("100" vs "100.0")
                const reqSize = new Decimal(requestedLeg.quantity).abs();
                const provSize = new Decimal(provided.size).abs();

                if (!reqSize.equals(provSize)) {
                    throw new Error(`Size mismatch on leg ${requestedLeg.id}. Requested: ${reqSize.toString()}, Provided: ${provSize.toString()}`);
                }

                const price = new Decimal(provided.price);
                if (price.isNaN() || !price.isFinite() || price.isNegative()) {
                    throw new Error(`Invalid price on leg ${requestedLeg.id}`);
                }
            }
        }

        const quoteId = crypto.randomUUID();

        // 3. Normalized structure construction
        const normalized: NormalizedComboQuote = {
            id: quoteId,
            comboSessionId: session.id,
            lpId: lpPayload.lpId,
            isComboQuote: lpPayload.isComboQuote,
            comboPrice: lpPayload.comboPrice || undefined,
            perLegPrices: lpPayload.perLegPrices || undefined,
            effectiveCost: "0", // Handled below
            expiresAt: quoteExpiry,
            rawPayload: lpPayload.rawPayload || {},
            createdAt: new Date(),
            isApproximate
        };

        // 4. Compute Effective Cost using Pricing Engine
        // Assuming 0bps platform fee for this step, though configurable
        normalized.effectiveCost = computeEffectiveCostFromLPQuote(normalized, 0).toString();

        // 5. Metrics emission
        // Optional chaining if metrics singleton missing these exact gauges in this minimal repo example
        if (metrics && (metrics as any).normalizedComboQuoteTotal) {
            (metrics as any).normalizedComboQuoteTotal.inc({ lp_id: normalized.lpId, is_combo: normalized.isComboQuote ? 'true' : 'false' });
        }

        this.logger.info({ quoteId: normalized.id, effectiveCost: normalized.effectiveCost }, "Quote normalized successfully");

        return normalized;
    }
}
