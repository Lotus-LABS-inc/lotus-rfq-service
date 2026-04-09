import { normalizeFreeText } from "../../canonical/canonicalization-types.js";

export type SportsF1ConstructorsChampionVenue = "LIMITLESS" | "OPINION" | "POLYMARKET" | "PREDICT";

export type SportsF1ConstructorsChampionRuleCompatibilityClass =
  | "EXACT_RULE_COMPATIBLE"
  | "SEMANTICALLY_COMPATIBLE_REWORDING";

export type SportsF1ConstructorsChampionFinalDecisionLabel =
  | "SPORTS_F1_CONSTRUCTORS_CHAMPION_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE"
  | "SPORTS_F1_CONSTRUCTORS_CHAMPION_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
  | "SPORTS_F1_CONSTRUCTORS_CHAMPION_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND";

export type SportsF1ConstructorsChampionFragmentationLabel =
  | "FAMILY_REFRESHED_NO_SUPPLY"
  | "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
  | "FAMILY_REFRESHED_SHARED_CORE_EXISTS";

export interface SportsF1ConstructorsChampionExtractedRow {
  interpretedContractId: string;
  venue: SportsF1ConstructorsChampionVenue;
  venueMarketId: string;
  sourceUrl: string;
  title: string;
  rulesText: string | null;
  constructorLabel: string;
}

export interface SportsF1ConstructorsChampionNormalizedTopicRow {
  interpretedContractId: string;
  venue: SportsF1ConstructorsChampionVenue;
  venueMarketId: string;
  title: string;
  canonicalFamily: "TOURNAMENT_WINNER";
  canonicalTopicKey: string | null;
  canonicalCompetition: "F1_CONSTRUCTORS_CHAMPIONSHIP" | null;
  canonicalSeason: "2026" | null;
  canonicalConstructorId: string | null;
  interpretationNotes: readonly string[];
  rejectionReason: string | null;
}

export interface SportsF1ConstructorsChampionComparabilityTopicSummary {
  canonicalTopicKey: string;
  venuesPresent: readonly SportsF1ConstructorsChampionVenue[];
  pairSharedNamedOutcomesCount: number;
  triSharedNamedOutcomesCount: number;
  quadSharedNamedOutcomesCount: number;
  excludedOutcomesCount: number;
  ruleCompatibilityClassification: SportsF1ConstructorsChampionRuleCompatibilityClass;
  fragmentationLabel: SportsF1ConstructorsChampionFragmentationLabel;
  matcherCandidate: boolean;
  sharedNamedOutcomes: readonly string[];
  excludedOutcomes: readonly {
    label: string;
    reason: string;
    venues: readonly SportsF1ConstructorsChampionVenue[];
  }[];
  notes: readonly string[];
}

