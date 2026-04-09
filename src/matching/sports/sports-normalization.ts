import { normalizeFreeText } from "../../canonical/canonicalization-types.js";
import type { MatchingMarketRecord } from "../matching-types.js";
import type { SportsScopedDomain } from "./sports-match-labels.js";

const MONTH_INDEX = new Map([
  ["jan", 0], ["january", 0],
  ["feb", 1], ["february", 1],
  ["mar", 2], ["march", 2],
  ["apr", 3], ["april", 3],
  ["may", 4],
  ["jun", 5], ["june", 5],
  ["jul", 6], ["july", 6],
  ["aug", 7], ["august", 7],
  ["sep", 8], ["sept", 8], ["september", 8],
  ["oct", 9], ["october", 9],
  ["nov", 10], ["november", 10],
  ["dec", 11], ["december", 11]
]);

const ENTITY_ALIASES: Readonly<Record<string, string>> = {
  lakers: "los angeles lakers",
  "los angeles lakers": "los angeles lakers",
  magic: "orlando magic",
  "orlando magic": "orlando magic",
  bulls: "chicago bulls",
  "chicago bulls": "chicago bulls",
  grizzlies: "memphis grizzlies",
  "memphis grizzlies": "memphis grizzlies",
  celtics: "boston celtics",
  "boston celtics": "boston celtics",
  hornets: "charlotte hornets",
  "charlotte hornets": "charlotte hornets",
  heat: "miami heat",
  "miami heat": "miami heat",
  pacers: "indiana pacers",
  "indiana pacers": "indiana pacers",
  jazz: "utah jazz",
  "utah jazz": "utah jazz",
  suns: "phoenix suns",
  "phoenix suns": "phoenix suns",
  nets: "brooklyn nets",
  "brooklyn nets": "brooklyn nets",
  bucks: "milwaukee bucks",
  "milwaukee bucks": "milwaukee bucks",
  knicks: "new york knicks",
  "new york knicks": "new york knicks",
  spurs: "san antonio spurs",
  "san antonio spurs": "san antonio spurs",
  warriors: "golden state warriors",
  "golden state warriors": "golden state warriors",
  nuggets: "denver nuggets",
  "denver nuggets": "denver nuggets",
  thunder: "oklahoma city thunder",
  "oklahoma city thunder": "oklahoma city thunder",
  avalanche: "colorado avalanche",
  "colorado avalanche": "colorado avalanche",
  "manchester city": "manchester city",
  "manchester city fc": "manchester city",
  arsenal: "arsenal",
  "arsenal fc": "arsenal",
  chelsea: "chelsea",
  "chelsea fc": "chelsea",
  liverpool: "liverpool",
  "liverpool fc": "liverpool",
  "real madrid": "real madrid",
  "real madrid cf": "real madrid",
  barcelona: "barcelona",
  "fc barcelona": "barcelona",
  "atletico madrid": "atletico madrid",
  "atlético madrid": "atletico madrid",
  sevilla: "sevilla",
  "crystal palace": "crystal palace",
  "crystal palace fc": "crystal palace",
  fnatic: "fnatic",
  g2: "g2",
  "g2 esports": "g2",
  "team liquid": "team liquid",
  liquid: "team liquid",
  sentinels: "sentinels",
  "paper rex": "paper rex",
  prx: "paper rex",
  "edward gaming": "edward gaming",
  edg: "edward gaming",
  drx: "drx",
  "gen g": "geng",
  "gen g esports": "geng",
  geng: "geng",
  t1: "t1",
  navi: "navi",
  vitality: "vitality",
  aurora: "aurora",
  "aurora gaming": "aurora",
  pari: "pari",
  parivision: "pari",
  tundra: "tundra",
  falcons: "falcons",
  "team falcons": "falcons",
  mouz: "mouz",
  xg: "xg",
  "xtreme gaming": "xg",
  yandex: "yandex",
  "team yandex": "yandex",
  spirit: "spirit",
  "team spirit": "spirit",
  dyg: "dyg",
  ttg: "ttg",
  wb: "wb",
  "lgd nbw": "lgd nbw",
  wol: "wol",
  ksg: "ksg",
  pv: "pv"
};

