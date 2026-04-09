import type { Pool } from "pg";

import type { CompatibilityClass } from "../../canonical/canonicalization-types.js";
import { buildStableTextId } from "../../canonical/canonicalization-types.js";
import { summarizeSemanticsRulepackMetrics } from "../../canonical/semantics-rulepack-metrics.js";
import type { SemanticsRulepackValidation } from "../../canonical/semantics-rulepack-validator.js";
import {
  buildSemanticsRulepackProvenance,
  DEFAULT_SEMANTICS_RULEPACK_VERSION
} from "../../canonical/semantics-rulepack-versioning.js";
import type { SemanticsRulepackProvenance } from "../../canonical/semantics-rulepack-versioning.js";
import { validateSemanticsRulepackCandidate } from "../../canonical/semantics-rulepack-validator.js";
import {
  canLooseMatchCategoryText,
  compareStructuredPropositions,
  parseStructuredProposition,
  type PropositionComparison
} from "../../simulation/proposition-matching.js";
import {
  buildInventoryPairKey,
  buildMatchRef,
  buildStablePromotionIds,
  getCompatibilityForPair,
  loadCompatibilityLookup,
  loadSemanticExpansionInventory,
  summarizeInventory,
  type CrossVenueMatchClass,
  type CrossVenueMatchReport,
  type CrossVenueReportMatchEntry,
  type SemanticExpansionInventoryRow,
  type SemanticPromotionCandidate
} from "./shared.js";

interface CrossVenueMatchReportOptions {
  afterRulepackRefresh?: boolean;
  semanticsRulepackVersion?: string;
}

interface RawPairResult {
  left: SemanticExpansionInventoryRow;
  right: SemanticExpansionInventoryRow;
  comparison: PropositionComparison;
  exactBucketKey: string;
  compatibilityDecisionClass: CompatibilityClass | null;
}

const parseBoundaryReferenceAt = (value: string | null): Date | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toBaseConfidence = (left: SemanticExpansionInventoryRow, right: SemanticExpansionInventoryRow): number => {
  const values = [left.confidenceScore, right.confidenceScore].filter(
    (value): value is number => value !== null
  );
  if (values.length === 0) {
    return left.historicalRowCount > 0 && right.historicalRowCount > 0 ? 0.62 : 0.48;
  }
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Number(Math.max(0, Math.min(1, average)).toFixed(6));
};

const buildRawPairResult = (
  left: SemanticExpansionInventoryRow,
  right: SemanticExpansionInventoryRow,
  compatibilityDecisionClass: CompatibilityClass | null
): RawPairResult => {
  const leftText = `${left.title} ${left.rules ?? ""}`.trim();
  const rightText = `${right.title} ${right.rules ?? ""}`.trim();
  const seed = parseStructuredProposition({
    category: left.semanticCategory,
    title: left.title,
    rules: left.rules,
    boundaryReferenceAt: parseBoundaryReferenceAt(left.resolvesAt ?? left.expiresAt ?? left.publishedAt ?? null),
    yesLabel: "Yes",
    noLabel: "No"
  });
  const candidate = parseStructuredProposition({
    category: right.semanticCategory,
    title: right.title,
    rules: right.rules,
    boundaryReferenceAt: parseBoundaryReferenceAt(right.resolvesAt ?? right.expiresAt ?? right.publishedAt ?? null),
    yesLabel: "Yes",
    noLabel: "No"
  });

  const looseMatched =
    canLooseMatchCategoryText(left.semanticCategory, rightText)
    || canLooseMatchCategoryText(right.semanticCategory, leftText);

  const comparison = looseMatched
    ? compareStructuredPropositions({
        seed,
        candidate,
        historyQualified: left.historicalRowCount > 0 && right.historicalRowCount > 0,
        requireHistoricalQualification: true
      })
    : {
        classification: "proxy_or_mismatch" as const,
        matchScore: 0,
        exactDimensionsMatched: 0,
        requiredDimensionsMatched: 0,
        requiredDimensionCount: 0,
        failedDimensions: [],
        primaryFailureReason: "failed_loose_prefilter",
        dimensionResults: []
      };

  return {
    left,
    right,
    comparison,
    exactBucketKey: `${left.venue}:${left.venueMarketId}|${right.venue}`,
    compatibilityDecisionClass
  };
};

