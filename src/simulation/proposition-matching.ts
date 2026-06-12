import { z } from "zod";

import {
  applySemanticRulepack,
  findSemanticRuleMatch,
  normalizeSemanticText,
  rankSemanticCategories,
  semanticDiscoveryCategorySchema,
  type SemanticDiscoveryCategory,
  type SemanticFieldTarget
} from "./semantic-rulepack.js";

export const propositionMatchCategorySchema = semanticDiscoveryCategorySchema;
export type PropositionMatchCategory = SemanticDiscoveryCategory;

export const propositionFieldConfidenceSchema = z.enum(["NONE", "LOW", "MEDIUM", "HIGH"]);
export type PropositionFieldConfidence = z.infer<typeof propositionFieldConfidenceSchema>;

export const propositionFieldSchema = z.object({
  raw: z.string().nullable(),
  normalized: z.string().nullable(),
  confidence: propositionFieldConfidenceSchema,
  aliasesApplied: z.array(z.string()).default([]),
  ruleEvidence: z.array(z.string()).default([])
});
export type PropositionField = z.infer<typeof propositionFieldSchema>;

export const structuredOutcomeSchemaTypeSchema = z.enum(["YES_NO", "UP_DOWN", "UNKNOWN"]);
export type StructuredOutcomeSchemaType = z.infer<typeof structuredOutcomeSchemaTypeSchema>;

export const resolutionSourceTypeSchema = z.enum(["MARKET_DATA_EXCHANGE", "CENTRAL_MARKET_RULES", "UNKNOWN"]);
export type ResolutionSourceType = z.infer<typeof resolutionSourceTypeSchema>;

export const structuredPropositionSchema = z.object({
  category: propositionMatchCategorySchema,
  sourceText: z.string(),
  subject: propositionFieldSchema,
  actionOrCondition: propositionFieldSchema,
  threshold: propositionFieldSchema,
  deadlineOrSeason: propositionFieldSchema,
  competitionOrContext: propositionFieldSchema,
  outcomeSchema: z.object({
    raw: z.string().nullable(),
    normalized: structuredOutcomeSchemaTypeSchema,
    confidence: propositionFieldConfidenceSchema,
    ruleEvidence: z.array(z.string()).default([])
  }),
  resolutionSourceType: z.object({
    raw: z.string().nullable(),
    normalized: resolutionSourceTypeSchema,
    confidence: propositionFieldConfidenceSchema,
    ruleEvidence: z.array(z.string()).default([])
  }),
  parserVersion: z.string()
});
export type StructuredProposition = z.infer<typeof structuredPropositionSchema>;

export const propositionMatchDimensionSchema = z.enum([
  "subjectEntityMatch",
  "conditionActionMatch",
  "thresholdMatch",
  "timeBoundaryMatch",
  "competitionContextMatch",
  "resolutionSourceCompatibility",
  "outcomeSchemaCompatibility"
]);
export type PropositionMatchDimension = z.infer<typeof propositionMatchDimensionSchema>;

export const propositionDimensionResultSchema = z.object({
  dimension: propositionMatchDimensionSchema,
  required: z.boolean(),
  matched: z.boolean(),
  left: z.string().nullable(),
  right: z.string().nullable(),
  reasonCode: z.string()
});
export type PropositionDimensionResult = z.infer<typeof propositionDimensionResultSchema>;

export const propositionMatchClassificationSchema = z.enum([
  "semantic_exact_historical_qualified",
  "semantic_exact_live_only",
  "semantic_near_exact",
  "proxy_or_mismatch",
  "unresolved_no_candidate"
]);
export type PropositionMatchClassification = z.infer<typeof propositionMatchClassificationSchema>;

export const propositionComparisonSchema = z.object({
  classification: propositionMatchClassificationSchema,
  matchScore: z.number().int().nonnegative(),
  exactDimensionsMatched: z.number().int().nonnegative(),
  requiredDimensionsMatched: z.number().int().nonnegative(),
  requiredDimensionCount: z.number().int().nonnegative(),
  failedDimensions: z.array(propositionMatchDimensionSchema),
  primaryFailureReason: z.string().nullable(),
  dimensionResults: z.array(propositionDimensionResultSchema)
});
export type PropositionComparison = z.infer<typeof propositionComparisonSchema>;

