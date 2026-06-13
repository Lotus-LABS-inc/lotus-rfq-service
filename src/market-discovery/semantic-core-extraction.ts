import { normalizeFreeText } from "../canonical/canonicalization-types.js";

export interface MarketSemanticHints {
  marketFamily: string | null;
  subject: string | null;
  condition: string | null;
  topicTitle: string;
  topicKey: string;
  contractLabel: string | null;
  contractKey: string | null;
  sideLabels: readonly string[];
  reasonCodes: readonly string[];
}

export interface MarketSemanticInput {
  title: string;
  eventTitle: string;
  rulesText?: string | null | undefined;
  venueMarketId?: string | null | undefined;
  category?: string | null | undefined;
  outcomes?: readonly string[] | null | undefined;
}

const cryptoSubjects: Array<[RegExp, string]> = [
  [/\b(btc|bitcoin)\b/, "BTC"],
  [/\b(eth|ethereum)\b/, "ETH"],
  [/\b(sol|solana)\b/, "SOL"],
  [/\b(xrp)\b/, "XRP"],
  [/\b(bnb)\b/, "BNB"],
  [/\b(doge|dogecoin)\b/, "DOGE"],
  [/\b(opensea)\b/, "OPENSEA"],
  [/\b(metamask)\b/, "METAMASK"],
  [/\breya\b/, "REYA"],
  [/\bbase\b/, "BASE"]
];

const entitySubjects: Array<[RegExp, string]> = [
  [/\bdonald trump\b|\btrump\b/, "DONALD_TRUMP"],
  [/\bbenjamin netanyahu\b|\bnetanyahu\b/, "BENJAMIN_NETANYAHU"],
  [/\bgreenland\b/, "GREENLAND"],
  [/\bjon ossoff\b|\bossoff\b/, "JON_OSSOFF"],
  [/\bgavin newsom\b|\bnewsom\b/, "GAVIN_NEWSOM"],
  [/\bjd gaming\b|\bjdg\b/, "JD_GAMING"],
  [/\bbilibili gaming\b|\bbilibili\b|\bblg\b/, "BILIBILI_GAMING"],
  [/\bt1\b/, "T1"],
  [/\bgen g esports\b|\bgeng\b|\bgen g\b/, "GEN_G_ESPORTS"],
  [/\bdplus\b/, "DPLUS"],
  [/\bfreecs\b/, "FREECS"],
  [/\bkt rolster\b/, "KT_ROLSTER"]
];

const normalizeSubjectText = (value: string): string =>
  value
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toUpperCase();

const normalizeKeyText = (value: string): string =>
  normalizeFreeText(value)
    .replace(/\b\$\s*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s/g, "_")
    .toUpperCase();

const normalizeNumericValue = (raw: string, suffix: string | undefined): string => {
  const value = Number.parseFloat(raw.replace(/,/g, ""));
  if (!Number.isFinite(value)) return normalizeSubjectText(`${raw}${suffix ?? ""}`);
  const multiplier = suffix?.toLowerCase() === "k"
    ? 1_000
    : suffix?.toLowerCase() === "m"
      ? 1_000_000
      : suffix?.toLowerCase() === "b"
        ? 1_000_000_000
        : suffix?.toLowerCase() === "t"
          ? 1_000_000_000_000
          : 1;
  return String(Math.round(value * multiplier));
};

const monthByName = new Map([
  ["january", "01"],
  ["jan", "01"],
  ["february", "02"],
  ["feb", "02"],
  ["march", "03"],
  ["mar", "03"],
  ["april", "04"],
  ["apr", "04"],
  ["may", "05"],
  ["june", "06"],
  ["jun", "06"],
  ["july", "07"],
  ["jul", "07"],
  ["august", "08"],
  ["aug", "08"],
  ["september", "09"],
  ["sep", "09"],
  ["sept", "09"],
  ["october", "10"],
  ["oct", "10"],
  ["november", "11"],
  ["nov", "11"],
  ["december", "12"],
  ["dec", "12"]
]);

