import { normalizeFreeText } from "../../canonical/canonicalization-types.js";
import { classifyPoliticsManualFamily } from "./politics-manual-family-pass.js";
import type { PoliticsExtractedRow, PoliticsNomineeRuleCompatibilityClass } from "./politics-types.js";

export type PoliticsPartyControlFinalDecisionLabel =
  | "PARTY_CONTROL_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE"
  | "PARTY_CONTROL_FAMILY_REFRESHED_PAIR_MATCHER_CANDIDATE_FOUND"
  | "PARTY_CONTROL_FAMILY_REFRESHED_TRI_MATCHER_CANDIDATE_FOUND"
  | "PARTY_CONTROL_FAMILY_REFRESHED_TRI_CANDIDATE_FOUND_BUT_REVIEW_REQUIRED"
  | "PARTY_CONTROL_FAMILY_REFRESHED_RULE_FRAGMENTED"
  | "PARTY_CONTROL_FAMILY_REFRESHED_SINGLE_VENUE_ONLY";

export type PoliticsPartyControlFragmentationLabel =
  | "FAMILY_REFRESHED_NO_SUPPLY"
  | "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
  | "FAMILY_REFRESHED_BASIS_FRAGMENTED"
  | "FAMILY_REFRESHED_RULE_FRAGMENTED"
  | "FAMILY_REFRESHED_COMPARABLE_PAIR_EXISTS"
  | "FAMILY_REFRESHED_COMPARABLE_TRI_EXISTS"
  | "FAMILY_REFRESHED_REVIEW_REQUIRED";

const TARGET_TOPIC_KEY = "PARTY_CONTROL|USA|CONGRESS|2026|BALANCE_OF_POWER" as const;
const TARGET_VENUES = ["OPINION", "POLYMARKET", "PREDICT"] as const;
const OTHERS_PATTERN = /\bother\b/i;

const PARTY_CONTROL_OUTCOME_MAP: ReadonlyArray<[string, RegExp]> = [
  ["DEMOCRATS_SWEEP", /\bdemocrats?\s+sweep\b/i],
  ["REPUBLICANS_SWEEP", /\brepublicans?\s+sweep\b/i],
  ["D_SENATE_R_HOUSE", /\bd\s*senate\b.*\br\s*house\b|\bdemocrats?\b.*\bsenate\b.*\brepublicans?\b.*\bhouse\b/i],
  ["R_SENATE_D_HOUSE", /\br\s*senate\b.*\bd\s*house\b|\brepublicans?\b.*\bsenate\b.*\bdemocrats?\b.*\bhouse\b/i]
] as const;

export interface PoliticsPartyControlNormalizedTopicRow {
  interpretedContractId: string;
  venue: "OPINION" | "POLYMARKET" | "PREDICT";
  venueMarketId: string;
  title: string;
  canonicalFamily: "PARTY_CONTROL";
  canonicalTopicKey: string | null;
  canonicalJurisdiction: string | null;
  canonicalCycle: string | null;
  canonicalInstitution: string | null;
  canonicalControlScope: string | null;
  canonicalTemporalBasis: "DATE_BOUND" | "OPEN_ENDED";
  normalizedOutcomes: readonly string[];
  interpretationConfidence: PoliticsExtractedRow["extractionConfidence"];
  interpretationNotes: readonly string[];
  rejectionReason: string | null;
}

export interface PoliticsPartyControlComparabilityTopicSummary {
  canonicalTopicKey: string;
  venuesPresent: readonly string[];
  pairSharedNamedOutcomesCount: number;
  triSharedNamedOutcomesCount: number;
  excludedOutcomesCount: number;
  ruleCompatibilityClassification: PoliticsNomineeRuleCompatibilityClass;
  fragmentationLabel: PoliticsPartyControlFragmentationLabel;
  matcherCandidate: boolean;
  sharedNamedOutcomes: readonly string[];
  excludedOutcomes: readonly {
    label: string;
    reason: string;
    venues: readonly string[];
  }[];
  notes: readonly string[];
}