const COMPETITION_PATTERNS: ReadonlyArray<{
  key: string;
  label: string;
  sportOrEsport: string;
  pattern: RegExp;
}> = [
  { key: "nba", label: "NBA", sportOrEsport: "basketball", pattern: /\bnba\b/i },
  { key: "nhl", label: "NHL", sportOrEsport: "hockey", pattern: /\bnhl\b|\bstanley cup\b/i },
  { key: "premier_league", label: "Premier League", sportOrEsport: "football", pattern: /\bpremier league\b|\bepl\b/i },
  { key: "la_liga", label: "La Liga", sportOrEsport: "football", pattern: /\bla liga\b|\blaliga\b|\bla-liga\b/i },
  { key: "fifa_club_world_cup", label: "FIFA Club World Cup", sportOrEsport: "football", pattern: /\bfifa club world cup\b/i },
  { key: "valorant_champions", label: "VALORANT Champions", sportOrEsport: "valorant", pattern: /\bvalorant\b.*\bchampions\b|\bvct champions\b|\bvalorant champions\b/i },
  { key: "valorant_masters", label: "VALORANT Masters", sportOrEsport: "valorant", pattern: /\bvalorant\b.*\bmasters\b|\bvct masters\b|\bvalorant masters\b/i },
  { key: "valorant_vct", label: "VCT", sportOrEsport: "valorant", pattern: /\bvct\b|\bvalorant champions tour\b|\bvalorant\b/i },
  { key: "lck", label: "LCK", sportOrEsport: "league of legends", pattern: /\blck\b/i },
  { key: "lec", label: "LEC", sportOrEsport: "league of legends", pattern: /\blec\b/i },
  { key: "lcs", label: "LCS", sportOrEsport: "league of legends", pattern: /\blcs\b/i },
  { key: "lpl", label: "LPL", sportOrEsport: "league of legends", pattern: /\blpl\b/i },
  { key: "lol_msi", label: "MSI", sportOrEsport: "league of legends", pattern: /\bmsi\b|\bmid-season invitational\b/i },
  { key: "lol_worlds", label: "LoL Worlds", sportOrEsport: "league of legends", pattern: /\bworlds\b/i },
  { key: "cs2_blast", label: "BLAST", sportOrEsport: "cs2", pattern: /\bcs2\b.*\bblast\b|\bblast\b/i },
  { key: "dota2_esl", label: "ESL", sportOrEsport: "dota2", pattern: /\bdota2\b.*\besl\b|\besl\b/i },
  { key: "kpl", label: "KPL", sportOrEsport: "honor of kings", pattern: /\bkpl\b/i }
];

const normalizeWhitespace = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

const isEpochSentinelDate = (value: Date | null): boolean =>
  value !== null && value.getUTCFullYear() <= 1971;

const isTrustworthyTimingDate = (value: Date | null): value is Date =>
  value !== null && !isEpochSentinelDate(value);

const stripTrailingMatchContext = (value: string): string =>
  normalizeWhitespace(
    value
      .replace(/\(.+$/, "")
      .replace(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:\s+at\s+\d{1,2}:\d{2}(?:am|pm)\s*et|\s+\d{1,2}:\d{2}(?:am|pm)\s*et)?$/i, "")
      .replace(/\b\d{1,2}:\d{2}(?:am|pm)\s*et$/i, "")
      .replace(/[-,|]+$/g, "")
  );

const stripTitleLeadContext = (value: string): string =>
  normalizeWhitespace(
    value
      .replace(/^[^:]+:\s*/i, "")
      .replace(/^[^-|]+[-|]\s*/i, "")
  );

export const buildSportsText = (market: MatchingMarketRecord): string =>
  [market.title, market.description ?? "", market.rulesText ?? ""]
    .filter((value) => value.length > 0)
    .join(" ");

export const extractOutcomeLabels = (market: MatchingMarketRecord): readonly string[] =>
  Array.isArray(market.outcomes)
    ? market.outcomes
      .map((entry) => {
        const label = entry["label"];
        return typeof label === "string" ? label : null;
      })
      .filter((label): label is string => label !== null)
    : [];

