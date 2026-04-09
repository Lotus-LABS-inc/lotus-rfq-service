import { normalizeFreeText } from "../../canonical/canonicalization-types.js";
import {
  buildPoliticsManualFamilySummary,
  classifyPoliticsManualFamily,
  normalizePoliticsManualFamilyRow
} from "./politics-manual-family-pass.js";
import type {
  PoliticsExtractedRow,
  PoliticsManualComparabilityLabel,
  PoliticsManualNormalizedRow,
  PoliticsNomineeRuleCompatibilityClass
} from "./politics-types.js";

export type PoliticsOfficeWinnerFinalDecisionLabel =
  | "OFFICE_WINNER_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE"
  | "OFFICE_WINNER_FAMILY_REFRESHED_PAIR_MATCHER_CANDIDATE_FOUND"
  | "OFFICE_WINNER_FAMILY_REFRESHED_TRI_CANDIDATE_FOUND_BUT_REVIEW_REQUIRED"
  | "OFFICE_WINNER_FAMILY_REFRESHED_RULE_FRAGMENTED"
  | "OFFICE_WINNER_FAMILY_REFRESHED_SINGLE_VENUE_ONLY";

export type PoliticsOfficeWinnerFragmentationLabel =
  | "FAMILY_REFRESHED_NO_SUPPLY"
  | "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
  | "FAMILY_REFRESHED_BASIS_FRAGMENTED"
  | "FAMILY_REFRESHED_RULE_FRAGMENTED"
  | "FAMILY_REFRESHED_COMPARABLE_PAIR_EXISTS"
  | "FAMILY_REFRESHED_COMPARABLE_TRI_EXISTS"
  | "FAMILY_REFRESHED_REVIEW_REQUIRED";

export interface PoliticsOfficeWinnerNormalizedTopicRow {
  interpretedContractId: string;
  venue: PoliticsManualNormalizedRow["venue"];
  venueMarketId: string;
  title: string;
  canonicalFamily: "OFFICE_WINNER";
  canonicalTopicKey: string | null;
  canonicalSubject: string | null;
  canonicalJurisdiction: string | null;
  canonicalCycle: string | null;
  canonicalOffice: string | null;
  canonicalOfficeLevel: string | null;
  canonicalElectionType: string | null;
  canonicalTemporalBasis: string | null;
  electionRound: string | null;
  officeScope: string | null;
  jurisdictionScope: string | null;
  candidateSet: readonly string[];
  candidateSetType: PoliticsManualNormalizedRow["candidateSetType"] | null;
  dateBounded: boolean;
  interpretationConfidence: PoliticsManualNormalizedRow["interpretationConfidence"];
  interpretationNotes: readonly string[];
  rejectionReason: string | null;
}

export interface PoliticsOfficeWinnerComparabilityTopicSummary {
  canonicalTopicKey: string;
  venuesPresent: readonly string[];
  pairSharedNamedOutcomesCount: number;
  triSharedNamedOutcomesCount: number;
  excludedOutcomesCount: number;
  ruleCompatibilityClassification: PoliticsNomineeRuleCompatibilityClass;
  fragmentationLabel: PoliticsOfficeWinnerFragmentationLabel;
  matcherCandidate: boolean;
  sharedNamedCandidates: readonly string[];
  excludedOutcomes: readonly {
    label: string;
    reason: string;
    venues: readonly string[];
  }[];
  notes: readonly string[];
}