export interface PoliticsPartyControlFinalDecision {
  overallFamilyDecision: PoliticsPartyControlFinalDecisionLabel;
  bestNextMatcherCandidate: {
    canonicalTopicKey: string;
    venuesPresent: readonly string[];
    sharedNamedOutcomes: readonly string[];
    ruleCompatibilityClassification: PoliticsNomineeRuleCompatibilityClass;
    fragmentationLabel: PoliticsPartyControlFragmentationLabel;
  } | null;
  bestCandidateTopicKey: string | null;
  familySupplyCredible: boolean;
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export interface PoliticsPartyControlFoundationArtifacts {
  classifiedRows: readonly ReturnType<typeof classifyPoliticsManualFamily>[];
  normalizedTopicRows: readonly PoliticsPartyControlNormalizedTopicRow[];
  fetchSummaryInput: {
    rowsFetchedByVenue: Record<string, number>;
    rowsAdmittedByVenue: Record<string, number>;
  };
  admissionSummary: {
    totalAdmittedPartyControlRows: number;
    rowsRejectedByReason: Record<string, number>;
    rowsAdmittedByTopicCandidate: Record<string, number>;
    venueBreakdown: Record<string, number>;
  };
  comparabilitySummary: readonly PoliticsPartyControlComparabilityTopicSummary[];
  basisFragmentationSummary: {
    blockerCounts: Record<string, number>;
    topicBlockers: readonly {
      canonicalTopicKey: string | null;
      reasons: readonly string[];
      venuesPresent: readonly string[];
    }[];
    unresolvedRows: readonly {
      venue: string;
      venueMarketId: string;
      title: string;
      reason: string;
    }[];
  };
  finalDecision: PoliticsPartyControlFinalDecision;
}

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

const classifyTopic = (row: PoliticsExtractedRow): string | null => {
  const combined = `${row.title} ${row.rulesText ?? ""}`;
  return /\bbalance of power\b/i.test(combined) && /\b2026\b/i.test(combined) && /\bmidterms?\b/i.test(combined)
    ? TARGET_TOPIC_KEY
    : null;
};

const normalizeOutcome = (value: string): string | null => {
  if (OTHERS_PATTERN.test(value)) {
    return null;
  }
  for (const [key, pattern] of PARTY_CONTROL_OUTCOME_MAP) {
    if (pattern.test(value)) {
      return key;
    }
  }
  return null;
};

const deriveRuleCompatibility = (
  rows: readonly PoliticsPartyControlNormalizedTopicRow[]
): PoliticsNomineeRuleCompatibilityClass => {
  if (rows.some((row) => row.rejectionReason !== null)) {
    return "UNKNOWN_RULE_MEANING";
  }

  const normalizedTexts = new Set(
    rows.map((row) => normalizeFreeText(row.title).replace(/\s+/g, " ").trim())
  );

  return normalizedTexts.size > 1 ? "SEMANTICALLY_COMPATIBLE_REWORDING" : "EXACT_RULE_COMPATIBLE";
};

const toNormalizedTopicRow = (row: PoliticsExtractedRow): PoliticsPartyControlNormalizedTopicRow => {
  const normalizedOutcomes = row.outcomeLabels
    .map((label) => normalizeOutcome(label))
    .filter((label): label is string => label !== null);
  const topicKey = classifyTopic(row);

  return {
    interpretedContractId: row.interpretedContractId,
    venue: row.venue as "OPINION" | "POLYMARKET" | "PREDICT",
    venueMarketId: row.venueMarketId,
    title: row.title,
    canonicalFamily: "PARTY_CONTROL",
    canonicalTopicKey: topicKey,
    canonicalJurisdiction: row.jurisdiction,
    canonicalCycle: row.cycleYear,
    canonicalInstitution: "congress",
    canonicalControlScope: "house_and_senate",
    canonicalTemporalBasis: "DATE_BOUND",
    normalizedOutcomes,
    interpretationConfidence: row.extractionConfidence,
    interpretationNotes: row.parseFailures,
    rejectionReason:
      topicKey === null ? "OUT_OF_SCOPE_FOR_BALANCE_OF_POWER_2026_MIDTERMS"
      : row.jurisdiction !== "usa" ? "JURISDICTION_NOT_USA"
      : row.cycleYear !== "2026" ? "CYCLE_MISMATCH"
      : normalizedOutcomes.length === 0 ? "NO_USABLE_PARTY_CONTROL_OUTCOMES"
      : null
  };
};

export const buildPoliticsPartyControlFamilyArtifacts = (
  rows: readonly PoliticsExtractedRow[]
): PoliticsPartyControlFoundationArtifacts => {
  const rowsFetchedByVenue: Record<string, number> = {};
  const rowsAdmittedByVenue: Record<string, number> = {};
  const rowsRejectedByReason: Record<string, number> = {};
  const rowsAdmittedByTopicCandidate: Record<string, number> = {};
  const unresolvedRows: Array<{ venue: string; venueMarketId: string; title: string; reason: string }> = [];
  const classifiedRows = rows.map((row) => classifyPoliticsManualFamily(row));

  for (const row of rows) {
    if (TARGET_VENUES.includes(row.venue as (typeof TARGET_VENUES)[number])) {
      increment(rowsFetchedByVenue, row.venue);
    }
  }

  const normalizedTopicRows = rows
    .filter((row) => TARGET_VENUES.includes(row.venue as (typeof TARGET_VENUES)[number]))
    .map((row) => {
      const normalized = toNormalizedTopicRow(row);
      if (row.family !== "PARTY_CONTROL") {
        increment(rowsRejectedByReason, row.family === "OUT_OF_SCOPE" ? "OUT_OF_SCOPE" : `${row.family}_NOT_PARTY_CONTROL`);
      } else if (normalized.rejectionReason) {
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
  const ruleCompatibilityClassification = deriveRuleCompatibility(admittedRows);
  const outcomeVenues = new Map<string, Set<string>>();
  const excludedOutcomes = new Map<string, { label: string; reason: string; venues: Set<string> }>();

  for (const row of admittedRows) {
    for (const outcome of row.normalizedOutcomes) {
      outcomeVenues.get(outcome)?.add(row.venue) ?? outcomeVenues.set(outcome, new Set([row.venue]));
    }
    const sourceRow = rows.find((candidate) => candidate.interpretedContractId === row.interpretedContractId);
    if (sourceRow?.outcomeLabels.some((label) => OTHERS_PATTERN.test(label))) {
      const current = excludedOutcomes.get("Other|OTHERS_EXCLUDED") ?? {
        label: "Other",
        reason: "OTHERS_EXCLUDED",
        venues: new Set<string>()
      };
      current.venues.add(row.venue);
      excludedOutcomes.set("Other|OTHERS_EXCLUDED", current);
    }
  }

  for (const [outcome, venues] of outcomeVenues.entries()) {
    if (venues.size < 2) {
      excludedOutcomes.set(`${outcome}|NOT_SHARED`, {
        label: outcome,
        reason: "NOT_SHARED",
        venues
      });
    }
  }

  const venuesPresent = [...unique(admittedRows.map((row) => row.venue))].sort();
  const sharedNamedOutcomes = [...outcomeVenues.entries()]
    .filter(([, venues]) => venues.size >= 2)
    .map(([outcome]) => outcome)
    .sort((left, right) => left.localeCompare(right));
  const pairSharedNamedOutcomesCount = [...outcomeVenues.values()].filter((venues) => venues.size >= 2).length;
  const triSharedNamedOutcomesCount = [...outcomeVenues.values()].filter((venues) => venues.size >= 3).length;

  const fragmentationLabel: PoliticsPartyControlFragmentationLabel =
    admittedRows.length === 0 ? "FAMILY_REFRESHED_NO_SUPPLY"
    : venuesPresent.length <= 1 ? "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
    : ruleCompatibilityClassification === "RULES_MATERIALLY_INCOMPATIBLE" || ruleCompatibilityClassification === "UNKNOWN_RULE_MEANING"
      ? "FAMILY_REFRESHED_RULE_FRAGMENTED"
    : triSharedNamedOutcomesCount > 0
      ? "FAMILY_REFRESHED_COMPARABLE_TRI_EXISTS"
    : pairSharedNamedOutcomesCount > 0
      ? "FAMILY_REFRESHED_COMPARABLE_PAIR_EXISTS"
    : "FAMILY_REFRESHED_BASIS_FRAGMENTED";

  const comparabilitySummary: PoliticsPartyControlComparabilityTopicSummary[] = admittedRows.length === 0 ? [] : [{
    canonicalTopicKey: TARGET_TOPIC_KEY,
    venuesPresent,
    pairSharedNamedOutcomesCount,
    triSharedNamedOutcomesCount,
    excludedOutcomesCount: excludedOutcomes.size,
    ruleCompatibilityClassification,
    fragmentationLabel,
    matcherCandidate: pairSharedNamedOutcomesCount > 0,
    sharedNamedOutcomes,
    excludedOutcomes: [...excludedOutcomes.values()].map((entry) => ({
      label: entry.label,
      reason: entry.reason,
      venues: [...entry.venues].sort()
    })),
    notes: [
      `target_venues=${TARGET_VENUES.join("|")}`,
      triSharedNamedOutcomesCount > 0 ? "strict_tri_shared_core_present" : "strict_tri_shared_core_absent"
    ]
  }];

  const bestNextMatcherCandidate = comparabilitySummary[0]?.matcherCandidate ? {
    canonicalTopicKey: TARGET_TOPIC_KEY,
    venuesPresent,
    sharedNamedOutcomes,
    ruleCompatibilityClassification,
    fragmentationLabel
  } : null;

  const blockerCounts: Record<string, number> = {};
  if (!rowsAdmittedByVenue.OPINION) increment(blockerCounts, "opinion_not_admitted");
  if (!rowsAdmittedByVenue.POLYMARKET) increment(blockerCounts, "polymarket_not_admitted");
  if (!rowsAdmittedByVenue.PREDICT) increment(blockerCounts, "predict_not_admitted");
  if (triSharedNamedOutcomesCount === 0) increment(blockerCounts, "strict_tri_shared_core_absent");

  const overallFamilyDecision: PoliticsPartyControlFinalDecisionLabel =
    admittedRows.length === 0 ? "PARTY_CONTROL_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE"
    : fragmentationLabel === "FAMILY_REFRESHED_COMPARABLE_TRI_EXISTS" && ruleCompatibilityClassification !== "EXACT_RULE_COMPATIBLE"
      ? "PARTY_CONTROL_FAMILY_REFRESHED_TRI_CANDIDATE_FOUND_BUT_REVIEW_REQUIRED"
    : fragmentationLabel === "FAMILY_REFRESHED_COMPARABLE_TRI_EXISTS"
      ? "PARTY_CONTROL_FAMILY_REFRESHED_TRI_MATCHER_CANDIDATE_FOUND"
    : fragmentationLabel === "FAMILY_REFRESHED_COMPARABLE_PAIR_EXISTS"
      ? "PARTY_CONTROL_FAMILY_REFRESHED_PAIR_MATCHER_CANDIDATE_FOUND"
    : fragmentationLabel === "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
      ? "PARTY_CONTROL_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
    : fragmentationLabel === "FAMILY_REFRESHED_RULE_FRAGMENTED"
      ? "PARTY_CONTROL_FAMILY_REFRESHED_RULE_FRAGMENTED"
    : "PARTY_CONTROL_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE";

  return {
    classifiedRows,
    normalizedTopicRows,
    fetchSummaryInput: {
      rowsFetchedByVenue,
      rowsAdmittedByVenue
    },
    admissionSummary: {
      totalAdmittedPartyControlRows: admittedRows.length,
      rowsRejectedByReason,
      rowsAdmittedByTopicCandidate,
      venueBreakdown: rowsAdmittedByVenue
    },
    comparabilitySummary,
    basisFragmentationSummary: {
      blockerCounts,
      topicBlockers: admittedRows.length === 0 ? [] : [{
        canonicalTopicKey: TARGET_TOPIC_KEY,
        reasons: [...Object.keys(blockerCounts)],
        venuesPresent
      }],
      unresolvedRows
    },
    finalDecision: {
      overallFamilyDecision,
      bestNextMatcherCandidate,
      bestCandidateTopicKey: bestNextMatcherCandidate?.canonicalTopicKey ?? null,
      familySupplyCredible: admittedRows.length > 0,
      operatorCredible: true,
      matcherFollowUpJustified: bestNextMatcherCandidate !== null,
      singleBestNextAction:
        bestNextMatcherCandidate !== null
          ? `Start a narrow party-control matcher follow-up on ${bestNextMatcherCandidate.canonicalTopicKey}.`
          : "Keep party-control at family-foundation only until exact venue truth and shared-core are stably proven."
    }
  };
};