export const isYesNoLabel = (value: string): boolean => {
  const normalized = normalizeFreeText(value);
  return normalized === "yes" || normalized === "no";
};

export const normalizeSportsEntity = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const normalized = normalizeWhitespace(
    normalizeFreeText(value)
      .replace(/\bthe\b/g, " ")
      .replace(/\bfc\b/g, " ")
      .replace(/\besports\b/g, " ")
      .replace(/\s+/g, " ")
  );
  return ENTITY_ALIASES[normalized] ?? (normalized || null);
};

export interface SportsMatchParticipantsExtraction {
  leftRaw: string;
  rightRaw: string;
  separator: "VS" | "AT";
  titleNoiseStripped: boolean;
}

export const extractMatchParticipantsFromTitleDetailed = (title: string): SportsMatchParticipantsExtraction | null => {
  const strippedTitle = stripTitleLeadContext(title);
  const separatorMatch = strippedTitle.match(/\s+(vs\.?|versus|@)\s+/i);
  if (!separatorMatch?.[1]) {
    return null;
  }

  const separator = separatorMatch[1].includes("@") ? "AT" : "VS";
  const splitPattern = separator === "AT" ? /\s+@\s+/i : /\s+(?:vs\.?|versus)\s+/i;
  const parts = strippedTitle.split(splitPattern).map((entry) => normalizeWhitespace(entry));
  if (parts.length < 2) {
    return null;
  }

  const leftOriginal = parts[0] ?? "";
  const rightOriginal = parts[1] ?? "";
  const leftRaw = stripTrailingMatchContext(leftOriginal);
  const rightRaw = stripTrailingMatchContext(rightOriginal);
  if (!leftRaw || !rightRaw) {
    return null;
  }

  return {
    leftRaw,
    rightRaw,
    separator,
    titleNoiseStripped: strippedTitle !== title || leftRaw !== leftOriginal || rightRaw !== rightOriginal
  };
};

export const extractMatchParticipantsFromTitle = (title: string): readonly [string, string] | null => {
  const detailed = extractMatchParticipantsFromTitleDetailed(title);
  return detailed ? [detailed.leftRaw, detailed.rightRaw] as const : null;
};

export const extractSubjectFromOutrightText = (market: MatchingMarketRecord): string | null => {
  const titleMatch = market.title.match(/will\s+(?:the\s+)?(.+?)\s+win\b/i);
  if (titleMatch?.[1]) {
    return normalizeWhitespace(titleMatch[1]);
  }
  const ruleMatch = buildSportsText(market).match(/if\s+(.+?)\s+wins?\b/i);
  if (ruleMatch?.[1]) {
    return normalizeWhitespace(ruleMatch[1]);
  }
  return normalizeWhitespace(market.title);
};

const extractExplicitYear = (text: string): number | null => {
  const match = text.match(/\b(20\d{2})\b/);
  if (!match?.[1]) {
    return null;
  }
  const year = Number.parseInt(match[1], 10);
  return Number.isFinite(year) ? year : null;
};

const resolveEasternUtcBoundary = (
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number
): string | null => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const expectedMonth = String(monthIndex + 1).padStart(2, "0");
  const expectedDay = String(day).padStart(2, "0");
  const expectedHour = String(hour).padStart(2, "0");
  const expectedMinute = String(minute).padStart(2, "0");

  for (const offsetHours of [4, 5]) {
    const candidate = new Date(Date.UTC(year, monthIndex, day, hour + offsetHours, minute, 0, 0));
    const parts = Object.fromEntries(
      formatter.formatToParts(candidate)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value])
    );
    if (
      parts["year"] === String(year)
      && parts["month"] === expectedMonth
      && parts["day"] === expectedDay
      && parts["hour"] === expectedHour
      && parts["minute"] === expectedMinute
    ) {
      return candidate.toISOString();
    }
  }

  return null;
};

