import { normalizeFreeText } from "../../canonical/canonicalization-types.js";

export type SportsChampionsLeagueWinnerVenue = "LIMITLESS" | "OPINION" | "POLYMARKET" | "PREDICT";

export type SportsChampionsLeagueWinnerRuleCompatibilityClass =
  | "EXACT_RULE_COMPATIBLE"
  | "SEMANTICALLY_COMPATIBLE_REWORDING";

export type SportsChampionsLeagueWinnerFinalDecisionLabel =
  | "SPORTS_CHAMPIONS_LEAGUE_WINNER_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE"
  | "SPORTS_CHAMPIONS_LEAGUE_WINNER_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
  | "SPORTS_CHAMPIONS_LEAGUE_WINNER_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND";

export type SportsChampionsLeagueWinnerFragmentationLabel =
  | "FAMILY_REFRESHED_NO_SUPPLY"
  | "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
  | "FAMILY_REFRESHED_SHARED_CORE_EXISTS";

export interface SportsChampionsLeagueWinnerExtractedRow {
  interpretedContractId: string;
  venue: SportsChampionsLeagueWinnerVenue;
  venueMarketId: string;
  sourceUrl: string;
  title: string;
  rulesText: string | null;
  clubLabel: string;
}

export interface SportsChampionsLeagueWinnerNormalizedTopicRow {
  interpretedContractId: string;
  venue: SportsChampionsLeagueWinnerVenue;
  venueMarketId: string;
  title: string;
  canonicalFamily: "TOURNAMENT_WINNER";
  canonicalTopicKey: string | null;
  canonicalCompetition: "UEFA_CHAMPIONS_LEAGUE" | null;
  canonicalSeason: "2025_2026" | null;
  canonicalClubId: string | null;
  interpretationNotes: readonly string[];
  rejectionReason: string | null;
}

export interface SportsChampionsLeagueWinnerComparabilityTopicSummary {
  canonicalTopicKey: string;
  venuesPresent: readonly SportsChampionsLeagueWinnerVenue[];
  pairSharedNamedOutcomesCount: number;
  triSharedNamedOutcomesCount: number;
  quadSharedNamedOutcomesCount: number;
  excludedOutcomesCount: number;
  ruleCompatibilityClassification: SportsChampionsLeagueWinnerRuleCompatibilityClass;
  fragmentationLabel: SportsChampionsLeagueWinnerFragmentationLabel;
  matcherCandidate: boolean;
  sharedNamedOutcomes: readonly string[];
  excludedOutcomes: readonly {
    label: string;
    reason: string;
    venues: readonly SportsChampionsLeagueWinnerVenue[];
  }[];
  notes: readonly string[];
}

