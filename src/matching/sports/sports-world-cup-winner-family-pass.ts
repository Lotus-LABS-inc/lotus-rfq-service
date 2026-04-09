import { normalizeFreeText } from "../../canonical/canonicalization-types.js";

export type SportsWorldCupWinnerVenue = "LIMITLESS" | "OPINION" | "POLYMARKET" | "PREDICT";

export type SportsWorldCupWinnerRuleCompatibilityClass =
  | "EXACT_RULE_COMPATIBLE"
  | "SEMANTICALLY_COMPATIBLE_REWORDING";

export type SportsWorldCupWinnerFinalDecisionLabel =
  | "SPORTS_WORLD_CUP_WINNER_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE"
  | "SPORTS_WORLD_CUP_WINNER_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
  | "SPORTS_WORLD_CUP_WINNER_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND";

export type SportsWorldCupWinnerFragmentationLabel =
  | "FAMILY_REFRESHED_NO_SUPPLY"
  | "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
  | "FAMILY_REFRESHED_SHARED_CORE_EXISTS";

export interface SportsWorldCupWinnerExtractedRow {
  interpretedContractId: string;
  venue: SportsWorldCupWinnerVenue;
  venueMarketId: string;
  sourceUrl: string;
  title: string;
  rulesText: string | null;
  teamLabel: string;
}

export interface SportsWorldCupWinnerNormalizedTopicRow {
  interpretedContractId: string;
  venue: SportsWorldCupWinnerVenue;
  venueMarketId: string;
  title: string;
  canonicalFamily: "TOURNAMENT_WINNER";
  canonicalTopicKey: string | null;
  canonicalCompetition: "FIFA_WORLD_CUP" | null;
  canonicalSeason: "2026" | null;
  canonicalTeamId: string | null;
  interpretationNotes: readonly string[];
  rejectionReason: string | null;
}

export interface SportsWorldCupWinnerComparabilityTopicSummary {
  canonicalTopicKey: string;
  venuesPresent: readonly SportsWorldCupWinnerVenue[];
  pairSharedNamedOutcomesCount: number;
  triSharedNamedOutcomesCount: number;
  quadSharedNamedOutcomesCount: number;
  excludedOutcomesCount: number;
  ruleCompatibilityClassification: SportsWorldCupWinnerRuleCompatibilityClass;
  fragmentationLabel: SportsWorldCupWinnerFragmentationLabel;
  matcherCandidate: boolean;
  sharedNamedOutcomes: readonly string[];
  excludedOutcomes: readonly {
    label: string;
    reason: string;
    venues: readonly SportsWorldCupWinnerVenue[];
  }[];
  notes: readonly string[];
}