export interface SportsBoundaryExtraction {
  dateKey: string | null;
  scheduledBoundaryKey: string | null;
  rawDateText: string | null;
  parsedTimestamp: string | null;
  status: "DATE_CONFIRMED" | "DATE_INFERRED" | "DATE_MISSING" | "DATE_INVALID" | "DATE_AMBIGUOUS";
  dateSourceProvenance: "TITLE_OR_RULES_ET" | "TIMING_SEMANTICS" | null;
  timestampSource: "TITLE_OR_RULES_ET" | "RESOLVES_AT" | "EXPIRES_AT" | "PUBLISHED_AT" | null;
  yearSource: "TITLE_OR_RULES" | "RESOLVES_AT" | "EXPIRES_AT" | "PUBLISHED_AT" | null;
  unsafeDefaultReasons: readonly string[];
}

const extractBoundaryFromTimingFallback = (market: MatchingMarketRecord): SportsBoundaryExtraction => {
  const unsafeDefaultReasons: string[] = [];
  if (isEpochSentinelDate(market.resolvesAt)) {
    unsafeDefaultReasons.push("RESOLVES_AT_EPOCH_SENTINEL");
  }

  const timingCandidates = [
    ["resolvesAt", market.resolvesAt],
    ["expiresAt", market.expiresAt],
    ["publishedAt", market.publishedAt]
  ] as const;
  const timingEntry = timingCandidates.find(([, value]) => isTrustworthyTimingDate(value));
  if (!timingEntry?.[1]) {
    return {
      dateKey: null,
      scheduledBoundaryKey: null,
      rawDateText: null,
      parsedTimestamp: null,
      status: unsafeDefaultReasons.length > 0 ? "DATE_INVALID" : "DATE_MISSING",
      dateSourceProvenance: null,
      timestampSource: null,
      yearSource: null,
      unsafeDefaultReasons
    };
  }

  const timestampSource =
    timingEntry[0] === "resolvesAt" ? "RESOLVES_AT"
      : timingEntry[0] === "expiresAt" ? "EXPIRES_AT"
      : "PUBLISHED_AT";

  return {
    dateKey: timingEntry[1].toISOString().slice(0, 10),
    scheduledBoundaryKey: timingEntry[0] === "publishedAt" ? null : timingEntry[1].toISOString(),
    rawDateText: null,
    parsedTimestamp: timingEntry[1].toISOString(),
    status: "DATE_INFERRED",
    dateSourceProvenance: "TIMING_SEMANTICS",
    timestampSource,
    yearSource: timestampSource,
    unsafeDefaultReasons
  };
};

