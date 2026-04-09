import type { Pool } from "pg";

import {
  compareStructuredPropositions,
  parseStructuredProposition,
  type PropositionMatchDimension,
  type StructuredProposition
} from "../../simulation/proposition-matching.js";
import { loadPmLimitlessRouteableAnchorSeeds } from "./pm-limitless-anchor-seeds.js";
import { readArtifact, writeArtifact } from "./shared.js";
import type { OpinionExactSeedAcquisitionSummary } from "./opinion-exact-seed-acquisition.js";
import { toSupportedSemanticCategory } from "./exact-seed-shared.js";

type InScopeCategory = "CRYPTO" | "SPORTS" | "ESPORTS";
type RootCauseClass = "normalization_gap" | "true_inventory_mismatch" | "ambiguous_needs_manual_review";
type BlockerConclusion =
  | "true_lack_of_safe_opinion_overlap_on_limitless_edge"
  | "unresolved_limitless_opinion_normalization_gap"
  | "exactness_policy_correctly_blocking_unsafe_promotion"
  | "downstream_tri_assembly_issue"
  | "category_coverage_imbalance"
  | "other_evidenced_blocker";

interface CandidateSummaryRow {
  marketId: string;
  title: string;
  classification: string;
  matchScore: number;
  failedDimensions: readonly string[];
  exactDateStatus: string;
}

interface RouteabilitySummary {
  routeModes: ReadonlyArray<{
    routeMode: string;
    routeableMarketCount: number;
  }>;
}

export interface LimitlessOpinionEdgeDecomposition {
  observedAt: string;
  metadataVersion: string;
  sourceSummaryPath: string;
  analyzedSeedCount: number;
  analyzedCandidateCount: number;
  counts: {
    byCategory: Record<InScopeCategory, number>;
    byFailureDimension: Record<string, number>;
    byRootCauseClass: Record<RootCauseClass, number>;
    byAnchorSeed: Record<string, number>;
  };
  candidates: ReadonlyArray<{
    anchorSeedReference: string;
    category: InScopeCategory;
    candidateMarketId: string;
    title: string;
    classification: string;
    matchScore: number;
    failedDimensions: readonly PropositionMatchDimension[];
    rootCauseClass: RootCauseClass;
    rationale: string;
  }>;
  blockerConclusion: BlockerConclusion;
}

const METADATA_VERSION = "limitless-opinion-edge-decomposition-v1";
const SOURCE_SUMMARY_PATH = "docs/opinion-pm-limitless-anchor-expansion-summary.json";
const OUTPUT_PATH = "docs/limitless-opinion-edge-decomposition.json";

const MATCHUP_COMPETITION_PATTERN = /\b(nba|nhl|lck|lcs|lec|esl|fst|kpl|dota2|lol)\b/i;
const CHAMPIONSHIP_CONTEXT_PATTERN = /\b(finals|championship|stanley cup|title|playoffs?)\b/i;
const inferCryptoAssetFromText = (text: string): string | null => {
  const normalized = text.toLowerCase();
  if (/\b(bitcoin|btc)\b/.test(normalized)) {
    return "bitcoin";
  }
  if (/\b(bnb)\b/.test(normalized)) {
    return "bnb";
  }
  if (/\b(hyperliquid|hype)\b/.test(normalized)) {
    return "hyperliquid";
  }
  if (/\b(ethereum|eth)\b/.test(normalized)) {
    return "ethereum";
  }
  return null;
};

const isAthFamily = (parsed: StructuredProposition): boolean =>
  parsed.threshold.normalized === "all time high" || parsed.actionOrCondition.normalized === "reach all time high";

const isUpDownFamily = (parsed: StructuredProposition): boolean =>
  parsed.actionOrCondition.normalized === "up or down" || parsed.outcomeSchema.normalized === "UP_DOWN";

const hasTitleDateOnlyDrift = (
  failedDimensions: readonly PropositionMatchDimension[]
): boolean => failedDimensions.every((dimension) =>
  dimension === "timeBoundaryMatch"
  || dimension === "thresholdMatch"
  || dimension === "conditionActionMatch"
  || dimension === "resolutionSourceCompatibility"
);