const normalizeDateContract = (label: string): string | null => {
  const iso = label.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/);
  if (iso?.[1] && iso[2] && iso[3]) {
    const month = iso[2].padStart(2, "0");
    const day = iso[3].padStart(2, "0");
    return `DATE_${iso[1]}_${month}_${day}`;
  }

  const written = label.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+([0-9]{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})\b/i);
  if (written?.[1] && written[2] && written[3]) {
    const month = monthByName.get(written[1].toLowerCase().replace(".", ""));
    const day = written[2].padStart(2, "0");
    return month ? `DATE_${written[3]}_${month}_${day}` : null;
  }

  const monthYear = label.match(/\b(?:end\s+of\s+|by\s+|in\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(20\d{2})\b/i);
  if (monthYear?.[1] && monthYear[2]) {
    const month = monthByName.get(monthYear[1].toLowerCase().replace(".", ""));
    return month ? `MONTH_${monthYear[2]}_${month}` : null;
  }

  return null;
};

const displayDateContract = (label: string): string | null => {
  const iso = label.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/);
  if (iso?.[0]) return iso[0];
  const written = label.match(/\b(?:end\s+of\s+|by\s+|in\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(?:[0-9]{1,2}(?:st|nd|rd|th)?[,]?\s+)?20\d{2}\b/i);
  return written?.[0]?.trim() ?? null;
};

const normalizeThresholdContract = (label: string): string | null => {
  const match = label.match(/[↑↓]?\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k|m|b|t|%)?/i);
  if (!match?.[1]) return null;
  const prefix = label.includes("↓") ? "DOWN" : label.includes("↑") ? "UP" : "ABOVE";
  const normalized = normalizeNumericValue(match[1], match[2]);
  return `${prefix}_${normalized}${match[2] === "%" || label.includes("%") ? "_PCT" : ""}`;
};

const displayThresholdContract = (label: string): string | null => {
  const match = label.match(/[↑↓]?\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k|m|b|t|%)?/i);
  if (!match?.[1]) return null;
  const arrow = label.includes("↓") ? "↓ " : label.includes("↑") ? "↑ " : "";
  const dollar = label.includes("$") ? "$" : "";
  return `${arrow}${dollar}${match[1]}${match[2] ?? ""}`.trim();
};

const normalizeFedDecisionContract = (label: string): string | null => {
  const text = normalizeFreeText(label);
  if (/\b(no change|hold|unchanged)\b/.test(text)) return "NO_CHANGE";
  const bps = text.match(/\b(25|50|75|100)\+?\s*(?:bps|basis points?)\s+(decrease|cut|increase|hike)\b/);
  if (bps?.[1] && bps[2]) {
    const direction = /increase|hike/.test(bps[2]) ? "INCREASE" : "DECREASE";
    const plus = /\+/.test(bps[0]) ? "_PLUS" : "";
    return `BPS_${direction}_${bps[1]}${plus}`;
  }
  const directional = text.match(/\b(50\+|25|50|75|100)\s*(?:bps|basis points?)?\s*(?:or\s+more\s+)?(decrease|cut|increase|hike)\b/);
  if (directional?.[1] && directional[2]) {
    const amount = directional[1].replace("+", "");
    const direction = /increase|hike/.test(directional[2]) ? "INCREASE" : "DECREASE";
    const plus = directional[1].includes("+") || /\bor more\b/.test(directional[0]) ? "_PLUS" : "";
    return `BPS_${direction}_${amount}${plus}`;
  }
  return null;
};

const normalizeFedCutCountContract = (label: string): string | null => {
  const text = normalizeFreeText(label);
  const count = text.match(/\b([0-9]+)\+?\s*(?:fed\s+)?(?:rate\s+)?cuts?\b|\b([0-9]+)\+?\b/);
  const raw = count?.[1] ?? count?.[2];
  if (!raw) return null;
  const plus = /\+/.test(label) || /\bor more\b/i.test(label) ? "_PLUS" : "";
  return `CUTS_${raw}${plus}`;
};