export interface SportsF1ConstructorsChampionFinalDecision {
  overallFamilyDecision: SportsF1ConstructorsChampionFinalDecisionLabel;
  bestCandidateTopicKey: string | null;
  familySupplyCredible: boolean;
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export interface SportsF1ConstructorsChampionFoundationArtifacts {
  normalizedTopicRows: readonly SportsF1ConstructorsChampionNormalizedTopicRow[];
  fetchSummaryInput: {
    rowsFetchedByVenue: Record<string, number>;
    rowsAdmittedByVenue: Record<string, number>;
  };
  admissionSummary: {
    totalAdmittedTournamentWinnerRows: number;
    rowsRejectedByReason: Record<string, number>;
    rowsAdmittedByTopicCandidate: Record<string, number>;
    venueBreakdown: Record<string, number>;
  };
  comparabilitySummary: readonly SportsF1ConstructorsChampionComparabilityTopicSummary[];
  basisFragmentationSummary: {
    blockerCounts: Record<string, number>;
    topicBlockers: readonly {
      canonicalTopicKey: string | null;
      reasons: readonly string[];
      venuesPresent: readonly SportsF1ConstructorsChampionVenue[];
    }[];
    unresolvedRows: readonly {
      venue: SportsF1ConstructorsChampionVenue;
      venueMarketId: string;
      title: string;
      reason: string;
    }[];
  };
  finalDecision: SportsF1ConstructorsChampionFinalDecision;
}

const TARGET_TOPIC_KEY = "SPORTS|TOURNAMENT_WINNER|F1_CONSTRUCTORS_CHAMPIONSHIP|2026" as const;
const TARGET_VENUES = ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"] as const;

const CONSTRUCTOR_NORMALIZATION_RULES: ReadonlyArray<[string, RegExp]> = [
  ["aston_martin", /\baston martin\b/i],
  ["audi", /\baudi\b|\bsauber\b/i],
  ["ferrari", /\bferrari\b/i],
  ["mclaren", /\bmclaren\b/i],
  ["mercedes", /\bmercedes\b/i],
  ["red_bull_racing", /\bred bull racing\b|\bred bull\b/i],
  ["williams", /\bwilliams\b/i],
  ["other", /\bother\b|any other constructor/i]
] as const;

const CONSTRUCTOR_DISPLAY_NAMES: Record<string, string> = {
  aston_martin: "Aston Martin",
  audi: "Audi",
  ferrari: "Ferrari",
  mclaren: "McLaren",
  mercedes: "Mercedes",
  red_bull_racing: "Red Bull Racing",
  williams: "Williams",
  other: "Other"
};

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

const normalizeConstructorId = (value: string): string | null => {
  for (const [constructorId, pattern] of CONSTRUCTOR_NORMALIZATION_RULES) {
    if (pattern.test(value)) {
      return constructorId;
    }
  }
  return null;
};

const toNormalizedTopicRow = (
  row: SportsF1ConstructorsChampionExtractedRow
): SportsF1ConstructorsChampionNormalizedTopicRow => {
  const combined = `${row.title} ${row.rulesText ?? ""} ${row.constructorLabel}`;
  const canonicalConstructorId = normalizeConstructorId(combined);
  const topicKey = /\b(?:2026 )?f1 constructors['’]?\s+champion(?:ship)?\b|\bf1 constructors champion\b/i.test(combined)
    ? TARGET_TOPIC_KEY
    : null;

  return {
    interpretedContractId: row.interpretedContractId,
    venue: row.venue,
    venueMarketId: row.venueMarketId,
    title: row.title,
    canonicalFamily: "TOURNAMENT_WINNER",
    canonicalTopicKey: topicKey,
    canonicalCompetition: topicKey === null ? null : "F1_CONSTRUCTORS_CHAMPIONSHIP",
    canonicalSeason: topicKey === null ? null : "2026",
    canonicalConstructorId,
    interpretationNotes: [
      `constructor_label=${row.constructorLabel}`,
      row.rulesText ? "rules_present" : "rules_missing"
    ],
    rejectionReason:
      topicKey === null ? "OUT_OF_SCOPE_FOR_F1_CONSTRUCTORS_CHAMPION_2026"
      : canonicalConstructorId === null ? "CONSTRUCTOR_IDENTITY_UNRESOLVED"
      : canonicalConstructorId === "other" ? "OTHERS_EXCLUDED"
      : null
  };
};

const deriveRuleCompatibility = (
  rows: readonly SportsF1ConstructorsChampionNormalizedTopicRow[],
  sourceRowsById: ReadonlyMap<string, SportsF1ConstructorsChampionExtractedRow>
): SportsF1ConstructorsChampionRuleCompatibilityClass => {
  const normalizedRuleTexts = new Set(
    rows
      .map((row) => sourceRowsById.get(row.interpretedContractId)?.rulesText ?? row.title)
      .map((value) => normalizeFreeText(value).replace(/\s+/g, " ").trim())
      .filter((value) => value.length > 0)
  );

  return normalizedRuleTexts.size <= 1 ? "EXACT_RULE_COMPATIBLE" : "SEMANTICALLY_COMPATIBLE_REWORDING";
};

export const buildSportsF1ConstructorsChampionFamilyArtifacts = (
  rows: readonly SportsF1ConstructorsChampionExtractedRow[]
): SportsF1ConstructorsChampionFoundationArtifacts => {
  const rowsFetchedByVenue: Record<string, number> = {};
  const rowsAdmittedByVenue: Record<string, number> = {};
  const rowsRejectedByReason: Record<string, number> = {};
  const rowsAdmittedByTopicCandidate: Record<string, number> = {};
  const unresolvedRows: Array<{
    venue: SportsF1ConstructorsChampionVenue;
    venueMarketId: string;
    title: string;
    reason: string;
  }> = [];
  const sourceRowsById = new Map(rows.map((row) => [row.interpretedContractId, row] as const));

  for (const row of rows) {
    if (TARGET_VENUES.includes(row.venue)) {
      increment(rowsFetchedByVenue, row.venue);
    }
  }

  const normalizedTopicRows = rows
    .filter((row) => TARGET_VENUES.includes(row.venue))
    .map((row) => {
      const normalized = toNormalizedTopicRow(row);
      if (normalized.rejectionReason) {
        increment(rowsRejectedByReason, normalized.rejectionReason);
        unresolvedRows.push({
          venue: normalized.venue,
          venueMarketId: normalized.venueMarketId,
          title: normalized.title,
          reason: normalized.rejectionReason
        });
      } else {
        increment(rowsAdmittedByVenue, normalized.venue);
        increment(rowsAdmittedByTopicCandidate, normalized.canonicalTopicKey ?? "UNRESOLVED_TOPIC");
      }
      return normalized;
    });

  const admittedRows = normalizedTopicRows.filter(
    (row) => row.rejectionReason === null && row.canonicalTopicKey === TARGET_TOPIC_KEY
  );
  const constructorVenues = new Map<string, Set<SportsF1ConstructorsChampionVenue>>();
  const excludedOutcomes = new Map<
    string,
    { label: string; reason: string; venues: Set<SportsF1ConstructorsChampionVenue> }
  >();

  for (const row of admittedRows) {
    const constructorId = row.canonicalConstructorId;
    if (!constructorId) {
      continue;
    }
    const venues = constructorVenues.get(constructorId) ?? new Set<SportsF1ConstructorsChampionVenue>();
    venues.add(row.venue);
    constructorVenues.set(constructorId, venues);
  }

  for (const [constructorId, venues] of constructorVenues.entries()) {
    if (venues.size < 2) {
      excludedOutcomes.set(`${constructorId}|NOT_SHARED`, {
        label: CONSTRUCTOR_DISPLAY_NAMES[constructorId] ?? constructorId,
        reason: "NOT_SHARED",
        venues
      });
    }
  }

  const venuesPresent = [...new Set(admittedRows.map((row) => row.venue))].sort() as SportsF1ConstructorsChampionVenue[];
  const sharedNamedOutcomes = [...constructorVenues.entries()]
    .filter(([, venues]) => venues.size >= 2)
    .map(([constructorId]) => CONSTRUCTOR_DISPLAY_NAMES[constructorId] ?? constructorId)
    .sort((left, right) => left.localeCompare(right));

  const pairSharedNamedOutcomesCount = [...constructorVenues.values()].filter((venues) => venues.size >= 2).length;
  const triSharedNamedOutcomesCount = [...constructorVenues.values()].filter((venues) => venues.size >= 3).length;
  const quadSharedNamedOutcomesCount = [...constructorVenues.values()].filter((venues) => venues.size >= 4).length;
  const matcherCandidate = venuesPresent.length >= 2 && pairSharedNamedOutcomesCount > 0;
  const fragmentationLabel: SportsF1ConstructorsChampionFragmentationLabel =
    admittedRows.length === 0 ? "FAMILY_REFRESHED_NO_SUPPLY"
    : venuesPresent.length === 1 ? "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
    : pairSharedNamedOutcomesCount > 0 ? "FAMILY_REFRESHED_SHARED_CORE_EXISTS"
    : "FAMILY_REFRESHED_SINGLE_VENUE_ONLY";

  const ruleCompatibilityClassification = deriveRuleCompatibility(admittedRows, sourceRowsById);

  const comparabilitySummary: SportsF1ConstructorsChampionComparabilityTopicSummary[] = admittedRows.length === 0
    ? []
    : [{
      canonicalTopicKey: TARGET_TOPIC_KEY,
      venuesPresent,
      pairSharedNamedOutcomesCount,
      triSharedNamedOutcomesCount,
      quadSharedNamedOutcomesCount,
      excludedOutcomesCount: excludedOutcomes.size,
      ruleCompatibilityClassification,
      fragmentationLabel,
      matcherCandidate,
      sharedNamedOutcomes,
      excludedOutcomes: [...excludedOutcomes.values()]
        .map((item) => ({
          label: item.label,
          reason: item.reason,
          venues: [...item.venues].sort() as SportsF1ConstructorsChampionVenue[]
        }))
        .sort((left, right) => left.label.localeCompare(right.label)),
      notes: [
        `admitted_rows=${admittedRows.length}`,
        `venues_present=${venuesPresent.join("|") || "none"}`,
        `tri_shared_named_outcomes=${triSharedNamedOutcomesCount}`
      ]
    }];

  const blockerCounts: Record<string, number> = {};
  if (admittedRows.length === 0) {
    increment(blockerCounts, "NO_SUPPLY");
  } else if (venuesPresent.length === 1) {
    increment(blockerCounts, "SINGLE_VENUE_ONLY");
  } else if (pairSharedNamedOutcomesCount === 0) {
    increment(blockerCounts, "NO_SHARED_CORE");
  }

  const finalDecision: SportsF1ConstructorsChampionFinalDecision = {
    overallFamilyDecision:
      admittedRows.length === 0 ? "SPORTS_F1_CONSTRUCTORS_CHAMPION_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE"
      : venuesPresent.length === 1 ? "SPORTS_F1_CONSTRUCTORS_CHAMPION_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
      : matcherCandidate ? "SPORTS_F1_CONSTRUCTORS_CHAMPION_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND"
      : "SPORTS_F1_CONSTRUCTORS_CHAMPION_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE",
    bestCandidateTopicKey: matcherCandidate ? TARGET_TOPIC_KEY : null,
    familySupplyCredible: admittedRows.length > 0,
    operatorCredible: matcherCandidate,
    matcherFollowUpJustified: matcherCandidate,
    singleBestNextAction: matcherCandidate
      ? "run a narrow matcher pass for SPORTS|TOURNAMENT_WINNER|F1_CONSTRUCTORS_CHAMPIONSHIP|2026, preserving the strict shared core and excluding venue-only tails."
      : admittedRows.length === 0
        ? "continue targeted venue repair for F1 constructors champion discovery before attempting matcher work."
        : "continue F1 constructors champion venue reconciliation until a shared named-outcome core exists."
  };

  return {
    normalizedTopicRows,
    fetchSummaryInput: {
      rowsFetchedByVenue,
      rowsAdmittedByVenue
    },
    admissionSummary: {
      totalAdmittedTournamentWinnerRows: admittedRows.length,
      rowsRejectedByReason,
      rowsAdmittedByTopicCandidate,
      venueBreakdown: rowsAdmittedByVenue
    },
    comparabilitySummary,
    basisFragmentationSummary: {
      blockerCounts,
      topicBlockers: [{
        canonicalTopicKey: admittedRows.length === 0 ? null : TARGET_TOPIC_KEY,
        reasons: Object.keys(blockerCounts),
        venuesPresent
      }],
      unresolvedRows
    },
    finalDecision
  };
};