interface ParseInput {
  category: PropositionMatchCategory;
  title: string;
  rules?: string | null;
  yesLabel?: string | null;
  noLabel?: string | null;
  boundaryReferenceAt?: Date | null;
}

type ParserOutput = Omit<
  StructuredProposition,
  "category" | "sourceText" | "outcomeSchema" | "resolutionSourceType" | "parserVersion"
>;

interface ParserContext {
  category: PropositionMatchCategory;
  sourceText: string;
  normalizedText: string;
  aliasesApplied: readonly string[];
  ruleEvidence: readonly string[];
  boundaryReferenceAt: Date | null;
}

const PARSER_VERSION = "structured-proposition-v3";
const MONTH_PATTERN = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const RAW_MONTH_PATTERN = "(jan(?:uary)?\\.?|feb(?:ruary)?\\.?|mar(?:ch)?\\.?|apr(?:il)?\\.?|may\\.?|jun(?:e)?\\.?|jul(?:y)?\\.?|aug(?:ust)?\\.?|sep(?:tember)?\\.?|oct(?:ober)?\\.?|nov(?:ember)?\\.?|dec(?:ember)?\\.?)";
const ISO_MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december"
] as const;

const normalizeCalendarDate = (
  month: string,
  day: string,
  year?: string | null,
  referenceAt?: Date | null
): string | null => {
  const normalizedMonth = month.toLowerCase().replace(/\./g, "");
  const resolvedYear = year ?? (referenceAt ? String(referenceAt.getUTCFullYear()) : null);
  if (!resolvedYear) {
    return null;
  }
  return `${normalizedMonth} ${day} ${resolvedYear}`;
};

const normalizeIsoCalendarDate = (year: string, month: string, day: string): string | null => {
  const yearNumber = Number.parseInt(year, 10);
  const monthNumber = Number.parseInt(month, 10);
  const dayNumber = Number.parseInt(day, 10);
  const date = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));
  if (
    date.getUTCFullYear() !== yearNumber
    || date.getUTCMonth() !== monthNumber - 1
    || date.getUTCDate() !== dayNumber
  ) {
    return null;
  }
  const monthName = ISO_MONTH_NAMES[monthNumber - 1];
  return monthName ? `${monthName} ${dayNumber} ${yearNumber}` : null;
};

const extractCalendarDateField = (
  context: ParserContext,
  matches: readonly (RegExpMatchArray | null)[],
  reasonCode: string
): PropositionField => {
  for (const match of matches) {
    if (!match) {
      continue;
    }
    const normalized = normalizeCalendarDate(
      match[1] ?? "",
      match[2] ?? "",
      match[3] ?? null,
      context.boundaryReferenceAt
    );
    if (!normalized) {
      continue;
    }
    return buildField(
      match[0],
      normalized,
      context.aliasesApplied,
      "HIGH",
      [...context.ruleEvidence, reasonCode]
    );
  }
  return emptyField();
};

const buildField = (
  raw: string | null,
  normalized: string | null,
  aliasesApplied: readonly string[] = [],
  confidence: PropositionFieldConfidence = normalized ? "HIGH" : "NONE",
  ruleEvidence: readonly string[] = []
): PropositionField => ({
  raw,
  normalized,
  confidence,
  aliasesApplied: [...aliasesApplied],
  ruleEvidence: [...ruleEvidence]
});

const emptyField = (): PropositionField => buildField(null, null, [], "NONE", []);

const maybeEqual = (left: string | null, right: string | null): boolean => left !== null && right !== null && left === right;
const bothMissing = (left: string | null, right: string | null): boolean => left === null && right === null;

const normalizeThresholdValue = (value: string): string =>
  value.replace(/[$,\s]/g, "").toLowerCase();

