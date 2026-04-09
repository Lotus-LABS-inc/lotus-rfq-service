import { normalizeFreeText } from "../../canonical/canonicalization-types.js";

export type SportsEplWinnerVenue = "LIMITLESS" | "OPINION" | "POLYMARKET" | "PREDICT";

export type SportsEplWinnerRuleCompatibilityClass =
  | "EXACT_RULE_COMPATIBLE"
  | "SEMANTICALLY_COMPATIBLE_REWORDING";

export type SportsEplWinnerFinalDecisionLabel =
  | "SPORTS_EPL_WINNER_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE"
  | "SPORTS_EPL_WINNER_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
  | "SPORTS_EPL_WINNER_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND";

export type SportsEplWinnerFragmentationLabel =
  | "FAMILY_REFRESHED_NO_SUPPLY"
  | "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
  | "FAMILY_REFRESHED_SHARED_CORE_EXISTS";

export interface SportsEplWinnerExtractedRow {
  interpretedContractId: string;
  venue: SportsEplWinnerVenue;
  venueMarketId: string;
  sourceUrl: string;
  title: string;
  rulesText: string | null;
  clubLabel: string;
}

export interface SportsEplWinnerNormalizedTopicRow {
  interpretedContractId: string;
  venue: SportsEplWinnerVenue;
  venueMarketId: string;
  title: string;
  canonicalFamily: "LEAGUE_WINNER";
  canonicalTopicKey: string | null;
  canonicalCompetition: "EPL" | null;
  canonicalSeason: "2025_2026" | null;
  canonicalClubId: string | null;
  interpretationNotes: readonly string[];
  rejectionReason: string | null;
}

export interface SportsEplWinnerComparabilityTopicSummary {
  canonicalTopicKey: string;
  venuesPresent: readonly SportsEplWinnerVenue[];
  pairSharedNamedOutcomesCount: number;
  triSharedNamedOutcomesCount: number;
  quadSharedNamedOutcomesCount: number;
  excludedOutcomesCount: number;
  ruleCompatibilityClassification: SportsEplWinnerRuleCompatibilityClass;
  fragmentationLabel: SportsEplWinnerFragmentationLabel;
  matcherCandidate: boolean;
  sharedNamedOutcomes: readonly string[];
  excludedOutcomes: readonly {
    label: string;
    reason: string;
    venues: readonly SportsEplWinnerVenue[];
  }[];
  notes: readonly string[];
}