export interface PoliticsOfficeWinnerFinalDecision {
  overallFamilyDecision: PoliticsOfficeWinnerFinalDecisionLabel;
  bestNextMatcherCandidate: {
    canonicalTopicKey: string;
    venuesPresent: readonly string[];
    sharedNamedCandidates: readonly string[];
    ruleCompatibilityClassification: PoliticsNomineeRuleCompatibilityClass;
    fragmentationLabel: PoliticsOfficeWinnerFragmentationLabel;
  } | null;
  bestCandidateTopicKey: string | null;
  familySupplyCredible: boolean;
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export interface PoliticsOfficeWinnerFoundationArtifacts {
  classifiedRows: readonly ReturnType<typeof classifyPoliticsManualFamily>[];
  normalizedTopicRows: readonly PoliticsOfficeWinnerNormalizedTopicRow[];
  fetchSummaryInput: {
    rowsFetchedByVenue: Record<string, number>;
    rowsAdmittedByVenue: Record<string, number>;
  };
  admissionSummary: {
    totalAdmittedOfficeWinnerRows: number;
    rowsRejectedByReason: Record<string, number>;
    rowsAdmittedByTopicCandidate: Record<string, number>;
    venueBreakdown: Record<string, number>;
  };
  comparabilitySummary: readonly PoliticsOfficeWinnerComparabilityTopicSummary[];
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
  finalDecision: PoliticsOfficeWinnerFinalDecision;
}

interface OfficeWinnerRecord {
  classified: ReturnType<typeof classifyPoliticsManualFamily>;
  normalized: PoliticsManualNormalizedRow;
  normalizedTopic: PoliticsOfficeWinnerNormalizedTopicRow;
}

const OTHERS_PATTERN = /\b(other|others|any other|rest of field|field|someone else)\b/i;
const UNKNOWN_COMPOSITE_PATTERN = /\b(no one|none|not listed|all of the above|yes|no)\b/i;
const NOMINEE_PATTERN = /\bnominee|nomination|primary|caucus\b/i;
const OUT_OF_SCOPE_RULE_PATTERN = /\bapproval|disapproval|control of|party control|ceasefire|sanctions|cabinet|confirmation\b/i;
const OFFICE_WINNER_RULE_PATTERN =
  /\bwin\b.*\belection\b|\bwho will be\b|\bwho will win\b|\belection winner\b|\bwill resolve according to the listed candidate that wins\b/i;

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

const normalizeToken = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const normalized = normalizeFreeText(value)
    .replace(/[`'".,()/:-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 0 ? normalized.replace(/\s+/g, "_").toUpperCase() : null;
};

const normalizeOfficeWinnerCandidate = (value: string): string | null => {
  const normalized = normalizeFreeText(value)
    .replace(/[`'".,()/:-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= 1 || OTHERS_PATTERN.test(normalized) || UNKNOWN_COMPOSITE_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
};

const toCanonicalOfficeToken = (office: string | null): string | null =>
  office === "president" ? "US_PRESIDENT"
  : office === "prime_minister" ? "PRIME_MINISTER"
  : normalizeToken(office);

export const buildOfficeWinnerCanonicalTopicKey = (row: PoliticsManualNormalizedRow): string | null => {
  const jurisdiction = normalizeToken(row.canonicalJurisdiction);
  const office = toCanonicalOfficeToken(row.canonicalOffice);
  const cycle = normalizeToken(row.canonicalCycle);
  if (!jurisdiction || !office || !cycle) {
    return null;
  }
  return `OFFICE_WINNER|${jurisdiction}|${office}|${cycle}`;
};

const toNormalizedTopicRow = (row: PoliticsManualNormalizedRow): PoliticsOfficeWinnerNormalizedTopicRow => ({
  interpretedContractId: row.interpretedContractId,
  venue: row.venue,
  venueMarketId: row.venueMarketId,
  title: row.title,
  canonicalFamily: "OFFICE_WINNER",
  canonicalTopicKey: buildOfficeWinnerCanonicalTopicKey(row),
  canonicalSubject: row.canonicalSubject,
  canonicalJurisdiction: row.canonicalJurisdiction,
  canonicalCycle: row.canonicalCycle,
  canonicalOffice: row.canonicalOffice,
  canonicalOfficeLevel: row.canonicalOfficeLevel,
  canonicalElectionType: row.canonicalElectionType,
  canonicalTemporalBasis: row.canonicalTemporalBasis,
  electionRound: row.electionRound ?? null,
  officeScope: row.canonicalOfficeLevel ?? row.canonicalOffice,
  jurisdictionScope: row.canonicalJurisdiction,
  candidateSet: row.candidateSet ?? [],
  candidateSetType: row.candidateSetType ?? null,
  dateBounded: row.dateBounded === true || row.canonicalTemporalBasis === "DATE_BOUND",
  interpretationConfidence: row.interpretationConfidence,
  interpretationNotes: row.interpretationNotes,
  rejectionReason: row.rejectionReason
});

const toOfficeWinnerRejectionReason = (row: ReturnType<typeof classifyPoliticsManualFamily>): string => {
  if (row.family === "NOMINEE_WINNER") {
    return "NOMINEE_NOT_OFFICE_WINNER";
  }
  if (row.family === "OFFICE_EXIT_BY_DATE") {
    return "OFFICE_EXIT_NOT_OFFICE_WINNER";
  }
  if (row.family === "GEOPOLITICAL_EVENT" || row.family === "GEOPOLITICAL_EVENT_BY_DATE") {
    return "GEOPOLITICAL_NOT_OFFICE_WINNER";
  }
  if (row.family === "OUT_OF_SCOPE") {
    return row.reason ?? "OUT_OF_SCOPE_FOR_OFFICE_WINNER";
  }
  return row.reason ?? row.family;
};

const deriveRuleCompatibility = (records: readonly OfficeWinnerRecord[]): PoliticsNomineeRuleCompatibilityClass => {
  if (records.some((record) => record.normalized.rejectionReason !== null)) {
    return "UNKNOWN_RULE_MEANING";
  }

  const meanings = new Set<string>();
  const normalizedTexts = new Set<string>();

  for (const record of records) {
    const combined = `${record.classified.title} ${record.classified.extracted.rulesText ?? ""}`.toLowerCase();
    normalizedTexts.add(normalizeFreeText(combined).replace(/\s+/g, " ").trim());

    if (NOMINEE_PATTERN.test(combined) || OUT_OF_SCOPE_RULE_PATTERN.test(combined)) {
      return "RULES_MATERIALLY_INCOMPATIBLE";
    }

      if (/\brunoff\b|\bspecial election\b/.test(combined)) {
        meanings.add("SPECIAL_OR_RUNOFF_OFFICE_WINNER");
      } else if (OFFICE_WINNER_RULE_PATTERN.test(combined)) {
        meanings.add("OFFICE_WINNER");
      } else {
        meanings.add("UNKNOWN");
      }
  }

  const electionRounds = unique(records.map((record) => record.normalized.electionRound ?? "UNKNOWN"));
  if (meanings.has("UNKNOWN")) {
    return "UNKNOWN_RULE_MEANING";
  }
  if (electionRounds.length > 1 || meanings.size > 1) {
    return "REVIEW_REQUIRED_RULE_VARIANCE";
  }
  if (normalizedTexts.size > 1) {
    return "SEMANTICALLY_COMPATIBLE_REWORDING";
  }
  return "EXACT_RULE_COMPATIBLE";
};

const buildTopicComparabilitySummary = (records: readonly OfficeWinnerRecord[]): PoliticsOfficeWinnerComparabilityTopicSummary[] => {
  const byTopic = new Map<string, OfficeWinnerRecord[]>();
  for (const record of records) {
    const topicKey = record.normalizedTopic.canonicalTopicKey;
    if (!topicKey) {
      continue;
    }
    byTopic.get(topicKey)?.push(record) ?? byTopic.set(topicKey, [record]);
  }

  const summaries: PoliticsOfficeWinnerComparabilityTopicSummary[] = [];
  for (const [canonicalTopicKey, topicRecords] of [...byTopic.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    const venuesPresent = [...unique(topicRecords.map((record) => record.normalized.venue))].sort();
    const candidateVenues = new Map<string, Set<string>>();
    const excludedOutcomeMap = new Map<string, { label: string; reason: string; venues: Set<string> }>();
    const clusterSummary = buildPoliticsManualFamilySummary(
      "OFFICE_WINNER",
      topicRecords.map((record) => record.normalized)
    );
    const ruleCompatibilityClassification = deriveRuleCompatibility(topicRecords);

    for (const record of topicRecords) {
      for (const candidate of record.normalized.candidateSet ?? []) {
        const normalizedCandidate = normalizeOfficeWinnerCandidate(candidate);
        if (!normalizedCandidate) {
          excludedOutcomeMap.set(`${candidate}|UNKNOWN_COMPOSITE`, {
            label: candidate,
            reason: OTHERS_PATTERN.test(candidate) ? "OTHERS_EXCLUDED" : "UNKNOWN_COMPOSITE",
            venues: new Set([record.normalized.venue])
          });
          continue;
        }
        candidateVenues.get(normalizedCandidate)?.add(record.normalized.venue)
          ?? candidateVenues.set(normalizedCandidate, new Set([record.normalized.venue]));
      }

      for (const label of record.classified.extracted.outcomeLabels) {
        if (OTHERS_PATTERN.test(label) || UNKNOWN_COMPOSITE_PATTERN.test(label)) {
          const reason = OTHERS_PATTERN.test(label) ? "OTHERS_EXCLUDED" : "UNKNOWN_COMPOSITE";
          const key = `${label}|${reason}`;
          const existing = excludedOutcomeMap.get(key) ?? {
            label,
            reason,
            venues: new Set<string>()
          };
          existing.venues.add(record.normalized.venue);
          excludedOutcomeMap.set(key, existing);
        }
      }
    }

    for (const [candidate, venueSet] of candidateVenues.entries()) {
      if (venueSet.size < 2) {
        excludedOutcomeMap.set(`${candidate}|NOT_SHARED`, {
          label: candidate,
          reason: "NOT_SHARED",
          venues: venueSet
        });
      }
    }

    const sharedNamedCandidates = [...candidateVenues.entries()]
      .filter(([, venueSet]) => venueSet.size >= 2)
      .map(([candidate]) => candidate)
      .sort((left, right) => left.localeCompare(right));
    const pairSharedNamedOutcomesCount = [...candidateVenues.values()].filter((venueSet) => venueSet.size >= 2).length;
    const triSharedNamedOutcomesCount = [...candidateVenues.values()].filter((venueSet) => venueSet.size >= 3).length;

    const fragmentationLabel: PoliticsOfficeWinnerFragmentationLabel =
      venuesPresent.length <= 1 ? "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
      : ruleCompatibilityClassification === "RULES_MATERIALLY_INCOMPATIBLE" || ruleCompatibilityClassification === "UNKNOWN_RULE_MEANING"
        ? "FAMILY_REFRESHED_RULE_FRAGMENTED"
      : triSharedNamedOutcomesCount > 0
        ? ruleCompatibilityClassification === "REVIEW_REQUIRED_RULE_VARIANCE"
          ? "FAMILY_REFRESHED_REVIEW_REQUIRED"
          : "FAMILY_REFRESHED_COMPARABLE_TRI_EXISTS"
      : pairSharedNamedOutcomesCount > 0
        ? ruleCompatibilityClassification === "REVIEW_REQUIRED_RULE_VARIANCE"
          ? "FAMILY_REFRESHED_REVIEW_REQUIRED"
          : "FAMILY_REFRESHED_COMPARABLE_PAIR_EXISTS"
      : "FAMILY_REFRESHED_BASIS_FRAGMENTED";

    summaries.push({
      canonicalTopicKey,
      venuesPresent,
      pairSharedNamedOutcomesCount,
      triSharedNamedOutcomesCount,
      excludedOutcomesCount: excludedOutcomeMap.size,
      ruleCompatibilityClassification,
      fragmentationLabel,
      matcherCandidate:
        (fragmentationLabel === "FAMILY_REFRESHED_COMPARABLE_PAIR_EXISTS"
        || fragmentationLabel === "FAMILY_REFRESHED_COMPARABLE_TRI_EXISTS"
        || fragmentationLabel === "FAMILY_REFRESHED_REVIEW_REQUIRED")
        && pairSharedNamedOutcomesCount > 0,
      sharedNamedCandidates,
      excludedOutcomes: [...excludedOutcomeMap.values()].map((entry) => ({
        label: entry.label,
        reason: entry.reason,
        venues: [...entry.venues].sort()
      })),
      notes: [
        clusterSummary.comparableClusters.length > 0
          ? `comparable_clusters=${clusterSummary.comparableClusters.length}`
          : "no comparable clusters",
        clusterSummary.dominantBlocker ? `dominant_blocker=${clusterSummary.dominantBlocker}` : "no dominant blocker"
      ]
    });
  }

  return summaries;
};

const toBlockerReason = (
  label: PoliticsOfficeWinnerFragmentationLabel,
  ruleCompatibility: PoliticsNomineeRuleCompatibilityClass,
  dominantBlocker: PoliticsManualComparabilityLabel | null
): readonly string[] => {
  if (label === "FAMILY_REFRESHED_SINGLE_VENUE_ONLY") {
    return ["single_venue_only", "thin_supply"];
  }
  if (label === "FAMILY_REFRESHED_RULE_FRAGMENTED") {
    return ["rule_mismatch", ruleCompatibility.toLowerCase()];
  }
  if (label === "FAMILY_REFRESHED_REVIEW_REQUIRED") {
    return ["review_required_rule_variance"];
  }
  if (dominantBlocker === "JURISDICTION_MISMATCH" || dominantBlocker === "OFFICE_MISMATCH") {
    return ["office_or_jurisdiction_ambiguity"];
  }
  if (dominantBlocker === "BASIS_FRAGMENTED") {
    return ["cycle_mismatch"];
  }
  if (dominantBlocker === "CANDIDATE_SET_MISMATCH") {
    return ["non_shared_candidate_sets"];
  }
  return ["thin_supply"];
};

const chooseBestNextMatcherCandidate = (
  comparabilitySummary: readonly PoliticsOfficeWinnerComparabilityTopicSummary[]
): PoliticsOfficeWinnerFinalDecision["bestNextMatcherCandidate"] => {
  const candidates = comparabilitySummary.filter((summary) => summary.matcherCandidate);
  if (candidates.length === 0) {
    return null;
  }

  const best = [...candidates].sort((left, right) =>
    right.triSharedNamedOutcomesCount - left.triSharedNamedOutcomesCount
    || right.pairSharedNamedOutcomesCount - left.pairSharedNamedOutcomesCount
    || right.venuesPresent.length - left.venuesPresent.length
    || left.canonicalTopicKey.localeCompare(right.canonicalTopicKey)
  )[0]!;

  return {
    canonicalTopicKey: best.canonicalTopicKey,
    venuesPresent: best.venuesPresent,
    sharedNamedCandidates: best.sharedNamedCandidates,
    ruleCompatibilityClassification: best.ruleCompatibilityClassification,
    fragmentationLabel: best.fragmentationLabel
  };
};

export const buildPoliticsOfficeWinnerFamilyArtifacts = (
  rows: readonly PoliticsExtractedRow[]
): PoliticsOfficeWinnerFoundationArtifacts => {
  const classifiedRows = rows.map((row) => classifyPoliticsManualFamily(row));
  const officeWinnerRecords: OfficeWinnerRecord[] = [];
  const rowsRejectedByReason: Record<string, number> = {};
  const rowsFetchedByVenue: Record<string, number> = {};
  const rowsAdmittedByVenue: Record<string, number> = {};
  const rowsAdmittedByTopicCandidate: Record<string, number> = {};
  const unresolvedRows: Array<{ venue: string; venueMarketId: string; title: string; reason: string }> = [];

  for (const row of rows) {
    increment(rowsFetchedByVenue, row.venue);
  }

  for (const classified of classifiedRows) {
    if (classified.family !== "OFFICE_WINNER") {
      increment(rowsRejectedByReason, toOfficeWinnerRejectionReason(classified));
      continue;
    }

    const normalized = normalizePoliticsManualFamilyRow(classified);
    if (!normalized) {
      increment(rowsRejectedByReason, "FAILED_TO_NORMALIZE_OFFICE_WINNER");
      continue;
    }

    const normalizedTopic = toNormalizedTopicRow(normalized);
    increment(rowsAdmittedByVenue, normalized.venue);
    increment(rowsAdmittedByTopicCandidate, normalizedTopic.canonicalTopicKey ?? "UNRESOLVED_TOPIC");

    if (normalizedTopic.canonicalTopicKey === null || normalizedTopic.rejectionReason !== null) {
      unresolvedRows.push({
        venue: normalized.venue,
        venueMarketId: normalized.venueMarketId,
        title: normalized.title,
        reason: normalizedTopic.rejectionReason ?? "missing_office_winner_topic_key"
      });
    }

    officeWinnerRecords.push({
      classified,
      normalized,
      normalizedTopic
    });
  }

  const comparabilitySummary = buildTopicComparabilitySummary(officeWinnerRecords);
  const blockerCounts: Record<string, number> = {};
  const topicBlockers = comparabilitySummary
    .filter((summary) => !summary.matcherCandidate)
    .map((summary) => {
      const familySummary = buildPoliticsManualFamilySummary(
        "OFFICE_WINNER",
        officeWinnerRecords
          .filter((record) => record.normalizedTopic.canonicalTopicKey === summary.canonicalTopicKey)
          .map((record) => record.normalized)
      );
      const reasons = toBlockerReason(
        summary.fragmentationLabel,
        summary.ruleCompatibilityClassification,
        familySummary.dominantBlocker
      );
      for (const reason of reasons) {
        increment(blockerCounts, reason);
      }
      return {
        canonicalTopicKey: summary.canonicalTopicKey,
        reasons,
        venuesPresent: summary.venuesPresent
      };
    });

  for (const unresolvedRow of unresolvedRows) {
    increment(blockerCounts, unresolvedRow.reason);
  }

  const bestNextMatcherCandidate = chooseBestNextMatcherCandidate(comparabilitySummary);
  const allSingleVenue =
    comparabilitySummary.length > 0
    && comparabilitySummary.every((summary) => summary.fragmentationLabel === "FAMILY_REFRESHED_SINGLE_VENUE_ONLY");
  const anyRuleFragmented = comparabilitySummary.some((summary) => summary.fragmentationLabel === "FAMILY_REFRESHED_RULE_FRAGMENTED");
  const bestNeedsReview = bestNextMatcherCandidate?.fragmentationLabel === "FAMILY_REFRESHED_REVIEW_REQUIRED"
    && bestNextMatcherCandidate.venuesPresent.length >= 3;

  const overallFamilyDecision: PoliticsOfficeWinnerFinalDecisionLabel =
    officeWinnerRecords.length === 0 ? "OFFICE_WINNER_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE"
    : bestNeedsReview ? "OFFICE_WINNER_FAMILY_REFRESHED_TRI_CANDIDATE_FOUND_BUT_REVIEW_REQUIRED"
    : bestNextMatcherCandidate !== null ? "OFFICE_WINNER_FAMILY_REFRESHED_PAIR_MATCHER_CANDIDATE_FOUND"
    : allSingleVenue ? "OFFICE_WINNER_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
    : anyRuleFragmented ? "OFFICE_WINNER_FAMILY_REFRESHED_RULE_FRAGMENTED"
    : "OFFICE_WINNER_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE";

  return {
    classifiedRows,
    normalizedTopicRows: officeWinnerRecords.map((record) => record.normalizedTopic),
    fetchSummaryInput: {
      rowsFetchedByVenue,
      rowsAdmittedByVenue
    },
    admissionSummary: {
      totalAdmittedOfficeWinnerRows: officeWinnerRecords.length,
      rowsRejectedByReason,
      rowsAdmittedByTopicCandidate,
      venueBreakdown: rowsAdmittedByVenue
    },
    comparabilitySummary,
    basisFragmentationSummary: {
      blockerCounts,
      topicBlockers,
      unresolvedRows
    },
    finalDecision: {
      overallFamilyDecision,
      bestNextMatcherCandidate,
      bestCandidateTopicKey: bestNextMatcherCandidate?.canonicalTopicKey ?? null,
      familySupplyCredible: officeWinnerRecords.length > 0,
      operatorCredible: true,
      matcherFollowUpJustified: bestNextMatcherCandidate !== null,
      singleBestNextAction:
        bestNextMatcherCandidate !== null
          ? `Start a narrow office-winner matcher follow-up on ${bestNextMatcherCandidate.canonicalTopicKey}.`
          : "Keep office-winner at family-foundation only and wait for a real cross-venue shared-core topic before matcher work."
    }
  };
};
