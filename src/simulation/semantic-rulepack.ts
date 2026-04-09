import { z } from "zod";

import { normalizeFreeText } from "../canonical/canonicalization-types.js";
import { semanticGeneratedRulepack } from "./semantic-rulepack.generated.js";

export const semanticDiscoveryCategorySchema = z.enum([
  "POLITICS",
  "CRYPTO",
  "SPORTS",
  "ESPORTS",
  "CULTURE",
  "TECH",
  "WEATHER",
  "OTHER"
]);
export type SemanticDiscoveryCategory = z.infer<typeof semanticDiscoveryCategorySchema>;

export const semanticFieldTargetSchema = z.enum([
  "subject",
  "actionOrCondition",
  "threshold",
  "deadlineOrSeason",
  "competitionOrContext",
  "resolutionSourceType",
  "discoveryKeyword"
]);
export type SemanticFieldTarget = z.infer<typeof semanticFieldTargetSchema>;

export interface SemanticRule {
  canonical: string;
  variants: readonly string[];
  categories: readonly SemanticDiscoveryCategory[];
  targetField: SemanticFieldTarget;
  venues?: readonly string[];
  precedence?: number;
  exactnessRequired?: boolean;
}

const ALL_EXACT_CATEGORIES: readonly SemanticDiscoveryCategory[] = [
  "POLITICS",
  "CRYPTO",
  "SPORTS",
  "ESPORTS",
  "CULTURE",
  "TECH",
  "WEATHER",
  "OTHER"
];

