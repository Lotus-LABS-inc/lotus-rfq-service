import { writeFileSync } from "node:fs";
import path from "node:path";

import { normalizeFreeText } from "../../canonical/canonicalization-types.js";
import type { PropositionMatchDimension } from "../../simulation/proposition-matching.js";
import type { SemanticRule } from "../../simulation/semantic-rulepack.js";
import {
  mergeRuleSuggestions,
  readArtifact,
  type CrossVenueMatchReport,
  type SemanticSuggestion,
  type SemanticSuggestionReport
} from "./shared.js";

const SUGGESTION_DIMENSION_TO_FIELD: Record<
  PropositionMatchDimension,
  SemanticSuggestion["targetField"]
> = {
  subjectEntityMatch: "subject",
  conditionActionMatch: "actionOrCondition",
  thresholdMatch: "threshold",
  timeBoundaryMatch: "deadlineOrSeason",
  competitionContextMatch: "competitionOrContext",
  resolutionSourceCompatibility: "resolutionSourceType",
  outcomeSchemaCompatibility: "actionOrCondition"
};
const PRIORITIZED_DIMENSIONS: readonly PropositionMatchDimension[] = [
  "thresholdMatch",
  "conditionActionMatch",
  "timeBoundaryMatch",
  "resolutionSourceCompatibility"
] as const;

interface SuggestionAccumulator {
  category: SemanticSuggestion["category"];
  targetField: SemanticSuggestion["targetField"];
  canonical: string;
  variants: Set<string>;
  evidence: Set<string>;
}

export interface SemanticSuggestionGenerationResult {
  report: SemanticSuggestionReport;
  generatedRules: readonly SemanticRule[];
  generatedRulepackPath: string | null;
}

const extractNormalizedValue = (
  provenance: Record<string, unknown>,
  side: "seed" | "candidate",
  field: "subject" | "actionOrCondition" | "threshold" | "deadlineOrSeason" | "competitionOrContext" | "resolutionSourceType"
): string | null => {
  if (field === "resolutionSourceType") {
    const outcomeSemantics = provenance["outcomeSemantics"] as Record<string, unknown> | undefined;
    const key = side === "seed" ? "seedResolutionSourceType" : "candidateResolutionSourceType";
    const value = outcomeSemantics?.[key] as Record<string, unknown> | undefined;
    return typeof value?.["normalized"] === "string" ? value["normalized"] : null;
  }

  const normalizedElements = provenance["normalizedPropositionElements"] as Record<string, unknown> | undefined;
  const value = normalizedElements?.[field] as Record<string, unknown> | undefined;
  const sideValue = value?.[side] as Record<string, unknown> | undefined;
  return typeof sideValue?.["normalized"] === "string" ? sideValue["normalized"] : null;
};

const extractFailedDimensions = (
  match: CrossVenueMatchReport["matches"][number]
): readonly PropositionMatchDimension[] => {
  const validation = match.semanticValidation as Record<string, unknown>;
  return Array.isArray(validation["failedDimensions"])
    ? (validation["failedDimensions"] as PropositionMatchDimension[])
    : [];
};

const hasSharedNumericYear = (left: string, right: string): boolean => {
  const leftYear = left.match(/\b20\d{2}\b/)?.[0] ?? null;
  const rightYear = right.match(/\b20\d{2}\b/)?.[0] ?? null;
  if (leftYear === null || rightYear === null) {
    return true;
  }
  return leftYear === rightYear;
};

const hasMeaningfulTokenOverlap = (left: string, right: string): boolean => {
  const leftTokens = new Set(left.split(/\s+/).filter((token) => token.length >= 4));
  const rightTokens = right.split(/\s+/).filter((token) => token.length >= 4);
  return rightTokens.some((token) => leftTokens.has(token));
};

