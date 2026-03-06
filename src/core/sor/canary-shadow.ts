import { createHash } from "node:crypto";

export interface CanaryWindowInput {
  enabled: boolean;
  startAt?: string;
  endAt?: string;
  now?: () => Date;
}

export interface ShadowDecision {
  quoteId: string;
  providerId?: string;
  price?: number;
}

export type ShadowMode = "legacy_authoritative" | "sor_authoritative";

export interface DecisionComparison {
  match: boolean;
  dimension: "quote_id" | "provider" | "price_band";
  reason?: "different_quote" | "price_delta" | "no_candidate" | "error";
  priceDeltaBps: number;
}

const toUint32 = (hex: string): number => {
  return Number.parseInt(hex, 16) >>> 0;
};

export const isCanarySampled = (sessionId: string, percent: number): boolean => {
  if (percent <= 0) {
    return false;
  }
  if (percent >= 1) {
    return true;
  }

  const digest = createHash("sha256").update(sessionId).digest("hex");
  const bucket = toUint32(digest.slice(0, 8)) / 0xffffffff;
  return bucket < percent;
};

export const isCanaryWindowActive = (input: CanaryWindowInput): boolean => {
  if (!input.enabled) {
    return false;
  }
  const now = (input.now ?? (() => new Date()))().getTime();

  if (input.startAt) {
    const start = Date.parse(input.startAt);
    if (Number.isFinite(start) && now < start) {
      return false;
    }
  }

  if (input.endAt) {
    const end = Date.parse(input.endAt);
    if (Number.isFinite(end) && now > end) {
      return false;
    }
  }

  return true;
};

const toPriceDeltaBps = (left?: number, right?: number): number => {
  if (typeof left !== "number" || typeof right !== "number" || right === 0) {
    return 0;
  }

  return Math.abs(((left - right) / right) * 10000);
};

export const compareShadowDecisions = (
  authoritative: ShadowDecision | null,
  shadow: ShadowDecision | null
): DecisionComparison => {
  if (!authoritative || !shadow) {
    return {
      match: false,
      dimension: "quote_id",
      reason: "no_candidate",
      priceDeltaBps: 0
    };
  }

  if (authoritative.quoteId === shadow.quoteId) {
    return {
      match: true,
      dimension: "quote_id",
      priceDeltaBps: toPriceDeltaBps(authoritative.price, shadow.price)
    };
  }

  if (
    authoritative.providerId &&
    shadow.providerId &&
    authoritative.providerId === shadow.providerId
  ) {
    return {
      match: true,
      dimension: "provider",
      priceDeltaBps: toPriceDeltaBps(authoritative.price, shadow.price)
    };
  }

  return {
    match: false,
    dimension: "price_band",
    reason: "different_quote",
    priceDeltaBps: toPriceDeltaBps(authoritative.price, shadow.price)
  };
};

