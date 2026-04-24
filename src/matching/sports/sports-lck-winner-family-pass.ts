import { normalizeFreeText } from "../../canonical/canonicalization-types.js";

export type SportsLckWinnerVenue = "LIMITLESS" | "OPINION" | "POLYMARKET";

export type SportsLckWinnerRuleCompatibilityClass =
  | "EXACT_RULE_COMPATIBLE"
  | "SEMANTICALLY_COMPATIBLE_REWORDING";

export type SportsLckWinnerFinalDecisionLabel =
  | "SPORTS_LCK_WINNER_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE"
  | "SPORTS_LCK_WINNER_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
  | "SPORTS_LCK_WINNER_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND";

export type SportsLckWinnerFragmentationLabel =
  | "FAMILY_REFRESHED_NO_SUPPLY"
  | "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
  | "FAMILY_REFRESHED_SHARED_CORE_EXISTS";

export interface SportsLckWinnerExtractedRow {
  interpretedContractId: string;
  venue: SportsLckWinnerVenue;
  venueMarketId: string;
  sourceUrl: string;
  title: string;
  rulesText: string | null;
  teamLabel: string;
}

export interface SportsLckWinnerNormalizedTopicRow {
  interpretedContractId: string;
  venue: SportsLckWinnerVenue;
  venueMarketId: string;
  title: string;
  canonicalFamily: "LEAGUE_WINNER";
  canonicalTopicKey: string | null;
  canonicalCompetition: "LCK" | null;
  canonicalSeason: "2026" | null;
  canonicalTeamId: string | null;
  interpretationNotes: readonly string[];
  rejectionReason: string | null;
}

export interface SportsLckWinnerComparabilityTopicSummary {
  canonicalTopicKey: string;
  venuesPresent: readonly SportsLckWinnerVenue[];
  pairSharedNamedOutcomesCount: number;
  triSharedNamedOutcomesCount: number;
  excludedOutcomesCount: number;
  ruleCompatibilityClassification: SportsLckWinnerRuleCompatibilityClass;
  fragmentationLabel: SportsLckWinnerFragmentationLabel;
  matcherCandidate: boolean;
  sharedNamedOutcomes: readonly string[];
  excludedOutcomes: readonly {
    label: string;
    reason: string;
    venues: readonly SportsLckWinnerVenue[];
  }[];
  notes: readonly string[];
}

