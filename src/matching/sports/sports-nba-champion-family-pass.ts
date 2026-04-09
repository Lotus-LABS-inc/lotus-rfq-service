import { normalizeFreeText } from "../../canonical/canonicalization-types.js";

export type SportsNbaChampionVenue = "LIMITLESS" | "OPINION" | "POLYMARKET" | "PREDICT";

export type SportsNbaChampionRuleCompatibilityClass =
  | "EXACT_RULE_COMPATIBLE"
  | "SEMANTICALLY_COMPATIBLE_REWORDING";

export type SportsNbaChampionFinalDecisionLabel =
  | "SPORTS_NBA_CHAMPION_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE"
  | "SPORTS_NBA_CHAMPION_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
  | "SPORTS_NBA_CHAMPION_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND";

export type SportsNbaChampionFragmentationLabel =
  | "FAMILY_REFRESHED_NO_SUPPLY"
  | "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
  | "FAMILY_REFRESHED_SHARED_CORE_EXISTS";

export interface SportsNbaChampionExtractedRow {
  interpretedContractId: string;
  venue: SportsNbaChampionVenue;
  venueMarketId: string;
  sourceUrl: string;
  title: string;
  rulesText: string | null;
  teamLabel: string;
}

export interface SportsNbaChampionNormalizedTopicRow {
  interpretedContractId: string;
  venue: SportsNbaChampionVenue;
  venueMarketId: string;
  title: string;
  canonicalFamily: "TOURNAMENT_WINNER";
  canonicalTopicKey: string | null;
  canonicalCompetition: "NBA" | null;
  canonicalSeason: "2025_2026" | null;
  canonicalTeamId: string | null;
  interpretationNotes: readonly string[];
  rejectionReason: string | null;
}

export interface SportsNbaChampionComparabilityTopicSummary {
  canonicalTopicKey: string;
  venuesPresent: readonly SportsNbaChampionVenue[];
  pairSharedNamedOutcomesCount: number;
  triSharedNamedOutcomesCount: number;
  quadSharedNamedOutcomesCount: number;
  excludedOutcomesCount: number;
  ruleCompatibilityClassification: SportsNbaChampionRuleCompatibilityClass;
  fragmentationLabel: SportsNbaChampionFragmentationLabel;
  matcherCandidate: boolean;
  sharedNamedOutcomes: readonly string[];
  excludedOutcomes: readonly {
    label: string;
    reason: string;
    venues: readonly SportsNbaChampionVenue[];
  }[];
  notes: readonly string[];
}

