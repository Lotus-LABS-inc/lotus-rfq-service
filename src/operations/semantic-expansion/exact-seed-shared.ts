import type { Pool, QueryResultRow } from "pg";

import type { CanonicalCategory, CanonicalVenue } from "../../canonical/canonicalization-types.js";
import { normalizeCategory } from "../../canonical/canonicalization-types.js";
import type { HistoricalCanonicalCategory } from "../../core/historical-simulation/historical-simulation.types.js";
import type { SemanticDiscoveryCategory } from "../../simulation/semantic-rulepack.js";
import {
  parseStructuredProposition,
  type PropositionMatchCategory,
  type StructuredOutcomeSchemaType
} from "../../simulation/proposition-matching.js";
import { semanticExpansionVenues, type SemanticExpansionInventoryRow } from "./shared.js";

export const missingPairFamilies = [
  "POLYMARKET_OPINION",
  "LIMITLESS_OPINION",
  "POLYMARKET_PREDICT",
  "LIMITLESS_PREDICT",
  "OPINION_PREDICT"
] as const;

export type MissingPairFamily = typeof missingPairFamilies[number];

const activeSemanticVenueSet = new Set<CanonicalVenue>(semanticExpansionVenues);

const canonicalToSemanticCategoryMap: Readonly<Record<CanonicalCategory, SemanticDiscoveryCategory>> = Object.freeze({
  POLITICS: "POLITICS",
  CRYPTO: "CRYPTO",
  SPORTS: "SPORTS",
  ESPORTS: "ESPORTS",
  POP_CULTURE: "CULTURE",
  ECONOMICS: "OTHER",
  OTHER: "OTHER"
});

const canonicalToHistoricalCategoryMap: Readonly<Partial<Record<CanonicalCategory, HistoricalCanonicalCategory>>> = Object.freeze({
  POLITICS: "POLITICS",
  CRYPTO: "CRYPTO",
  SPORTS: "SPORTS",
  ESPORTS: "ESPORTS",
  OTHER: "OTHER",
  ECONOMICS: "OTHER"
});

export interface ExactSeedDefinition {
  seedReference: string;
  canonicalEventId: string;
  canonicalMarketId: string;
  canonicalCategory: CanonicalCategory;
  title: string;
  sourceText: string;
  memberVenues: readonly CanonicalVenue[];
  memberVenueMarketIds: readonly string[];
  targetPairFamilies: readonly MissingPairFamily[];
  exactDateSearch: ExactDateSeedSearch | null;
  boundaryReferenceAt: string | null;
}

export interface ExactDateSeedSearch {
  exactDateKey: string;
  semanticCategory: PropositionMatchCategory;
  subject: string;
  actionOrCondition: string;
  exactDayBoundary: string;
  outcomeSchema: StructuredOutcomeSchemaType;
  targetPairFamilies: readonly MissingPairFamily[];
}

export const toSupportedSemanticCategory = (category: CanonicalCategory): SemanticDiscoveryCategory =>
  canonicalToSemanticCategoryMap[category] ?? "OTHER";

export const toHistoricalCanonicalCategory = (category: CanonicalCategory): HistoricalCanonicalCategory =>
  canonicalToHistoricalCategoryMap[category] ?? "OTHER";

const EXACT_DAY_BOUNDARY_PATTERN = /^\w+\s+\d{1,2}\s+20\d{2}$/;

const isDeterministicExactDayBoundary = (value: string | null): value is string =>
  value !== null && EXACT_DAY_BOUNDARY_PATTERN.test(value);

export const buildExactDateSeedSearch = (input: {
  canonicalCategory: CanonicalCategory;
  title: string;
  sourceText: string;
  targetPairFamilies: readonly MissingPairFamily[];
  boundaryReferenceAt?: string | null;
}): ExactDateSeedSearch | null => {
  const semanticCategory = toSupportedSemanticCategory(input.canonicalCategory);
  const parsed = parseStructuredProposition({
    category: semanticCategory,
    title: input.title,
    rules: input.sourceText,
    boundaryReferenceAt: input.boundaryReferenceAt ? new Date(input.boundaryReferenceAt) : null
  });

  if (
    parsed.subject.normalized === null
    || parsed.actionOrCondition.normalized === null
    || !isDeterministicExactDayBoundary(parsed.deadlineOrSeason.normalized)
  ) {
    return null;
  }

  return {
    exactDateKey: [
      semanticCategory,
      parsed.subject.normalized,
      parsed.actionOrCondition.normalized,
      parsed.deadlineOrSeason.normalized,
      parsed.outcomeSchema.normalized
    ].join("|"),
    semanticCategory,
    subject: parsed.subject.normalized,
    actionOrCondition: parsed.actionOrCondition.normalized,
    exactDayBoundary: parsed.deadlineOrSeason.normalized,
    outcomeSchema: parsed.outcomeSchema.normalized,
    targetPairFamilies: input.targetPairFamilies
  };
};