const baseSemanticRulepack: readonly SemanticRule[] = [
  {
    canonical: "all time high",
    variants: ["ath", "all time high", "all-time high", "new high"],
    categories: ["CRYPTO"],
    targetField: "threshold",
    precedence: 90,
    exactnessRequired: true
  },
  {
    canonical: "reach all time high",
    variants: ["reaches all time high", "reach all time high", "reaches a new all time high", "hits all time high"],
    categories: ["CRYPTO"],
    targetField: "actionOrCondition",
    precedence: 100,
    exactnessRequired: true
  },
  {
    canonical: "up or down",
    variants: ["up or down", "goes up or down", "up/down", "directional"],
    categories: ["CRYPTO"],
    targetField: "actionOrCondition",
    precedence: 50
  },
  {
    canonical: "above threshold",
    variants: ["above", "over", "at least", "reaches", "hits", "touches", "trades above", "closes above", "prints above"],
    categories: ["CRYPTO"],
    targetField: "actionOrCondition",
    precedence: 40
  },
  {
    canonical: "below threshold",
    variants: ["below", "under", "at most", "drops below", "falls below", "trades below", "closes below"],
    categories: ["CRYPTO"],
    targetField: "actionOrCondition",
    precedence: 40
  },
  {
    canonical: "win nomination",
    variants: [
      "win the nomination",
      "wins the nomination",
      "becomes nominee",
      "become nominee",
      "becomes the nominee",
      "become the nominee",
      "secures nomination",
      "secure nomination",
      "party nominee",
      "wins nomination",
      "wins the democratic nominee contest",
      "wins democratic nominee contest"
    ],
    categories: ["POLITICS"],
    targetField: "actionOrCondition",
    precedence: 80,
    exactnessRequired: true
  },
  {
    canonical: "win election",
    variants: ["wins election", "win the election", "wins the presidency", "be elected", "wins senate race"],
    categories: ["POLITICS"],
    targetField: "actionOrCondition",
    precedence: 60
  },
  {
    canonical: "strike",
    variants: ["strike", "launch strike", "military strike", "attack", "launch attack"],
    categories: ["POLITICS"],
    targetField: "actionOrCondition",
    precedence: 60
  },
  {
    canonical: "sanctions",
    variants: ["sanction", "sanctions", "impose sanctions", "new sanctions"],
    categories: ["POLITICS"],
    targetField: "actionOrCondition"
  },
  {
    canonical: "appointment",
    variants: ["appoint", "appointment", "confirmed", "confirmation"],
    categories: ["POLITICS", "TECH", "OTHER"],
    targetField: "actionOrCondition"
  },
  {
    canonical: "pass legislation",
    variants: ["passes bill", "pass bill", "signs bill", "legislation", "law enacted"],
    categories: ["POLITICS"],
    targetField: "actionOrCondition"
  },
  {
    canonical: "win match",
    variants: ["win the match", "wins the match", "match winner", "defeat", "beat", "vs"],
    categories: ["SPORTS", "ESPORTS"],
    targetField: "actionOrCondition",
    precedence: 60
  },
  {
    canonical: "win championship",
    variants: ["win finals", "wins finals", "win championship", "wins championship", "champion", "wins title"],
    categories: ["SPORTS", "ESPORTS"],
    targetField: "actionOrCondition",
    precedence: 70
  },
  {
    canonical: "win series",
    variants: ["win series", "wins series", "best of", "bo5", "bo3"],
    categories: ["SPORTS", "ESPORTS"],
    targetField: "actionOrCondition",
    precedence: 50
  },
  {
    canonical: "award win",
    variants: ["wins oscar", "wins academy award", "wins grammy", "wins emmy", "wins award", "award winner", "academy award"],
    categories: ["CULTURE"],
    targetField: "actionOrCondition",
    precedence: 60
  },
  {
    canonical: "release event",
    variants: ["release", "launches", "debut", "premiere", "opens in theaters"],
    categories: ["CULTURE", "TECH"],
    targetField: "actionOrCondition"
  },
  {
    canonical: "box office milestone",
    variants: ["box office", "grosses", "crosses box office", "ticket sales"],
    categories: ["CULTURE"],
    targetField: "actionOrCondition"
  },
  {
    canonical: "model release",
    variants: ["release model", "launch model", "ship model", "announce model", "new model", "flagship model"],
    categories: ["TECH"],
    targetField: "actionOrCondition",
    precedence: 60
  },
  {
    canonical: "product launch",
    variants: ["launch product", "product launch", "announces product", "reveals product", "ships device"],
    categories: ["TECH"],
    targetField: "actionOrCondition"
  },
  {
    canonical: "weather intensity event",
    variants: ["hurricane", "storm intensity", "category 5", "category 4", "temperature high", "rainfall"],
    categories: ["WEATHER"],
    targetField: "actionOrCondition",
    precedence: 60
  },
  {
    canonical: "landfall",
    variants: ["landfall", "make landfall", "hits coast", "storm hits"],
    categories: ["WEATHER"],
    targetField: "actionOrCondition",
    precedence: 70
  },
  {
    canonical: "2028 democratic presidential nomination",
    variants: [
      "2028 democratic presidential nomination",
      "2028 democratic nominee",
      "democratic presidential nomination",
      "democratic nominee",
      "party nominee"
    ],
    categories: ["POLITICS"],
    targetField: "competitionOrContext",
    precedence: 90,
    exactnessRequired: true
  },
  {
    canonical: "2028 presidential election",
    variants: ["2028 presidential election", "presidential election", "white house race"],
    categories: ["POLITICS"],
    targetField: "competitionOrContext",
    precedence: 60
  },
  {
    canonical: "nba finals",
    variants: ["nba finals", "2026 nba finals", "nba championship", "the finals"],
    categories: ["SPORTS"],
    targetField: "competitionOrContext",
    precedence: 80,
    exactnessRequired: true
  },
  {
    canonical: "stanley cup",
    variants: ["stanley cup", "nhl stanley cup", "nhl finals"],
    categories: ["SPORTS"],
    targetField: "competitionOrContext",
    precedence: 80,
    exactnessRequired: true
  },
  {
    canonical: "world series",
    variants: ["world series", "mlb world series"],
    categories: ["SPORTS"],
    targetField: "competitionOrContext",
    precedence: 70
  },
  {
    canonical: "super bowl",
    variants: ["super bowl", "superbowl"],
    categories: ["SPORTS"],
    targetField: "competitionOrContext",
    precedence: 70
  },
  {
    canonical: "lck 2026 season playoffs",
    variants: [
      "lck 2026 season playoffs",
      "lck 2026 playoffs",
      "lck playoffs",
      "lck season playoffs"
    ],
    categories: ["ESPORTS"],
    targetField: "competitionOrContext",
    precedence: 85,
    exactnessRequired: true
  },
  {
    canonical: "esl",
    variants: ["esl", "esl one", "esl pro league"],
    categories: ["ESPORTS"],
    targetField: "competitionOrContext",
    precedence: 50
  },
  {
    canonical: "worlds",
    variants: ["worlds", "world championship", "league worlds"],
    categories: ["ESPORTS"],
    targetField: "competitionOrContext",
    precedence: 50
  },
  {
    canonical: "award season",
    variants: ["oscars", "grammys", "emmys", "golden globes"],
    categories: ["CULTURE"],
    targetField: "competitionOrContext"
  },
  {
    canonical: "technology product cycle",
    variants: ["developer conference", "keynote", "wwdc", "ces", "launch event"],
    categories: ["TECH"],
    targetField: "competitionOrContext"
  },
  {
    canonical: "storm season",
    variants: ["hurricane season", "storm season", "winter storm season"],
    categories: ["WEATHER"],
    targetField: "competitionOrContext"
  },
  {
    canonical: "march 31 2026",
    variants: ["march 31, 2026", "march 31 2026", "mar 31 2026", "mar 31, 2026", "march 31"],
    categories: ["CRYPTO", "POLITICS", "SPORTS", "ESPORTS", "CULTURE", "TECH", "WEATHER", "OTHER"],
    targetField: "deadlineOrSeason",
    precedence: 90,
    exactnessRequired: true
  },
  {
    canonical: "2026 season",
    variants: ["2026 season", "season 2026", "2026 playoffs"],
    categories: ["SPORTS", "ESPORTS"],
    targetField: "deadlineOrSeason",
    precedence: 60
  },
  {
    canonical: "q3",
    variants: ["q3", "third quarter"],
    categories: ["OTHER"],
    targetField: "deadlineOrSeason"
  },
  {
    canonical: "binance",
    variants: ["binance"],
    categories: ["CRYPTO"],
    targetField: "resolutionSourceType",
    precedence: 80
  },
  {
    canonical: "official rules",
    variants: ["resolves", "official rules", "market resolves", "according to official rules"],
    categories: ALL_EXACT_CATEGORIES,
    targetField: "resolutionSourceType",
    precedence: 10
  },
  {
    canonical: "bitcoin",
    variants: ["bitcoin", "btc", "btc/usdt"],
    categories: ["CRYPTO"],
    targetField: "subject",
    precedence: 90,
    exactnessRequired: true
  },
  {
    canonical: "ethereum",
    variants: ["ethereum", "eth", "eth/usdt"],
    categories: ["CRYPTO"],
    targetField: "subject",
    precedence: 90,
    exactnessRequired: true
  },
  {
    canonical: "solana",
    variants: ["solana", "sol"],
    categories: ["CRYPTO"],
    targetField: "subject"
  },
  {
    canonical: "gavin newsom",
    variants: ["gavin newsom"],
    categories: ["POLITICS"],
    targetField: "subject",
    precedence: 90,
    exactnessRequired: true
  },
  {
    canonical: "jon ossoff",
    variants: ["jon ossoff"],
    categories: ["POLITICS"],
    targetField: "subject",
    precedence: 90,
    exactnessRequired: true
  },
  {
    canonical: "democratic party",
    variants: ["democratic party", "democrats", "democrat"],
    categories: ["POLITICS"],
    targetField: "subject"
  },
  {
    canonical: "republican party",
    variants: ["republican party", "republicans", "gop"],
    categories: ["POLITICS"],
    targetField: "subject"
  },
  {
    canonical: "iran",
    variants: ["iran", "iranian"],
    categories: ["POLITICS"],
    targetField: "subject"
  },
  {
    canonical: "oklahoma city thunder",
    variants: ["oklahoma city thunder", "okc", "thunder"],
    categories: ["SPORTS"],
    targetField: "subject",
    precedence: 90,
    exactnessRequired: true
  },
  {
    canonical: "colorado avalanche",
    variants: ["colorado avalanche", "avalanche", "avs"],
    categories: ["SPORTS"],
    targetField: "subject",
    precedence: 90,
    exactnessRequired: true
  },
  {
    canonical: "phoenix suns",
    variants: ["phoenix suns", "suns"],
    categories: ["SPORTS"],
    targetField: "subject"
  },
  {
    canonical: "utah jazz",
    variants: ["utah jazz", "jazz"],
    categories: ["SPORTS"],
    targetField: "subject"
  },
  {
    canonical: "t1",
    variants: ["t1"],
    categories: ["ESPORTS"],
    targetField: "subject",
    precedence: 90,
    exactnessRequired: true
  },
  {
    canonical: "gen g esports",
    variants: ["gen.g", "gen g", "gen.g esports", "gen g esports"],
    categories: ["ESPORTS"],
    targetField: "subject",
    precedence: 90,
    exactnessRequired: true
  },
  {
    canonical: "tundra esports",
    variants: ["tundra", "tundra esports"],
    categories: ["ESPORTS"],
    targetField: "subject"
  },
  {
    canonical: "yandex",
    variants: ["yandex"],
    categories: ["ESPORTS"],
    targetField: "subject"
  },
  {
    canonical: "academy awards",
    variants: ["academy awards", "oscars", "oscar"],
    categories: ["CULTURE"],
    targetField: "subject"
  },
  {
    canonical: "grammy awards",
    variants: ["grammys", "grammy awards", "grammy"],
    categories: ["CULTURE"],
    targetField: "subject"
  },
  {
    canonical: "openai",
    variants: ["openai"],
    categories: ["TECH"],
    targetField: "subject"
  },
  {
    canonical: "nvidia",
    variants: ["nvidia"],
    categories: ["TECH"],
    targetField: "subject"
  },
  {
    canonical: "iphone",
    variants: ["iphone"],
    categories: ["TECH"],
    targetField: "subject"
  },
  {
    canonical: "storm system",
    variants: ["storm", "hurricane", "cyclone", "typhoon", "snowstorm"],
    categories: ["WEATHER"],
    targetField: "subject"
  },
  {
    canonical: "heatwave",
    variants: ["heat wave", "heatwave"],
    categories: ["WEATHER"],
    targetField: "subject"
  },
  {
    canonical: "politics keyword family",
    variants: ["politics", "election", "nominee", "nomination", "president", "senate", "government", "parliament", "strike", "sanctions", "legislation"],
    categories: ["POLITICS"],
    targetField: "discoveryKeyword"
  },
  {
    canonical: "crypto keyword family",
    variants: ["crypto", "bitcoin", "btc", "ethereum", "eth", "solana", "ath", "all time high", "price", "threshold"],
    categories: ["CRYPTO"],
    targetField: "discoveryKeyword"
  },
  {
    canonical: "sports keyword family",
    variants: ["sports", "nba", "nhl", "nfl", "mlb", "ufc", "soccer", "tennis", "playoffs", "finals", "championship", "matchup"],
    categories: ["SPORTS"],
    targetField: "discoveryKeyword"
  },
  {
    canonical: "esports keyword family",
    variants: ["esports", "lck", "league of legends", "worlds", "valorant", "dota", "esl", "gaming"],
    categories: ["ESPORTS"],
    targetField: "discoveryKeyword"
  },
  {
    canonical: "culture keyword family",
    variants: ["movie", "film", "music", "album", "box office", "oscar", "grammy", "emmy", "celebrity", "culture"],
    categories: ["CULTURE"],
    targetField: "discoveryKeyword"
  },
  {
    canonical: "tech keyword family",
    variants: ["tech", "technology", "ai", "chip", "gpu", "software", "model", "startup", "launch", "device"],
    categories: ["TECH"],
    targetField: "discoveryKeyword"
  },
  {
    canonical: "weather keyword family",
    variants: ["weather", "storm", "hurricane", "rainfall", "temperature", "snow", "landfall", "heatwave"],
    categories: ["WEATHER"],
    targetField: "discoveryKeyword"
  },
  {
    canonical: "other keyword family",
    variants: ["economy", "inflation", "cpi", "gdp", "macro", "general", "other"],
    categories: ["OTHER"],
    targetField: "discoveryKeyword"
  }
] as const;

