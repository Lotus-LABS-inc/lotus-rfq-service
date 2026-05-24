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

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

const normalizeComparableText = (value: string): string =>
  stripHtml(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const collectTextFields = (
  value: unknown,
  fieldNames: readonly string[],
  depth: number
): string[] => {
  if (depth < 0 || typeof value === "string") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectTextFields(entry, fieldNames, depth - 1));
  }
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return [];
  }
  const direct = fieldNames.flatMap((field) => {
    const candidate = record[field];
    return typeof candidate === "string" && candidate.trim().length > 0 ? [candidate] : [];
  });
  const nested = Object.values(record).flatMap((entry) => collectTextFields(entry, fieldNames, depth - 1));
  return [...direct, ...nested];
};

const selectVenueRuleText = (input: {
  detail: LimitlessMarketDetail | null;
  fallbackTitle: string;
  fallbackDescription?: string | null;
}): string | null => {
  const detail = asRecord(input.detail);
  const candidates = [
    ...collectTextFields(detail, [
      "resolutionRules",
      "resolution_rules",
      "resolutionRule",
      "resolution_rule",
      "resolutionRulesText",
      "resolution_rules_text",
      "rules",
      "rule",
      "description",
      "resolveDescription",
      "resolutionCriteria",
      "settlementRules"
    ], 3),
    input.fallbackDescription ?? null
  ];
  const normalizedTitle = normalizeComparableText(input.fallbackTitle);
  for (const candidate of candidates) {
    const stripped = stripHtml(candidate ?? "");
    if (!stripped) {
      continue;
    }
    const normalizedCandidate = normalizeComparableText(stripped);
    if (!normalizedCandidate || normalizedCandidate === normalizedTitle) {
      continue;
    }
    return stripped;
  }
  return null;
};

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
  const normalizedRules = selectVenueRuleText(input);
  const detailTitle = asOptionalText(input.detail?.title);
  const title = selectExecutableTitle({
    detailTitle,
    fallbackTitle: input.fallbackTitle,
    normalizedRules
  });
  const description = normalizedRules;
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