const classifyCryptoRootCause = (input: {
  seed: StructuredProposition;
  candidate: StructuredProposition;
  failedDimensions: readonly PropositionMatchDimension[];
  candidateTitle: string;
}): { rootCauseClass: RootCauseClass; rationale: string } => {
  const normalizedSeedAsset = input.seed.subject.normalized ?? inferCryptoAssetFromText(input.seed.sourceText);
  const normalizedCandidateAsset = input.candidate.subject.normalized ?? inferCryptoAssetFromText(input.candidateTitle);
  if (
    normalizedSeedAsset
    && normalizedCandidateAsset
    && normalizedSeedAsset !== normalizedCandidateAsset
  ) {
    return {
      rootCauseClass: "true_inventory_mismatch",
      rationale: "different_crypto_asset"
    };
  }

  if (isAthFamily(input.seed) && isUpDownFamily(input.candidate)) {
    return {
      rootCauseClass: "true_inventory_mismatch",
      rationale: "all_time_high_vs_up_down_contract_family"
    };
  }

  if (isAthFamily(input.seed) && isAthFamily(input.candidate) && hasTitleDateOnlyDrift(input.failedDimensions)) {
    return {
      rootCauseClass: "normalization_gap",
      rationale: "same_asset_ath_deadline_or_wording_drift"
    };
  }

  if (
    input.seed.subject.normalized === input.candidate.subject.normalized
    && input.seed.actionOrCondition.normalized === input.candidate.actionOrCondition.normalized
    && hasTitleDateOnlyDrift(input.failedDimensions)
  ) {
    return {
      rootCauseClass: "normalization_gap",
      rationale: "same_asset_same_action_cutoff_interpretation_gap"
    };
  }

  return {
    rootCauseClass: "ambiguous_needs_manual_review",
    rationale: "crypto_failure_pattern_not_confidently_classified"
  };
};

const classifyCompetitionRootCause = (input: {
  seed: StructuredProposition;
  candidate: StructuredProposition;
  failedDimensions: readonly PropositionMatchDimension[];
  title: string;
}): { rootCauseClass: RootCauseClass; rationale: string } => {
  if (
    input.seed.actionOrCondition.normalized === "win championship"
    && input.candidate.actionOrCondition.normalized === "win match"
  ) {
    return {
      rootCauseClass: "true_inventory_mismatch",
      rationale: "championship_vs_match_winner_contract_family"
    };
  }

  if (
    input.seed.subject.normalized
    && input.candidate.subject.normalized
    && input.seed.subject.normalized !== input.candidate.subject.normalized
  ) {
    return {
      rootCauseClass: "true_inventory_mismatch",
      rationale: "different_team_or_competitor_identity"
    };
  }

  if (
    input.seed.competitionOrContext.normalized
    && input.candidate.competitionOrContext.normalized
    && input.seed.competitionOrContext.normalized !== input.candidate.competitionOrContext.normalized
  ) {
    return {
      rootCauseClass: "true_inventory_mismatch",
      rationale: "different_tournament_or_competition_context"
    };
  }

  if (
    MATCHUP_COMPETITION_PATTERN.test(input.title)
    && CHAMPIONSHIP_CONTEXT_PATTERN.test(input.seed.sourceText)
  ) {
    return {
      rootCauseClass: "true_inventory_mismatch",
      rationale: "matchup_title_against_championship_seed"
    };
  }

  if (hasTitleDateOnlyDrift(input.failedDimensions)) {
    return {
      rootCauseClass: "normalization_gap",
      rationale: "same_competition_winner_alias_or_cutoff_drift"
    };
  }

  return {
    rootCauseClass: "ambiguous_needs_manual_review",
    rationale: "competition_failure_pattern_not_confidently_classified"
  };
};

export const classifyLimitlessOpinionRootCause = (input: {
  category: InScopeCategory;
  seed: StructuredProposition;
  candidate: StructuredProposition;
  failedDimensions: readonly PropositionMatchDimension[];
  candidateTitle: string;
}): { rootCauseClass: RootCauseClass; rationale: string } => {
  switch (input.category) {
    case "CRYPTO":
      return classifyCryptoRootCause({
        seed: input.seed,
        candidate: input.candidate,
        failedDimensions: input.failedDimensions,
        candidateTitle: input.candidateTitle
      });
    case "SPORTS":
    case "ESPORTS":
      return classifyCompetitionRootCause({
        seed: input.seed,
        candidate: input.candidate,
        failedDimensions: input.failedDimensions,
        title: input.candidateTitle
      });
  }
};

const concludeBlocker = (input: {
  countsByRootCauseClass: Record<RootCauseClass, number>;
  exactCandidateCount: number;
  routeabilitySummary?: RouteabilitySummary;
}): BlockerConclusion => {
  const triCount = input.routeabilitySummary?.routeModes.find((mode) => mode.routeMode === "POLYMARKET_LIMITLESS_OPINION")?.routeableMarketCount ?? 0;
  const limitlessOpinionCount = input.routeabilitySummary?.routeModes.find((mode) => mode.routeMode === "LIMITLESS_OPINION")?.routeableMarketCount ?? 0;

  if (triCount > 0) {
    return "other_evidenced_blocker";
  }
  if (limitlessOpinionCount > 0 && triCount === 0) {
    return "downstream_tri_assembly_issue";
  }
  if (input.exactCandidateCount > 0 && limitlessOpinionCount === 0) {
    return "exactness_policy_correctly_blocking_unsafe_promotion";
  }
  if (input.countsByRootCauseClass.normalization_gap > 0 && input.countsByRootCauseClass.true_inventory_mismatch === 0) {
    return "unresolved_limitless_opinion_normalization_gap";
  }
  if (input.countsByRootCauseClass.true_inventory_mismatch > 0) {
    return "true_lack_of_safe_opinion_overlap_on_limitless_edge";
  }
  return "category_coverage_imbalance";
};