export const semanticRulepack: readonly SemanticRule[] = [
  ...baseSemanticRulepack,
  ...semanticGeneratedRulepack
];

const FIELD_ORDER: readonly SemanticFieldTarget[] = [
  "subject",
  "actionOrCondition",
  "threshold",
  "deadlineOrSeason",
  "competitionOrContext",
  "resolutionSourceType"
];

export const normalizeSemanticText = (value: string): string =>
  normalizeFreeText(value)
    .replace(/\b(yes|no)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const ruleAppliesToCategory = (rule: SemanticRule, category: SemanticDiscoveryCategory): boolean =>
  rule.categories.includes(category);

export const getSemanticRulesForField = (
  category: SemanticDiscoveryCategory,
  targetField: SemanticFieldTarget
): readonly SemanticRule[] =>
  semanticRulepack
    .filter((rule) => rule.targetField === targetField && ruleAppliesToCategory(rule, category))
    .sort((left, right) => {
      const precedenceDelta = (right.precedence ?? 0) - (left.precedence ?? 0);
      if (precedenceDelta !== 0) {
        return precedenceDelta;
      }
      return right.canonical.length - left.canonical.length;
    });

export interface SemanticRuleMatch {
  canonical: string;
  raw: string;
  aliasesApplied: readonly string[];
  ruleEvidence: readonly string[];
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const findSemanticRuleMatch = (
  text: string,
  category: SemanticDiscoveryCategory,
  targetField: SemanticFieldTarget
): SemanticRuleMatch | null => {
  const normalizedText = normalizeSemanticText(text);
  for (const rule of getSemanticRulesForField(category, targetField)) {
    for (const variant of [rule.canonical, ...rule.variants]) {
      const normalizedVariant = normalizeSemanticText(variant);
      if (!normalizedVariant) {
        continue;
      }
      const pattern = new RegExp(`\\b${escapeRegex(normalizedVariant)}\\b`, "i");
      const matched = normalizedText.match(pattern);
      if (matched?.[0]) {
        return {
          canonical: rule.canonical,
          raw: matched[0],
          aliasesApplied: [`${matched[0]}=>${rule.canonical}`],
          ruleEvidence: [`${targetField}:${rule.canonical}`]
        };
      }
    }
  }
  return null;
};

export const applySemanticRulepack = (
  value: string,
  category: SemanticDiscoveryCategory,
  targets: readonly SemanticFieldTarget[] = FIELD_ORDER
): { text: string; aliasesApplied: readonly string[]; ruleEvidence: readonly string[] } => {
  let text = normalizeSemanticText(value);
  const aliasesApplied: string[] = [];
  const ruleEvidence: string[] = [];

  for (const target of targets) {
    for (const rule of getSemanticRulesForField(category, target)) {
      for (const variant of [rule.canonical, ...rule.variants]) {
        const normalizedVariant = normalizeSemanticText(variant);
        if (!normalizedVariant) {
          continue;
        }
        const pattern = new RegExp(`\\b${escapeRegex(normalizedVariant)}\\b`, "g");
        if (pattern.test(text)) {
          text = text.replace(pattern, rule.canonical);
          aliasesApplied.push(`${normalizedVariant}=>${rule.canonical}`);
          ruleEvidence.push(`${target}:${rule.canonical}`);
        }
      }
    }
  }

  return {
    text: text.replace(/\s+/g, " ").trim(),
    aliasesApplied: [...new Set(aliasesApplied)],
    ruleEvidence: [...new Set(ruleEvidence)]
  };
};

export const getLooseDiscoveryKeywords = (category: SemanticDiscoveryCategory): readonly string[] =>
  getSemanticRulesForField(category, "discoveryKeyword").flatMap((rule) =>
    [rule.canonical, ...rule.variants].map((entry) => normalizeSemanticText(entry)).filter((entry) => entry.length > 0)
  );

export interface RankedSemanticCategory {
  category: SemanticDiscoveryCategory;
  score: number;
  matchedKeywords: readonly string[];
}

export const rankSemanticCategories = (
  text: string,
  categories: readonly SemanticDiscoveryCategory[] = semanticDiscoveryCategorySchema.options
): readonly RankedSemanticCategory[] => {
  const normalized = normalizeSemanticText(text);
  return categories
    .map((category) => {
      const matchedKeywords = getLooseDiscoveryKeywords(category).filter((keyword) => normalized.includes(keyword));
      return {
        category,
        score: matchedKeywords.length,
        matchedKeywords: [...new Set(matchedKeywords)]
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.category.localeCompare(right.category));
};
