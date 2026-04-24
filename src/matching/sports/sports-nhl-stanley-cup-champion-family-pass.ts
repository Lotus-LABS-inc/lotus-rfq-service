import { normalizeFreeText } from "../../canonical/canonicalization-types.js";

export type SportsNhlStanleyCupChampionVenue = "LIMITLESS" | "OPINION" | "POLYMARKET" | "PREDICT";

export type SportsNhlStanleyCupChampionRuleCompatibilityClass =
  | "EXACT_RULE_COMPATIBLE"
  | "SEMANTICALLY_COMPATIBLE_REWORDING";

export type SportsNhlStanleyCupChampionFinalDecisionLabel =
  | "SPORTS_NHL_STANLEY_CUP_CHAMPION_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE"
  | "SPORTS_NHL_STANLEY_CUP_CHAMPION_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
  | "SPORTS_NHL_STANLEY_CUP_CHAMPION_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND";

export type SportsNhlStanleyCupChampionFragmentationLabel =
  | "FAMILY_REFRESHED_NO_SUPPLY"
  | "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
  | "FAMILY_REFRESHED_SHARED_CORE_EXISTS";

export interface SportsNhlStanleyCupChampionExtractedRow {
  interpretedContractId: string;
  venue: SportsNhlStanleyCupChampionVenue;
  venueMarketId: string;
  sourceUrl: string;
  title: string;
  rulesText: string | null;
  teamLabel: string;
}

export interface SportsNhlStanleyCupChampionNormalizedTopicRow {
  interpretedContractId: string;
  venue: SportsNhlStanleyCupChampionVenue;
  venueMarketId: string;
  title: string;
  canonicalFamily: "TOURNAMENT_WINNER";
  canonicalTopicKey: string | null;
  canonicalCompetition: "NHL_STANLEY_CUP" | null;
  canonicalSeason: "2025_2026" | null;
  canonicalTeamId: string | null;
  interpretationNotes: readonly string[];
  rejectionReason: string | null;
}

export interface SportsNhlStanleyCupChampionComparabilityTopicSummary {
  canonicalTopicKey: string;
  venuesPresent: readonly SportsNhlStanleyCupChampionVenue[];
  pairSharedNamedOutcomesCount: number;
  triSharedNamedOutcomesCount: number;
  quadSharedNamedOutcomesCount: number;
  excludedOutcomesCount: number;
  ruleCompatibilityClassification: SportsNhlStanleyCupChampionRuleCompatibilityClass;
  fragmentationLabel: SportsNhlStanleyCupChampionFragmentationLabel;
  matcherCandidate: boolean;
  sharedNamedOutcomes: readonly string[];
  excludedOutcomes: readonly {
    label: string;
    reason: string;
    venues: readonly SportsNhlStanleyCupChampionVenue[];
  }[];
  notes: readonly string[];
}