export const buildExactDateCandidateStatus = (input: {
  seed: ExactSeedDefinition;
  candidateTitle: string;
  candidateRules?: string | null;
  boundaryReferenceAt?: Date | null;
}): "exact_date_found" | "wrong_date_same_family" | "not_exact_date_searchable" | "no_day_boundary_match" => {
  if (!input.seed.exactDateSearch) {
    return "not_exact_date_searchable";
  }

  const parsedCandidate = parseStructuredProposition({
    category: input.seed.exactDateSearch.semanticCategory,
    title: input.candidateTitle,
    rules: input.candidateRules ?? null,
    boundaryReferenceAt: input.boundaryReferenceAt ?? null
  });

  if (
    parsedCandidate.subject.normalized !== input.seed.exactDateSearch.subject
    || parsedCandidate.actionOrCondition.normalized !== input.seed.exactDateSearch.actionOrCondition
    || parsedCandidate.outcomeSchema.normalized !== input.seed.exactDateSearch.outcomeSchema
  ) {
    return "no_day_boundary_match";
  }

  if (parsedCandidate.deadlineOrSeason.normalized === input.seed.exactDateSearch.exactDayBoundary) {
    return "exact_date_found";
  }

  return parsedCandidate.deadlineOrSeason.normalized !== null
    ? "wrong_date_same_family"
    : "no_day_boundary_match";
};

interface ExactSeedRow extends QueryResultRow {
  canonical_market_id: string;
  canonical_event_id: string;
  display_name: string;
  canonical_category: string | null;
  venue: CanonicalVenue;
  venue_market_id: string;
  title: string;
  rules: string | null;
  boundary_reference_at: Date | null;
}

const pairFamilyVenueMap: Readonly<Record<MissingPairFamily, readonly [CanonicalVenue, CanonicalVenue]>> = Object.freeze({
  POLYMARKET_OPINION: ["POLYMARKET", "OPINION"],
  LIMITLESS_OPINION: ["LIMITLESS", "OPINION"],
  POLYMARKET_PREDICT: ["POLYMARKET", "PREDICT"],
  LIMITLESS_PREDICT: ["LIMITLESS", "PREDICT"],
  OPINION_PREDICT: ["OPINION", "PREDICT"]
});

export const getPairFamilyVenues = (family: MissingPairFamily): readonly [CanonicalVenue, CanonicalVenue] =>
  pairFamilyVenueMap[family];

export const resolvePairFamily = (
  left: CanonicalVenue,
  right: CanonicalVenue
): MissingPairFamily | null => {
  return missingPairFamilies.find((family) => {
    const [familyLeft, familyRight] = getPairFamilyVenues(family);
    return (familyLeft === left && familyRight === right) || (familyLeft === right && familyRight === left);
  }) ?? null;
};

const dedupeAndSort = (values: readonly string[]): readonly string[] =>
  [...new Set(values.filter((value) => value.length > 0))].sort((left, right) => left.localeCompare(right));

const buildTargetPairFamilies = (memberVenues: readonly CanonicalVenue[]): readonly MissingPairFamily[] => {
  const memberVenueSet = new Set(memberVenues);
  return missingPairFamilies.filter((family) => {
    const [left, right] = getPairFamilyVenues(family);
    return (memberVenueSet.has(left) || memberVenueSet.has(right))
      && !(memberVenueSet.has(left) && memberVenueSet.has(right));
  });
};

export const buildSeedSourceText = (input: {
  title: string;
  memberTitles: readonly string[];
  memberRules: readonly string[];
}): string => dedupeAndSort([input.title, ...input.memberTitles, ...input.memberRules]).join(" | ");

export const buildAcquisitionTargetFamilies = (
  seed: ExactSeedDefinition,
  candidateVenue: CanonicalVenue
): readonly MissingPairFamily[] => seed.targetPairFamilies.filter((family) =>
  getPairFamilyVenues(family).includes(candidateVenue)
);