const determineMatchClass = (input: {
  comparison: PropositionComparison;
  compatibilityDecisionClass: CompatibilityClass | null;
  discoveryStatus: string;
}): CrossVenueMatchClass => {
  if (input.compatibilityDecisionClass === "DISTINCT" || input.compatibilityDecisionClass === "DO_NOT_POOL") {
    return "blocked_by_compatibility";
  }
  if (input.comparison.classification === "semantic_exact_historical_qualified") {
    return input.discoveryStatus === "candidate_expanded"
      ? "semantic_exact_historical_qualified"
      : "semantic_near_exact";
  }
  if (input.comparison.classification === "semantic_exact_live_only") {
    return input.discoveryStatus === "candidate_expanded"
      ? "semantic_exact_live_only"
      : "semantic_near_exact";
  }
  return input.comparison.classification === "unresolved_no_candidate"
    ? "proxy_or_mismatch"
    : input.comparison.classification;
};

const toMatchEntry = (
  raw: RawPairResult,
  exactCountByBucket: ReadonlyMap<string, number>,
  semanticsRulepackVersion: string
): CrossVenueReportMatchEntry => {
  const seed = parseStructuredProposition({
    category: raw.left.semanticCategory,
    title: raw.left.title,
    rules: raw.left.rules,
    boundaryReferenceAt: parseBoundaryReferenceAt(raw.left.resolvesAt ?? raw.left.expiresAt ?? raw.left.publishedAt ?? null),
    yesLabel: "Yes",
    noLabel: "No"
  });
  const candidate = parseStructuredProposition({
    category: raw.right.semanticCategory,
    title: raw.right.title,
    rules: raw.right.rules,
    boundaryReferenceAt: parseBoundaryReferenceAt(raw.right.resolvesAt ?? raw.right.expiresAt ?? raw.right.publishedAt ?? null),
    yesLabel: "Yes",
    noLabel: "No"
  });
  const provenance = buildSemanticsRulepackProvenance({
    seed,
    candidate,
    comparison: raw.comparison,
    semanticConfidenceContribution:
      raw.comparison.classification === "semantic_exact_historical_qualified" ? 0.18
      : raw.comparison.classification === "semantic_exact_live_only" ? 0.12
      : raw.comparison.classification === "semantic_near_exact" ? 0.05
      : 0,
    semanticsRulepackVersion,
    createdAt: new Date().toISOString(),
    replayLinkage: {
      parentDecisionType: "cross_venue_match_report",
      parentDecisionId: buildInventoryPairKey(raw.left, raw.right)
    },
    exactCandidateCount: exactCountByBucket.get(raw.exactBucketKey) ?? 1
  });

  const validation = validateSemanticsRulepackCandidate({
    seed,
    candidate,
    comparison: raw.comparison,
    provenance,
    baseConfidence: toBaseConfidence(raw.left, raw.right),
    exactCandidateCount: exactCountByBucket.get(raw.exactBucketKey) ?? 1,
    compatibilityContext: {
      decisionClass: raw.compatibilityDecisionClass,
      executionEligible: false
    }
  });

  const matchClass = determineMatchClass({
    comparison: raw.comparison,
    compatibilityDecisionClass: raw.compatibilityDecisionClass,
    discoveryStatus: validation.discoveryStatus
  });

  return {
    matchId: buildStableTextId("semmatch_", buildInventoryPairKey(raw.left, raw.right)),
    category: raw.left.semanticCategory,
    venueSet: [raw.left.venue, raw.right.venue].sort((left, right) => left.localeCompare(right)),
    seed: buildMatchRef(raw.left),
    candidate: buildMatchRef(raw.right),
    matchClass,
    exactPromotionEligible:
      validation.discoveryStatus === "candidate_expanded"
      && (matchClass === "semantic_exact_historical_qualified" || matchClass === "semantic_exact_live_only"),
    historicalQualified: matchClass === "semantic_exact_historical_qualified",
    compatibilityDecisionClass: raw.compatibilityDecisionClass,
    blockReason:
      matchClass === "blocked_by_compatibility" ? "blocked_by_compatibility"
      : validation.confidenceCapReason ?? raw.comparison.primaryFailureReason,
    baseConfidence: validation.baseConfidence,
    finalConfidence: validation.finalConfidence,
    semanticValidation: validation,
    semanticProvenance: provenance
  };
};

