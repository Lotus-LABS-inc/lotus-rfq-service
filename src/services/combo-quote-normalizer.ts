import crypto from "crypto";
import type { Logger } from "pino";
import Decimal from "decimal.js";
import type { ComboRFQSession, ComboQuote, LPComboQuoteRequest } from "../core/combo-engine/types.js";
import { computeEffectiveCostFromLPQuote } from "../core/combo-engine/pricing-engine.js";

export interface NormalizedComboQuote extends ComboQuote {
  isApproximate: boolean;
}

export interface IComboQuoteNormalizer {
  normalizeLPQuote(lpPayload: LPComboQuoteRequest, session: ComboRFQSession): NormalizedComboQuote;
}

export class ComboQuoteNormalizer implements IComboQuoteNormalizer {
  public constructor(private readonly logger: Logger) {}

  public normalizeLPQuote(
    lpPayload: LPComboQuoteRequest,
    session: ComboRFQSession
  ): NormalizedComboQuote {
    const quoteExpiry = new Date(lpPayload.validUntil);
    if (quoteExpiry < new Date()) {
      this.logger.warn({ lpId: lpPayload.lpId, comboSessionId: session.id }, "Quote expired before normalization.");
      throw new Error("Quote has already expired");
    }
    if (quoteExpiry > session.expiresAt) {
      quoteExpiry.setTime(session.expiresAt.getTime());
    }

    let isApproximate = false;

    if (lpPayload.isComboQuote) {
      if (!lpPayload.comboPrice) {
        throw new Error("Combo quote must provide a single comboPrice");
      }
    } else {
      isApproximate = true;
      if (!lpPayload.perLegPrices || lpPayload.perLegPrices.length !== session.legs.length) {
        throw new Error("Per-leg quote must provide pricing for exactly the number of requested combo legs");
      }

      const providedLegs = new Map(lpPayload.perLegPrices.map((leg) => [leg.legId, leg]));
      for (const requestedLeg of session.legs) {
        const provided = providedLegs.get(requestedLeg.id);
        if (!provided) {
          throw new Error(`Missing quote for leg ID: ${requestedLeg.id}`);
        }

        const reqSize = new Decimal(requestedLeg.quantity).abs();
        const provSize = new Decimal(provided.size).abs();
        if (!reqSize.equals(provSize)) {
          throw new Error(
            `Size mismatch on leg ${requestedLeg.id}. Requested: ${reqSize.toString()}, Provided: ${provSize.toString()}`
          );
        }

        const price = new Decimal(provided.price);
        if (price.isNaN() || !price.isFinite() || price.isNegative()) {
          throw new Error(`Invalid price on leg ${requestedLeg.id}`);
        }
      }
    }

    const normalizedBase = {
      id: crypto.randomUUID(),
      comboSessionId: session.id,
      lpId: lpPayload.lpId,
      isComboQuote: lpPayload.isComboQuote,
      effectiveCost: "0",
      expiresAt: quoteExpiry,
      rawPayload: lpPayload.rawPayload ?? {},
      createdAt: new Date(),
      isApproximate
    };

    const normalized: NormalizedComboQuote = lpPayload.isComboQuote
      ? {
          ...normalizedBase,
          ...(lpPayload.comboPrice ? { comboPrice: lpPayload.comboPrice } : {})
        }
      : {
          ...normalizedBase,
          ...(lpPayload.perLegPrices ? { perLegPrices: lpPayload.perLegPrices } : {})
        };

    normalized.effectiveCost = computeEffectiveCostFromLPQuote(normalized, 0).toString();

    this.logger.info(
      { quoteId: normalized.id, effectiveCost: normalized.effectiveCost },
      "Combo quote normalized successfully."
    );

    return normalized;
  }
}