const normalizePartyControlContract = (label: string): string | null => {
  const text = normalizeFreeText(label)
    .replace(/\bdemocrats?\b/g, "d")
    .replace(/\brepublicans?\b/g, "r")
    .replace(/\bsweep\b/g, "sweep")
    .replace(/\s*,\s*/g, " ");
  if (/\bd\s+sweep\b/.test(text)) return "DEMOCRATS_SWEEP";
  if (/\br\s+sweep\b/.test(text)) return "REPUBLICANS_SWEEP";
  const senate = text.match(/\b([dr])\s+senate\b/);
  const house = text.match(/\b([dr])\s+house\b/);
  if (senate?.[1] && house?.[1]) return `${senate[1].toUpperCase()}_SENATE_${house[1].toUpperCase()}_HOUSE`;
  return null;
};

const firstMatch = (text: string, patterns: Array<[RegExp, string]>): string | null => {
  for (const [pattern, value] of patterns) {
    if (pattern.test(text)) return value;
  }
  return null;
};

const extractFixtureSubject = (text: string): string | null => {
  const match = text.match(/\b([a-z0-9][a-z0-9 .'-]{1,60}?)\s+(?:vs|v)\s+([a-z0-9][a-z0-9 .'-]{1,60}?)(?:$|\s+(?:on|in|by|at|to win|winner|wins|match|game))/i);
  if (!match?.[1] || !match[2]) return null;
  return normalizeSubjectText(`${match[1]}_${match[2]}`);
};