const buildFieldFromRule = (
  context: ParserContext,
  targetField: SemanticFieldTarget,
  confidence: PropositionFieldConfidence = "HIGH"
): PropositionField => {
  const matched = findSemanticRuleMatch(context.normalizedText, context.category, targetField);
  if (!matched) {
    return emptyField();
  }
  return buildField(
    matched.raw,
    matched.canonical,
    [...context.aliasesApplied, ...matched.aliasesApplied],
    confidence,
    [...context.ruleEvidence, ...matched.ruleEvidence]
  );
};

const parseThreshold = (context: ParserContext): PropositionField => {
  const ruleMatch = buildFieldFromRule(context, "threshold");
  if (ruleMatch.normalized) {
    return ruleMatch;
  }

  const rawText = context.sourceText.toLowerCase();
  const numericWithOperator = rawText.match(
    /\b(above|over|at least|reaches|hits|touches|trades above|closes above|below|under|at most|trades below|closes below)\s+\$?\s*(\d+(?:,\d{3})*(?:\.\d+)?(?:k|m|b)?)(%| percent)?\b/i
  );
  if (numericWithOperator?.[2]) {
    return buildField(
      numericWithOperator[0] ?? numericWithOperator[2],
      `${numericWithOperator[1]?.toLowerCase() ?? "level"}:${normalizeThresholdValue(numericWithOperator[2])}${numericWithOperator[3] ? "%" : ""}`,
      context.aliasesApplied,
      "HIGH",
      [...context.ruleEvidence, "threshold:numeric"]
    );
  }

  const numericPrice = rawText.match(/\$\s*(\d+(?:,\d{3})*(?:\.\d+)?(?:k|m|b)?)\b/i);
  if (!numericPrice?.[1]) {
    return emptyField();
  }
  return buildField(
    numericPrice[0] ?? numericPrice[1],
    `level:${normalizeThresholdValue(numericPrice[1])}`,
    context.aliasesApplied,
    "MEDIUM",
    [...context.ruleEvidence, "threshold:numeric"]
  );
};

const inferCryptoAction = (
  context: ParserContext,
  threshold: PropositionField
): PropositionField => {
  const explicit = buildFieldFromRule(context, "actionOrCondition");
  if (explicit.normalized) {
    return explicit;
  }
  if (threshold.normalized === "all time high") {
    return buildField(
      "all time high",
      "reach all time high",
      context.aliasesApplied,
      "MEDIUM",
      [...context.ruleEvidence, "action:crypto_ath_fallback"]
    );
  }
  return explicit;
};