export interface SportsNbaChampionFinalDecision {
  overallFamilyDecision: SportsNbaChampionFinalDecisionLabel;
  bestCandidateTopicKey: string | null;
  familySupplyCredible: boolean;
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export interface SportsNbaChampionFoundationArtifacts {
  normalizedTopicRows: readonly SportsNbaChampionNormalizedTopicRow[];
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
  comparabilitySummary: readonly SportsNbaChampionComparabilityTopicSummary[];
  basisFragmentationSummary: {
    blockerCounts: Record<string, number>;
    topicBlockers: readonly {
      canonicalTopicKey: string | null;
      reasons: readonly string[];
      venuesPresent: readonly SportsNbaChampionVenue[];
    }[];
    unresolvedRows: readonly {
      venue: SportsNbaChampionVenue;
      venueMarketId: string;
      title: string;
      reason: string;
    }[];
  };
  finalDecision: SportsNbaChampionFinalDecision;
}

const TARGET_TOPIC_KEY = "SPORTS|TOURNAMENT_WINNER|NBA|2025_2026" as const;
const TARGET_VENUES = ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"] as const;

const TEAM_NORMALIZATION_RULES: ReadonlyArray<[string, RegExp]> = [
  ["atlanta_hawks", /\batlanta hawks\b/i],
  ["boston_celtics", /\bboston celtics\b/i],
  ["brooklyn_nets", /\bbrooklyn nets\b/i],
  ["charlotte_hornets", /\bcharlotte hornets\b/i],
  ["chicago_bulls", /\bchicago bulls\b/i],
  ["cleveland_cavaliers", /\bcleveland cavaliers\b/i],
  ["dallas_mavericks", /\bdallas mavericks\b/i],
  ["denver_nuggets", /\bdenver nuggets\b/i],
  ["detroit_pistons", /\bdetroit pistons\b/i],
  ["golden_state_warriors", /\bgolden state warriors\b/i],
  ["houston_rockets", /\bhouston rockets\b/i],
  ["indiana_pacers", /\bindiana pacers\b/i],
  ["los_angeles_clippers", /\blos angeles clippers\b/i],
  ["los_angeles_lakers", /\blos angeles lakers\b/i],
  ["memphis_grizzlies", /\bmemphis grizzlies\b/i],
  ["miami_heat", /\bmiami heat\b/i],
  ["milwaukee_bucks", /\bmilwaukee bucks\b/i],
  ["minnesota_timberwolves", /\bminnesota timberwolves\b/i],
  ["new_orleans_pelicans", /\bnew orleans pelicans\b/i],
  ["new_york_knicks", /\bnew york knicks\b/i],
  ["oklahoma_city_thunder", /\boklahoma city thunder\b/i],
  ["orlando_magic", /\borlando magic\b/i],
  ["philadelphia_76ers", /\bphiladelphia 76ers\b|\bphiladelphia seventy[- ]sixers\b/i],
  ["phoenix_suns", /\bphoenix suns\b/i],
  ["portland_trail_blazers", /\bportland trail blazers\b/i],
  ["sacramento_kings", /\bsacramento kings\b/i],
  ["san_antonio_spurs", /\bsan antonio spurs\b/i],
  ["toronto_raptors", /\btoronto raptors\b/i],
  ["utah_jazz", /\butah jazz\b/i],
  ["washington_wizards", /\bwashington wizards\b/i],
  ["other", /\bother\b|none of the listed teams/i]
] as const;

const TEAM_DISPLAY_NAMES: Record<string, string> = {
  atlanta_hawks: "Atlanta Hawks",
  boston_celtics: "Boston Celtics",
  brooklyn_nets: "Brooklyn Nets",
  charlotte_hornets: "Charlotte Hornets",
  chicago_bulls: "Chicago Bulls",
  cleveland_cavaliers: "Cleveland Cavaliers",
  dallas_mavericks: "Dallas Mavericks",
  denver_nuggets: "Denver Nuggets",
  detroit_pistons: "Detroit Pistons",
  golden_state_warriors: "Golden State Warriors",
  houston_rockets: "Houston Rockets",
  indiana_pacers: "Indiana Pacers",
  los_angeles_clippers: "Los Angeles Clippers",
  los_angeles_lakers: "Los Angeles Lakers",
  memphis_grizzlies: "Memphis Grizzlies",
  miami_heat: "Miami Heat",
  milwaukee_bucks: "Milwaukee Bucks",
  minnesota_timberwolves: "Minnesota Timberwolves",
  new_orleans_pelicans: "New Orleans Pelicans",
  new_york_knicks: "New York Knicks",
  oklahoma_city_thunder: "Oklahoma City Thunder",
  orlando_magic: "Orlando Magic",
  philadelphia_76ers: "Philadelphia 76ers",
  phoenix_suns: "Phoenix Suns",
  portland_trail_blazers: "Portland Trail Blazers",
  sacramento_kings: "Sacramento Kings",
  san_antonio_spurs: "San Antonio Spurs",
  toronto_raptors: "Toronto Raptors",
  utah_jazz: "Utah Jazz",
  washington_wizards: "Washington Wizards",
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
  row: SportsNbaChampionExtractedRow
): SportsNbaChampionNormalizedTopicRow => {
  const combined = `${row.title} ${row.rulesText ?? ""} ${row.teamLabel}`;
  const canonicalTeamId = normalizeTeamId(combined);
  const topicKey = /\b(?:2026 )?nba (?:champion|finals)\b/i.test(combined) ? TARGET_TOPIC_KEY : null;

  return {
    interpretedContractId: row.interpretedContractId,
    venue: row.venue,
    venueMarketId: row.venueMarketId,
    title: row.title,
    canonicalFamily: "TOURNAMENT_WINNER",
    canonicalTopicKey: topicKey,
    canonicalCompetition: topicKey === null ? null : "NBA",
    canonicalSeason: topicKey === null ? null : "2025_2026",
    canonicalTeamId,
    interpretationNotes: [
      `team_label=${row.teamLabel}`,
      row.rulesText ? "rules_present" : "rules_missing"
    ],
    rejectionReason:
      topicKey === null ? "OUT_OF_SCOPE_FOR_NBA_2025_2026_CHAMPION"
      : canonicalTeamId === null ? "TEAM_IDENTITY_UNRESOLVED"
      : canonicalTeamId === "other" ? "OTHERS_EXCLUDED"
      : null
  };
};

const deriveRuleCompatibility = (
  rows: readonly SportsNbaChampionNormalizedTopicRow[],
  sourceRowsById: ReadonlyMap<string, SportsNbaChampionExtractedRow>
): SportsNbaChampionRuleCompatibilityClass => {
  const normalizedRuleTexts = new Set(
    rows
      .map((row) => sourceRowsById.get(row.interpretedContractId)?.rulesText ?? row.title)
      .map((value) => normalizeFreeText(value).replace(/\s+/g, " ").trim())
      .filter((value) => value.length > 0)
  );

  return normalizedRuleTexts.size <= 1 ? "EXACT_RULE_COMPATIBLE" : "SEMANTICALLY_COMPATIBLE_REWORDING";
};

export const buildSportsNbaChampionFamilyArtifacts = (
  rows: readonly SportsNbaChampionExtractedRow[]
): SportsNbaChampionFoundationArtifacts => {
  const rowsFetchedByVenue: Record<string, number> = {};
  const rowsAdmittedByVenue: Record<string, number> = {};
  const rowsRejectedByReason: Record<string, number> = {};
  const rowsAdmittedByTopicCandidate: Record<string, number> = {};
  const unresolvedRows: Array<{
    venue: SportsNbaChampionVenue;
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
  const teamVenues = new Map<string, Set<SportsNbaChampionVenue>>();
  const excludedOutcomes = new Map<
    string,
    { label: string; reason: string; venues: Set<SportsNbaChampionVenue> }
  >();

  for (const row of admittedRows) {
    const teamId = row.canonicalTeamId;
    if (!teamId) {
      continue;
    }
    const venues = teamVenues.get(teamId) ?? new Set<SportsNbaChampionVenue>();
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

  const venuesPresent = [...new Set(admittedRows.map((row) => row.venue))].sort() as SportsNbaChampionVenue[];
  const sharedNamedOutcomes = [...teamVenues.entries()]
    .filter(([, venues]) => venues.size >= 2)
    .map(([teamId]) => TEAM_DISPLAY_NAMES[teamId] ?? teamId)
    .sort((left, right) => left.localeCompare(right));

  const pairSharedNamedOutcomesCount = [...teamVenues.values()].filter((venues) => venues.size >= 2).length;
  const triSharedNamedOutcomesCount = [...teamVenues.values()].filter((venues) => venues.size >= 3).length;
  const quadSharedNamedOutcomesCount = [...teamVenues.values()].filter((venues) => venues.size >= 4).length;
  const matcherCandidate = venuesPresent.length >= 2 && pairSharedNamedOutcomesCount > 0;
  const fragmentationLabel: SportsNbaChampionFragmentationLabel =
    admittedRows.length === 0 ? "FAMILY_REFRESHED_NO_SUPPLY"
    : venuesPresent.length === 1 ? "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
    : pairSharedNamedOutcomesCount > 0 ? "FAMILY_REFRESHED_SHARED_CORE_EXISTS"
    : "FAMILY_REFRESHED_SINGLE_VENUE_ONLY";

  const ruleCompatibilityClassification = deriveRuleCompatibility(admittedRows, sourceRowsById);

  const comparabilitySummary: SportsNbaChampionComparabilityTopicSummary[] = admittedRows.length === 0
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
          venues: [...item.venues].sort() as SportsNbaChampionVenue[]
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

  const finalDecision: SportsNbaChampionFinalDecision = {
    overallFamilyDecision:
      admittedRows.length === 0 ? "SPORTS_NBA_CHAMPION_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE"
      : venuesPresent.length === 1 ? "SPORTS_NBA_CHAMPION_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
      : matcherCandidate ? "SPORTS_NBA_CHAMPION_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND"
      : "SPORTS_NBA_CHAMPION_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE",
    bestCandidateTopicKey: matcherCandidate ? TARGET_TOPIC_KEY : null,
    familySupplyCredible: admittedRows.length > 0,
    operatorCredible: matcherCandidate,
    matcherFollowUpJustified: matcherCandidate,
    singleBestNextAction: matcherCandidate
      ? "run a narrow matcher pass for SPORTS|TOURNAMENT_WINNER|NBA|2025_2026, preserving the strict shared core and excluding venue-only tails."
      : admittedRows.length === 0
        ? "continue targeted venue repair for NBA champion discovery before attempting matcher work."
        : "continue NBA champion venue reconciliation until a shared named-outcome core exists."
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