const isAliasLikeSubjectPair = (canonical: string, variant: string): boolean => {
  const canonicalTokens = canonical.split(/\s+/).filter((token) => token.length > 0);
  const variantTokens = variant.split(/\s+/).filter((token) => token.length > 0);
  const canonicalInitialism = canonicalTokens.map((token) => token[0]).join("");
  const variantInitialism = variantTokens.map((token) => token[0]).join("");
  const abbreviatedCanonicalForms = new Set<string>([
    canonicalInitialism,
    `${canonicalTokens[0]?.slice(0, 2) ?? ""}${canonicalTokens[1]?.[0] ?? ""}`,
    `${canonicalTokens[0]?.slice(0, 2) ?? ""}${canonicalTokens[1]?.[0] ?? ""}${canonicalTokens[2]?.[0] ?? ""}`,
    `${canonicalTokens[0]?.[0] ?? ""}${canonicalTokens[1]?.[0] ?? ""}`,
    `${canonicalTokens[0]?.[0] ?? ""}${canonicalTokens[1]?.[0] ?? ""}${canonicalTokens[2]?.[0] ?? ""}`
  ]);

  return canonical.includes(variant)
    || variant.includes(canonical)
    || abbreviatedCanonicalForms.has(variant.replace(/\s+/g, ""))
    || canonicalInitialism === variant.replace(/\s+/g, "")
    || variantInitialism === canonical.replace(/\s+/g, "");
};

const isSafeSuggestionCandidate = (
  match: CrossVenueMatchReport["matches"][number],
  targetField: SemanticSuggestion["targetField"],
  canonical: string,
  variant: string
): boolean => {
  const failedDimensions = extractFailedDimensions(match);
  if (failedDimensions.length !== 1) {
    return false;
  }

  if (targetField === "resolutionSourceType") {
    return false;
  }

  if (targetField === "subject") {
    return failedDimensions[0] === "subjectEntityMatch" && isAliasLikeSubjectPair(canonical, variant);
  }

  if (targetField === "deadlineOrSeason") {
    return failedDimensions[0] === "timeBoundaryMatch" && hasSharedNumericYear(canonical, variant);
  }

  if (targetField === "competitionOrContext") {
    return failedDimensions[0] === "competitionContextMatch"
      && (canonical.includes(variant) || variant.includes(canonical) || hasMeaningfulTokenOverlap(canonical, variant));
  }

  if (targetField === "actionOrCondition") {
    return failedDimensions[0] === "conditionActionMatch"
      && (canonical.includes(variant) || variant.includes(canonical) || hasMeaningfulTokenOverlap(canonical, variant));
  }

  if (targetField === "threshold") {
    return failedDimensions[0] === "thresholdMatch"
      && (canonical.includes(variant) || variant.includes(canonical) || hasMeaningfulTokenOverlap(canonical, variant));
  }

  return false;
};

