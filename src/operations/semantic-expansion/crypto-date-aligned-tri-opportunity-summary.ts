import { inferCryptoCutoffStyle, type OpinionCryptoCutoffStyle } from "../../integrations/opinion/opinion-crypto-date-family-matrix.js";
import { classifyStructuredOpinionFamily } from "../../integrations/opinion/opinion-family-classifier.js";
import type { OpinionExactSeedAcquisitionSummary } from "./opinion-exact-seed-acquisition.js";
import type { PmLimitlessCryptoDateAlignedExpansionSummary } from "./pm-limitless-crypto-date-aligned-expansion.js";
import { readArtifact, writeArtifact } from "./shared.js";

type BlockerConclusion =
  | "date_misalignment_was_the_main_blocker_and_was_reduced_or_solved"
  | "date_cutoff_alignment_improved_but_still_no_safe_exact_overlap_exists"
  | "live_opinion_crypto_inventory_is_still_insufficient_even_after_date_aligned_expansion"
  | "tri_remains_blocked_by_real_upstream_inventory_scarcity_not_matching_or_routing";

interface RouteabilitySummary {
  routeModes: ReadonlyArray<{
    routeMode: string;
    routeableMarketCount: number;
  }>;
}

export interface CryptoDateAlignedTriOpportunitySummary {
  observedAt: string;
  metadataVersion: string;
  targetedBtcDates: readonly {
    family: string;
    exactDate: string;
    cutoffStyle: OpinionCryptoCutoffStyle;
    count: number;
  }[];
  anchors: readonly {
    seedReference: string;
    seedTitle: string;
    family: string;
    exactDate: string | null;
    cutoffStyle: OpinionCryptoCutoffStyle;
    exactCandidateCount: number;
    nearExactCandidateCount: number;
    familyMatchButWrongDateCount: number;
    familyMatchButWrongCutoffCount: number;
    outOfScopeFamilyCount: number;
    trueMismatchCount: number;
  }[];
  blockerConclusion: BlockerConclusion;
}

const METADATA_VERSION = "crypto-date-aligned-tri-opportunity-summary-v1";

const normalizeExactDate = (value: string | null): string | null =>
  value?.toLowerCase().replace(/\s+/g, " ").trim() ?? null;

const classifyCandidateTiming = (input: {
  seedTitle: string;
  seedFamily: string;
  seedAsset: string | null;
  seedExactDate: string | null;
  seedCutoffStyle: OpinionCryptoCutoffStyle;
  candidateTitle: string;
  candidateClassification: string;
  outOfFamily?: boolean;
}): "EXACT_CANDIDATE" | "NEAR_EXACT_CANDIDATE" | "FAMILY_MATCH_BUT_WRONG_DATE" | "FAMILY_MATCH_BUT_WRONG_CUTOFF" | "OUT_OF_SCOPE_FAMILY" | "TRUE_MISMATCH" => {
  if (input.outOfFamily) {
    return "OUT_OF_SCOPE_FAMILY";
  }
  if (input.candidateClassification === "semantic_exact_historical_qualified" || input.candidateClassification === "semantic_exact_live_only") {
    return "EXACT_CANDIDATE";
  }
  const candidate = classifyStructuredOpinionFamily({
    category: "CRYPTO",
    title: input.candidateTitle,
    rules: null
  });
  const candidateDate = normalizeExactDate(candidate.deadlineOrSeason);
  const candidateCutoff = inferCryptoCutoffStyle({
    title: input.candidateTitle,
    exactDate: candidate.deadlineOrSeason,
    timeBoundaryPattern: candidate.timeBoundaryPattern
  });
  if (input.seedAsset !== candidate.subject || input.seedFamily !== candidate.familyBucket) {
    return "TRUE_MISMATCH";
  }
  if (input.seedExactDate !== candidateDate) {
    return "FAMILY_MATCH_BUT_WRONG_DATE";
  }
  if (input.seedCutoffStyle !== candidateCutoff) {
    return "FAMILY_MATCH_BUT_WRONG_CUTOFF";
  }
  return "NEAR_EXACT_CANDIDATE";
};

const concludeBlocker = (input: {
  exactCount: number;
  nearExactCount: number;
  wrongDateCount: number;
  wrongCutoffCount: number;
  routeabilitySummary: RouteabilitySummary;
}): BlockerConclusion => {
  const triCount = input.routeabilitySummary.routeModes.find((row) => row.routeMode === "POLYMARKET_LIMITLESS_OPINION")?.routeableMarketCount ?? 0;
  const limitlessOpinionCount = input.routeabilitySummary.routeModes.find((row) => row.routeMode === "LIMITLESS_OPINION")?.routeableMarketCount ?? 0;
  if (triCount > 0 || limitlessOpinionCount > 0) {
    return "date_misalignment_was_the_main_blocker_and_was_reduced_or_solved";
  }
  if (input.exactCount > 0 || input.nearExactCount > 0 || input.wrongDateCount > 0 || input.wrongCutoffCount > 0) {
    return "date_cutoff_alignment_improved_but_still_no_safe_exact_overlap_exists";
  }
  return "live_opinion_crypto_inventory_is_still_insufficient_even_after_date_aligned_expansion";
};

