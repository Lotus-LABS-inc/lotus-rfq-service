import { normalizeFreeText } from "../../canonical/canonicalization-types.js";

export type SportsF1DriversChampionVenue = "LIMITLESS" | "OPINION" | "POLYMARKET" | "PREDICT";

export type SportsF1DriversChampionRuleCompatibilityClass =
  | "EXACT_RULE_COMPATIBLE"
  | "SEMANTICALLY_COMPATIBLE_REWORDING";

export type SportsF1DriversChampionFinalDecisionLabel =
  | "SPORTS_F1_DRIVERS_CHAMPION_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE"
  | "SPORTS_F1_DRIVERS_CHAMPION_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
  | "SPORTS_F1_DRIVERS_CHAMPION_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND";

export type SportsF1DriversChampionFragmentationLabel =
  | "FAMILY_REFRESHED_NO_SUPPLY"
  | "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
  | "FAMILY_REFRESHED_SHARED_CORE_EXISTS";

export interface SportsF1DriversChampionExtractedRow {
  interpretedContractId: string;
  venue: SportsF1DriversChampionVenue;
  venueMarketId: string;
  sourceUrl: string;
  title: string;
  rulesText: string | null;
  driverLabel: string;
}

export interface SportsF1DriversChampionNormalizedTopicRow {
  interpretedContractId: string;
  venue: SportsF1DriversChampionVenue;
  venueMarketId: string;
  title: string;
  canonicalFamily: "TOURNAMENT_WINNER";
  canonicalTopicKey: string | null;
  canonicalCompetition: "F1_DRIVERS_CHAMPIONSHIP" | null;
  canonicalSeason: "2026" | null;
  canonicalDriverId: string | null;
  interpretationNotes: readonly string[];
  rejectionReason: string | null;
}

export interface SportsF1DriversChampionComparabilityTopicSummary {
  canonicalTopicKey: string;
  venuesPresent: readonly SportsF1DriversChampionVenue[];
  pairSharedNamedOutcomesCount: number;
  triSharedNamedOutcomesCount: number;
  quadSharedNamedOutcomesCount: number;
  excludedOutcomesCount: number;
  ruleCompatibilityClassification: SportsF1DriversChampionRuleCompatibilityClass;
  fragmentationLabel: SportsF1DriversChampionFragmentationLabel;
  matcherCandidate: boolean;
  sharedNamedOutcomes: readonly string[];
  excludedOutcomes: readonly {
    label: string;
    reason: string;
    venues: readonly SportsF1DriversChampionVenue[];
  }[];
  notes: readonly string[];
}

