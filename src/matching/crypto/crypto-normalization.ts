import { normalizeFreeText, serializeStableRecord } from "../../canonical/canonicalization-types.js";
import type { MatchingMarketRecord } from "../matching-types.js";
import type {
  CryptoBucketGranularity,
  CryptoComparator,
  CryptoContractFamily,
  CryptoObservationType,
  CryptoStructuralContractClass
} from "./crypto-match-labels.js";

const MONTH_LOOKUP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12
};

interface ParsedDateParts {
  year: number;
  month: number;
  day: number;
  dateKey: string;
  raw: string;
}

export interface CryptoCutoff {
  cutoffTimestamp: string;
  timezoneNormalizedCutoffKey: string;
  timezone: "UTC" | "ET";
  raw: string;
}

const buildText = (market: MatchingMarketRecord): string =>
  `${market.title} ${market.rulesText ?? ""}`.trim();

const normalizeThresholdShorthand = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");

const toIsoDateKey = (year: number, month: number, day: number): string =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const matchCalendarDate = (text: string): ParsedDateParts | null => {
  const match = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:,?\s+(20\d{2}))?\b/i);
  if (!match) {
    return null;
  }
  const month = MONTH_LOOKUP[match[1]!.toLowerCase().replace(".", "")];
  const day = Number.parseInt(match[2]!, 10);
  const year = match[3] ? Number.parseInt(match[3], 10) : Number.NaN;
  if (!month || Number.isNaN(day)) {
    return null;
  }
  return {
    year,
    month,
    day,
    dateKey: year ? toIsoDateKey(year, month, day) : "",
    raw: match[0]
  };
};

const resolveYear = (market: MatchingMarketRecord, year: number): number => {
  if (!Number.isNaN(year)) {
    return year;
  }
  const fallback = market.resolvesAt ?? market.expiresAt ?? market.publishedAt;
  return fallback?.getUTCFullYear() ?? 1970;
};

const firstSunday = (year: number, month: number): number => {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const weekday = start.getUTCDay();
  return weekday === 0 ? 1 : 8 - weekday;
};

const parseEasternOffsetHours = (year: number, month: number, day: number, hour: number): number => {
  const secondSundayInMarch = firstSunday(year, 3) + 7;
  const firstSundayInNovember = firstSunday(year, 11);
  const afterDstStart =
    month > 3
    || (month === 3 && (day > secondSundayInMarch || (day === secondSundayInMarch && hour >= 2)));
  const beforeDstEnd =
    month < 11
    || (month === 11 && (day < firstSundayInNovember || (day === firstSundayInNovember && hour < 2)));
  return afterDstStart && beforeDstEnd ? -4 : -5;
};

const buildUtcDate = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: "UTC" | "ET"
): Date => {
  const offsetHours = timezone === "UTC" ? 0 : parseEasternOffsetHours(year, month, day, hour);
  return new Date(Date.UTC(year, month - 1, day, hour - offsetHours, minute, 0, 0));
};

const matchTimeAndZone = (text: string): { hour: number; minute: number; timezone: "UTC" | "ET"; raw: string } | null => {
  const match = text.match(/(\d{1,2}):(\d{2})\s*(UTC|ET)\b/i);
  if (!match) {
    return null;
  }
  return {
    hour: Number.parseInt(match[1]!, 10),
    minute: Number.parseInt(match[2]!, 10),
    timezone: match[3]!.toUpperCase() as "UTC" | "ET",
    raw: match[0]
  };
};

const extractOutcomeLabels = (market: MatchingMarketRecord): readonly string[] =>
  market.outcomes
    .map((outcome) => outcome["label"])
    .filter((label): label is string => typeof label === "string")
    .map((label) => normalizeFreeText(label));

