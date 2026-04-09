import { readArtifact, writeArtifact } from "./shared.js";
import type { OpinionExactSeedAcquisitionSummary } from "./opinion-exact-seed-acquisition.js";
import type { OpinionConstrainedAnchorExpansionSummary } from "./pm-limitless-opinion-constrained-anchor-expansion.js";
import type { OpinionFamilyInventorySummary } from "../../integrations/opinion/opinion-family-inventory-map.js";

interface RouteabilitySummary {
  routeModes: ReadonlyArray<{
    routeMode: string;
    routeableMarketCount: number;
  }>;
}

type BlockerConclusion =
  | "live_opinion_inventory_too_sparse_in_relevant_families"
  | "pm_limitless_anchor_universe_was_previously_too_narrow_but_expansion_still_did_not_find_overlap"
  | "some_families_are_promising_but_still_lack_exact_safe_overlap"
  | "tri_is_blocked_by_real_3_way_inventory_scarcity_not_matching_or_routing";

export interface OpinionConstrainedTriOpportunitySummary {
  observedAt: string;
  metadataVersion: string;
  familyCoverage: OpinionFamilyInventorySummary["families"];
  addedAnchorCount: number;
  familiesWithCandidates: readonly {
    familyBucket: string;
    exactCandidateCount: number;
    nearExactCandidateCount: number;
    familyMatchButNotExactCount: number;
    outOfScopeFamilyCount: number;
  }[];
  blockerByAnchor: readonly {
    seedReference: string;
    familyTemplate: string;
    exactCandidateCount: number;
    nearExactCandidateCount: number;
    familyMatchButNotExactCount: number;
    outOfScopeFamilyCount: number;
  }[];
  blockerConclusion: BlockerConclusion;
}

const METADATA_VERSION = "opinion-constrained-tri-opportunity-summary-v1";

const concludeBlocker = (input: {
  addedAnchorCount: number;
  exactCandidateCount: number;
  nearExactCount: number;
  familyMatchButNotExactCount: number;
  routeabilitySummary: RouteabilitySummary;
}): BlockerConclusion => {
  const triCount = input.routeabilitySummary.routeModes.find((row) => row.routeMode === "POLYMARKET_LIMITLESS_OPINION")?.routeableMarketCount ?? 0;
  if (triCount > 0) {
    return "some_families_are_promising_but_still_lack_exact_safe_overlap";
  }
  if (input.exactCandidateCount > 0 || input.nearExactCount > 0 || input.familyMatchButNotExactCount > 0) {
    return "some_families_are_promising_but_still_lack_exact_safe_overlap";
  }
  if (input.addedAnchorCount > 0) {
    return "pm_limitless_anchor_universe_was_previously_too_narrow_but_expansion_still_did_not_find_overlap";
  }
  if (input.routeabilitySummary.routeModes.find((row) => row.routeMode === "LIMITLESS_OPINION")?.routeableMarketCount ?? 0) {
    return "some_families_are_promising_but_still_lack_exact_safe_overlap";
  }
  return "live_opinion_inventory_too_sparse_in_relevant_families";
};

export const buildOpinionConstrainedTriOpportunitySummary = (input: {
  repoRoot: string;
  familySummaryPath?: string;
  expansionSummaryPath?: string;
  acquisitionSummaryPath?: string;
  routeabilitySummaryPath?: string;
  outputPath?: string;
}): OpinionConstrainedTriOpportunitySummary => {
  const familySummary = readArtifact<OpinionFamilyInventorySummary>(input.repoRoot, input.familySummaryPath ?? "docs/opinion-family-inventory-summary.json");
  const expansionSummary = readArtifact<OpinionConstrainedAnchorExpansionSummary>(input.repoRoot, input.expansionSummaryPath ?? "docs/opinion-constrained-anchor-expansion-summary.json");
  const acquisitionSummary = readArtifact<OpinionExactSeedAcquisitionSummary>(input.repoRoot, input.acquisitionSummaryPath ?? "docs/opinion-exact-seed-acquisition-summary.json");
  const routeabilitySummary = readArtifact<RouteabilitySummary>(input.repoRoot, input.routeabilitySummaryPath ?? "docs/simulation-routeability-summary.json");

  const countsByFamily = new Map<string, {
    familyBucket: string;
    exactCandidateCount: number;
    nearExactCandidateCount: number;
    familyMatchButNotExactCount: number;
    outOfScopeFamilyCount: number;
  }>();
  const blockerByAnchor = acquisitionSummary.attempts.map((attempt) => {
    const exactCandidateCount = attempt.selectedCandidates.filter((row) =>
      row.classification === "semantic_exact_historical_qualified" || row.classification === "semantic_exact_live_only"
    ).length;
    const nearExactCandidateCount = attempt.selectedCandidates.filter((row) => row.classification === "semantic_near_exact").length;
    const familyMatchButNotExactCount = attempt.rejectedCandidates.length;
    const outOfScopeFamilyCount = attempt.outOfFamilyIgnoredCount;
    const familyBucket = attempt.familyTemplate;
    const familyCount = countsByFamily.get(familyBucket) ?? {
      familyBucket,
      exactCandidateCount: 0,
      nearExactCandidateCount: 0,
      familyMatchButNotExactCount: 0,
      outOfScopeFamilyCount: 0
    };
    familyCount.exactCandidateCount += exactCandidateCount;
    familyCount.nearExactCandidateCount += nearExactCandidateCount;
    familyCount.familyMatchButNotExactCount += familyMatchButNotExactCount;
    familyCount.outOfScopeFamilyCount += outOfScopeFamilyCount;
    countsByFamily.set(familyBucket, familyCount);
    return {
      seedReference: attempt.seedReference,
      familyTemplate: familyBucket,
      exactCandidateCount,
      nearExactCandidateCount,
      familyMatchButNotExactCount,
      outOfScopeFamilyCount
    };
  });

  const summary: OpinionConstrainedTriOpportunitySummary = {
    observedAt: new Date().toISOString(),
    metadataVersion: METADATA_VERSION,
    familyCoverage: familySummary.families,
    addedAnchorCount: expansionSummary.addedSeedCount,
    familiesWithCandidates: [...countsByFamily.values()].sort((left, right) => left.familyBucket.localeCompare(right.familyBucket)),
    blockerByAnchor,
    blockerConclusion: concludeBlocker({
      addedAnchorCount: expansionSummary.addedSeedCount,
      exactCandidateCount: acquisitionSummary.exactCandidateCount,
      nearExactCount: acquisitionSummary.nearExactCandidateCount,
      familyMatchButNotExactCount: acquisitionSummary.rejectedCandidateCount,
      routeabilitySummary
    })
  };

  writeArtifact(input.repoRoot, input.outputPath ?? "docs/opinion-constrained-tri-opportunity-summary.json", summary);
  return summary;
};