export interface SportsF1DriversChampionFinalDecision {
  overallFamilyDecision: SportsF1DriversChampionFinalDecisionLabel;
  bestCandidateTopicKey: string | null;
  familySupplyCredible: boolean;
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export interface SportsF1DriversChampionFoundationArtifacts {
  normalizedTopicRows: readonly SportsF1DriversChampionNormalizedTopicRow[];
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
  comparabilitySummary: readonly SportsF1DriversChampionComparabilityTopicSummary[];
  basisFragmentationSummary: {
    blockerCounts: Record<string, number>;
    topicBlockers: readonly {
      canonicalTopicKey: string | null;
      reasons: readonly string[];
      venuesPresent: readonly SportsF1DriversChampionVenue[];
    }[];
    unresolvedRows: readonly {
      venue: SportsF1DriversChampionVenue;
      venueMarketId: string;
      title: string;
      reason: string;
    }[];
  };
  finalDecision: SportsF1DriversChampionFinalDecision;
}

const TARGET_TOPIC_KEY = "SPORTS|TOURNAMENT_WINNER|F1_DRIVERS_CHAMPIONSHIP|2026" as const;
const TARGET_VENUES = ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"] as const;

const DRIVER_NORMALIZATION_RULES: ReadonlyArray<[string, RegExp]> = [
  ["charles_leclerc", /\bcharles leclerc\b/i],
  ["fernando_alonso", /\bfernando alonso\b/i],
  ["george_russell", /\bgeorge russell\b/i],
  ["kimi_antonelli", /\bkimi antonelli\b/i],
  ["lando_norris", /\blando norris\b/i],
  ["lewis_hamilton", /\blewis hamilton\b|\bhamilton\b/i],
  ["max_verstappen", /\bmax verstappen\b|\bverstappen\b/i],
  ["oscar_piastri", /\boscar piastri\b|\bpiastri\b/i],
  ["other", /\bother\b|any other driver/i]
] as const;

const DRIVER_DISPLAY_NAMES: Record<string, string> = {
  charles_leclerc: "Charles Leclerc",
  fernando_alonso: "Fernando Alonso",
  george_russell: "George Russell",
  kimi_antonelli: "Kimi Antonelli",
  lando_norris: "Lando Norris",
  lewis_hamilton: "Lewis Hamilton",
  max_verstappen: "Max Verstappen",
  oscar_piastri: "Oscar Piastri",
  other: "Other"
};

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

const normalizeDriverId = (value: string): string | null => {
  for (const [driverId, pattern] of DRIVER_NORMALIZATION_RULES) {
    if (pattern.test(value)) {
      return driverId;
    }
  }
  return null;
};

const toNormalizedTopicRow = (
  row: SportsF1DriversChampionExtractedRow
): SportsF1DriversChampionNormalizedTopicRow => {
  const combined = `${row.title} ${row.rulesText ?? ""} ${row.driverLabel}`;
  const canonicalDriverId = normalizeDriverId(combined);
  const topicKey = /\b(?:2026 )?f1 drivers['’]?\s+champion(?:ship)?\b|\bf1 world drivers['’]?\s+champion\b/i.test(combined)
    ? TARGET_TOPIC_KEY
    : null;

  return {
    interpretedContractId: row.interpretedContractId,
    venue: row.venue,
    venueMarketId: row.venueMarketId,
    title: row.title,
    canonicalFamily: "TOURNAMENT_WINNER",
    canonicalTopicKey: topicKey,
    canonicalCompetition: topicKey === null ? null : "F1_DRIVERS_CHAMPIONSHIP",
    canonicalSeason: topicKey === null ? null : "2026",
    canonicalDriverId,
    interpretationNotes: [
      `driver_label=${row.driverLabel}`,
      row.rulesText ? "rules_present" : "rules_missing"
    ],
    rejectionReason:
      topicKey === null ? "OUT_OF_SCOPE_FOR_F1_DRIVERS_CHAMPION_2026"
      : canonicalDriverId === null ? "DRIVER_IDENTITY_UNRESOLVED"
      : canonicalDriverId === "other" ? "OTHERS_EXCLUDED"
      : null
  };
};

const deriveRuleCompatibility = (
  rows: readonly SportsF1DriversChampionNormalizedTopicRow[],
  sourceRowsById: ReadonlyMap<string, SportsF1DriversChampionExtractedRow>
): SportsF1DriversChampionRuleCompatibilityClass => {
  const normalizedRuleTexts = new Set(
    rows
      .map((row) => sourceRowsById.get(row.interpretedContractId)?.rulesText ?? row.title)
      .map((value) => normalizeFreeText(value).replace(/\s+/g, " ").trim())
      .filter((value) => value.length > 0)
  );

  return normalizedRuleTexts.size <= 1 ? "EXACT_RULE_COMPATIBLE" : "SEMANTICALLY_COMPATIBLE_REWORDING";
};

export const buildSportsF1DriversChampionFamilyArtifacts = (
  rows: readonly SportsF1DriversChampionExtractedRow[]
): SportsF1DriversChampionFoundationArtifacts => {
  const rowsFetchedByVenue: Record<string, number> = {};
  const rowsAdmittedByVenue: Record<string, number> = {};
  const rowsRejectedByReason: Record<string, number> = {};
  const rowsAdmittedByTopicCandidate: Record<string, number> = {};
  const unresolvedRows: Array<{
    venue: SportsF1DriversChampionVenue;
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
  const driverVenues = new Map<string, Set<SportsF1DriversChampionVenue>>();
  const excludedOutcomes = new Map<
    string,
    { label: string; reason: string; venues: Set<SportsF1DriversChampionVenue> }
  >();

  for (const row of admittedRows) {
    const driverId = row.canonicalDriverId;
    if (!driverId) {
      continue;
    }
    const venues = driverVenues.get(driverId) ?? new Set<SportsF1DriversChampionVenue>();
    venues.add(row.venue);
    driverVenues.set(driverId, venues);
  }

  for (const [driverId, venues] of driverVenues.entries()) {
    if (venues.size < 2) {
      excludedOutcomes.set(`${driverId}|NOT_SHARED`, {
        label: DRIVER_DISPLAY_NAMES[driverId] ?? driverId,
        reason: "NOT_SHARED",
        venues
      });
    }
  }

  const venuesPresent = [...new Set(admittedRows.map((row) => row.venue))].sort() as SportsF1DriversChampionVenue[];
  const sharedNamedOutcomes = [...driverVenues.entries()]
    .filter(([, venues]) => venues.size >= 2)
    .map(([driverId]) => DRIVER_DISPLAY_NAMES[driverId] ?? driverId)
    .sort((left, right) => left.localeCompare(right));

  const pairSharedNamedOutcomesCount = [...driverVenues.values()].filter((venues) => venues.size >= 2).length;
  const triSharedNamedOutcomesCount = [...driverVenues.values()].filter((venues) => venues.size >= 3).length;
  const quadSharedNamedOutcomesCount = [...driverVenues.values()].filter((venues) => venues.size >= 4).length;
  const matcherCandidate = venuesPresent.length >= 2 && pairSharedNamedOutcomesCount > 0;
  const fragmentationLabel: SportsF1DriversChampionFragmentationLabel =
    admittedRows.length === 0 ? "FAMILY_REFRESHED_NO_SUPPLY"
    : venuesPresent.length === 1 ? "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
    : pairSharedNamedOutcomesCount > 0 ? "FAMILY_REFRESHED_SHARED_CORE_EXISTS"
    : "FAMILY_REFRESHED_SINGLE_VENUE_ONLY";

  const ruleCompatibilityClassification = deriveRuleCompatibility(admittedRows, sourceRowsById);

  const comparabilitySummary: SportsF1DriversChampionComparabilityTopicSummary[] = admittedRows.length === 0
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
          venues: [...item.venues].sort() as SportsF1DriversChampionVenue[]
        }))
        .sort((left, right) => left.label.localeCompare(right.label)),
      notes: [
        `admitted_rows=${admittedRows.length}`,
        `venues_present=${venuesPresent.join("|") || "none"}`,
        `quad_shared_named_outcomes=${quadSharedNamedOutcomesCount}`
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

  const finalDecision: SportsF1DriversChampionFinalDecision = {
    overallFamilyDecision:
      admittedRows.length === 0 ? "SPORTS_F1_DRIVERS_CHAMPION_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE"
      : venuesPresent.length === 1 ? "SPORTS_F1_DRIVERS_CHAMPION_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
      : matcherCandidate ? "SPORTS_F1_DRIVERS_CHAMPION_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND"
      : "SPORTS_F1_DRIVERS_CHAMPION_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE",
    bestCandidateTopicKey: matcherCandidate ? TARGET_TOPIC_KEY : null,
    familySupplyCredible: admittedRows.length > 0,
    operatorCredible: matcherCandidate,
    matcherFollowUpJustified: matcherCandidate,
    singleBestNextAction: matcherCandidate
      ? "run a narrow matcher pass for SPORTS|TOURNAMENT_WINNER|F1_DRIVERS_CHAMPIONSHIP|2026, preserving the strict shared core and excluding venue-only tails."
      : admittedRows.length === 0
        ? "continue targeted venue repair for F1 drivers champion discovery before attempting matcher work."
        : "continue F1 drivers champion venue reconciliation until a shared named-outcome core exists."
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
