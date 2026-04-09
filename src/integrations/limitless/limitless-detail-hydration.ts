import type { LimitlessMarketDetail } from "./limitless-client.js";

const stripHtml = (value: string): string =>
  value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, "\"")
    .replace(/&lsquo;|&rsquo;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();

const asOptionalText = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const toDateOrNull = (value: unknown): Date | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const selectExecutableTitle = (input: {
  detailTitle: string | null;
  fallbackTitle: string;
  normalizedRules: string | null;
}): string => {
  const detailTitle = input.detailTitle;
  const fallbackTitle = input.fallbackTitle.trim();
  if (!detailTitle) {
    return fallbackTitle;
  }

  const normalizedDetailTitle = detailTitle.trim();
  const fallbackLooksExecutable = fallbackTitle.includes("?");
  const detailLooksExecutable = normalizedDetailTitle.includes("?");

  if (fallbackLooksExecutable && !detailLooksExecutable) {
    return fallbackTitle;
  }

  if (
    input.normalizedRules &&
    !detailLooksExecutable &&
    input.normalizedRules.toLowerCase().includes(normalizedDetailTitle.toLowerCase()) &&
    fallbackTitle.length >= normalizedDetailTitle.length
  ) {
    return fallbackTitle;
  }

  return normalizedDetailTitle;
};

export interface HydratedLimitlessExecutableProfile {
  title: string;
  description: string | null;
  resolutionTitle: string;
  resolutionRulesText: string | null;
  publishedAt: Date | null;
  expiresAt: Date | null;
  resolvesAt: Date | null;
  resolutionSource: string | null;
  detailHydrated: boolean;
}

export const hydrateLimitlessExecutableProfile = (input: {
  detail: LimitlessMarketDetail | null;
  fallbackTitle: string;
  fallbackDescription?: string | null;
}): HydratedLimitlessExecutableProfile => {
  const detailDescription = asOptionalText(input.detail?.description);
  const normalizedRules = detailDescription ? stripHtml(detailDescription) : null;
  const normalizedFallbackDescription = asOptionalText(input.fallbackDescription);
  const detailTitle = asOptionalText(input.detail?.title);
  const title = selectExecutableTitle({
    detailTitle,
    fallbackTitle: input.fallbackTitle,
    normalizedRules
  });
  const description = normalizedRules ?? normalizedFallbackDescription ?? input.fallbackTitle;
  const publishedAt = toDateOrNull(input.detail?.createdAt);
  const expiration =
    toDateOrNull(input.detail?.expirationTimestamp)
    ?? toDateOrNull(input.detail?.expirationDate)
    ?? toDateOrNull((input.detail as Record<string, unknown> | null)?.deadline);

  return {
    title,
    description,
    resolutionTitle: title,
    resolutionRulesText: description,
    publishedAt,
    expiresAt: expiration,
    resolvesAt: expiration,
    resolutionSource: input.detail ? "LIMITLESS" : null,
    detailHydrated: Boolean(input.detail)
  };
};