const extractSuggestionEvidence = (match: CrossVenueMatchReport["matches"][number]) => {
  const failed = extractFailedDimensions(match);
  return failed
    .map((dimension) => {
      const targetField = SUGGESTION_DIMENSION_TO_FIELD[dimension];
      const provenance = match.semanticProvenance as Record<string, unknown>;
      const left = extractNormalizedValue(provenance, "seed", targetField);
      const right = extractNormalizedValue(provenance, "candidate", targetField);
      if (!left || !right || left === right || !isSafeSuggestionCandidate(match, targetField, left, right)) {
        return null;
      }
      return {
        category: match.category,
        targetField,
        canonical: left,
        variant: right,
        evidence: `${match.seed.venue}:${match.seed.venueMarketId}<->${match.candidate.venue}:${match.candidate.venueMarketId}:${dimension}`
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
};

const buildSuggestionList = (report: CrossVenueMatchReport): readonly SemanticSuggestion[] => {
  const accumulators = new Map<string, SuggestionAccumulator>();

  for (const match of report.matches) {
    if (match.matchClass !== "semantic_near_exact") {
      continue;
    }
    const failedDimensions = extractFailedDimensions(match);
    if (!failedDimensions.some((dimension) => PRIORITIZED_DIMENSIONS.includes(dimension))) {
      continue;
    }
    for (const evidence of extractSuggestionEvidence(match)) {
      const variant = normalizeFreeText(evidence.variant);
      const canonical = normalizeFreeText(evidence.canonical);
      if (!canonical || !variant || canonical === variant) {
        continue;
      }
      const key = `${evidence.category}|${evidence.targetField}|${canonical}`;
      const accumulator = accumulators.get(key) ?? {
        category: evidence.category,
        targetField: evidence.targetField,
        canonical,
        variants: new Set<string>(),
        evidence: new Set<string>()
      };
      accumulator.variants.add(variant);
      accumulator.evidence.add(evidence.evidence);
      accumulators.set(key, accumulator);
    }
  }

  return [...accumulators.values()]
    .filter((entry) => entry.variants.size > 0 && entry.evidence.size >= 2)
    .map((entry) => ({
      suggestionId: `${entry.category}:${entry.targetField}:${entry.canonical}`,
      category: entry.category,
      targetField: entry.targetField,
      canonical: entry.canonical,
      variants: [...entry.variants].sort((left, right) => left.localeCompare(right)),
      evidenceCount: entry.evidence.size,
      evidence: [...entry.evidence].sort((left, right) => left.localeCompare(right))
    }))
    .sort((left, right) =>
      right.evidenceCount - left.evidenceCount
      || left.category.localeCompare(right.category)
      || left.targetField.localeCompare(right.targetField)
      || left.canonical.localeCompare(right.canonical)
    );
};

const buildMismatchFamilies = (report: CrossVenueMatchReport): SemanticSuggestionReport["mismatchFamilies"] => {
  const counts = new Map<string, { category: SemanticSuggestion["category"]; failedDimension: string; count: number }>();
  for (const match of report.matches) {
    if (match.matchClass !== "semantic_near_exact") {
      continue;
    }
    for (const failedDimension of extractFailedDimensions(match)) {
      if (!PRIORITIZED_DIMENSIONS.includes(failedDimension)) {
        continue;
      }
      const key = `${match.category}:${failedDimension}`;
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, {
          category: match.category,
          failedDimension,
          count: 1
        });
      }
    }
  }

  return [...counts.values()]
    .filter((entry) => entry.count >= 2)
    .sort((left, right) =>
      right.count - left.count
      || left.category.localeCompare(right.category)
      || left.failedDimension.localeCompare(right.failedDimension)
    );
};

const renderGeneratedRulepack = (rules: readonly SemanticRule[]): string => {
  const formattedRules = rules
    .map((rule) => `  {
    canonical: ${JSON.stringify(rule.canonical)},
    variants: ${JSON.stringify([...rule.variants])},
    categories: ${JSON.stringify([...rule.categories])},
    targetField: ${JSON.stringify(rule.targetField)},
    precedence: ${rule.precedence ?? 35},
    exactnessRequired: ${rule.exactnessRequired ?? false}
  }`)
    .join(",\n");

  return `import type { SemanticRule } from "./semantic-rulepack.js";

export const semanticGeneratedRulepack: readonly SemanticRule[] = [
${formattedRules}
];
`;
};

export const buildSemanticRulepackSuggestions = (input: {
  repoRoot: string;
  reportPath?: string;
  apply?: boolean;
}): SemanticSuggestionGenerationResult => {
  const reportPath = input.reportPath ?? "docs/cross-venue-match-report.json";
  const report = readArtifact<CrossVenueMatchReport>(input.repoRoot, reportPath);
  const suggestions = buildSuggestionList(report);
  const suggestionReport: SemanticSuggestionReport = {
    observedAt: new Date().toISOString(),
    sourceMatchReportPath: reportPath,
    mismatchFamilies: buildMismatchFamilies(report),
    suggestions
  };
  const generatedRules = mergeRuleSuggestions(suggestions);

  let generatedRulepackPath: string | null = null;
  if (input.apply) {
    generatedRulepackPath = path.resolve(
      input.repoRoot,
      "src/simulation/semantic-rulepack.generated.ts"
    );
    writeFileSync(generatedRulepackPath, renderGeneratedRulepack(generatedRules), "utf8");
  }

  return {
    report: suggestionReport,
    generatedRules,
    generatedRulepackPath
  };
};