export const isSeedRelevantToVenue = (
  seed: ExactSeedDefinition,
  venue: CanonicalVenue
): boolean => seed.targetPairFamilies.some((family) => getPairFamilyVenues(family).includes(venue));

export const isOneEdgeAwayFromTriEligibility = (
  seed: ExactSeedDefinition,
  family: MissingPairFamily,
  status: string
): boolean => {
  if (status !== "semantic_exact_historical_qualified" && status !== "semantic_exact_live_only") {
    return false;
  }
  const familyVenueSet = new Set(getPairFamilyVenues(family));
  return seed.memberVenues.some((venue) =>
    activeSemanticVenueSet.has(venue) && !familyVenueSet.has(venue)
  );
};

export const loadExactSeedDefinitions = async (
  pool: Pool
): Promise<readonly ExactSeedDefinition[]> => {
  const result = await pool.query<ExactSeedRow>(
    `SELECT
        cem.id AS canonical_market_id,
        cem.canonical_event_id,
        cem.display_name,
        ce.canonical_category,
        vmp.venue,
        vmp.venue_market_id,
        vmp.title,
        COALESCE(vrp.rule_text, vmp.resolution_rules_text, vmp.description) AS rules,
        COALESCE(vmp.resolves_at, vmp.expires_at, vmp.published_at) AS boundary_reference_at
       FROM canonical_executable_markets cem
       JOIN canonical_events ce
         ON ce.id = cem.canonical_event_id
       JOIN canonical_executable_market_members members
         ON members.canonical_executable_market_id = cem.id
       JOIN venue_market_profiles vmp
         ON vmp.id = members.venue_market_profile_id
       LEFT JOIN venue_resolution_profiles vrp
         ON vrp.venue_market_profile_id = vmp.id
      WHERE vmp.venue IN ('POLYMARKET', 'LIMITLESS', 'OPINION', 'PREDICT')
      ORDER BY cem.id ASC, vmp.venue ASC, vmp.venue_market_id ASC`
  );

  const grouped = new Map<string, ExactSeedRow[]>();
  for (const row of result.rows) {
    const bucket = grouped.get(row.canonical_market_id);
    if (bucket) {
      bucket.push(row);
    } else {
      grouped.set(row.canonical_market_id, [row]);
    }
  }

  return [...grouped.values()]
    .map((rows) => {
      const first = rows[0]!;
      const memberVenues = dedupeAndSort(rows.map((row) => row.venue)) as readonly CanonicalVenue[];
      const memberVenueMarketIds = dedupeAndSort(rows.map((row) => `${row.venue}:${row.venue_market_id}`));
      const boundaryReferenceAt = rows
        .map((row) => row.boundary_reference_at)
        .find((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()))
        ?.toISOString() ?? null;
      const sourceText = buildSeedSourceText({
        title: first.display_name,
        memberTitles: rows.map((row) => row.title),
        memberRules: rows.map((row) => row.rules ?? "")
      });

      return {
        seedReference: first.canonical_market_id,
        canonicalEventId: first.canonical_event_id,
        canonicalMarketId: first.canonical_market_id,
        canonicalCategory: normalizeCategory(first.canonical_category),
        title: first.display_name,
        sourceText,
        memberVenues,
        memberVenueMarketIds,
        targetPairFamilies: buildTargetPairFamilies(memberVenues),
        exactDateSearch: null,
        boundaryReferenceAt
      } satisfies ExactSeedDefinition;
    })
    .map((seed) => ({
      ...seed,
      exactDateSearch: buildExactDateSeedSearch({
        canonicalCategory: seed.canonicalCategory,
        title: seed.title,
        sourceText: seed.sourceText,
        targetPairFamilies: seed.targetPairFamilies,
        boundaryReferenceAt: seed.boundaryReferenceAt
      })
    }))
    .filter((seed) => seed.targetPairFamilies.length > 0)
    .sort((left, right) =>
      left.canonicalCategory.localeCompare(right.canonicalCategory)
      || left.title.localeCompare(right.title)
      || left.canonicalMarketId.localeCompare(right.canonicalMarketId)
    );
};

export const indexInventoryByKey = (
  inventory: readonly SemanticExpansionInventoryRow[]
): ReadonlyMap<string, SemanticExpansionInventoryRow> =>
  new Map(inventory.map((row) => [`${row.venue}:${row.venueMarketId}`, row] as const));