export interface SportsChampionsLeagueWinnerFinalDecision {
  overallFamilyDecision: SportsChampionsLeagueWinnerFinalDecisionLabel;
  bestCandidateTopicKey: string | null;
  familySupplyCredible: boolean;
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export interface SportsChampionsLeagueWinnerFoundationArtifacts {
  normalizedTopicRows: readonly SportsChampionsLeagueWinnerNormalizedTopicRow[];
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
  comparabilitySummary: readonly SportsChampionsLeagueWinnerComparabilityTopicSummary[];
  basisFragmentationSummary: {
    blockerCounts: Record<string, number>;
    topicBlockers: readonly {
      canonicalTopicKey: string | null;
      reasons: readonly string[];
      venuesPresent: readonly SportsChampionsLeagueWinnerVenue[];
    }[];
    unresolvedRows: readonly {
      venue: SportsChampionsLeagueWinnerVenue;
      venueMarketId: string;
      title: string;
      reason: string;
    }[];
  };
  finalDecision: SportsChampionsLeagueWinnerFinalDecision;
}

const TARGET_TOPIC_KEY = "SPORTS|TOURNAMENT_WINNER|UEFA_CHAMPIONS_LEAGUE|2025_2026" as const;
const TARGET_VENUES = ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"] as const;

const CLUB_NORMALIZATION_RULES: ReadonlyArray<[string, RegExp]> = [
  ["arsenal", /\barsenal\b/i],
  ["aston_villa", /\baston villa\b/i],
  ["atletico_madrid", /\batletico madrid\b|\batl[ée]tico madrid\b/i],
  ["barcelona", /\bbarcelona\b|\bbarca\b/i],
  ["bayern_munich", /\bbayern\b|\bbayern munich\b/i],
  ["borussia_dortmund", /\bdortmund\b|\bborussia dortmund\b/i],
  ["chelsea", /\bchelsea\b/i],
  ["inter_milan", /\binter milan\b|\binter\b/i],
  ["juventus", /\bjuventus\b/i],
  ["liverpool", /\bliverpool\b/i],
  ["manchester_city", /\bman(?:chester)?\s*city\b/i],
  ["paris_saint_germain", /\bparis saint[-\s]?germain\b|\bpsg\b/i],
  ["real_madrid", /\breal madrid\b/i],
  ["other", /\bother\b|none of the listed clubs/i]
] as const;

const CLUB_DISPLAY_NAMES: Record<string, string> = {
  arsenal: "Arsenal",
  aston_villa: "Aston Villa",
  atletico_madrid: "Atletico Madrid",
  barcelona: "Barcelona",
  bayern_munich: "Bayern Munich",
  borussia_dortmund: "Borussia Dortmund",
  chelsea: "Chelsea",
  inter_milan: "Inter Milan",
  juventus: "Juventus",
  liverpool: "Liverpool",
  manchester_city: "Manchester City",
  paris_saint_germain: "Paris Saint-Germain",
  real_madrid: "Real Madrid",
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

const toNormalizedTopicRow = (
  row: SportsChampionsLeagueWinnerExtractedRow
): SportsChampionsLeagueWinnerNormalizedTopicRow => {
  const combined = `${row.title} ${row.rulesText ?? ""} ${row.clubLabel}`;
  const canonicalClubId = normalizeClubId(combined);
  const topicKey = /\b(?:uefa )?champions league\b/i.test(combined) ? TARGET_TOPIC_KEY : null;

  return {
    interpretedContractId: row.interpretedContractId,
    venue: row.venue,
    venueMarketId: row.venueMarketId,
    title: row.title,
    canonicalFamily: "TOURNAMENT_WINNER",
    canonicalTopicKey: topicKey,
    canonicalCompetition: topicKey === null ? null : "UEFA_CHAMPIONS_LEAGUE",
    canonicalSeason: topicKey === null ? null : "2025_2026",
    canonicalClubId,
    interpretationNotes: [
      `club_label=${row.clubLabel}`,
      row.rulesText ? "rules_present" : "rules_missing"
    ],
    rejectionReason:
      topicKey === null ? "OUT_OF_SCOPE_FOR_CHAMPIONS_LEAGUE_2025_2026_WINNER"
      : canonicalClubId === null ? "CLUB_IDENTITY_UNRESOLVED"
      : canonicalClubId === "other" ? "OTHERS_EXCLUDED"
      : null
  };
};

const deriveRuleCompatibility = (
  rows: readonly SportsChampionsLeagueWinnerNormalizedTopicRow[],
  sourceRowsById: ReadonlyMap<string, SportsChampionsLeagueWinnerExtractedRow>
): SportsChampionsLeagueWinnerRuleCompatibilityClass => {
  const normalizedRuleTexts = new Set(
    rows
      .map((row) => sourceRowsById.get(row.interpretedContractId)?.rulesText ?? row.title)
      .map((value) => normalizeFreeText(value).replace(/\s+/g, " ").trim())
      .filter((value) => value.length > 0)
  );

  return normalizedRuleTexts.size <= 1 ? "EXACT_RULE_COMPATIBLE" : "SEMANTICALLY_COMPATIBLE_REWORDING";
};

export const buildSportsChampionsLeagueWinnerFamilyArtifacts = (
  rows: readonly SportsChampionsLeagueWinnerExtractedRow[]
): SportsChampionsLeagueWinnerFoundationArtifacts => {
  const rowsFetchedByVenue: Record<string, number> = {};
  const rowsAdmittedByVenue: Record<string, number> = {};
  const rowsRejectedByReason: Record<string, number> = {};
  const rowsAdmittedByTopicCandidate: Record<string, number> = {};
  const unresolvedRows: Array<{
    venue: SportsChampionsLeagueWinnerVenue;
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
  const clubVenues = new Map<string, Set<SportsChampionsLeagueWinnerVenue>>();
  const excludedOutcomes = new Map<
    string,
    { label: string; reason: string; venues: Set<SportsChampionsLeagueWinnerVenue> }
  >();

  for (const row of admittedRows) {
    const clubId = row.canonicalClubId;
    if (!clubId) {
      continue;
    }
    const venues = clubVenues.get(clubId) ?? new Set<SportsChampionsLeagueWinnerVenue>();
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

  const venuesPresent = [...new Set(admittedRows.map((row) => row.venue))].sort() as SportsChampionsLeagueWinnerVenue[];
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

  const fragmentationLabel: SportsChampionsLeagueWinnerFragmentationLabel =
    admittedRows.length === 0 ? "FAMILY_REFRESHED_NO_SUPPLY"
    : venuesPresent.length <= 1 ? "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
    : "FAMILY_REFRESHED_SHARED_CORE_EXISTS";

  const comparabilitySummary: SportsChampionsLeagueWinnerComparabilityTopicSummary[] =
    admittedRows.length === 0 ? [] : [{
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

  const finalDecision: SportsChampionsLeagueWinnerFinalDecision = {
    overallFamilyDecision:
      admittedRows.length === 0 ? "SPORTS_CHAMPIONS_LEAGUE_WINNER_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE"
      : venuesPresent.length <= 1 ? "SPORTS_CHAMPIONS_LEAGUE_WINNER_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
      : "SPORTS_CHAMPIONS_LEAGUE_WINNER_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND",
    bestCandidateTopicKey: pairSharedNamedOutcomes.length > 0 ? TARGET_TOPIC_KEY : null,
    familySupplyCredible: admittedRows.length > 0,
    operatorCredible: pairSharedNamedOutcomes.length > 0,
    matcherFollowUpJustified: pairSharedNamedOutcomes.length > 0,
    singleBestNextAction:
      pairSharedNamedOutcomes.length > 0
        ? `Run a narrow matcher pass for ${TARGET_TOPIC_KEY}, preserving the strict shared club core and excluding venue-only tails.`
        : "Keep Champions League winner on a narrow supply-repair track until at least one exact shared club core is repo-proven."
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