export const normalizeCryptoAsset = (market: MatchingMarketRecord): string | null => {
  const normalized = normalizeFreeText(buildText(market));
  if (/\b(bitcoin|btc)\b/.test(normalized)) return "BTC";
  if (/\b(ethereum|eth)\b/.test(normalized)) return "ETH";
  if (/\b(solana|sol)\b/.test(normalized)) return "SOL";
  if (/\b(bnb|binance coin)\b/.test(normalized)) return "BNB";
  return null;
};

export const normalizeCryptoThreshold = (market: MatchingMarketRecord): string | null => {
  const text = buildText(market);
  const match = text.match(/\$?\s*(\d+(?:,\d{3})*(?:\.\d+)?)(k|m|b)?\b/i);
  if (!match) {
    return null;
  }
  const base = Number.parseFloat(match[1]!.replace(/,/g, ""));
  const multiplier =
    !match[2] ? 1
    : match[2].toLowerCase() === "k" ? 1_000
    : match[2].toLowerCase() === "m" ? 1_000_000
    : 1_000_000_000;
  return normalizeThresholdShorthand(base * multiplier);
};

export const normalizeCryptoComparator = (market: MatchingMarketRecord): CryptoComparator | null => {
  const text = normalizeFreeText(buildText(market));
  const outcomes = extractOutcomeLabels(market);
  if (outcomes.includes("up") && outcomes.includes("down")) return "YES_NO_DIRECTIONAL";
  if (/\bup or down\b|\bhigher or lower\b/.test(text)) return "YES_NO_DIRECTIONAL";
  if (/\bat least\b|\bno less than\b/.test(text)) return "AT_OR_ABOVE";
  if (/\bat most\b|\bno more than\b/.test(text)) return "AT_OR_BELOW";
  if (/\babove\b|\bover\b|\breach(?:es)?\b|\bhit(?:s)?\b|\btouch(?:es)?\b/.test(text)) return "ABOVE";
  if (/\bbelow\b|\bunder\b/.test(text)) return "BELOW";
  if (/\bup\b|\bhigher\b/.test(text)) return "UP";
  if (/\bdown\b|\blower\b/.test(text)) return "DOWN";
  return null;
};

export const normalizeCryptoDateKey = (market: MatchingMarketRecord): string | null => {
  const parsed = matchCalendarDate(market.title) ?? matchCalendarDate(buildText(market));
  if (!parsed) {
    return null;
  }
  const resolvedYear = resolveYear(market, parsed.year);
  return toIsoDateKey(resolvedYear, parsed.month, parsed.day);
};

export const normalizeCryptoCutoff = (
  market: MatchingMarketRecord,
  family: CryptoContractFamily
): CryptoCutoff | null => {
  if (family === "ATH_BY_DATE") {
    return null;
  }
  const parsedDate = matchCalendarDate(market.title) ?? matchCalendarDate(buildText(market));
  const parsedTime = matchTimeAndZone(market.title) ?? matchTimeAndZone(buildText(market));
  if (parsedDate && parsedTime) {
    const resolvedYear = resolveYear(market, parsedDate.year);
    const utcDate = buildUtcDate(
      resolvedYear,
      parsedDate.month,
      parsedDate.day,
      parsedTime.hour,
      parsedTime.minute,
      parsedTime.timezone
    );
    return {
      cutoffTimestamp: utcDate.toISOString(),
      timezoneNormalizedCutoffKey: utcDate.toISOString(),
      timezone: parsedTime.timezone,
      raw: `${parsedDate.raw} ${parsedTime.raw}`
    };
  }
  const fallbackCutoff = market.expiresAt ?? market.resolvesAt;
  if (!fallbackCutoff || family === "THRESHOLD_BY_DATE") {
    return null;
  }
  return {
    cutoffTimestamp: fallbackCutoff.toISOString(),
    timezoneNormalizedCutoffKey: fallbackCutoff.toISOString(),
    timezone: "UTC",
    raw: "venue_boundary_fallback"
  };
};

