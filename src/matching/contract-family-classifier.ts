import { buildStableTextId, normalizeFreeText } from "../canonical/canonicalization-types.js";
import { parseStructuredProposition, type PropositionMatchCategory } from "../simulation/proposition-matching.js";
import type { ContractFamilyClassification, MatchingMarketRecord, ContractFamily } from "./matching-types.js";

const CLASSIFIER_VERSION = "contract-family-classifier-v1";
const DATE_PATTERN = /^\w+\s+\d{1,2}\s+20\d{2}$/;
const WEATHER_PATTERN = /\b(weather|rain|snow|temperature|storm|hurricane|wind)\b/i;
const CULTURE_PATTERN = /\b(oscar|grammy|movie|album|box office|celebrity|show|festival)\b/i;
const RANGE_PATTERN = /\bbetween\b|\brange\b/i;
const BUCKET_PATTERN = /\b(bucket|band|range)\b/i;
const SERIES_PATTERN = /\bseries\b/i;
const FINALS_PATTERN = /\bfinals\b/i;
const TOURNAMENT_PATTERN = /\b(tournament|cup|playoffs|major|masters|worlds|championship)\b/i;
const LEAGUE_PATTERN = /\b(league|lck|lcs|lec|lpl)\b/i;
const SPLIT_PATTERN = /\b(split|spring|summer|winter)\b/i;
const MATCHUP_PATTERN = /\b(vs\.?|versus|match)\b/i;
const ELECTION_PATTERN = /\b(election|president|governor|nomination|senate|mayor)\b/i;

const toSemanticCategory = (market: MatchingMarketRecord): PropositionMatchCategory =>
  market.category === "POLITICS" ? "POLITICS"
  : market.category === "CRYPTO" ? "CRYPTO"
  : market.category === "SPORTS" ? "SPORTS"
  : market.category === "ESPORTS" ? "ESPORTS"
  : market.category === "POP_CULTURE" ? "CULTURE"
  : market.category === "OTHER" ? "OTHER"
  : "OTHER";

const parseBoundaryReference = (market: MatchingMarketRecord): Date | null =>
  market.resolvesAt ?? market.expiresAt ?? market.publishedAt;

const classifyCryptoFamily = (title: string, parsedThreshold: string | null, action: string | null): ContractFamily =>
  parsedThreshold === "all time high" || action === "reach all time high" ? "ATH_BY_DATE"
  : parsedThreshold !== null && action !== null && title.includes("close") ? "PRICE_AT_CLOSE"
  : parsedThreshold !== null && action !== null && action.includes("threshold") ? "THRESHOLD_BY_DATE"
  : action === "up or down" && DATE_PATTERN.test(parsedThreshold ?? "") ? "SAME_DAY_DIRECTIONAL"
  : action === "up or down" && BUCKET_PATTERN.test(title) ? "UP_DOWN_BUCKET"
  : RANGE_PATTERN.test(title) || BUCKET_PATTERN.test(title) ? "PRICE_RANGE_BUCKET"
  : action === "up or down" ? "GENERIC_DIRECTIONAL"
  : "GENERIC_DIRECTIONAL";

const classifySportsLikeFamily = (title: string, rules: string, isEsports: boolean): ContractFamily =>
  MATCHUP_PATTERN.test(title) ? "MATCHUP_WINNER"
  : SERIES_PATTERN.test(title) ? "SERIES_WINNER"
  : FINALS_PATTERN.test(title) ? "FINALS_WINNER"
  : SPLIT_PATTERN.test(title) && isEsports ? "SPLIT_WINNER"
  : LEAGUE_PATTERN.test(title) && isEsports ? "LEAGUE_WINNER"
  : TOURNAMENT_PATTERN.test(title) ? "TOURNAMENT_WINNER"
  : /season/i.test(rules) ? "SEASON_WINNER"
  : /championship/i.test(title) ? "CHAMPIONSHIP_WINNER"
  : "MATCHUP_WINNER";

const classifyEventFamily = (title: string, rules: string, category: MatchingMarketRecord["category"]): ContractFamily =>
  category === "POLITICS" && ELECTION_PATTERN.test(`${title} ${rules}`) ? "ELECTION_WINNER"
  : WEATHER_PATTERN.test(`${title} ${rules}`) ? "WEATHER_EVENT"
  : CULTURE_PATTERN.test(`${title} ${rules}`) ? "CULTURE_EVENT"
  : /\bby\b/i.test(`${title} ${rules}`) ? "DATE_BOUND_EVENT"
  : /\bwill\b/i.test(`${title} ${rules}`) ? "BINARY_EVENT_RESOLUTION"
  : /\b(unemployment|inflation|gdp|cpi|rate hike|yield)\b/i.test(`${title} ${rules}`) ? "MACRO_THRESHOLD"
  : /\b(person|company|team|candidate|entity)\b/i.test(`${title} ${rules}`) ? "PERSON_OR_ENTITY_OUTCOME"
  : "OTHER_EVENT_STYLE";

const buildReasons = (family: ContractFamily, title: string, rules: string): readonly string[] => {
  const normalized = normalizeFreeText(`${title} ${rules}`);
  return [
    `family:${family.toLowerCase()}`,
    `title:${normalized.slice(0, 64) || "empty"}`,
    rules.length > 0 ? "rules:present" : "rules:missing"
  ];
};

const buildAmbiguityFlags = (market: MatchingMarketRecord): readonly string[] =>
  Object.entries(market.ambiguityFlags)
    .filter((entry): entry is [string, true] => entry[1] === true)
    .map(([key]) => key);

const computeConfidence = (market: MatchingMarketRecord, ambiguityFlags: readonly string[]): string => {
  const base = Number.parseFloat(market.confidenceScore);
  const confidence = Number.isFinite(base) ? Math.max(0.2, Math.min(1, base - ambiguityFlags.length * 0.1)) : 0.5;
  return confidence.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
};

export const classifyContractFamily = (market: MatchingMarketRecord): ContractFamilyClassification => {
  const category = toSemanticCategory(market);
  const parsed = parseStructuredProposition({
    category,
    title: market.title,
    rules: market.rulesText,
    boundaryReferenceAt: parseBoundaryReference(market)
  });
  const title = market.title;
  const rules = market.rulesText ?? "";
  const ambiguityFlags = buildAmbiguityFlags(market);
  const family =
    category === "CRYPTO" ? classifyCryptoFamily(title, parsed.threshold.normalized, parsed.actionOrCondition.normalized)
    : category === "SPORTS" ? classifySportsLikeFamily(title, rules, false)
    : category === "ESPORTS" ? classifySportsLikeFamily(title, rules, true)
    : classifyEventFamily(title, rules, market.category);

  return {
    interpretedContractId: market.interpretedContractId,
    family,
    familyConfidence: computeConfidence(market, ambiguityFlags),
    classificationReasons: buildReasons(family, title, rules),
    ruleIds: [
      buildStableTextId("familyrule_", `${CLASSIFIER_VERSION}|${category}|${family}`),
      `category:${category}`
    ],
    ambiguityFlags,
    weakStructureLane: family === "OTHER_EVENT_STYLE" || family === "PERSON_OR_ENTITY_OUTCOME",
    classifierVersion: CLASSIFIER_VERSION,
    metadata: {
      parsedCategory: category,
      parsedSubject: parsed.subject.normalized,
      parsedAction: parsed.actionOrCondition.normalized,
      parsedThreshold: parsed.threshold.normalized,
      parsedDeadline: parsed.deadlineOrSeason.normalized
    }
  };
};