const extractWorldCupGroupSubject = (text: string): string | null => {
  const groupMatch = text.match(/\bworld cup\b.*\bgroup\s+([a-l])\b|\bgroup\s+([a-l])\b.*\bworld cup\b/i);
  const group = groupMatch?.[1] ?? groupMatch?.[2];
  if (!group) return null;
  const countryMatch = text.match(/\bwill\s+([a-z][a-z .'-]{2,40}?)\s+finish\s+(?:first|second|third|fourth)\b/i);
  return countryMatch?.[1]
    ? `WORLD_CUP_GROUP_${group.toUpperCase()}_${normalizeSubjectText(countryMatch[1])}`
    : `WORLD_CUP_GROUP_${group.toUpperCase()}`;
};

const extractSeasonWinnerSubject = (text: string): string | null => {
  const match = text.match(/\b(epl|nba|nfl|nhl|mlb|lck|lpl|uefa champions league|fifa world cup|la liga|f1 constructors championship)\s+(?:20\d{2}\s+)?(?:20\d{2}\s+)?(?:winner|champion)\b/i);
  if (!match?.[1]) return null;
  return normalizeSubjectText(match[1]);
};

const extractTokenLaunchSubject = (eventText: string, fullText: string): string | null => {
  const launch = eventText.match(/\bwill\s+([a-z0-9][a-z0-9 .,'()&-]{1,80}?)\s+launch\s+a\s+token\b/i)
    ?? fullText.match(/\bwill\s+([a-z0-9][a-z0-9 .,'()&-]{1,80}?)\s+launch\s+a\s+token\b/i)
    ?? eventText.match(/\b([a-z0-9][a-z0-9 .,'()&-]{1,80}?)\s+token\s+launch\b/i)
    ?? fullText.match(/\b([a-z0-9][a-z0-9 .,'()&-]{1,80}?)\s+token\s+launch\b/i);
  return launch?.[1] ? normalizeSubjectText(launch[1]) : null;
};

const extractElectionSubject = (text: string): string | null => {
  const year = text.match(/\b(20\d{2})\b/)?.[1];
  if (/\bbalance of power\b|\bparty_control\b|\bcongress\b/.test(text)) return `US_CONGRESS_${year ?? "UNKNOWN"}`;
  if (/\bsenate\b/.test(text)) return `US_SENATE_${year ?? "UNKNOWN"}`;
  if (/\bhouse\b/.test(text)) return `US_HOUSE_${year ?? "UNKNOWN"}`;
  const presidentCountry = text.match(/\b([a-z][a-z ]{2,40})\s+presidential\b|\bpresidential\b.*\b([a-z][a-z ]{2,40})\b/i);
  const country = presidentCountry?.[1] ?? presidentCountry?.[2];
  if (country) return `${normalizeSubjectText(country)}_PRESIDENT_${year ?? "UNKNOWN"}`;
  if (/\bpresident\b|\bpresidential\b/.test(text)) return `PRESIDENT_${year ?? "UNKNOWN"}`;
  return null;
};

const extractWorldCupStatSubject = (text: string): string | null => {
  if (!/\bworld cup\b/.test(text)) return null;
  const year = text.match(/\b(20\d{2})\b/)?.[1] ?? "2026";
  return `WORLD_CUP_${year}`;
};

const extractAiModelContract = (label: string): string | null => {
  const text = label.trim();
  const will = text.match(/\bwill\s+([a-z0-9][a-z0-9 .,'()&-]{1,80}?)\s+have\s+(?:the\s+)?best\s+ai\s+model\b/i);
  if (will?.[1]) return will[1].trim();
  if (!/\b(which company|best ai model)\b/i.test(text) && text.length > 0) return text;
  return null;
};

const extractWorldCupStatContract = (label: string): string | null => {
  const will = label.match(/\bwill\s+([a-z0-9][a-z0-9 .,'()&-]{1,80}?)\s+(?:have\s+)?(?:be\s+)?(?:the\s+)?(?:top scorer|most assists|most clean sheets|most goal contributions)\b/i);
  if (will?.[1]) return will[1].trim();
  if (!/\bworld cup\b/i.test(label) && label.trim().length > 0) return label.trim();
  return null;
};

const extractDynamicSubject = (eventText: string, fullText: string): string | null => {
  const tokenLaunch = extractTokenLaunchSubject(eventText, fullText);
  if (tokenLaunch) return tokenLaunch;

  const fdv = eventText.match(/\b([a-z0-9][a-z0-9 .'-]{1,60}?)\s+fdv\s+above\b/i)
    ?? fullText.match(/\b([a-z0-9][a-z0-9 .'-]{1,60}?)\s+fdv\s+above\b/i);
  if (fdv?.[1]) return normalizeSubjectText(fdv[1]);

  const ipoMarketCap = eventText.match(/\b([a-z0-9][a-z0-9 .'-]{1,60}?)\s+ipo\s+(?:closing\s+)?market\s+cap\b/i)
    ?? fullText.match(/\b([a-z0-9][a-z0-9 .'-]{1,60}?)\s+ipo\s+(?:closing\s+)?market\s+cap\b/i);
  if (ipoMarketCap?.[1]) return normalizeSubjectText(ipoMarketCap[1]);

  const monthlyHit = eventText.match(/\bwhat\s+will\s+([a-z0-9][a-z0-9 .,'()&-]{1,80}?)\s+hit\s+in\s+/i)
    ?? fullText.match(/\bwhat\s+will\s+([a-z0-9][a-z0-9 .,'()&-]{1,80}?)\s+hit\s+in\s+/i);
  if (monthlyHit?.[1]) return normalizeSubjectText(monthlyHit[1]);

  if (/\bfed\s+rate\b/.test(eventText) || /\bfed\s+rate\b/.test(fullText)) return "FED_RATE";
  if (/\bfed decision\b|\bfomc\b/.test(eventText) || /\bfed decision\b|\bfomc\b/.test(fullText)) return "FED_RATE";
  if (/\bbest ai model\b|\bai model\b/.test(eventText) || /\bbest ai model\b|\bai model\b/.test(fullText)) return "AI_MODEL_LEADERBOARD";
  if (/\bipos?\s+before\b/.test(eventText) || /\bipos?\s+before\b/.test(fullText)) return "IPO_LISTING";
  return null;
};

const inferTopicTitle = (input: MarketSemanticInput): string =>
  input.eventTitle.trim().length > 0 ? input.eventTitle.trim() : input.title.trim();

const inferContractLabel = (input: MarketSemanticInput, marketFamily: string | null): string | null => {
  const title = input.title.trim();
  const eventTitle = input.eventTitle.trim();
  if (marketFamily === "FDV_AFTER_LAUNCH" || marketFamily === "IPO_MARKET_CAP_THRESHOLD" || marketFamily === "FIRST_TO_HIT") {
    return displayThresholdContract(title) ?? displayThresholdContract(eventTitle);
  }
  if (marketFamily === "TOKEN_LAUNCH_BY_DATE" || marketFamily === "FED_RATE_CUT_BY_DATE" || marketFamily === "FED_RATE_HIKE_BY_DATE") {
    return displayDateContract(title) ?? displayDateContract(eventTitle);
  }
  if (marketFamily === "FED_DECISION" || marketFamily === "FED_RATE_CUT_COUNT") {
    return eventTitle !== title && title.length > 0 ? title : null;
  }
  if (marketFamily === "PARTY_CONTROL_BALANCE_OF_POWER") {
    if (eventTitle !== title && title.length > 0) return title;
    const venueTail = input.venueMarketId?.split(/[|:]/).pop();
    return venueTail && venueTail.length > 0 ? venueTail.replace(/_/g, " ") : null;
  }
  if (marketFamily === "AI_MODEL_RANKING") {
    return extractAiModelContract(title) ?? (eventTitle !== title && title.length > 0 ? title : null);
  }
  if (marketFamily?.startsWith("WORLD_CUP_") && !marketFamily.includes("GROUP")) {
    return extractWorldCupStatContract(title) ?? (eventTitle !== title && title.length > 0 ? title : null);
  }
  if (marketFamily === "ELECTION_WINNER") {
    if (eventTitle !== title && title.length > 0) return title.replace(/^will\s+/i, "").replace(/\s+win.*$/i, "").trim();
    return null;
  }
  if (marketFamily === "SEASON_WINNER") {
    const colon = title.match(/:\s*([^:]+)$/);
    if (colon?.[1]) return colon[1].trim();
    if (eventTitle !== title && title.length > 0) return title;
  }
  if (marketFamily === "IPO_BY_DATE") {
    const titleCompany = title.match(/^([a-z0-9][a-z0-9 .,'()&-]{1,80}?)(?:\s+ipo|\s*$)/i);
    if (titleCompany?.[1] && !/^ipos? before/i.test(titleCompany[1])) return titleCompany[1].trim();
    return eventTitle !== title && title.length > 0 ? title : null;
  }
  if (marketFamily === "FIXTURE_RESULT") {
    const nonSideOutcomes = (input.outcomes ?? []).filter((outcome) => !/^(yes|no)$/i.test(outcome.trim()));
    return nonSideOutcomes.length > 0 ? nonSideOutcomes.join(" / ") : null;
  }
  return null;
};

const inferContractKey = (label: string | null, marketFamily: string | null): string | null => {
  if (!label) return null;
  if (marketFamily === "FDV_AFTER_LAUNCH" || marketFamily === "IPO_MARKET_CAP_THRESHOLD" || marketFamily === "FIRST_TO_HIT") {
    return normalizeThresholdContract(label);
  }
  if (marketFamily === "TOKEN_LAUNCH_BY_DATE" || marketFamily === "FED_RATE_CUT_BY_DATE" || marketFamily === "FED_RATE_HIKE_BY_DATE") {
    return normalizeDateContract(label);
  }
  if (marketFamily === "FED_DECISION") {
    return normalizeFedDecisionContract(label);
  }
  if (marketFamily === "FED_RATE_CUT_COUNT") {
    return normalizeFedCutCountContract(label);
  }
  if (marketFamily === "PARTY_CONTROL_BALANCE_OF_POWER") {
    return normalizePartyControlContract(label) ?? normalizeKeyText(label);
  }
  return normalizeKeyText(label);
};

const inferSideLabels = (outcomes: readonly string[] | null | undefined): readonly string[] =>
  [...new Set((outcomes ?? [])
    .map((outcome) => normalizeFreeText(outcome))
    .filter((outcome) => /^(yes|no|up|down|above|below)$/.test(outcome))
  )].sort((left, right) => left.localeCompare(right));

export const extractMarketSemanticHints = (input: MarketSemanticInput): MarketSemanticHints => {
  const titleParts = [...new Set([
    input.eventTitle,
    input.title
  ].filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map(normalizeFreeText))];
  const titleText = titleParts.join(" ");
  const text = normalizeFreeText([
    input.eventTitle,
    input.title,
    input.rulesText,
    input.venueMarketId,
    input.category
  ].filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).join(" "));
  const reasonCodes: string[] = [];
  const topicTitle = inferTopicTitle(input);

  let marketFamily: string | null = null;
  let condition: string | null = null;
  if (/\bworld cup\b.*\bhighest scoring team\b.*\bgroup\b/.test(text)) {
    marketFamily = "WORLD_CUP_GROUP_TOP_SCORER";
    condition = "HIGHEST_SCORING_TEAM";
  } else if (/\bworld cup\b.*\bfinish\s+(?:first|second|third|fourth)\b.*\bgroup\b/.test(text)) {
    marketFamily = "WORLD_CUP_GROUP_POSITION";
    condition = text.includes("finish second") ? "FINISH_SECOND" : "GROUP_POSITION";
  } else if (/\bworld cup\b.*\btop scorer\b/.test(text)) {
    marketFamily = "WORLD_CUP_TOP_SCORER";
    condition = "TOP_SCORER";
  } else if (/\bworld cup\b.*\bmost assists\b/.test(text)) {
    marketFamily = "WORLD_CUP_MOST_ASSISTS";
    condition = "MOST_ASSISTS";
  } else if (/\bworld cup\b.*\bmost clean sheets\b/.test(text)) {
    marketFamily = "WORLD_CUP_MOST_CLEAN_SHEETS";
    condition = "MOST_CLEAN_SHEETS";
  } else if (/\bworld cup\b.*\bmost goal contributions\b/.test(text)) {
    marketFamily = "WORLD_CUP_GOAL_CONTRIBUTIONS";
    condition = "MOST_GOAL_CONTRIBUTIONS";
  } else if (/\bfed decision\b|\bfomc\b/.test(text)) {
    marketFamily = "FED_DECISION";
    condition = "FED_DECISION";
  } else if (/\bhow many\b.*\bfed\s+rate\s+cuts\b|\bfed\s+rate\s+cut\s+count\b/.test(text)) {
    marketFamily = "FED_RATE_CUT_COUNT";
    condition = "FED_RATE_CUT_COUNT";
  } else if (/\bfed\s+rate\s+cut\s+by\b/.test(text)) {
    marketFamily = "FED_RATE_CUT_BY_DATE";
    condition = "FED_RATE_CUT_BY_DATE";
  } else if (/\bfed\s+rate\s+hike\s+(?:in|by)\b/.test(text)) {
    marketFamily = "FED_RATE_HIKE_BY_DATE";
    condition = "FED_RATE_HIKE_BY_DATE";
  } else if (/\bbalance of power\b|\bparty_control\b/.test(text)) {
    marketFamily = "PARTY_CONTROL_BALANCE_OF_POWER";
    condition = "PARTY_CONTROL";
  } else if (/\bbest ai model\b|\bwhich company has best ai model\b/.test(text)) {
    marketFamily = "AI_MODEL_RANKING";
    condition = "AI_MODEL_RANKING";
  } else if (/\bwill\b.*\blaunch\s+a\s+token\s+by\b|\btoken\s+launch\s+by\b/.test(text)) {
    marketFamily = "TOKEN_LAUNCH_BY_DATE";
    condition = "TOKEN_LAUNCH_BY_DATE";
  } else if (/\b(all time high|ath|high by date)\b/.test(text)) {
    marketFamily = "ATH_BY_DATE";
    condition = "REACH_HIGH_BY_DATE";
  } else if (/\bipo\b.*\bmarket\s+cap\b|\bmarket\s+cap\b.*\bipo\b/.test(text)) {
    marketFamily = "IPO_MARKET_CAP_THRESHOLD";
    condition = "MARKET_CAP_THRESHOLD";
  } else if (/\bipos?\s+before\b|\bipo\s+before\b/.test(text)) {
    marketFamily = "IPO_BY_DATE";
    condition = "IPO_BY_DATE";
  } else if (/\b(fdv|fully diluted valuation|token launch|one day after launch)\b/.test(text)) {
    marketFamily = "FDV_AFTER_LAUNCH";
    condition = "FDV_AFTER_LAUNCH";
  } else if (/\b(first to hit|price will|will .* hit|will .* reach|reaches?|hits?)\b/.test(text)) {
    marketFamily = "FIRST_TO_HIT";
    condition = "PRICE_THRESHOLD";
  } else if (/\b(out by|leave office|resign|removed|ousted)\b/.test(text)) {
    marketFamily = "OFFICE_EXIT";
    condition = "LEAVE_OFFICE";
  } else if (/\b(acquire|buy greenland|greenland)\b/.test(text)) {
    marketFamily = "ACQUIRE_GEO_ASSET";
    condition = "ACQUIRE";
  } else if (/\bvisit china|visit\b/.test(text)) {
    marketFamily = "STATE_VISIT";
    condition = "VISIT";
  } else if (/\b(president|nominee|election|senate|house|governor|mayor)\b/.test(text)) {
    if (/\b(winner|win|wins|nominee)\b/.test(text)) {
      marketFamily = "ELECTION_WINNER";
      condition = "ELECTION_WINNER";
    } else {
    marketFamily = "ELECTION";
    condition = "ELECTION_OUTCOME";
    }
  } else if (/\bvs\b|\b v \b/.test(text)) {
    marketFamily = "FIXTURE_RESULT";
    condition = "MATCH_RESULT";
  } else if (/\b(champion|championship|winner|win the|wins?)\b/.test(text)) {
    marketFamily = "SEASON_WINNER";
    condition = "WINNER";
  }

  let subject = extractWorldCupGroupSubject(text)
    ?? extractWorldCupStatSubject(text)
    ?? extractFixtureSubject(titleText)
    ?? extractElectionSubject(text)
    ?? extractDynamicSubject(normalizeFreeText(topicTitle), text)
    ?? firstMatch(text, cryptoSubjects)
    ?? firstMatch(text, entitySubjects)
    ?? extractSeasonWinnerSubject(text);

  const thresholdMatch = text.match(/\b(?:hit|hits|reach|reaches|above|over)\s+\$?([0-9]+(?:\.[0-9]+)?)(k|m|b|t)?\b/);
  const subjectCanIncludeThreshold = marketFamily !== "FDV_AFTER_LAUNCH"
    && marketFamily !== "IPO_MARKET_CAP_THRESHOLD"
    && marketFamily !== "TOKEN_LAUNCH_BY_DATE"
    && marketFamily !== "FED_DECISION"
    && marketFamily !== "FED_RATE_CUT_BY_DATE"
    && marketFamily !== "FED_RATE_HIKE_BY_DATE"
    && marketFamily !== "FED_RATE_CUT_COUNT"
    && marketFamily !== "PARTY_CONTROL_BALANCE_OF_POWER"
    && marketFamily !== "AI_MODEL_RANKING"
    && marketFamily !== "ELECTION_WINNER"
    && !(marketFamily?.startsWith("WORLD_CUP_") ?? false);
  if (subject && thresholdMatch?.[1] && subjectCanIncludeThreshold) {
    subject = `${subject}_${thresholdMatch[1]}${thresholdMatch[2] ?? ""}`.toUpperCase();
    reasonCodes.push("SUBJECT_INCLUDES_THRESHOLD");
  }
  const contractLabel = inferContractLabel(input, marketFamily);
  const contractKey = inferContractKey(contractLabel, marketFamily);
  const sideLabels = inferSideLabels(input.outcomes);

  if (marketFamily) reasonCodes.push(`MARKET_FAMILY_${marketFamily}`);
  if (subject) reasonCodes.push(`SUBJECT_${subject}`);
  if (condition) reasonCodes.push(`CONDITION_${condition}`);
  if (contractKey) reasonCodes.push(`CONTRACT_${contractKey}`);

  return {
    marketFamily,
    subject,
    condition,
    topicTitle,
    topicKey: normalizeKeyText(topicTitle),
    contractLabel,
    contractKey,
    sideLabels,
    reasonCodes
  };
};