export const extractSportsBoundaryDetailed = (market: MatchingMarketRecord): SportsBoundaryExtraction => {
  const text = buildSportsText(market);
  const exactMatch = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:,?\s+(20\d{2}))?(?:\s+at\s+(\d{1,2}):(\d{2})(am|pm)\s*et|\s+(\d{1,2}):(\d{2})(am|pm)\s*et)?/i);
  const unsafeDefaultReasons: string[] = [];
  if (isEpochSentinelDate(market.resolvesAt)) {
    unsafeDefaultReasons.push("RESOLVES_AT_EPOCH_SENTINEL");
  }

  if (exactMatch?.[1] && exactMatch[2]) {
    const monthIndex = MONTH_INDEX.get(exactMatch[1].toLowerCase().replace(/\./g, ""));
    if (monthIndex === undefined) {
      return {
        dateKey: null,
        scheduledBoundaryKey: null,
        rawDateText: exactMatch[0] ?? null,
        parsedTimestamp: null,
        status: "DATE_INVALID",
        dateSourceProvenance: "TITLE_OR_RULES_ET",
        timestampSource: null,
        yearSource: null,
        unsafeDefaultReasons
      };
    }

    const explicitYear = exactMatch[3] ? Number.parseInt(exactMatch[3], 10) : extractExplicitYear(text);
    const trustedYearSource = explicitYear
      ? "TITLE_OR_RULES"
      : isTrustworthyTimingDate(market.publishedAt) ? "PUBLISHED_AT"
      : isTrustworthyTimingDate(market.expiresAt) ? "EXPIRES_AT"
      : isTrustworthyTimingDate(market.resolvesAt) ? "RESOLVES_AT"
      : null;
    const inferredYear = explicitYear
      ?? (isTrustworthyTimingDate(market.publishedAt) ? market.publishedAt.getUTCFullYear() : null)
      ?? (isTrustworthyTimingDate(market.expiresAt) ? market.expiresAt.getUTCFullYear() : null)
      ?? (isTrustworthyTimingDate(market.resolvesAt) ? market.resolvesAt.getUTCFullYear() : null)
      ?? null;

    if (inferredYear === null || !Number.isFinite(inferredYear) || inferredYear <= 1971) {
      return {
        dateKey: null,
        scheduledBoundaryKey: null,
        rawDateText: exactMatch[0] ?? null,
        parsedTimestamp: null,
        status: unsafeDefaultReasons.length > 0 ? "DATE_AMBIGUOUS" : "DATE_MISSING",
        dateSourceProvenance: "TITLE_OR_RULES_ET",
        timestampSource: null,
        yearSource: trustedYearSource,
        unsafeDefaultReasons
      };
    }

    const day = Number.parseInt(exactMatch[2], 10);
    const dateKey = new Date(Date.UTC(inferredYear, monthIndex, day, 0, 0, 0, 0)).toISOString().slice(0, 10);
    const hourText = exactMatch[4] ?? exactMatch[7];
    const minuteText = exactMatch[5] ?? exactMatch[8];
    const meridiem = (exactMatch[6] ?? exactMatch[9] ?? "").toLowerCase();
    if (hourText && minuteText) {
      let hour = Number.parseInt(hourText, 10) % 12;
      if (meridiem === "pm") {
        hour += 12;
      }
      const scheduledBoundaryKey = resolveEasternUtcBoundary(inferredYear, monthIndex, day, hour, Number.parseInt(minuteText, 10));
      return {
        dateKey,
        scheduledBoundaryKey,
        rawDateText: exactMatch[0] ?? null,
        parsedTimestamp: scheduledBoundaryKey,
        status: trustedYearSource === "TITLE_OR_RULES" ? "DATE_CONFIRMED" : "DATE_INFERRED",
        dateSourceProvenance: "TITLE_OR_RULES_ET",
        timestampSource: scheduledBoundaryKey ? "TITLE_OR_RULES_ET" : null,
        yearSource: trustedYearSource,
        unsafeDefaultReasons
      };
    }

    return {
      dateKey,
      scheduledBoundaryKey: null,
      rawDateText: exactMatch[0] ?? null,
      parsedTimestamp: null,
      status: trustedYearSource === "TITLE_OR_RULES" ? "DATE_CONFIRMED" : "DATE_INFERRED",
      dateSourceProvenance: "TITLE_OR_RULES_ET",
      timestampSource: null,
      yearSource: trustedYearSource,
      unsafeDefaultReasons
    };
  }

  return extractBoundaryFromTimingFallback(market);
};