export interface SportsWorldCupWinnerFinalDecision {
  overallFamilyDecision: SportsWorldCupWinnerFinalDecisionLabel;
  bestCandidateTopicKey: string | null;
  familySupplyCredible: boolean;
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export interface SportsWorldCupWinnerFoundationArtifacts {
  normalizedTopicRows: readonly SportsWorldCupWinnerNormalizedTopicRow[];
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
  comparabilitySummary: readonly SportsWorldCupWinnerComparabilityTopicSummary[];
  basisFragmentationSummary: {
    blockerCounts: Record<string, number>;
    topicBlockers: readonly {
      canonicalTopicKey: string | null;
      reasons: readonly string[];
      venuesPresent: readonly SportsWorldCupWinnerVenue[];
    }[];
    unresolvedRows: readonly {
      venue: SportsWorldCupWinnerVenue;
      venueMarketId: string;
      title: string;
      reason: string;
    }[];
  };
  finalDecision: SportsWorldCupWinnerFinalDecision;
}

const TARGET_TOPIC_KEY = "SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026" as const;
const TARGET_VENUES = ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"] as const;

const TEAM_NORMALIZATION_RULES: ReadonlyArray<[string, RegExp]> = [
  ["argentina", /\bargentina\b/i],
  ["brazil", /\bbrazil\b/i],
  ["england", /\bengland\b/i],
  ["france", /\bfrance\b/i],
  ["spain", /\bspain\b/i],
  ["germany", /\bgermany\b/i],
  ["portugal", /\bportugal\b/i],
  ["netherlands", /\bnetherlands\b/i],
  ["italy", /\bitaly\b/i],
  ["belgium", /\bbelgium\b/i],
  ["uruguay", /\buruguay\b/i],
  ["croatia", /\bcroatia\b/i],
  ["united_states", /\busa\b|\bunited states\b/i],
  ["mexico", /\bmexico\b/i],
  ["other", /\bother\b|none of the listed teams/i]
] as const;

const TEAM_DISPLAY_NAMES: Record<string, string> = {
  argentina: "Argentina",
  belgium: "Belgium",
  brazil: "Brazil",
  croatia: "Croatia",
  england: "England",
  france: "France",
  germany: "Germany",
  italy: "Italy",
  mexico: "Mexico",
  netherlands: "Netherlands",
  portugal: "Portugal",
  spain: "Spain",
  united_states: "United States",
  uruguay: "Uruguay",
  other: "Other"
};

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

const normalizeTeamId = (value: string): string | null => {
  for (const [teamId, pattern] of TEAM_NORMALIZATION_RULES) {
    if (pattern.test(value)) {
      return teamId;
    }
  }
  return null;
};

const toNormalizedTopicRow = (
  row: SportsWorldCupWinnerExtractedRow
): SportsWorldCupWinnerNormalizedTopicRow => {
  const combined = `${row.title} ${row.rulesText ?? ""} ${row.teamLabel}`;
  const canonicalTeamId = normalizeTeamId(combined);
  const topicKey = /\b(?:2026 )?fifa world cup\b/i.test(combined) ? TARGET_TOPIC_KEY : null;

  return {
    interpretedContractId: row.interpretedContractId,
    venue: row.venue,
    venueMarketId: row.venueMarketId,
    title: row.title,
    canonicalFamily: "TOURNAMENT_WINNER",
    canonicalTopicKey: topicKey,
    canonicalCompetition: topicKey === null ? null : "FIFA_WORLD_CUP",
    canonicalSeason: topicKey === null ? null : "2026",
    canonicalTeamId,
    interpretationNotes: [
      `team_label=${row.teamLabel}`,
      row.rulesText ? "rules_present" : "rules_missing"
    ],
    rejectionReason:
      topicKey === null ? "OUT_OF_SCOPE_FOR_FIFA_WORLD_CUP_2026_WINNER"
      : canonicalTeamId === null ? "TEAM_IDENTITY_UNRESOLVED"
      : canonicalTeamId === "other" ? "OTHERS_EXCLUDED"
      : null
  };
};

const deriveRuleCompatibility = (
  rows: readonly SportsWorldCupWinnerNormalizedTopicRow[],
  sourceRowsById: ReadonlyMap<string, SportsWorldCupWinnerExtractedRow>
): SportsWorldCupWinnerRuleCompatibilityClass => {
  const normalizedRuleTexts = new Set(
    rows
      .map((row) => sourceRowsById.get(row.interpretedContractId)?.rulesText ?? row.title)
      .map((value) => normalizeFreeText(value).replace(/\s+/g, " ").trim())
      .filter((value) => value.length > 0)
  );

  return normalizedRuleTexts.size <= 1 ? "EXACT_RULE_COMPATIBLE" : "SEMANTICALLY_COMPATIBLE_REWORDING";
};

export const buildSportsWorldCupWinnerFamilyArtifacts = (
  rows: readonly SportsWorldCupWinnerExtractedRow[]
): SportsWorldCupWinnerFoundationArtifacts => {
  const rowsFetchedByVenue: Record<string, number> = {};
  const rowsAdmittedByVenue: Record<string, number> = {};
  const rowsRejectedByReason: Record<string, number> = {};
  const rowsAdmittedByTopicCandidate: Record<string, number> = {};
  const unresolvedRows: Array<{
    venue: SportsWorldCupWinnerVenue;
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
  const teamVenues = new Map<string, Set<SportsWorldCupWinnerVenue>>();
  const excludedOutcomes = new Map<
    string,
    { label: string; reason: string; venues: Set<SportsWorldCupWinnerVenue> }
  >();

  for (const row of admittedRows) {
    const teamId = row.canonicalTeamId;
    if (!teamId) {
      continue;
    }
    const venues = teamVenues.get(teamId) ?? new Set<SportsWorldCupWinnerVenue>();
    venues.add(row.venue);
    teamVenues.set(teamId, venues);
  }

  for (const [teamId, venues] of teamVenues.entries()) {
    if (venues.size < 2) {
      excludedOutcomes.set(`${teamId}|NOT_SHARED`, {
        label: TEAM_DISPLAY_NAMES[teamId] ?? teamId,
        reason: "NOT_SHARED",
        venues
      });
    }
  }

  const venuesPresent = [...new Set(admittedRows.map((row) => row.venue))].sort() as SportsWorldCupWinnerVenue[];
  const sharedNamedOutcomes = [...teamVenues.entries()]
    .filter(([, venues]) => venues.size >= 2)
    .map(([teamId]) => TEAM_DISPLAY_NAMES[teamId] ?? teamId)
    .sort((left, right) => left.localeCompare(right));

  const pairSharedNamedOutcomesCount = [...teamVenues.values()].filter((venues) => venues.size >= 2).length;
  const triSharedNamedOutcomesCount = [...teamVenues.values()].filter((venues) => venues.size >= 3).length;
  const quadSharedNamedOutcomesCount = [...teamVenues.values()].filter((venues) => venues.size >= 4).length;
  const matcherCandidate = venuesPresent.length >= 2 && pairSharedNamedOutcomesCount > 0;
  const fragmentationLabel: SportsWorldCupWinnerFragmentationLabel =
    admittedRows.length === 0 ? "FAMILY_REFRESHED_NO_SUPPLY"
    : venuesPresent.length === 1 ? "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
    : pairSharedNamedOutcomesCount > 0 ? "FAMILY_REFRESHED_SHARED_CORE_EXISTS"
    : "FAMILY_REFRESHED_SINGLE_VENUE_ONLY";

  const ruleCompatibilityClassification = deriveRuleCompatibility(admittedRows, sourceRowsById);

  const comparabilitySummary: SportsWorldCupWinnerComparabilityTopicSummary[] = admittedRows.length === 0
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
          venues: [...item.venues].sort() as SportsWorldCupWinnerVenue[]
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

  const finalDecision: SportsWorldCupWinnerFinalDecision = {
    overallFamilyDecision:
      admittedRows.length === 0 ? "SPORTS_WORLD_CUP_WINNER_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE"
      : venuesPresent.length === 1 ? "SPORTS_WORLD_CUP_WINNER_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
      : matcherCandidate ? "SPORTS_WORLD_CUP_WINNER_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND"
      : "SPORTS_WORLD_CUP_WINNER_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE",
    bestCandidateTopicKey: matcherCandidate ? TARGET_TOPIC_KEY : null,
    familySupplyCredible: admittedRows.length > 0,
    operatorCredible: matcherCandidate,
    matcherFollowUpJustified: matcherCandidate,
    singleBestNextAction: matcherCandidate
      ? "run a narrow matcher pass for SPORTS|TOURNAMENT_WINNER|FIFA_WORLD_CUP|2026, preserving the strict shared core and excluding venue-only tails."
      : admittedRows.length === 0
        ? "continue targeted venue repair for FIFA World Cup winner discovery before attempting matcher work."
        : "continue World Cup venue reconciliation until a shared named-outcome core exists."
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
