import { normalizeFreeText } from "../../canonical/canonicalization-types.js";

export type SportsLaLigaWinnerVenue = "LIMITLESS" | "OPINION" | "POLYMARKET" | "PREDICT";

export type SportsLaLigaWinnerRuleCompatibilityClass =
  | "EXACT_RULE_COMPATIBLE"
  | "SEMANTICALLY_COMPATIBLE_REWORDING";

export type SportsLaLigaWinnerFinalDecisionLabel =
  | "SPORTS_LA_LIGA_WINNER_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE"
  | "SPORTS_LA_LIGA_WINNER_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
  | "SPORTS_LA_LIGA_WINNER_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND";

export type SportsLaLigaWinnerFragmentationLabel =
  | "FAMILY_REFRESHED_NO_SUPPLY"
  | "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
  | "FAMILY_REFRESHED_SHARED_CORE_EXISTS";

export interface SportsLaLigaWinnerExtractedRow {
  interpretedContractId: string;
  venue: SportsLaLigaWinnerVenue;
  venueMarketId: string;
  sourceUrl: string;
  title: string;
  rulesText: string | null;
  clubLabel: string;
}

export interface SportsLaLigaWinnerNormalizedTopicRow {
  interpretedContractId: string;
  venue: SportsLaLigaWinnerVenue;
  venueMarketId: string;
  title: string;
  canonicalFamily: "LEAGUE_WINNER";
  canonicalTopicKey: string | null;
  canonicalCompetition: "LA_LIGA" | null;
  canonicalSeason: "2025_2026" | null;
  canonicalClubId: string | null;
  interpretationNotes: readonly string[];
  rejectionReason: string | null;
}

export interface SportsLaLigaWinnerComparabilityTopicSummary {
  canonicalTopicKey: string;
  venuesPresent: readonly SportsLaLigaWinnerVenue[];
  pairSharedNamedOutcomesCount: number;
  triSharedNamedOutcomesCount: number;
  quadSharedNamedOutcomesCount: number;
  excludedOutcomesCount: number;
  ruleCompatibilityClassification: SportsLaLigaWinnerRuleCompatibilityClass;
  fragmentationLabel: SportsLaLigaWinnerFragmentationLabel;
  matcherCandidate: boolean;
  sharedNamedOutcomes: readonly string[];
  excludedOutcomes: readonly {
    label: string;
    reason: string;
    venues: readonly SportsLaLigaWinnerVenue[];
  }[];
  notes: readonly string[];
}