export interface SportsLckWinnerFinalDecision {
  overallFamilyDecision: SportsLckWinnerFinalDecisionLabel;
  bestCandidateTopicKey: string | null;
  familySupplyCredible: boolean;
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export interface SportsLckWinnerFoundationArtifacts {
  normalizedTopicRows: readonly SportsLckWinnerNormalizedTopicRow[];
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
  comparabilitySummary: readonly SportsLckWinnerComparabilityTopicSummary[];
  basisFragmentationSummary: {
    blockerCounts: Record<string, number>;
    topicBlockers: readonly {
      canonicalTopicKey: string | null;
      reasons: readonly string[];
      venuesPresent: readonly SportsLckWinnerVenue[];
    }[];
    unresolvedRows: readonly {
      venue: SportsLckWinnerVenue;
      venueMarketId: string;
      title: string;
      reason: string;
    }[];
  };
  finalDecision: SportsLckWinnerFinalDecision;
}

const TARGET_TOPIC_KEY = "SPORTS|LEAGUE_WINNER|LCK|2026" as const;
const TARGET_VENUES = ["LIMITLESS", "OPINION", "POLYMARKET"] as const;

const TEAM_NORMALIZATION_RULES: ReadonlyArray<[string, RegExp]> = [
  ["gen_g_esports", /\bgen\.?\s*g(?:\s*esports)?\b/i],
  ["freecs", /\bfreecs\b|\bdn freecs\b/i],
  ["dplus", /\bdplus\b|\bdplus kia\b|\bdk\b/i],
  ["t1", /\bt1\b/i],
  ["hanwha_life_esports", /\bhanwha life esports\b|\bhle\b/i],
  ["kt_rolster", /\bkt rolster\b|\bkt\b/i],
  ["drx", /\bdrx\b/i],
  ["nongshim_redforce", /\bnongshim redforce\b|\bns redforce\b/i]
] as const;

const TEAM_DISPLAY_NAMES: Record<string, string> = {
  gen_g_esports: "Gen.G Esports",
  freecs: "Freecs",
  dplus: "Dplus",
  t1: "T1",
  hanwha_life_esports: "Hanwha Life Esports",
  kt_rolster: "KT Rolster",
  drx: "DRX",
  nongshim_redforce: "Nongshim RedForce"
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

const toNormalizedTopicRow = (row: SportsLckWinnerExtractedRow): SportsLckWinnerNormalizedTopicRow => {
  const combined = `${row.title} ${row.rulesText ?? ""} ${row.teamLabel}`;
  const canonicalTeamId = normalizeTeamId(combined);
  const topicKey = /\b(?:lol:\s*)?lck\b.*\b2026\b.*\bseason winner\b|\blck 2026 season winner\b/i.test(combined)
    ? TARGET_TOPIC_KEY
    : null;

  return {
    interpretedContractId: row.interpretedContractId,
    venue: row.venue,
    venueMarketId: row.venueMarketId,
    title: row.title,
    canonicalFamily: "LEAGUE_WINNER",
    canonicalTopicKey: topicKey,
    canonicalCompetition: topicKey === null ? null : "LCK",
    canonicalSeason: topicKey === null ? null : "2026",
    canonicalTeamId,
    interpretationNotes: [
      `team_label=${row.teamLabel}`,
      row.rulesText ? "rules_present" : "rules_missing"
    ],
    rejectionReason:
      topicKey === null ? "OUT_OF_SCOPE_FOR_LCK_2026_SEASON_WINNER"
      : canonicalTeamId === null ? "TEAM_IDENTITY_UNRESOLVED"
      : null
  };
};

const deriveRuleCompatibility = (
  rows: readonly SportsLckWinnerNormalizedTopicRow[],
  sourceRowsById: ReadonlyMap<string, SportsLckWinnerExtractedRow>
): SportsLckWinnerRuleCompatibilityClass => {
  const normalizedRuleTexts = new Set(
    rows
      .map((row) => sourceRowsById.get(row.interpretedContractId)?.rulesText ?? row.title)
      .map((value) => normalizeFreeText(value).replace(/\s+/g, " ").trim())
      .filter((value) => value.length > 0)
  );

  return normalizedRuleTexts.size <= 1 ? "EXACT_RULE_COMPATIBLE" : "SEMANTICALLY_COMPATIBLE_REWORDING";
};

export const buildSportsLckWinnerFamilyArtifacts = (
  rows: readonly SportsLckWinnerExtractedRow[]
): SportsLckWinnerFoundationArtifacts => {
  const rowsFetchedByVenue: Record<string, number> = {};
  const rowsAdmittedByVenue: Record<string, number> = {};
  const rowsRejectedByReason: Record<string, number> = {};
  const rowsAdmittedByTopicCandidate: Record<string, number> = {};
  const unresolvedRows: Array<{
    venue: SportsLckWinnerVenue;
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
  const teamVenues = new Map<string, Set<SportsLckWinnerVenue>>();
  const excludedOutcomes = new Map<
    string,
    { label: string; reason: string; venues: Set<SportsLckWinnerVenue> }
  >();

  for (const row of admittedRows) {
    if (!row.canonicalTeamId) {
      continue;
    }
    const venues = teamVenues.get(row.canonicalTeamId) ?? new Set<SportsLckWinnerVenue>();
    venues.add(row.venue);
    teamVenues.set(row.canonicalTeamId, venues);
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

  const venuesPresent = [...new Set(admittedRows.map((row) => row.venue))].sort() as SportsLckWinnerVenue[];
  const sharedNamedOutcomes = [...teamVenues.entries()]
    .filter(([, venues]) => venues.size >= 2)
    .map(([teamId]) => TEAM_DISPLAY_NAMES[teamId] ?? teamId)
    .sort((left, right) => left.localeCompare(right));

  const pairSharedNamedOutcomesCount = [...teamVenues.values()].filter((venues) => venues.size >= 2).length;
  const triSharedNamedOutcomesCount = [...teamVenues.values()].filter((venues) => venues.size >= 3).length;
  const matcherCandidate = venuesPresent.length >= 2 && pairSharedNamedOutcomesCount > 0;
  const fragmentationLabel: SportsLckWinnerFragmentationLabel =
    admittedRows.length === 0 ? "FAMILY_REFRESHED_NO_SUPPLY"
    : venuesPresent.length === 1 ? "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
    : pairSharedNamedOutcomesCount > 0 ? "FAMILY_REFRESHED_SHARED_CORE_EXISTS"
    : "FAMILY_REFRESHED_SINGLE_VENUE_ONLY";

  const ruleCompatibilityClassification = deriveRuleCompatibility(admittedRows, sourceRowsById);

  const comparabilitySummary: SportsLckWinnerComparabilityTopicSummary[] = admittedRows.length === 0
    ? []
    : [{
      canonicalTopicKey: TARGET_TOPIC_KEY,
      venuesPresent,
      pairSharedNamedOutcomesCount,
      triSharedNamedOutcomesCount,
      excludedOutcomesCount: excludedOutcomes.size,
      ruleCompatibilityClassification,
      fragmentationLabel,
      matcherCandidate,
      sharedNamedOutcomes,
      excludedOutcomes: [...excludedOutcomes.values()]
        .map((item) => ({
          label: item.label,
          reason: item.reason,
          venues: [...item.venues].sort() as SportsLckWinnerVenue[]
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

  const finalDecision: SportsLckWinnerFinalDecision = {
    overallFamilyDecision:
      admittedRows.length === 0 ? "SPORTS_LCK_WINNER_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE"
      : venuesPresent.length === 1 ? "SPORTS_LCK_WINNER_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
      : matcherCandidate ? "SPORTS_LCK_WINNER_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND"
      : "SPORTS_LCK_WINNER_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE",
    bestCandidateTopicKey: matcherCandidate ? TARGET_TOPIC_KEY : null,
    familySupplyCredible: admittedRows.length > 0,
    operatorCredible: matcherCandidate,
    matcherFollowUpJustified: matcherCandidate,
    singleBestNextAction: matcherCandidate
      ? "run a narrow matcher pass for SPORTS|LEAGUE_WINNER|LCK|2026, preserving the strict shared core and excluding venue-only tails."
      : admittedRows.length === 0
        ? "continue targeted venue repair for LCK 2026 season winner discovery before attempting matcher work."
        : "continue LCK 2026 season winner venue reconciliation until a shared named-outcome core exists."
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
