import type { CanonicalCategory } from "../../canonical/canonicalization-types.js";
import { normalizeCategory } from "../../canonical/canonicalization-types.js";
import { parseStructuredProposition, type StructuredProposition } from "../../simulation/proposition-matching.js";
import type { OpinionNormalizedMarket } from "./opinion-types.js";

export type OpinionFamilyCategory = "CRYPTO" | "SPORTS" | "ESPORTS" | "OTHER";

export type OpinionFamilyBucket =
  | "ATH_BY_DATE"
  | "THRESHOLD_BY_DATE"
  | "SAME_DAY_DIRECTIONAL"
  | "PRICE_AT_CLOSE"
  | "GENERIC_UP_DOWN"
  | "MATCHUP_WINNER"
  | "CHAMPIONSHIP_WINNER"
  | "SEASON_WINNER"
  | "TOURNAMENT_WINNER"
  | "SPLIT_WINNER"
  | "LEAGUE_WINNER"
  | "OTHER";

export type OpinionTimeBoundaryPattern =
  | "EXACT_DAY"
  | "BY_DATE"
  | "INTRADAY_CLOSE"
  | "SEASON"
  | "UNKNOWN";

export type OpinionStructureType =
  | "threshold"
  | "directional"
  | "price_at_close"
  | "matchup_winner"
  | "competition_winner"
  | "other";

export interface OpinionFamilyClassification {
  category: OpinionFamilyCategory;
  familyBucket: OpinionFamilyBucket;
  subject: string | null;
  competitionOrContext: string | null;
  threshold: string | null;
  deadlineOrSeason: string | null;
  timeBoundaryPattern: OpinionTimeBoundaryPattern;
  structureType: OpinionStructureType;
  parsed: StructuredProposition;
}

const DATE_PATTERN = /^\w+\s+\d{1,2}\s+20\d{2}$/;
const INTRADAY_PATTERN = /\b(hourly|close|utc|et|\d{1,2}:\d{2})\b/i;
const MATCHUP_PATTERN = /\b(vs\.?|versus)\b/i;
const TOURNAMENT_PATTERN = /\b(worlds|major|masters|tournament|cup|playoffs?|ti\b|championship)\b/i;
const SEASON_PATTERN = /\bseason\b/i;
const SPLIT_PATTERN = /\b(split|spring|summer|winter)\b/i;
const LEAGUE_PATTERN = /\b(lck|lcs|lec|lpl|league)\b/i;
const CHAMPIONSHIP_PATTERN = /\b(finals|championship|stanley cup|super bowl|world series|nba finals)\b/i;

const inferTimeBoundaryPattern = (input: {
  title: string;
  rules: string | null;
  parsed: StructuredProposition;
}): OpinionTimeBoundaryPattern => {
  const text = `${input.title} ${input.rules ?? ""}`;
  if (INTRADAY_PATTERN.test(text)) {
    return "INTRADAY_CLOSE";
  }
  if (/\bby\b/i.test(text) && DATE_PATTERN.test(input.parsed.deadlineOrSeason.normalized ?? "")) {
    return "BY_DATE";
  }
  if (DATE_PATTERN.test(input.parsed.deadlineOrSeason.normalized ?? "")) {
    return "EXACT_DAY";
  }
  if (input.parsed.deadlineOrSeason.normalized !== null) {
    return "SEASON";
  }
  return "UNKNOWN";
};

const classifyCryptoFamily = (input: {
  title: string;
  parsed: StructuredProposition;
  timeBoundaryPattern: OpinionTimeBoundaryPattern;
}): Pick<OpinionFamilyClassification, "familyBucket" | "structureType"> => {
  if (
    input.parsed.threshold.normalized === "all time high"
    || input.parsed.actionOrCondition.normalized === "reach all time high"
  ) {
    return {
      familyBucket: "ATH_BY_DATE",
      structureType: "threshold"
    };
  }

  if (
    input.parsed.threshold.normalized !== null
    && (
      input.parsed.actionOrCondition.normalized === "above threshold"
      || input.parsed.actionOrCondition.normalized === "below threshold"
    )
  ) {
    return {
      familyBucket: "THRESHOLD_BY_DATE",
      structureType: "threshold"
    };
  }

  if (/close/i.test(input.title)) {
    return {
      familyBucket: "PRICE_AT_CLOSE",
      structureType: "price_at_close"
    };
  }

  if (input.parsed.actionOrCondition.normalized === "up or down") {
    return {
      familyBucket: input.timeBoundaryPattern === "EXACT_DAY" || input.timeBoundaryPattern === "INTRADAY_CLOSE"
        ? "SAME_DAY_DIRECTIONAL"
        : "GENERIC_UP_DOWN",
      structureType: "directional"
    };
  }

  return {
    familyBucket: "OTHER",
    structureType: "other"
  };
};