export const extractLegacySportsBoundaryForAudit = (market: MatchingMarketRecord): SportsBoundaryExtraction => {
  const text = buildSportsText(market);
  const exactMatch = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:\s+at\s+(\d{1,2}):(\d{2})(am|pm)\s*et|\s+(\d{1,2}):(\d{2})(am|pm)\s*et)?/i);
  if (exactMatch?.[1] && exactMatch[2]) {
    const monthIndex = MONTH_INDEX.get(exactMatch[1].toLowerCase().replace(/\./g, ""));
    if (monthIndex !== undefined) {
      const reference = market.resolvesAt ?? market.expiresAt ?? market.publishedAt ?? new Date("2026-01-01T00:00:00.000Z");
      const year = reference.getUTCFullYear();
      const day = Number.parseInt(exactMatch[2], 10);
      const hourText = exactMatch[3] ?? exactMatch[6];
      const minuteText = exactMatch[4] ?? exactMatch[7];
      const meridiem = (exactMatch[5] ?? exactMatch[8] ?? "").toLowerCase();
      const dateKey = new Date(Date.UTC(year, monthIndex, day, 0, 0, 0, 0)).toISOString().slice(0, 10);
      if (hourText && minuteText) {
        let hour = Number.parseInt(hourText, 10) % 12;
        if (meridiem === "pm") {
          hour += 12;
        }
        return {
          dateKey,
          scheduledBoundaryKey: new Date(Date.UTC(year, monthIndex, day, hour + 5, Number.parseInt(minuteText, 10), 0, 0)).toISOString(),
          rawDateText: exactMatch[0] ?? null,
          parsedTimestamp: null,
          status: "DATE_CONFIRMED",
          dateSourceProvenance: "TITLE_OR_RULES_ET",
          timestampSource: "TITLE_OR_RULES_ET",
          yearSource: "RESOLVES_AT",
          unsafeDefaultReasons: isEpochSentinelDate(market.resolvesAt)
            ? ["RESOLVES_AT_EPOCH_SENTINEL", "LEGACY_YEAR_INFERENCE"]
            : ["LEGACY_YEAR_INFERENCE"]
        };
      }
      return {
        dateKey,
        scheduledBoundaryKey: null,
        rawDateText: exactMatch[0] ?? null,
        parsedTimestamp: null,
        status: "DATE_CONFIRMED",
        dateSourceProvenance: "TITLE_OR_RULES_ET",
        timestampSource: null,
        yearSource: "RESOLVES_AT",
        unsafeDefaultReasons: isEpochSentinelDate(market.resolvesAt)
          ? ["RESOLVES_AT_EPOCH_SENTINEL", "LEGACY_YEAR_INFERENCE"]
          : ["LEGACY_YEAR_INFERENCE"]
      };
    }
  }

  const fallback = market.resolvesAt ?? market.expiresAt;
  return {
    dateKey: fallback ? fallback.toISOString().slice(0, 10) : null,
    scheduledBoundaryKey: null,
    rawDateText: null,
    parsedTimestamp: fallback?.toISOString() ?? null,
    status: fallback ? "DATE_INFERRED" : "DATE_MISSING",
    dateSourceProvenance: fallback ? "TIMING_SEMANTICS" : null,
    timestampSource: market.resolvesAt ? "RESOLVES_AT" : market.expiresAt ? "EXPIRES_AT" : null,
    yearSource: market.resolvesAt ? "RESOLVES_AT" : market.expiresAt ? "EXPIRES_AT" : null,
    unsafeDefaultReasons: isEpochSentinelDate(market.resolvesAt)
      ? ["RESOLVES_AT_EPOCH_SENTINEL", "LEGACY_FALLBACK"]
      : ["LEGACY_FALLBACK"]
  };
};

export const extractSportsBoundary = (market: MatchingMarketRecord): {
  dateKey: string | null;
  scheduledBoundaryKey: string | null;
} => {
  const boundary = extractSportsBoundaryDetailed(market);
  return {
    dateKey: boundary.dateKey,
    scheduledBoundaryKey: boundary.scheduledBoundaryKey
  };
};

export const detectCompetitionKey = (market: MatchingMarketRecord, domain: SportsScopedDomain): {
  sportOrEsport: string | null;
  competitionKey: string | null;
  competitionLabel: string | null;
  stageOrRound: string | null;
} => {
  const text = `${buildSportsText(market)} ${JSON.stringify(market.propositionSemantics)}`;
  for (const entry of COMPETITION_PATTERNS) {
    if (entry.pattern.test(text)) {
      return {
        sportOrEsport: domain === "SPORTS" ? entry.sportOrEsport : entry.sportOrEsport,
        competitionKey: entry.key,
        competitionLabel: entry.label,
        stageOrRound:
          /\bfinals\b/i.test(text) ? "finals"
          : /\bplayoffs?\b/i.test(text) ? "playoffs"
          : /\bspring\b/i.test(text) ? "spring"
          : /\bsummer\b/i.test(text) ? "summer"
          : /\bwinter\b/i.test(text) ? "winter"
          : null
      };
    }
  }
  return {
    sportOrEsport: null,
    competitionKey: null,
    competitionLabel: null,
    stageOrRound: null
  };
};

export const buildSortedMatchupKey = (left: string | null, right: string | null): string | null => {
  if (!left || !right) {
    return null;
  }
  return [left, right].sort((a, b) => a.localeCompare(b)).join("|");
};
