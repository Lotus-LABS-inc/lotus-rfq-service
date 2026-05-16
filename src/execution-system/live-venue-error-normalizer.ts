import type { NormalizedVenueError } from "./venue-adapter.js";

export interface LiveVenueErrorNormalizationInput {
  venue: string;
  fallbackCode: string;
  fallbackMessage: string;
  retryable?: boolean | undefined;
}

export const normalizeLiveVenueErrorMessage = (
  raw: unknown,
  input: LiveVenueErrorNormalizationInput
): NormalizedVenueError => {
  const venue = input.venue.toUpperCase();
  const rawMessage = messageFromUnknown(raw) ?? input.fallbackMessage;
  const message = sanitizeProviderMessage(rawMessage);
  const lower = message.toLowerCase();
  const retryable = input.retryable ?? false;

  if (venue === "POLYMARKET") {
    if (containsAny(lower, [
      "not enough balance",
      "balance is not enough",
      "not enough allowance",
      "allowance is not enough",
      "clob collateral"
    ])) {
      return {
        code: "POLYMARKET_CLOB_COLLATERAL_NOT_READY",
        message: "Polymarket CLOB collateral is not ready for this order. Refresh balances, activate or approve Polymarket funds, then retry.",
        retryable
      };
    }
    if (containsAny(lower, [
      "conditional token",
      "token balance is less",
      "insufficient shares",
      "share balance",
      "shares not ready"
    ])) {
      return {
        code: "POLYMARKET_CLOB_SHARES_NOT_READY",
        message: "Polymarket shares are not spendable for this sell order. Refresh positions, approve trading access, then retry.",
        retryable
      };
    }
  }

  if (venue === "LIMITLESS") {
    if (containsAny(lower, [
      "insufficient collateral",
      "collateral allowance",
      "collateral balance",
      "total bid amount"
    ])) {
      return {
        code: "LIMITLESS_COLLATERAL_NOT_READY",
        message: "Limitless collateral is not ready for this order. Refresh balances, approve Limitless collateral, then retry.",
        retryable
      };
    }
    if (containsAny(lower, [
      "conditional token allowance",
      "conditional-token allowance",
      "conditional token balance",
      "conditional-token balance",
      "exchange not approved",
      "token balance is less",
      "insufficient shares",
      "share balance"
    ])) {
      return {
        code: "LIMITLESS_SHARES_NOT_READY",
        message: "Limitless shares are not spendable for this sell order. Refresh positions, approve Limitless shares, then retry.",
        retryable
      };
    }
  }

  if (venue === "PREDICT_FUN" || venue === "PREDICT") {
    if (containsAny(lower, [
      "status 401",
      "unauthorized",
      "invalid api key",
      "api key",
      "jwt",
      "token expired",
      "fresh user auth"
    ])) {
      return {
        code: lower.includes("status 401") || lower.includes("unauthorized")
          ? "PREDICT_PROVIDER_AUTH_INVALID"
          : "PREDICT_FUN_AUTH_REFRESH_REQUIRED",
        message: lower.includes("fresh user auth") || lower.includes("jwt") || lower.includes("token expired")
          ? "Predict.fun requires a fresh user auth signature before live submit. Refresh the Predict.fun venue setup, then retry."
          : "Predict.fun provider authentication is not ready. Check backend Predict.fun API credentials before retrying.",
        retryable
      };
    }
    if (containsAny(lower, [
      "collateral usdt allowance",
      "collateral allowance",
      "collateral balance",
      "total bid amount"
    ])) {
      return {
        code: "PREDICT_FUN_COLLATERAL_NOT_READY",
        message: "Predict.fun collateral is not ready for this order. Refresh balances, approve Predict.fun USDT, then retry.",
        retryable
      };
    }
    if (containsAny(lower, [
      "exchange is not approved",
      "exchange not approved",
      "token balance is less",
      "insufficient shares",
      "share balance"
    ])) {
      return {
        code: "PREDICT_FUN_SHARES_NOT_READY",
        message: "Predict.fun shares are not spendable for this sell order. Refresh positions, approve Predict.fun shares, then retry.",
        retryable
      };
    }
  }

  if (venue === "OPINION") {
    return {
      code: "OPINION_LIVE_SUBMIT_NOT_ENABLED",
      message: "Opinion live order submission is not enabled. Lotus can quote Opinion markets, but live submit remains disabled.",
      retryable: false
    };
  }

  return {
    code: input.fallbackCode,
    message,
    retryable
  };
};

const messageFromUnknown = (value: unknown): string | null => {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    if (typeof record.error === "string") return record.error;
    if (typeof record.reason === "string") return record.reason;
  }
  return null;
};

const sanitizeProviderMessage = (value: string): string =>
  value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(x-api-key|api[_-]?key|authorization|signature|secret|passphrase)\s*[:=]\s*["']?[^"',\s}]+/gi, "$1=[redacted]")
    .slice(0, 280);

const containsAny = (value: string, patterns: readonly string[]): boolean =>
  patterns.some((pattern) => value.includes(pattern));