const classifyCompetitionFamily = (input: {
  category: "SPORTS" | "ESPORTS";
  title: string;
  rules: string | null;
  parsed: StructuredProposition;
}): Pick<OpinionFamilyClassification, "familyBucket" | "structureType"> => {
  const text = `${input.title} ${input.rules ?? ""}`;
  if (MATCHUP_PATTERN.test(text) || input.parsed.actionOrCondition.normalized === "win match") {
    return {
      familyBucket: "MATCHUP_WINNER",
      structureType: "matchup_winner"
    };
  }

  if (input.category === "SPORTS") {
    if (CHAMPIONSHIP_PATTERN.test(text) || input.parsed.actionOrCondition.normalized === "win championship") {
      return {
        familyBucket: "CHAMPIONSHIP_WINNER",
        structureType: "competition_winner"
      };
    }
    if (SEASON_PATTERN.test(text)) {
      return {
        familyBucket: "SEASON_WINNER",
        structureType: "competition_winner"
      };
    }
    if (TOURNAMENT_PATTERN.test(text)) {
      return {
        familyBucket: "TOURNAMENT_WINNER",
        structureType: "competition_winner"
      };
    }
    return {
      familyBucket: "OTHER",
      structureType: "other"
    };
  }

  if (SPLIT_PATTERN.test(text)) {
    return {
      familyBucket: "SPLIT_WINNER",
      structureType: "competition_winner"
    };
  }
  if (LEAGUE_PATTERN.test(text)) {
    return {
      familyBucket: "LEAGUE_WINNER",
      structureType: "competition_winner"
    };
  }
  if (TOURNAMENT_PATTERN.test(text)) {
    return {
      familyBucket: "TOURNAMENT_WINNER",
      structureType: "competition_winner"
    };
  }
  return {
    familyBucket: "OTHER",
    structureType: "other"
  };
};

export const classifyStructuredOpinionFamily = (input: {
  category: CanonicalCategory | OpinionFamilyCategory | null | undefined;
  title: string;
  rules?: string | null;
  boundaryReferenceAt?: Date | null;
}): OpinionFamilyClassification => {
  const normalizedCategory = normalizeCategory(input.category) as OpinionFamilyCategory;
  const category = normalizedCategory === "CRYPTO" || normalizedCategory === "SPORTS" || normalizedCategory === "ESPORTS"
    ? normalizedCategory
    : "OTHER";
  const parsed = parseStructuredProposition({
    category,
    title: input.title,
    rules: input.rules ?? null,
    boundaryReferenceAt: input.boundaryReferenceAt ?? null
  });
  const timeBoundaryPattern = inferTimeBoundaryPattern({
    title: input.title,
    rules: input.rules ?? null,
    parsed
  });

  if (category === "CRYPTO") {
    const crypto = classifyCryptoFamily({
      title: input.title,
      parsed,
      timeBoundaryPattern
    });
    return {
      category,
      familyBucket: crypto.familyBucket,
      subject: parsed.subject.normalized,
      competitionOrContext: parsed.competitionOrContext.normalized,
      threshold: parsed.threshold.normalized,
      deadlineOrSeason: parsed.deadlineOrSeason.normalized,
      timeBoundaryPattern,
      structureType: crypto.structureType,
      parsed
    };
  }

  if (category === "SPORTS" || category === "ESPORTS") {
    const competition = classifyCompetitionFamily({
      category,
      title: input.title,
      rules: input.rules ?? null,
      parsed
    });
    return {
      category,
      familyBucket: competition.familyBucket,
      subject: parsed.subject.normalized,
      competitionOrContext: parsed.competitionOrContext.normalized,
      threshold: parsed.threshold.normalized,
      deadlineOrSeason: parsed.deadlineOrSeason.normalized,
      timeBoundaryPattern,
      structureType: competition.structureType,
      parsed
    };
  }

  return {
    category: "OTHER",
    familyBucket: "OTHER",
    subject: parsed.subject.normalized,
    competitionOrContext: parsed.competitionOrContext.normalized,
    threshold: parsed.threshold.normalized,
    deadlineOrSeason: parsed.deadlineOrSeason.normalized,
    timeBoundaryPattern,
    structureType: "other",
    parsed
  };
};

export const classifyOpinionMarketFamily = (
  market: OpinionNormalizedMarket,
  category: CanonicalCategory | OpinionFamilyCategory
): OpinionFamilyClassification =>
  classifyStructuredOpinionFamily({
    category,
    title: market.title,
    rules: market.rules,
    boundaryReferenceAt: market.cutoffAt ?? market.resolvedAt ?? market.createdAt ?? null
  });