export interface SportsEplWinnerFinalDecision {
  overallFamilyDecision: SportsEplWinnerFinalDecisionLabel;
  bestCandidateTopicKey: string | null;
  familySupplyCredible: boolean;
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export interface SportsEplWinnerFoundationArtifacts {
  normalizedTopicRows: readonly SportsEplWinnerNormalizedTopicRow[];
  fetchSummaryInput: {
    rowsFetchedByVenue: Record<string, number>;
    rowsAdmittedByVenue: Record<string, number>;
  };
  admissionSummary: {
    totalAdmittedLeagueWinnerRows: number;
    rowsRejectedByReason: Record<string, number>;
    rowsAdmittedByTopicCandidate: Record<string, number>;
    venueBreakdown: Record<string, number>;
  };
  comparabilitySummary: readonly SportsEplWinnerComparabilityTopicSummary[];
  basisFragmentationSummary: {
    blockerCounts: Record<string, number>;
    topicBlockers: readonly {
      canonicalTopicKey: string | null;
      reasons: readonly string[];
      venuesPresent: readonly SportsEplWinnerVenue[];
    }[];
    unresolvedRows: readonly {
      venue: SportsEplWinnerVenue;
      venueMarketId: string;
      title: string;
      reason: string;
    }[];
  };
  finalDecision: SportsEplWinnerFinalDecision;
}

const TARGET_TOPIC_KEY = "SPORTS|LEAGUE_WINNER|EPL|2025_2026" as const;
const TARGET_VENUES = ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"] as const;

const CLUB_NORMALIZATION_RULES: ReadonlyArray<[string, RegExp]> = [
  ["arsenal", /\barsenal\b/i],
  ["aston_villa", /\baston villa\b/i],
  ["bournemouth", /\bbournemouth\b/i],
  ["brentford", /\bbrentford\b/i],
  ["brighton", /\bbrighton\b/i],
  ["burnley", /\bburnley\b/i],
  ["chelsea", /\bchelsea\b/i],
  ["crystal_palace", /\bcrystal palace\b/i],
  ["everton", /\beverton\b/i],
  ["fulham", /\bfulham\b/i],
  ["leeds_united", /\bleeds\b/i],
  ["liverpool", /\bliverpool\b/i],
  ["manchester_city", /\bman(?:chester)?\s*city\b/i],
  ["manchester_united", /\bman(?:chester)?\s*united\b/i],
  ["newcastle_united", /\bnewcastle\b/i],
  ["nottingham_forest", /\bnottm(?:ingham)?\s*forest\b|\bnottingham forest\b/i],
  ["sunderland", /\bsunderland\b/i],
  ["tottenham_hotspur", /\btottenham\b/i],
  ["west_ham_united", /\bwest ham\b/i],
  ["wolverhampton_wanderers", /\bwolves\b|\bwolverhampton\b/i],
  ["other", /\bother\b|none of the listed teams/i]
] as const;

const CLUB_DISPLAY_NAMES: Record<string, string> = {
  arsenal: "Arsenal",
  aston_villa: "Aston Villa",
  bournemouth: "Bournemouth",
  brentford: "Brentford",
  brighton: "Brighton",
  burnley: "Burnley",
  chelsea: "Chelsea",
  crystal_palace: "Crystal Palace",
  everton: "Everton",
  fulham: "Fulham",
  leeds_united: "Leeds United",
  liverpool: "Liverpool",
  manchester_city: "Manchester City",
  manchester_united: "Manchester United",
  newcastle_united: "Newcastle United",
  nottingham_forest: "Nottingham Forest",
  sunderland: "Sunderland",
  tottenham_hotspur: "Tottenham Hotspur",
  west_ham_united: "West Ham United",
  wolverhampton_wanderers: "Wolverhampton Wanderers",
  other: "Other"
};

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

const normalizeClubId = (value: string): string | null => {
  for (const [clubId, pattern] of CLUB_NORMALIZATION_RULES) {
    if (pattern.test(value)) {
      return clubId;
    }
  }
  return null;
};

const toNormalizedTopicRow = (row: SportsEplWinnerExtractedRow): SportsEplWinnerNormalizedTopicRow => {
  const combined = `${row.title} ${row.rulesText ?? ""} ${row.clubLabel}`;
  const canonicalClubId = normalizeClubId(combined);
  const topicKey =
    /\bpremier league\b/i.test(combined) || /\benglish premier league\b/i.test(combined)
      ? TARGET_TOPIC_KEY
      : null;

  return {
    interpretedContractId: row.interpretedContractId,
    venue: row.venue,
    venueMarketId: row.venueMarketId,
    title: row.title,
    canonicalFamily: "LEAGUE_WINNER",
    canonicalTopicKey: topicKey,
    canonicalCompetition: topicKey === null ? null : "EPL",
    canonicalSeason: topicKey === null ? null : "2025_2026",
    canonicalClubId,
    interpretationNotes: [
      `club_label=${row.clubLabel}`,
      row.rulesText ? "rules_present" : "rules_missing"
    ],
    rejectionReason:
      topicKey === null ? "OUT_OF_SCOPE_FOR_EPL_2025_2026_WINNER"
      : canonicalClubId === null ? "CLUB_IDENTITY_UNRESOLVED"
      : canonicalClubId === "other" ? "OTHERS_EXCLUDED"
      : null
  };
};

const deriveRuleCompatibility = (
  rows: readonly SportsEplWinnerNormalizedTopicRow[],
  sourceRowsById: ReadonlyMap<string, SportsEplWinnerExtractedRow>
): SportsEplWinnerRuleCompatibilityClass => {
  const normalizedRuleTexts = new Set(
    rows
      .map((row) => sourceRowsById.get(row.interpretedContractId)?.rulesText ?? row.title)
      .map((value) => normalizeFreeText(value).replace(/\s+/g, " ").trim())
      .filter((value) => value.length > 0)
  );

  return normalizedRuleTexts.size <= 1 ? "EXACT_RULE_COMPATIBLE" : "SEMANTICALLY_COMPATIBLE_REWORDING";
};

export const buildSportsEplWinnerFamilyArtifacts = (
  rows: readonly SportsEplWinnerExtractedRow[]
): SportsEplWinnerFoundationArtifacts => {
  const rowsFetchedByVenue: Record<string, number> = {};
  const rowsAdmittedByVenue: Record<string, number> = {};
  const rowsRejectedByReason: Record<string, number> = {};
  const rowsAdmittedByTopicCandidate: Record<string, number> = {};
  const unresolvedRows: Array<{
    venue: SportsEplWinnerVenue;
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

  const admittedRows = normalizedTopicRows.filter((row) => row.rejectionReason === null && row.canonicalTopicKey === TARGET_TOPIC_KEY);
  const clubVenues = new Map<string, Set<SportsEplWinnerVenue>>();
  const excludedOutcomes = new Map<string, { label: string; reason: string; venues: Set<SportsEplWinnerVenue> }>();

  for (const row of admittedRows) {
    const clubId = row.canonicalClubId;
    if (!clubId) {
      continue;
    }
    const venues = clubVenues.get(clubId) ?? new Set<SportsEplWinnerVenue>();
    venues.add(row.venue);
    clubVenues.set(clubId, venues);
  }

  for (const [clubId, venues] of clubVenues.entries()) {
    if (venues.size < 2) {
      excludedOutcomes.set(`${clubId}|NOT_SHARED`, {
        label: CLUB_DISPLAY_NAMES[clubId] ?? clubId,
        reason: "NOT_SHARED",
        venues
      });
    }
  }

  const venuesPresent = [...new Set(admittedRows.map((row) => row.venue))].sort() as SportsEplWinnerVenue[];
  const pairSharedNamedOutcomes = [...clubVenues.entries()]
    .filter(([, venues]) => venues.size >= 2)
    .map(([clubId]) => clubId)
    .sort();
  const triSharedNamedOutcomes = [...clubVenues.entries()]
    .filter(([, venues]) => venues.size >= 3)
    .map(([clubId]) => clubId)
    .sort();
  const quadSharedNamedOutcomes = [...clubVenues.entries()]
    .filter(([, venues]) => venues.size >= 4)
    .map(([clubId]) => clubId)
    .sort();
  const ruleCompatibilityClassification = deriveRuleCompatibility(admittedRows, sourceRowsById);

  const fragmentationLabel: SportsEplWinnerFragmentationLabel =
    admittedRows.length === 0 ? "FAMILY_REFRESHED_NO_SUPPLY"
    : venuesPresent.length <= 1 ? "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
    : "FAMILY_REFRESHED_SHARED_CORE_EXISTS";

  const comparabilitySummary: SportsEplWinnerComparabilityTopicSummary[] = admittedRows.length === 0 ? [] : [{
    canonicalTopicKey: TARGET_TOPIC_KEY,
    venuesPresent,
    pairSharedNamedOutcomesCount: pairSharedNamedOutcomes.length,
    triSharedNamedOutcomesCount: triSharedNamedOutcomes.length,
    quadSharedNamedOutcomesCount: quadSharedNamedOutcomes.length,
    excludedOutcomesCount: excludedOutcomes.size,
    ruleCompatibilityClassification,
    fragmentationLabel,
    matcherCandidate: pairSharedNamedOutcomes.length > 0,
    sharedNamedOutcomes: pairSharedNamedOutcomes.map((clubId) => CLUB_DISPLAY_NAMES[clubId] ?? clubId),
    excludedOutcomes: [...excludedOutcomes.values()].map((entry) => ({
      label: entry.label,
      reason: entry.reason,
      venues: [...entry.venues].sort()
    })),
    notes: [
      `target_venues=${TARGET_VENUES.join("|")}`,
      `quad_shared_core=${quadSharedNamedOutcomes.map((clubId) => CLUB_DISPLAY_NAMES[clubId] ?? clubId).join("|") || "none"}`,
      "grouped_sibling_binary_market_reconstruction"
    ]
  }];

  const blockerCounts: Record<string, number> = {};
  if (!rowsAdmittedByVenue.LIMITLESS) increment(blockerCounts, "limitless_not_admitted");
  if (!rowsAdmittedByVenue.OPINION) increment(blockerCounts, "opinion_not_admitted");
  if (!rowsAdmittedByVenue.POLYMARKET) increment(blockerCounts, "polymarket_not_admitted");
  if (!rowsAdmittedByVenue.PREDICT) increment(blockerCounts, "predict_not_admitted");
  if (quadSharedNamedOutcomes.length === 0) increment(blockerCounts, "strict_quad_shared_core_absent");

  const finalDecision: SportsEplWinnerFinalDecision = {
    overallFamilyDecision:
      admittedRows.length === 0 ? "SPORTS_EPL_WINNER_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE"
      : venuesPresent.length <= 1 ? "SPORTS_EPL_WINNER_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
      : "SPORTS_EPL_WINNER_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND",
    bestCandidateTopicKey: pairSharedNamedOutcomes.length > 0 ? TARGET_TOPIC_KEY : null,
    familySupplyCredible: admittedRows.length > 0,
    operatorCredible: pairSharedNamedOutcomes.length > 0,
    matcherFollowUpJustified: pairSharedNamedOutcomes.length > 0,
    singleBestNextAction:
      pairSharedNamedOutcomes.length > 0
        ? `Run a narrow matcher pass for ${TARGET_TOPIC_KEY}, preserving the four-club shared core and excluding venue-only tails.`
        : "Keep EPL winner on a narrow supply-repair track until at least one exact shared club core is repo-proven."
  };

  return {
    normalizedTopicRows,
    fetchSummaryInput: {
      rowsFetchedByVenue,
      rowsAdmittedByVenue
    },
    admissionSummary: {
      totalAdmittedLeagueWinnerRows: admittedRows.length,
      rowsRejectedByReason,
      rowsAdmittedByTopicCandidate,
      venueBreakdown: rowsAdmittedByVenue
    },
    comparabilitySummary,
    basisFragmentationSummary: {
      blockerCounts,
      topicBlockers: admittedRows.length === 0 ? [{
        canonicalTopicKey: TARGET_TOPIC_KEY,
        reasons: Object.keys(blockerCounts),
        venuesPresent
      }] : [],
      unresolvedRows
    },
    finalDecision
  };
};