export interface SportsLaLigaWinnerFinalDecision {
  overallFamilyDecision: SportsLaLigaWinnerFinalDecisionLabel;
  bestCandidateTopicKey: string | null;
  familySupplyCredible: boolean;
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export interface SportsLaLigaWinnerFoundationArtifacts {
  normalizedTopicRows: readonly SportsLaLigaWinnerNormalizedTopicRow[];
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
  comparabilitySummary: readonly SportsLaLigaWinnerComparabilityTopicSummary[];
  basisFragmentationSummary: {
    blockerCounts: Record<string, number>;
    topicBlockers: readonly {
      canonicalTopicKey: string | null;
      reasons: readonly string[];
      venuesPresent: readonly SportsLaLigaWinnerVenue[];
    }[];
    unresolvedRows: readonly {
      venue: SportsLaLigaWinnerVenue;
      venueMarketId: string;
      title: string;
      reason: string;
    }[];
  };
  finalDecision: SportsLaLigaWinnerFinalDecision;
}

const TARGET_TOPIC_KEY = "SPORTS|LEAGUE_WINNER|LA_LIGA|2025_2026" as const;
const TARGET_VENUES = ["LIMITLESS", "OPINION", "POLYMARKET", "PREDICT"] as const;

const CLUB_NORMALIZATION_RULES: ReadonlyArray<[string, RegExp]> = [
  ["barcelona", /\bbarcelona\b|\bbarca\b/i],
  ["real_madrid", /\breal madrid\b/i],
  ["atletico_madrid", /\batletico madrid\b|\batl[ée]tico madrid\b/i],
  ["athletic_bilbao", /\bathletic bilbao\b|\bathletic club\b/i],
  ["villarreal", /\bvillarreal\b/i],
  ["girona", /\bgirona\b/i],
  ["real_betis", /\bbetis\b|\breal betis\b/i],
  ["real_sociedad", /\breal sociedad\b/i],
  ["sevilla", /\bsevilla\b/i],
  ["valencia", /\bvalencia\b/i],
  ["other", /\bother\b|none of the listed clubs/i]
];

const CLUB_DISPLAY_NAMES: Record<string, string> = {
  barcelona: "Barcelona",
  real_madrid: "Real Madrid",
  atletico_madrid: "Atletico Madrid",
  athletic_bilbao: "Athletic Bilbao",
  villarreal: "Villarreal",
  girona: "Girona",
  real_betis: "Real Betis",
  real_sociedad: "Real Sociedad",
  sevilla: "Sevilla",
  valencia: "Valencia",
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

const toNormalizedTopicRow = (row: SportsLaLigaWinnerExtractedRow): SportsLaLigaWinnerNormalizedTopicRow => {
  const combined = `${row.title} ${row.rulesText ?? ""} ${row.clubLabel}`;
  const canonicalClubId = normalizeClubId(combined);
  const topicKey = /\bla liga\b/i.test(combined) ? TARGET_TOPIC_KEY : null;

  return {
    interpretedContractId: row.interpretedContractId,
    venue: row.venue,
    venueMarketId: row.venueMarketId,
    title: row.title,
    canonicalFamily: "LEAGUE_WINNER",
    canonicalTopicKey: topicKey,
    canonicalCompetition: topicKey === null ? null : "LA_LIGA",
    canonicalSeason: topicKey === null ? null : "2025_2026",
    canonicalClubId,
    interpretationNotes: [
      `club_label=${row.clubLabel}`,
      row.rulesText ? "rules_present" : "rules_missing"
    ],
    rejectionReason:
      topicKey === null ? "OUT_OF_SCOPE_FOR_LA_LIGA_2025_2026_WINNER"
      : canonicalClubId === null ? "CLUB_IDENTITY_UNRESOLVED"
      : canonicalClubId === "other" ? "OTHERS_EXCLUDED"
      : null
  };
};

const deriveRuleCompatibility = (
  rows: readonly SportsLaLigaWinnerNormalizedTopicRow[],
  sourceRowsById: ReadonlyMap<string, SportsLaLigaWinnerExtractedRow>
): SportsLaLigaWinnerRuleCompatibilityClass => {
  const normalizedRuleTexts = new Set(
    rows
      .map((row) => sourceRowsById.get(row.interpretedContractId)?.rulesText ?? row.title)
      .map((value) => normalizeFreeText(value).replace(/\s+/g, " ").trim())
      .filter((value) => value.length > 0)
  );

  return normalizedRuleTexts.size <= 1 ? "EXACT_RULE_COMPATIBLE" : "SEMANTICALLY_COMPATIBLE_REWORDING";
};

export const buildSportsLaLigaWinnerFamilyArtifacts = (
  rows: readonly SportsLaLigaWinnerExtractedRow[]
): SportsLaLigaWinnerFoundationArtifacts => {
  const rowsFetchedByVenue: Record<string, number> = {};
  const rowsAdmittedByVenue: Record<string, number> = {};
  const rowsRejectedByReason: Record<string, number> = {};
  const rowsAdmittedByTopicCandidate: Record<string, number> = {};
  const unresolvedRows: Array<{
    venue: SportsLaLigaWinnerVenue;
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
  const clubVenues = new Map<string, Set<SportsLaLigaWinnerVenue>>();
  const excludedOutcomes = new Map<string, { label: string; reason: string; venues: Set<SportsLaLigaWinnerVenue> }>();

  for (const row of admittedRows) {
    const clubId = row.canonicalClubId;
    if (!clubId) {
      continue;
    }
    const venues = clubVenues.get(clubId) ?? new Set<SportsLaLigaWinnerVenue>();
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

  const venuesPresent = [...new Set(admittedRows.map((row) => row.venue))].sort() as SportsLaLigaWinnerVenue[];
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

  const fragmentationLabel: SportsLaLigaWinnerFragmentationLabel =
    admittedRows.length === 0 ? "FAMILY_REFRESHED_NO_SUPPLY"
    : venuesPresent.length <= 1 ? "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
    : "FAMILY_REFRESHED_SHARED_CORE_EXISTS";

  const comparabilitySummary: SportsLaLigaWinnerComparabilityTopicSummary[] = admittedRows.length === 0 ? [] : [{
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

  const finalDecision: SportsLaLigaWinnerFinalDecision = {
    overallFamilyDecision:
      admittedRows.length === 0 ? "SPORTS_LA_LIGA_WINNER_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE"
      : venuesPresent.length <= 1 ? "SPORTS_LA_LIGA_WINNER_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
      : "SPORTS_LA_LIGA_WINNER_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND",
    bestCandidateTopicKey: pairSharedNamedOutcomes.length > 0 ? TARGET_TOPIC_KEY : null,
    familySupplyCredible: admittedRows.length > 0,
    operatorCredible: pairSharedNamedOutcomes.length > 0,
    matcherFollowUpJustified: pairSharedNamedOutcomes.length > 0,
    singleBestNextAction:
      pairSharedNamedOutcomes.length > 0
        ? `Run a narrow matcher pass for ${TARGET_TOPIC_KEY}, preserving the strict shared club core and excluding venue-only tails.`
        : "Keep La Liga winner on a narrow supply-repair track until at least one exact shared club core is repo-proven."
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