export interface SportsNhlStanleyCupChampionFinalDecision {
  overallFamilyDecision: SportsNhlStanleyCupChampionFinalDecisionLabel;
  bestCandidateTopicKey: string | null;
  familySupplyCredible: boolean;
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export interface SportsNhlStanleyCupChampionFoundationArtifacts {
  normalizedTopicRows: readonly SportsNhlStanleyCupChampionNormalizedTopicRow[];
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
  comparabilitySummary: readonly SportsNhlStanleyCupChampionComparabilityTopicSummary[];
  basisFragmentationSummary: {
    blockerCounts: Record<string, number>;
    topicBlockers: readonly {
      canonicalTopicKey: string | null;
      reasons: readonly string[];
      venuesPresent: readonly SportsNhlStanleyCupChampionVenue[];
    }[];
    unresolvedRows: readonly {
      venue: SportsNhlStanleyCupChampionVenue;
      venueMarketId: string;
      title: string;
      reason: string;
    }[];
  };
  finalDecision: SportsNhlStanleyCupChampionFinalDecision;
}

const TARGET_TOPIC_KEY = "SPORTS|TOURNAMENT_WINNER|NHL_STANLEY_CUP|2025_2026" as const;
const TARGET_VENUES = ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"] as const;

const TEAM_NORMALIZATION_RULES: ReadonlyArray<[string, RegExp]> = [
  ["anaheim_ducks", /\banaheim ducks\b/i],
  ["boston_bruins", /\bboston bruins\b/i],
  ["buffalo_sabres", /\bbuffalo sabres\b/i],
  ["calgary_flames", /\bcalgary flames\b/i],
  ["carolina_hurricanes", /\bcarolina hurricanes\b/i],
  ["chicago_blackhawks", /\bchicago blackhawks\b/i],
  ["colorado_avalanche", /\bcolorado avalanche\b/i],
  ["columbus_blue_jackets", /\bcolumbus blue jackets\b/i],
  ["dallas_stars", /\bdallas stars\b/i],
  ["detroit_red_wings", /\bdetroit red wings\b/i],
  ["edmonton_oilers", /\bedmonton oilers\b/i],
  ["florida_panthers", /\bflorida panthers\b/i],
  ["los_angeles_kings", /\blos angeles kings\b/i],
  ["minnesota_wild", /\bminnesota wild\b/i],
  ["montreal_canadiens", /\bmontreal canadiens\b/i],
  ["nashville_predators", /\bnashville predators\b/i],
  ["new_jersey_devils", /\bnew jersey devils\b/i],
  ["new_york_islanders", /\bnew york islanders\b/i],
  ["new_york_rangers", /\bnew york rangers\b/i],
  ["ottawa_senators", /\bottawa senators\b/i],
  ["philadelphia_flyers", /\bphiladelphia flyers\b/i],
  ["pittsburgh_penguins", /\bpittsburgh penguins\b/i],
  ["san_jose_sharks", /\bsan jose sharks\b/i],
  ["seattle_kraken", /\bseattle kraken\b/i],
  ["st_louis_blues", /\bst\.?\s*louis blues\b/i],
  ["tampa_bay_lightning", /\btampa bay lightning\b/i],
  ["toronto_maple_leafs", /\btoronto maple leafs\b/i],
  ["utah_mammoth", /\butah mammoth\b|\butah hockey club\b/i],
  ["vancouver_canucks", /\bvancouver canucks\b/i],
  ["vegas_golden_knights", /\bvegas golden knights\b/i],
  ["washington_capitals", /\bwashington capitals\b/i],
  ["winnipeg_jets", /\bwinnipeg jets\b/i],
  ["other", /\bother\b|none of the listed teams/i]
] as const;

const TEAM_DISPLAY_NAMES: Record<string, string> = {
  anaheim_ducks: "Anaheim Ducks",
  boston_bruins: "Boston Bruins",
  buffalo_sabres: "Buffalo Sabres",
  calgary_flames: "Calgary Flames",
  carolina_hurricanes: "Carolina Hurricanes",
  chicago_blackhawks: "Chicago Blackhawks",
  colorado_avalanche: "Colorado Avalanche",
  columbus_blue_jackets: "Columbus Blue Jackets",
  dallas_stars: "Dallas Stars",
  detroit_red_wings: "Detroit Red Wings",
  edmonton_oilers: "Edmonton Oilers",
  florida_panthers: "Florida Panthers",
  los_angeles_kings: "Los Angeles Kings",
  minnesota_wild: "Minnesota Wild",
  montreal_canadiens: "Montreal Canadiens",
  nashville_predators: "Nashville Predators",
  new_jersey_devils: "New Jersey Devils",
  new_york_islanders: "New York Islanders",
  new_york_rangers: "New York Rangers",
  ottawa_senators: "Ottawa Senators",
  philadelphia_flyers: "Philadelphia Flyers",
  pittsburgh_penguins: "Pittsburgh Penguins",
  san_jose_sharks: "San Jose Sharks",
  seattle_kraken: "Seattle Kraken",
  st_louis_blues: "St. Louis Blues",
  tampa_bay_lightning: "Tampa Bay Lightning",
  toronto_maple_leafs: "Toronto Maple Leafs",
  utah_mammoth: "Utah Mammoth",
  vancouver_canucks: "Vancouver Canucks",
  vegas_golden_knights: "Vegas Golden Knights",
  washington_capitals: "Washington Capitals",
  winnipeg_jets: "Winnipeg Jets",
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
  row: SportsNhlStanleyCupChampionExtractedRow
): SportsNhlStanleyCupChampionNormalizedTopicRow => {
  const combined = `${row.title} ${row.rulesText ?? ""} ${row.teamLabel}`;
  const canonicalTeamId = normalizeTeamId(combined);
  const topicKey = /\b(?:2026 )?(?:nhl )?stanley cup champion\b/i.test(combined) ? TARGET_TOPIC_KEY : null;

  return {
    interpretedContractId: row.interpretedContractId,
    venue: row.venue,
    venueMarketId: row.venueMarketId,
    title: row.title,
    canonicalFamily: "TOURNAMENT_WINNER",
    canonicalTopicKey: topicKey,
    canonicalCompetition: topicKey === null ? null : "NHL_STANLEY_CUP",
    canonicalSeason: topicKey === null ? null : "2025_2026",
    canonicalTeamId,
    interpretationNotes: [
      `team_label=${row.teamLabel}`,
      row.rulesText ? "rules_present" : "rules_missing"
    ],
    rejectionReason:
      topicKey === null ? "OUT_OF_SCOPE_FOR_NHL_STANLEY_CUP_2025_2026_CHAMPION"
      : canonicalTeamId === null ? "TEAM_IDENTITY_UNRESOLVED"
      : canonicalTeamId === "other" ? "OTHERS_EXCLUDED"
      : null
  };
};

const deriveRuleCompatibility = (
  rows: readonly SportsNhlStanleyCupChampionNormalizedTopicRow[],
  sourceRowsById: ReadonlyMap<string, SportsNhlStanleyCupChampionExtractedRow>
): SportsNhlStanleyCupChampionRuleCompatibilityClass => {
  const normalizedRuleTexts = new Set(
    rows
      .map((row) => sourceRowsById.get(row.interpretedContractId)?.rulesText ?? row.title)
      .map((value) => normalizeFreeText(value).replace(/\s+/g, " ").trim())
      .filter((value) => value.length > 0)
  );

  return normalizedRuleTexts.size <= 1 ? "EXACT_RULE_COMPATIBLE" : "SEMANTICALLY_COMPATIBLE_REWORDING";
};

export const buildSportsNhlStanleyCupChampionFamilyArtifacts = (
  rows: readonly SportsNhlStanleyCupChampionExtractedRow[]
): SportsNhlStanleyCupChampionFoundationArtifacts => {
  const rowsFetchedByVenue: Record<string, number> = {};
  const rowsAdmittedByVenue: Record<string, number> = {};
  const rowsRejectedByReason: Record<string, number> = {};
  const rowsAdmittedByTopicCandidate: Record<string, number> = {};
  const unresolvedRows: Array<{
    venue: SportsNhlStanleyCupChampionVenue;
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

  const teamVenues = new Map<string, Set<SportsNhlStanleyCupChampionVenue>>();
  const excludedOutcomes = new Map<
    string,
    { label: string; reason: string; venues: Set<SportsNhlStanleyCupChampionVenue> }
  >();

  for (const row of admittedRows) {
    const teamId = row.canonicalTeamId;
    if (!teamId) {
      continue;
    }
    const venues = teamVenues.get(teamId) ?? new Set<SportsNhlStanleyCupChampionVenue>();
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

  const venuesPresent = [...new Set(admittedRows.map((row) => row.venue))].sort() as SportsNhlStanleyCupChampionVenue[];
  const sharedNamedOutcomes = [...teamVenues.entries()]
    .filter(([, venues]) => venues.size >= 2)
    .map(([teamId]) => TEAM_DISPLAY_NAMES[teamId] ?? teamId)
    .sort((left, right) => left.localeCompare(right));

  const pairSharedNamedOutcomesCount = [...teamVenues.values()].filter((venues) => venues.size >= 2).length;
  const triSharedNamedOutcomesCount = [...teamVenues.values()].filter((venues) => venues.size >= 3).length;
  const quadSharedNamedOutcomesCount = [...teamVenues.values()].filter((venues) => venues.size >= 4).length;
  const matcherCandidate = venuesPresent.length >= 2 && pairSharedNamedOutcomesCount > 0;
  const fragmentationLabel: SportsNhlStanleyCupChampionFragmentationLabel =
    admittedRows.length === 0 ? "FAMILY_REFRESHED_NO_SUPPLY"
    : venuesPresent.length === 1 ? "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
    : pairSharedNamedOutcomesCount > 0 ? "FAMILY_REFRESHED_SHARED_CORE_EXISTS"
    : "FAMILY_REFRESHED_SINGLE_VENUE_ONLY";

  const ruleCompatibilityClassification = deriveRuleCompatibility(admittedRows, sourceRowsById);

  const comparabilitySummary: SportsNhlStanleyCupChampionComparabilityTopicSummary[] = admittedRows.length === 0
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
          venues: [...item.venues].sort() as SportsNhlStanleyCupChampionVenue[]
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

  const finalDecision: SportsNhlStanleyCupChampionFinalDecision = {
    overallFamilyDecision:
      admittedRows.length === 0 ? "SPORTS_NHL_STANLEY_CUP_CHAMPION_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE"
      : venuesPresent.length === 1 ? "SPORTS_NHL_STANLEY_CUP_CHAMPION_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
      : matcherCandidate ? "SPORTS_NHL_STANLEY_CUP_CHAMPION_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND"
      : "SPORTS_NHL_STANLEY_CUP_CHAMPION_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE",
    bestCandidateTopicKey: matcherCandidate ? TARGET_TOPIC_KEY : null,
    familySupplyCredible: admittedRows.length > 0,
    operatorCredible: matcherCandidate,
    matcherFollowUpJustified: matcherCandidate,
    singleBestNextAction: matcherCandidate
      ? "run a narrow matcher pass for SPORTS|TOURNAMENT_WINNER|NHL_STANLEY_CUP|2025_2026, preserving the strict shared core and excluding venue-only tails."
      : admittedRows.length === 0
        ? "continue targeted venue repair for NHL Stanley Cup champion discovery before attempting matcher work."
        : "continue NHL Stanley Cup venue reconciliation until a shared named-outcome core exists."
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