export const inferCryptoBucketGranularity = (market: MatchingMarketRecord): CryptoBucketGranularity | null => {
  const text = normalizeFreeText(buildText(market));
  if (/\bhourly\b|\b\d{1,2}:\d{2}\s*utc\b|\b\d{1,2}:\d{2}\s*et\b/.test(text)) return "HOUR";
  if (/\bmonth\b/.test(text)) return "MONTH";
  if (/\bday\b|\btoday\b|\btomorrow\b|\bon march\b|\bon april\b/.test(text)) return "DAY";
  return null;
};

export const inferCryptoObservationType = (
  market: MatchingMarketRecord,
  family: CryptoContractFamily
): CryptoObservationType | null => {
  const text = normalizeFreeText(buildText(market));
  if (family === "ATH_BY_DATE") return "ANY_TIME_BEFORE";
  if (family === "SAME_DAY_DIRECTIONAL") return "SAME_DAY_DIRECTIONAL";
  if (family === "PRICE_RANGE_BUCKET" || family === "UP_DOWN_BUCKET") return "BUCKETED_PRICE_RANGE";
  if (family === "PRICE_AT_CLOSE") return "END_OF_PERIOD_CLOSE";
  if (family === "THRESHOLD_BY_DATE") return /\bby\b/.test(text) ? "ANY_TIME_BEFORE" : "END_OF_PERIOD_CLOSE";
  if (family === "GENERIC_DIRECTIONAL") return "END_OF_PERIOD_CLOSE";
  return null;
};

export const inferCryptoStructuralContractClass = (
  family: CryptoContractFamily,
  observationType: CryptoObservationType | null,
  bucketGranularity: CryptoBucketGranularity | null
): CryptoStructuralContractClass => {
  if (family === "ATH_BY_DATE") return "ATH_ANY_TIME_BEFORE_DATE";
  if (family === "THRESHOLD_BY_DATE" && observationType === "ANY_TIME_BEFORE") return "THRESHOLD_ANY_TIME_BEFORE_DATE";
  if (family === "THRESHOLD_BY_DATE") return "THRESHOLD_FIXED_TIME";
  if (family === "SAME_DAY_DIRECTIONAL") return "DAILY_DIRECTIONAL_CLOSE";
  if (family === "PRICE_AT_CLOSE") return "PRICE_AT_CLOSE_POINT";
  if (family === "UP_DOWN_BUCKET") return "UP_DOWN_BUCKET";
  if (family === "PRICE_RANGE_BUCKET") return "PRICE_RANGE_BUCKET";
  return bucketGranularity === "HOUR" ? "POINT_IN_TIME_DIRECTIONAL_CLOSE" : "DAILY_DIRECTIONAL_CLOSE";
};

export const inferCryptoBinaryStructure = (market: MatchingMarketRecord): string => {
  const labels = extractOutcomeLabels(market);
  if (labels.includes("up") && labels.includes("down")) return "UP_DOWN_BINARY";
  if (labels.includes("yes") && labels.includes("no")) return "YES_NO_BINARY";
  return `${market.marketClass}_STRUCTURE`;
};

export const extractCryptoRangeMetadata = (market: MatchingMarketRecord): Readonly<Record<string, unknown>> | null => {
  const text = normalizeFreeText(buildText(market));
  const betweenMatch = text.match(/\bbetween\s+\$?\s*(\d+(?:,\d{3})*(?:\.\d+)?(?:k|m|b)?)\s+and\s+\$?\s*(\d+(?:,\d{3})*(?:\.\d+)?(?:k|m|b)?)\b/i);
  if (!betweenMatch) {
    return null;
  }
  const lower = normalizeCryptoThreshold({ ...market, title: betweenMatch[1] ?? "", rulesText: null });
  const upper = normalizeCryptoThreshold({ ...market, title: betweenMatch[2] ?? "", rulesText: null });
  return lower && upper ? { lower, upper } : null;
};

export const buildCryptoDeterministicHash = (value: Record<string, unknown>): string =>
  serializeStableRecord(value);