export const buildPromotionCandidates = (
  matches: readonly CrossVenueReportMatchEntry[],
  inventoryByKey: ReadonlyMap<string, SemanticExpansionInventoryRow>
): readonly SemanticPromotionCandidate[] => {
  const exactMatches = matches.filter((entry) => entry.exactPromotionEligible);
  const adjacency = new Map<string, Set<string>>();

  for (const match of exactMatches) {
    const leftKey = `${match.seed.venue}:${match.seed.venueMarketId}`;
    const rightKey = `${match.candidate.venue}:${match.candidate.venueMarketId}`;
    adjacency.set(leftKey, adjacency.get(leftKey) ?? new Set<string>());
    adjacency.set(rightKey, adjacency.get(rightKey) ?? new Set<string>());
    adjacency.get(leftKey)!.add(rightKey);
    adjacency.get(rightKey)!.add(leftKey);
  }

  const components: string[][] = [];
  const visited = new Set<string>();
  for (const key of adjacency.keys()) {
    if (visited.has(key)) {
      continue;
    }
    const queue = [key];
    const component: string[] = [];
    visited.add(key);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    components.push(component.sort((left, right) => left.localeCompare(right)));
  }

  const exactPairKeys = new Set(
    exactMatches.map((entry) =>
      `${entry.seed.venue}:${entry.seed.venueMarketId}|${entry.candidate.venue}:${entry.candidate.venueMarketId}`
    )
  );

  return components
    .filter((component) => component.length >= 2)
    .map((component) => {
      const memberRefs = component
        .map((key) => {
          const row = inventoryByKey.get(key);
          return row ? buildMatchRef(row) : null;
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      const uniqueVenues = new Set(memberRefs.map((entry) => entry.venue));
      const exactClique = component.every((leftKey, leftIndex) =>
        component.slice(leftIndex + 1).every((rightKey) => {
          const pairKey = `${leftKey}|${rightKey}`;
          const reversePairKey = `${rightKey}|${leftKey}`;
          return exactPairKeys.has(pairKey) || exactPairKeys.has(reversePairKey);
        })
      );
      const canonicalIds = buildStablePromotionIds(memberRefs);
      const matchingRows = memberRefs
        .map((entry) => inventoryByKey.get(`${entry.venue}:${entry.venueMarketId}`))
        .filter((row): row is SemanticExpansionInventoryRow => row !== undefined);
      const existingTarget = matchingRows
        .filter((row) => row.canonicalMarketId !== null && row.currentExecutableMemberCount > 1)
        .sort((left, right) =>
          right.currentExecutableMemberCount - left.currentExecutableMemberCount
          || String(left.canonicalMarketId).localeCompare(String(right.canonicalMarketId))
        )[0];

      return {
        promotionId: canonicalIds.promotionId,
        category: matchingRows[0]?.semanticCategory ?? "OTHER",
        promotionClass: matchingRows.every((row) => row.historicalRowCount > 0)
          ? "historical_qualified_exact_overlap"
          : "live_only_exact_overlap",
        targetMode: existingTarget ? "existing_market_extension" : "new_exact_overlap",
        targetCanonicalEventId: existingTarget?.canonicalEventId ?? canonicalIds.canonicalEventId,
        targetCanonicalMarketId: existingTarget?.canonicalMarketId ?? canonicalIds.canonicalMarketId,
        memberRefs,
        exactClique,
        blockReason:
          uniqueVenues.size !== memberRefs.length ? "duplicate_venue_members"
          : exactClique ? null : "not_exact_clique"
      } satisfies SemanticPromotionCandidate;
    })
    .filter((candidate) => candidate.memberRefs.length >= 2);
};

export const buildCrossVenueMatchReport = async (
  pool: Pool,
  options: CrossVenueMatchReportOptions = {}
): Promise<CrossVenueMatchReport> => {
  const semanticsRulepackVersion = options.semanticsRulepackVersion ?? DEFAULT_SEMANTICS_RULEPACK_VERSION;
  const [inventory, compatibilityLookup] = await Promise.all([
    loadSemanticExpansionInventory(pool),
    loadCompatibilityLookup(pool)
  ]);

  const inventoryByKey = new Map(
    inventory.map((row) => [`${row.venue}:${row.venueMarketId}`, row] as const)
  );
  const rawPairs: RawPairResult[] = [];

  const byCategory = new Map<string, SemanticExpansionInventoryRow[]>();
  for (const row of inventory) {
    const bucket = byCategory.get(row.semanticCategory);
    if (bucket) {
      bucket.push(row);
    } else {
      byCategory.set(row.semanticCategory, [row]);
    }
  }

  for (const rows of byCategory.values()) {
    const sorted = [...rows].sort((left, right) =>
      left.venue.localeCompare(right.venue) || left.venueMarketId.localeCompare(right.venueMarketId)
    );
    for (let index = 0; index < sorted.length; index += 1) {
      for (let inner = index + 1; inner < sorted.length; inner += 1) {
        const left = sorted[index]!;
        const right = sorted[inner]!;
        if (left.venue === right.venue) {
          continue;
        }
        rawPairs.push(
          buildRawPairResult(left, right, getCompatibilityForPair(compatibilityLookup, left, right))
        );
      }
    }
  }

  const exactCountByBucket = new Map<string, number>();
  for (const pair of rawPairs) {
    if (
      pair.comparison.classification === "semantic_exact_historical_qualified"
      || pair.comparison.classification === "semantic_exact_live_only"
    ) {
      exactCountByBucket.set(pair.exactBucketKey, (exactCountByBucket.get(pair.exactBucketKey) ?? 0) + 1);
    }
  }

  const matches = rawPairs
    .map((pair) => toMatchEntry(pair, exactCountByBucket, semanticsRulepackVersion))
    .sort((left, right) =>
      left.category.localeCompare(right.category)
      || left.seed.venue.localeCompare(right.seed.venue)
      || left.seed.venueMarketId.localeCompare(right.seed.venueMarketId)
      || left.candidate.venue.localeCompare(right.candidate.venue)
      || left.candidate.venueMarketId.localeCompare(right.candidate.venueMarketId)
    );

  const promotionCandidates = buildPromotionCandidates(matches, inventoryByKey)
    .filter((candidate) => candidate.blockReason === null)
    .sort((left, right) => left.promotionId.localeCompare(right.promotionId));

  const metrics = summarizeSemanticsRulepackMetrics(
    matches.map((entry) => ({
      validation: entry.semanticValidation as SemanticsRulepackValidation,
      provenance: entry.semanticProvenance as SemanticsRulepackProvenance,
      compatibilityDecisionClass: entry.compatibilityDecisionClass
    }))
  );

  return {
    observedAt: new Date().toISOString(),
    afterRulepackRefresh: options.afterRulepackRefresh ?? false,
    semanticsRulepackVersion,
    inventorySummary: summarizeInventory(inventory),
    matches,
    promotionCandidates,
    summary: {
      exactHistoricalQualified: matches.filter((entry) => entry.matchClass === "semantic_exact_historical_qualified").length,
      exactLiveOnly: matches.filter((entry) => entry.matchClass === "semantic_exact_live_only").length,
      nearExact: matches.filter((entry) => entry.matchClass === "semantic_near_exact").length,
      proxyOrMismatch: matches.filter((entry) => entry.matchClass === "proxy_or_mismatch").length,
      blockedByCompatibility: matches.filter((entry) => entry.matchClass === "blocked_by_compatibility").length
    },
    metrics
  };
};