export const buildCryptoDateAlignedTriOpportunitySummary = (input: {
  repoRoot: string;
  acquisitionSummaryPath?: string;
  expansionSummaryPath?: string;
  routeabilitySummaryPath?: string;
  outputPath?: string;
}): CryptoDateAlignedTriOpportunitySummary => {
  const acquisitionSummary = readArtifact<OpinionExactSeedAcquisitionSummary>(input.repoRoot, input.acquisitionSummaryPath ?? "docs/opinion-exact-seed-acquisition-summary.json");
  const expansionSummary = readArtifact<PmLimitlessCryptoDateAlignedExpansionSummary>(input.repoRoot, input.expansionSummaryPath ?? "docs/pm-limitless-crypto-date-aligned-expansion-summary.json");
  const routeabilitySummary = readArtifact<RouteabilitySummary>(input.repoRoot, input.routeabilitySummaryPath ?? "docs/simulation-routeability-summary.json");

  const baselineSeedDetails = new Map(expansionSummary.baselineSeeds.map((row) => [row.seedReference, row] as const));
  const addedSeedDetails = new Map(expansionSummary.addedSeeds.map((row) => [row.seedReference, row] as const));
  let exactCount = 0;
  let nearExactCount = 0;
  let wrongDateCount = 0;
  let wrongCutoffCount = 0;

  const anchors = acquisitionSummary.attempts.map((attempt) => {
    const seedDetails = addedSeedDetails.get(attempt.seedReference) ?? baselineSeedDetails.get(attempt.seedReference);
    let attemptExact = 0;
    let attemptNear = 0;
    let attemptWrongDate = 0;
    let attemptWrongCutoff = 0;
    let attemptOutOfScope = 0;
    let attemptMismatch = 0;

    for (const candidate of attempt.selectedCandidates) {
      const classification = classifyCandidateTiming({
        seedTitle: seedDetails?.title ?? attempt.seedReference,
        seedFamily: seedDetails?.family ?? "OTHER",
        seedAsset: seedDetails?.asset ?? null,
        seedExactDate: seedDetails?.exactDate ?? null,
        seedCutoffStyle: seedDetails?.cutoffStyle ?? "UNKNOWN",
        candidateTitle: candidate.title,
        candidateClassification: candidate.classification
      });
      if (classification === "EXACT_CANDIDATE") {
        exactCount += 1;
        attemptExact += 1;
      } else if (classification === "NEAR_EXACT_CANDIDATE") {
        nearExactCount += 1;
        attemptNear += 1;
      } else if (classification === "FAMILY_MATCH_BUT_WRONG_DATE") {
        wrongDateCount += 1;
        attemptWrongDate += 1;
      } else if (classification === "FAMILY_MATCH_BUT_WRONG_CUTOFF") {
        wrongCutoffCount += 1;
        attemptWrongCutoff += 1;
      } else if (classification === "OUT_OF_SCOPE_FAMILY") {
        attemptOutOfScope += 1;
      } else {
        attemptMismatch += 1;
      }
    }

    for (const candidate of attempt.rejectedCandidates) {
      const classification = classifyCandidateTiming({
        seedTitle: seedDetails?.title ?? attempt.seedReference,
        seedFamily: seedDetails?.family ?? "OTHER",
        seedAsset: seedDetails?.asset ?? null,
        seedExactDate: seedDetails?.exactDate ?? null,
        seedCutoffStyle: seedDetails?.cutoffStyle ?? "UNKNOWN",
        candidateTitle: candidate.title,
        candidateClassification: candidate.classification
      });
      if (classification === "FAMILY_MATCH_BUT_WRONG_DATE") {
        wrongDateCount += 1;
        attemptWrongDate += 1;
      } else if (classification === "FAMILY_MATCH_BUT_WRONG_CUTOFF") {
        wrongCutoffCount += 1;
        attemptWrongCutoff += 1;
      } else if (classification === "OUT_OF_SCOPE_FAMILY") {
        attemptOutOfScope += 1;
      } else {
        attemptMismatch += 1;
      }
    }

    attemptOutOfScope += attempt.outOfFamilyIgnoredCount;
    return {
      seedReference: attempt.seedReference,
      seedTitle: seedDetails?.title ?? attempt.seedReference,
      family: seedDetails?.family ?? attempt.familyTemplate,
      exactDate: seedDetails?.exactDate ?? null,
      cutoffStyle: seedDetails?.cutoffStyle ?? "UNKNOWN",
      exactCandidateCount: attemptExact,
      nearExactCandidateCount: attemptNear,
      familyMatchButWrongDateCount: attemptWrongDate,
      familyMatchButWrongCutoffCount: attemptWrongCutoff,
      outOfScopeFamilyCount: attemptOutOfScope,
      trueMismatchCount: attemptMismatch
    };
  });

  const summary: CryptoDateAlignedTriOpportunitySummary = {
    observedAt: new Date().toISOString(),
    metadataVersion: METADATA_VERSION,
    targetedBtcDates: expansionSummary.targetedBtcDates,
    anchors,
    blockerConclusion: concludeBlocker({
      exactCount,
      nearExactCount,
      wrongDateCount,
      wrongCutoffCount,
      routeabilitySummary
    })
  };

  writeArtifact(input.repoRoot, input.outputPath ?? "docs/crypto-date-aligned-tri-opportunity-summary.json", summary);
  return summary;
};