export const buildLimitlessOpinionEdgeDecomposition = async (input: {
  repoRoot: string;
  pool: Pool;
  summaryPath?: string;
  outputPath?: string;
}): Promise<LimitlessOpinionEdgeDecomposition> => {
  const summary = readArtifact<OpinionExactSeedAcquisitionSummary>(input.repoRoot, input.summaryPath ?? SOURCE_SUMMARY_PATH);
  const routeabilitySummary = readArtifact<RouteabilitySummary>(input.repoRoot, "docs/simulation-routeability-summary.json");
  const seeds = await loadPmLimitlessRouteableAnchorSeeds({
    pool: input.pool,
    categories: ["CRYPTO", "SPORTS", "ESPORTS"]
  });
  const seedsByReference = new Map(seeds.map((seed) => [seed.seedReference, seed] as const));

  const countsByCategory: Record<InScopeCategory, number> = {
    CRYPTO: 0,
    SPORTS: 0,
    ESPORTS: 0
  };
  const countsByFailureDimension: Record<string, number> = {};
  const countsByRootCauseClass: Record<RootCauseClass, number> = {
    normalization_gap: 0,
    true_inventory_mismatch: 0,
    ambiguous_needs_manual_review: 0
  };
  const countsByAnchorSeed: Record<string, number> = {};

  const candidates = summary.attempts.flatMap((attempt) => {
    const seed = seedsByReference.get(attempt.seedReference);
    if (!seed) {
      return [];
    }
    const category = attempt.category as InScopeCategory;
    const semanticCategory = toSupportedSemanticCategory(seed.canonicalCategory);
    const parsedSeed = parseStructuredProposition({
      category: semanticCategory,
      title: seed.title,
      rules: seed.sourceText,
      boundaryReferenceAt: seed.boundaryReferenceAt ? new Date(seed.boundaryReferenceAt) : null
    });

    const allCandidates = [
      ...attempt.selectedCandidates,
      ...attempt.rejectedCandidates
    ] satisfies readonly CandidateSummaryRow[];

    return allCandidates.map((candidate) => {
      const parsedCandidate = parseStructuredProposition({
        category: semanticCategory,
        title: candidate.title,
        rules: null
      });
      const recomputed = compareStructuredPropositions({
        seed: parsedSeed,
        candidate: parsedCandidate,
        historyQualified: false,
        requireHistoricalQualification: false
      });
      const failedDimensions = (candidate.failedDimensions.length > 0
        ? candidate.failedDimensions
        : recomputed.failedDimensions) as PropositionMatchDimension[];
      const rootCause = classifyLimitlessOpinionRootCause({
        category,
        seed: parsedSeed,
        candidate: parsedCandidate,
        failedDimensions,
        candidateTitle: candidate.title
      });

      countsByCategory[category] += 1;
      countsByRootCauseClass[rootCause.rootCauseClass] += 1;
      countsByAnchorSeed[attempt.seedReference] = (countsByAnchorSeed[attempt.seedReference] ?? 0) + 1;
      for (const dimension of failedDimensions) {
        countsByFailureDimension[dimension] = (countsByFailureDimension[dimension] ?? 0) + 1;
      }

      return {
        anchorSeedReference: attempt.seedReference,
        category,
        candidateMarketId: candidate.marketId,
        title: candidate.title,
        classification: candidate.classification,
        matchScore: candidate.matchScore,
        failedDimensions,
        rootCauseClass: rootCause.rootCauseClass,
        rationale: rootCause.rationale
      };
    });
  });

  const artifact: LimitlessOpinionEdgeDecomposition = {
    observedAt: new Date().toISOString(),
    metadataVersion: METADATA_VERSION,
    sourceSummaryPath: input.summaryPath ?? SOURCE_SUMMARY_PATH,
    analyzedSeedCount: summary.attempts.length,
    analyzedCandidateCount: candidates.length,
    counts: {
      byCategory: countsByCategory,
      byFailureDimension: Object.fromEntries(Object.entries(countsByFailureDimension).sort(([left], [right]) => left.localeCompare(right))),
      byRootCauseClass: countsByRootCauseClass,
      byAnchorSeed: Object.fromEntries(Object.entries(countsByAnchorSeed).sort(([left], [right]) => left.localeCompare(right)))
    },
    candidates,
    blockerConclusion: concludeBlocker({
      countsByRootCauseClass,
      exactCandidateCount: summary.exactCandidateCount,
      routeabilitySummary
    })
  };

  writeArtifact(input.repoRoot, input.outputPath ?? OUTPUT_PATH, artifact);
  return artifact;
};