const parseDeadlineOrSeason = (context: ParserContext): PropositionField => {
  const ruleMatch = buildFieldFromRule(context, "deadlineOrSeason");
  if (ruleMatch.normalized) {
    return ruleMatch;
  }

  const rawSourceText = context.sourceText.toLowerCase();
  const exactCalendarDate = extractCalendarDateField(
    context,
    [
      rawSourceText.match(new RegExp(`\\b(?:on|for)\\s+${RAW_MONTH_PATTERN}\\s+(\\d{1,2})(?:,?\\s+(20\\d{2}))?\\b`, "i")),
      rawSourceText.match(new RegExp(`\\(\\s*${RAW_MONTH_PATTERN}\\s+(\\d{1,2})(?:,?\\s+(20\\d{2}))?`, "i")),
      rawSourceText.match(new RegExp(`\\b${RAW_MONTH_PATTERN}\\s+(\\d{1,2})(?:,\\s+(20\\d{2}))?\\b`, "i"))
    ],
    "deadline:calendar_date"
  );
  if (exactCalendarDate.normalized) {
    return exactCalendarDate;
  }

  const isoDate = rawSourceText.match(/\b(20\d{2})[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/);
  if (isoDate?.[1] && isoDate?.[2] && isoDate?.[3]) {
    const normalized = normalizeIsoCalendarDate(isoDate[1], isoDate[2], isoDate[3]);
    if (normalized) {
      return buildField(
        isoDate[0],
        normalized,
        context.aliasesApplied,
        "HIGH",
        [...context.ruleEvidence, "deadline:iso_date"]
      );
    }
  }

  const byDate = context.normalizedText.match(new RegExp(`\\bby\\s+${MONTH_PATTERN}\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?\\b`, "i"));
  if (byDate) {
    const normalized = normalizeCalendarDate(
      byDate[1] ?? "",
      byDate[2] ?? "",
      byDate[3] ?? null,
      context.boundaryReferenceAt
    );
    return buildField(
      byDate[0],
      normalized ?? `${byDate[1]} ${byDate[2]}${byDate[3] ? ` ${byDate[3]}` : ""}`.toLowerCase(),
      context.aliasesApplied,
      normalized ? "HIGH" : byDate[3] ? "HIGH" : "MEDIUM",
      [...context.ruleEvidence, normalized ? "deadline:by_date_inferred_year" : "deadline:by_date"]
    );
  }

  const quarter = context.normalizedText.match(/\b(q[1-4]|first quarter|second quarter|third quarter|fourth quarter)\b/i);
  if (quarter?.[1]) {
    const normalizedQuarter = quarter[1].toLowerCase().replace("first quarter", "q1").replace("second quarter", "q2").replace("third quarter", "q3").replace("fourth quarter", "q4");
    return buildField(quarter[0], normalizedQuarter, context.aliasesApplied, "MEDIUM", [...context.ruleEvidence, "deadline:quarter"]);
  }

  const yearSeason = context.normalizedText.match(/\b(20\d{2})\s+(season|playoffs|finals|championship|election)\b/i);
  if (yearSeason?.[1] && yearSeason?.[2]) {
    return buildField(
      yearSeason[0],
      `${yearSeason[1]} ${yearSeason[2].toLowerCase()}`,
      context.aliasesApplied,
      "MEDIUM",
      [...context.ruleEvidence, "deadline:season"]
    );
  }

  const year = context.normalizedText.match(/\b(20\d{2})\b/);
  if (year?.[1]) {
    return buildField(year[0], year[1], context.aliasesApplied, "LOW", [...context.ruleEvidence, "deadline:year"]);
  }

  if (
    context.boundaryReferenceAt
    && (context.category === "SPORTS" || context.category === "ESPORTS")
    && /\b(vs\.?|versus|match|win the match|wins the match|defeat|beat)\b/i.test(context.sourceText)
  ) {
    const normalizedBoundary = normalizeCalendarDate(
      context.boundaryReferenceAt.toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
      String(context.boundaryReferenceAt.getUTCDate()),
      String(context.boundaryReferenceAt.getUTCFullYear())
    );
    return buildField(
      context.boundaryReferenceAt.toISOString(),
      normalizedBoundary,
      context.aliasesApplied,
      "MEDIUM",
      [...context.ruleEvidence, "deadline:boundary_reference_matchup"]
    );
  }

  return emptyField();
};

const fallbackCompetitionField = (context: ParserContext): PropositionField => {
  switch (context.category) {
    case "CRYPTO":
      return buildField("crypto", "crypto", context.aliasesApplied, "LOW", [...context.ruleEvidence, "competition:crypto_fallback"]);
    case "TECH":
      return buildField("tech", "technology product cycle", context.aliasesApplied, "LOW", [...context.ruleEvidence, "competition:tech_fallback"]);
    case "WEATHER":
      return buildField("weather", "storm season", context.aliasesApplied, "LOW", [...context.ruleEvidence, "competition:weather_fallback"]);
    default:
      return emptyField();
  }
};

const inferPoliticsAction = (context: ParserContext, competition: PropositionField): PropositionField => {
  const explicit = buildFieldFromRule(context, "actionOrCondition");
  if (explicit.normalized) {
    return explicit;
  }
  if (
    competition.normalized === "2028 democratic presidential nomination"
    && /\b(win|wins|becomes|become|secures|secure)\b/i.test(context.normalizedText)
  ) {
    return buildField(
      "nomination action",
      "win nomination",
      context.aliasesApplied,
      "MEDIUM",
      [...context.ruleEvidence, "action:politics_nomination_fallback"]
    );
  }
  return explicit;
};

const inferCompetitionAction = (context: ParserContext, competition: PropositionField): PropositionField => {
  const explicit = buildFieldFromRule(context, "actionOrCondition");
  if (explicit.normalized) {
    return explicit;
  }
  if (competition.normalized && /\b(win|wins|defeat|beat)\b/i.test(context.normalizedText)) {
    const normalized =
      competition.normalized.includes("playoffs")
      || competition.normalized.includes("finals")
      || competition.normalized.includes("cup")
      || competition.normalized.includes("championship")
        ? "win championship"
        : "win match";
    return buildField(
      "competition action",
      normalized,
      context.aliasesApplied,
      "MEDIUM",
      [...context.ruleEvidence, "action:competition_fallback"]
    );
  }
  return explicit;
};

const parsePolitics = (context: ParserContext): ParserOutput => {
  const competitionOrContext = buildFieldFromRule(context, "competitionOrContext");
  return {
    subject: buildFieldFromRule(context, "subject"),
    actionOrCondition: inferPoliticsAction(context, competitionOrContext),
    threshold: parseThreshold(context),
    deadlineOrSeason: parseDeadlineOrSeason(context),
    competitionOrContext
  };
};

const parseCrypto = (context: ParserContext): ParserOutput => {
  const threshold = parseThreshold(context);
  return {
    subject: buildFieldFromRule(context, "subject"),
    actionOrCondition: inferCryptoAction(context, threshold),
    threshold,
    deadlineOrSeason: parseDeadlineOrSeason(context),
    competitionOrContext: buildFieldFromRule(context, "competitionOrContext").normalized
      ? buildFieldFromRule(context, "competitionOrContext")
      : fallbackCompetitionField(context)
  };
};

const parseCompetitionCategory = (context: ParserContext): ParserOutput => {
  const competitionOrContext = buildFieldFromRule(context, "competitionOrContext");
  return {
    subject: buildFieldFromRule(context, "subject"),
    actionOrCondition: inferCompetitionAction(context, competitionOrContext),
    threshold: parseThreshold(context),
    deadlineOrSeason: parseDeadlineOrSeason(context),
    competitionOrContext
  };
};

const parseDiscoveryOnlyCategory = (context: ParserContext): ParserOutput => ({
  subject: buildFieldFromRule(context, "subject"),
  actionOrCondition: buildFieldFromRule(context, "actionOrCondition"),
  threshold: parseThreshold(context),
  deadlineOrSeason: parseDeadlineOrSeason(context),
  competitionOrContext: buildFieldFromRule(context, "competitionOrContext").normalized
    ? buildFieldFromRule(context, "competitionOrContext")
    : fallbackCompetitionField(context)
});

const parserRegistry: Readonly<Record<PropositionMatchCategory, (context: ParserContext) => ParserOutput>> = {
  POLITICS: parsePolitics,
  CRYPTO: parseCrypto,
  SPORTS: parseCompetitionCategory,
  ESPORTS: parseCompetitionCategory,
  CULTURE: parseDiscoveryOnlyCategory,
  TECH: parseDiscoveryOnlyCategory,
  WEATHER: parseDiscoveryOnlyCategory,
  OTHER: parseDiscoveryOnlyCategory
};

const parseOutcomeSchema = (input: ParseInput): StructuredProposition["outcomeSchema"] => {
  const yes = normalizeSemanticText(input.yesLabel ?? "");
  const no = normalizeSemanticText(input.noLabel ?? "");
  if ((yes === "yes" || yes.length === 0) && (no === "no" || no.length === 0)) {
    return {
      raw: `${input.yesLabel ?? ""}/${input.noLabel ?? ""}`.trim() || null,
      normalized: "YES_NO",
      confidence: "HIGH",
      ruleEvidence: ["outcome:YES_NO"]
    };
  }
  if ((yes === "up" && no === "down") || (yes === "down" && no === "up")) {
    return {
      raw: `${input.yesLabel ?? ""}/${input.noLabel ?? ""}`.trim() || null,
      normalized: "UP_DOWN",
      confidence: "HIGH",
      ruleEvidence: ["outcome:UP_DOWN"]
    };
  }
  return {
    raw: `${input.yesLabel ?? ""}/${input.noLabel ?? ""}`.trim() || null,
    normalized: "UNKNOWN",
    confidence: "LOW",
    ruleEvidence: []
  };
};

const parseResolutionSourceType = (context: ParserContext): StructuredProposition["resolutionSourceType"] => {
  const ruleMatch = buildFieldFromRule(context, "resolutionSourceType");
  if (ruleMatch.normalized === "binance") {
    return {
      raw: ruleMatch.raw,
      normalized: "MARKET_DATA_EXCHANGE",
      confidence: "HIGH",
      ruleEvidence: [...ruleMatch.ruleEvidence]
    };
  }
  if (ruleMatch.normalized !== null || context.sourceText.trim().length > 0) {
    return {
      raw: ruleMatch.raw ?? "rules",
      normalized: "CENTRAL_MARKET_RULES",
      confidence: ruleMatch.normalized ? "MEDIUM" : "LOW",
      ruleEvidence: [...ruleMatch.ruleEvidence]
    };
  }
  return {
    raw: null,
    normalized: "UNKNOWN",
    confidence: "NONE",
    ruleEvidence: []
  };
};

export const parseStructuredProposition = (input: ParseInput): StructuredProposition => {
  const sourceText = `${input.title} ${input.rules ?? ""}`.trim();
  const aliased = applySemanticRulepack(sourceText, input.category);
  const context: ParserContext = {
    category: input.category,
    sourceText,
    normalizedText: aliased.text,
    aliasesApplied: aliased.aliasesApplied,
    ruleEvidence: aliased.ruleEvidence,
    boundaryReferenceAt: input.boundaryReferenceAt ?? null
  };
  const parser = parserRegistry[input.category];
  const parsed = parser(context);

  return structuredPropositionSchema.parse({
    category: input.category,
    sourceText,
    ...parsed,
    outcomeSchema: parseOutcomeSchema(input),
    resolutionSourceType: parseResolutionSourceType(context),
    parserVersion: PARSER_VERSION
  });
};

const buildDimension = (
  dimension: PropositionMatchDimension,
  required: boolean,
  left: string | null,
  right: string | null,
  reasonCode: string
): PropositionDimensionResult => ({
  dimension,
  required,
  matched: required ? maybeEqual(left, right) : bothMissing(left, right) || maybeEqual(left, right),
  left,
  right,
  reasonCode
});

const requiredIfPresent = (left: PropositionField, right: PropositionField): boolean =>
  left.normalized !== null || right.normalized !== null;

const matchResolutionSource = (
  left: StructuredProposition["resolutionSourceType"],
  right: StructuredProposition["resolutionSourceType"]
): PropositionDimensionResult => ({
  dimension: "resolutionSourceCompatibility",
  required: false,
  matched:
    left.normalized === right.normalized
    || left.normalized === "UNKNOWN"
    || right.normalized === "UNKNOWN",
  left: left.normalized,
  right: right.normalized,
  reasonCode: "resolution_source_compatibility"
});

const matchOutcomeSchema = (
  left: StructuredProposition["outcomeSchema"],
  right: StructuredProposition["outcomeSchema"]
): PropositionDimensionResult => ({
  dimension: "outcomeSchemaCompatibility",
  required: true,
  matched: left.normalized === right.normalized && left.normalized !== "UNKNOWN",
  left: left.normalized,
  right: right.normalized,
  reasonCode: "outcome_schema_compatibility"
});

export const compareStructuredPropositions = (input: {
  seed: StructuredProposition;
  candidate: StructuredProposition;
  historyQualified: boolean;
  requireHistoricalQualification: boolean;
}): PropositionComparison => {
  const dimensionResults: PropositionDimensionResult[] = [
    buildDimension(
      "subjectEntityMatch",
      true,
      input.seed.subject.normalized,
      input.candidate.subject.normalized,
      "subject_entity_match"
    ),
    buildDimension(
      "conditionActionMatch",
      true,
      input.seed.actionOrCondition.normalized,
      input.candidate.actionOrCondition.normalized,
      "condition_action_match"
    ),
    buildDimension(
      "thresholdMatch",
      requiredIfPresent(input.seed.threshold, input.candidate.threshold),
      input.seed.threshold.normalized,
      input.candidate.threshold.normalized,
      "threshold_match"
    ),
    buildDimension(
      "timeBoundaryMatch",
      requiredIfPresent(input.seed.deadlineOrSeason, input.candidate.deadlineOrSeason),
      input.seed.deadlineOrSeason.normalized,
      input.candidate.deadlineOrSeason.normalized,
      "time_boundary_match"
    ),
    buildDimension(
      "competitionContextMatch",
      requiredIfPresent(input.seed.competitionOrContext, input.candidate.competitionOrContext),
      input.seed.competitionOrContext.normalized,
      input.candidate.competitionOrContext.normalized,
      "competition_context_match"
    ),
    matchResolutionSource(input.seed.resolutionSourceType, input.candidate.resolutionSourceType),
    matchOutcomeSchema(input.seed.outcomeSchema, input.candidate.outcomeSchema)
  ];

  const requiredDimensions = dimensionResults.filter((result) => result.required);
  const requiredMatched = requiredDimensions.filter((result) => result.matched).length;
  const exactDimensionsMatched = dimensionResults.filter((result) => result.matched).length;
  const failedDimensions = dimensionResults.filter((result) => !result.matched).map((result) => result.dimension);
  const requiredPerfect = requiredMatched === requiredDimensions.length;
  const exactCalendarDateMismatch =
    input.seed.deadlineOrSeason.normalized !== null
    && input.candidate.deadlineOrSeason.normalized !== null
    && /^\w+\s+\d{1,2}\s+20\d{2}$/.test(input.seed.deadlineOrSeason.normalized)
    && /^\w+\s+\d{1,2}\s+20\d{2}$/.test(input.candidate.deadlineOrSeason.normalized)
    && input.seed.deadlineOrSeason.normalized !== input.candidate.deadlineOrSeason.normalized;
  const strongOverlap = [
    dimensionResults.find((result) => result.dimension === "subjectEntityMatch")?.matched,
    dimensionResults.find((result) => result.dimension === "conditionActionMatch")?.matched,
    dimensionResults.find((result) => result.dimension === "competitionContextMatch")?.matched,
    dimensionResults.find((result) => result.dimension === "timeBoundaryMatch")?.matched
  ].filter(Boolean).length;

  let classification: PropositionMatchClassification;
  if (!exactCalendarDateMismatch && requiredPerfect && input.requireHistoricalQualification && input.historyQualified) {
    classification = "semantic_exact_historical_qualified";
  } else if (!exactCalendarDateMismatch && requiredPerfect) {
    classification = "semantic_exact_live_only";
  } else if (strongOverlap >= 2) {
    classification = "semantic_near_exact";
  } else {
    classification = "proxy_or_mismatch";
  }

  return propositionComparisonSchema.parse({
    classification,
    matchScore: exactDimensionsMatched,
    exactDimensionsMatched,
    requiredDimensionsMatched: requiredMatched,
    requiredDimensionCount: requiredDimensions.length,
    failedDimensions,
    primaryFailureReason: failedDimensions[0] ?? null,
    dimensionResults
  });
};

export const canLooseMatchCategoryText = (category: PropositionMatchCategory, text: string): boolean => {
  const normalized = applySemanticRulepack(text, category, ["subject", "actionOrCondition", "competitionOrContext", "deadlineOrSeason", "threshold"]).text;
  if (!normalized) {
    return false;
  }
  const ranked = rankSemanticCategories(normalized);
  if (ranked.some((entry) => entry.category === category)) {
    return true;
  }
  return normalized.includes(category.toLowerCase());
};
