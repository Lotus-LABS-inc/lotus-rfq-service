import { classifyPoliticsManualFamily } from "./politics-manual-family-pass.js";
import type { PoliticsExtractedRow, PoliticsNomineeRuleCompatibilityClass } from "./politics-types.js";

export type PoliticsOfficeExitByDateFinalDecisionLabel =
  | "OFFICE_EXIT_BY_DATE_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE"
  | "OFFICE_EXIT_BY_DATE_FAMILY_REFRESHED_PAIR_MATCHER_CANDIDATE_FOUND"
  | "OFFICE_EXIT_BY_DATE_FAMILY_REFRESHED_TRI_MATCHER_CANDIDATE_FOUND"
  | "OFFICE_EXIT_BY_DATE_FAMILY_REFRESHED_TRI_CANDIDATE_FOUND_BUT_REVIEW_REQUIRED"
  | "OFFICE_EXIT_BY_DATE_FAMILY_REFRESHED_RULE_FRAGMENTED"
  | "OFFICE_EXIT_BY_DATE_FAMILY_REFRESHED_SINGLE_VENUE_ONLY";

export type PoliticsOfficeExitByDateFragmentationLabel =
  | "FAMILY_REFRESHED_NO_SUPPLY"
  | "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
  | "FAMILY_REFRESHED_BASIS_FRAGMENTED"
  | "FAMILY_REFRESHED_RULE_FRAGMENTED"
  | "FAMILY_REFRESHED_COMPARABLE_PAIR_EXISTS"
  | "FAMILY_REFRESHED_COMPARABLE_TRI_EXISTS";

const TARGET_VENUES = ["OPINION", "POLYMARKET", "LIMITLESS", "PREDICT", "MYRIAD"] as const;

const TARGET_TOPIC_SPECS = [
  {
    canonicalTopicKey: "OFFICE_EXIT_BY_DATE|USA|US_PRESIDENT|DONALD_TRUMP|2026-12-31",
    jurisdiction: "usa",
    office: "president",
    topicPatterns: [/\btrump\b/i, /\bpresident\b/i],
    deadlinePatterns: [/\bdec(?:ember)?\s+31,\s+2026\b/i, /\bbefore\s+2027\b/i, /\bend of 2026\b/i]
  },
  {
    canonicalTopicKey: "OFFICE_EXIT_BY_DATE|ISRAEL|PRIME_MINISTER|BENJAMIN_NETANYAHU|2026-12-31",
    jurisdiction: "israel",
    office: "prime_minister",
    topicPatterns: [/\bnetanyahu\b/i, /\bprime minister\b/i],
    deadlinePatterns: [/\bdec(?:ember)?\s+31,\s+2026\b/i, /\bbefore\s+2027\b/i, /\bend of 2026\b/i]
  },
  {
    canonicalTopicKey: "OFFICE_EXIT_BY_DATE|UK|PRIME_MINISTER|KEIR_STARMER|2026-06-30",
    jurisdiction: "uk",
    office: "prime_minister",
    topicPatterns: [/\bstarmer\b/i, /\bprime minister\b/i],
    deadlinePatterns: [/\bjune\s+30,\s+2026\b/i, /\bbefore\s+july\b/i, /\bbefore july 2026\b/i]
  }
] as const;

export interface PoliticsOfficeExitByDateNormalizedTopicRow {
  interpretedContractId: string;
  venue: typeof TARGET_VENUES[number];
  venueMarketId: string;
  title: string;
  canonicalFamily: "OFFICE_EXIT_BY_DATE";
  canonicalTopicKey: string | null;
  canonicalSubjectKey: string | null;
  canonicalJurisdiction: string | null;
  canonicalOffice: string | null;
  canonicalDeadlineDate: string | null;
  canonicalRuleMeaning: "OUT_OF_OFFICE_ANY_REASON_BY_DATE" | "REMOVAL_ONLY_BY_DATE" | "UNKNOWN_RULE_MEANING";
  interpretationConfidence: PoliticsExtractedRow["extractionConfidence"];
  interpretationNotes: readonly string[];
  rejectionReason: string | null;
}

export interface PoliticsOfficeExitByDateComparabilityTopicSummary {
  canonicalTopicKey: string;
  venuesPresent: readonly string[];
  comparablePairCount: number;
  strictTriPresent: boolean;
  strictTriVenueSets: readonly string[];
  ruleCompatibilityClassification: PoliticsNomineeRuleCompatibilityClass;
  fragmentationLabel: PoliticsOfficeExitByDateFragmentationLabel;
  matcherCandidate: boolean;
  notes: readonly string[];
}

export interface PoliticsOfficeExitByDateFinalDecision {
  overallFamilyDecision: PoliticsOfficeExitByDateFinalDecisionLabel;
  bestNextMatcherCandidate: {
    canonicalTopicKey: string;
    venuesPresent: readonly string[];
    ruleCompatibilityClassification: PoliticsNomineeRuleCompatibilityClass;
    fragmentationLabel: PoliticsOfficeExitByDateFragmentationLabel;
  } | null;
  bestCandidateTopicKey: string | null;
  familySupplyCredible: boolean;
  operatorCredible: boolean;
  matcherFollowUpJustified: boolean;
  singleBestNextAction: string;
}

export interface PoliticsOfficeExitByDateFoundationArtifacts {
  classifiedRows: readonly ReturnType<typeof classifyPoliticsManualFamily>[];
  normalizedTopicRows: readonly PoliticsOfficeExitByDateNormalizedTopicRow[];
  fetchSummaryInput: {
    rowsFetchedByVenue: Record<string, number>;
    rowsAdmittedByVenue: Record<string, number>;
  };
  admissionSummary: {
    totalAdmittedOfficeExitRows: number;
    rowsRejectedByReason: Record<string, number>;
    rowsAdmittedByTopicCandidate: Record<string, number>;
    venueBreakdown: Record<string, number>;
  };
  comparabilitySummary: readonly PoliticsOfficeExitByDateComparabilityTopicSummary[];
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
  finalDecision: PoliticsOfficeExitByDateFinalDecision;
}

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

const classifyTopic = (row: PoliticsExtractedRow): string | null => {
  const combined = `${row.title} ${row.rulesText ?? ""}`;
  return TARGET_TOPIC_SPECS.find((spec) =>
    spec.topicPatterns.every((pattern) => pattern.test(combined))
    && spec.deadlinePatterns.some((pattern) => pattern.test(combined))
  )?.canonicalTopicKey ?? null;
};

const classifyRuleMeaning = (text: string): PoliticsOfficeExitByDateNormalizedTopicRow["canonicalRuleMeaning"] =>
  /\bceases to be\b|\botherwise ceases to be\b|\bout as\b|\bno longer holds office\b/i.test(text)
    ? "OUT_OF_OFFICE_ANY_REASON_BY_DATE"
    : /\bresigns?\b|\bremoved\b|\bresignation\/removal\b|\bimpeach(?:ed|ment)\b/i.test(text)
      ? "REMOVAL_ONLY_BY_DATE"
      : "UNKNOWN_RULE_MEANING";

const extractDeadlineDate = (topicKey: string | null): string | null =>
  topicKey?.match(/\|(\d{4}-\d{2}-\d{2})$/)?.[1] ?? null;

const extractSubjectKey = (topicKey: string | null): string | null =>
  topicKey?.split("|")[3] ?? null;

const deriveRuleCompatibility = (
  rows: readonly PoliticsOfficeExitByDateNormalizedTopicRow[]
): PoliticsNomineeRuleCompatibilityClass => {
  if (rows.some((row) => row.rejectionReason !== null || row.canonicalRuleMeaning === "UNKNOWN_RULE_MEANING")) {
    return "UNKNOWN_RULE_MEANING";
  }
  return new Set(rows.map((row) => row.canonicalRuleMeaning)).size === 1
    ? "EXACT_RULE_COMPATIBLE"
    : "SEMANTICALLY_COMPATIBLE_REWORDING";
};

const toNormalizedTopicRow = (row: PoliticsExtractedRow): PoliticsOfficeExitByDateNormalizedTopicRow => {
  const topicKey = classifyTopic(row);
  const targetSpec = TARGET_TOPIC_SPECS.find((spec) => spec.canonicalTopicKey === topicKey) ?? null;

  return {
    interpretedContractId: row.interpretedContractId,
    venue: row.venue as typeof TARGET_VENUES[number],
    venueMarketId: row.venueMarketId,
    title: row.title,
    canonicalFamily: "OFFICE_EXIT_BY_DATE",
    canonicalTopicKey: topicKey,
    canonicalSubjectKey: extractSubjectKey(topicKey),
    canonicalJurisdiction: row.jurisdiction,
    canonicalOffice: row.office,
    canonicalDeadlineDate: extractDeadlineDate(topicKey),
    canonicalRuleMeaning: classifyRuleMeaning(`${row.title} ${row.rulesText ?? ""}`),
    interpretationConfidence: row.extractionConfidence,
    interpretationNotes: row.parseFailures,
    rejectionReason:
      topicKey === null ? "OUT_OF_SCOPE_FOR_OFFICE_EXIT_TARGETS"
      : targetSpec?.jurisdiction !== row.jurisdiction ? "JURISDICTION_MISMATCH"
      : targetSpec?.office !== row.office ? "OFFICE_MISMATCH"
      : null
  };
};

export const buildPoliticsOfficeExitByDateFamilyArtifacts = (
  rows: readonly PoliticsExtractedRow[]
): PoliticsOfficeExitByDateFoundationArtifacts => {
  const rowsFetchedByVenue: Record<string, number> = {};
  const rowsAdmittedByVenue: Record<string, number> = {};
  const rowsRejectedByReason: Record<string, number> = {};
  const rowsAdmittedByTopicCandidate: Record<string, number> = {};
  const unresolvedRows: Array<{ venue: string; venueMarketId: string; title: string; reason: string }> = [];
  const classifiedRows = rows.map((row) => classifyPoliticsManualFamily(row));

  for (const row of rows) {
    if (TARGET_VENUES.includes(row.venue as typeof TARGET_VENUES[number])) {
      increment(rowsFetchedByVenue, row.venue);
    }
  }

  const normalizedTopicRows = rows
    .filter((row) => TARGET_VENUES.includes(row.venue as typeof TARGET_VENUES[number]))
    .map((row) => {
      const normalized = toNormalizedTopicRow(row);
      if (row.family !== "OFFICE_EXIT_BY_DATE") {
        increment(rowsRejectedByReason, row.family === "OUT_OF_SCOPE" ? "OUT_OF_SCOPE" : `${row.family}_NOT_OFFICE_EXIT_BY_DATE`);
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

  const admittedRows = normalizedTopicRows.filter((row) => row.rejectionReason === null && row.canonicalTopicKey !== null);
  const topicKeys = [...unique(admittedRows.map((row) => row.canonicalTopicKey!))].sort(
    (left: string, right: string) => left.localeCompare(right)
  );
  const comparabilitySummary = topicKeys.map((canonicalTopicKey: string) => {
      const topicRows = admittedRows.filter((row) => row.canonicalTopicKey === canonicalTopicKey);
      const venuesPresent = [...unique(topicRows.map((row) => row.venue))].sort();
      const ruleCompatibilityClassification = deriveRuleCompatibility(topicRows);
      return {
        canonicalTopicKey,
        venuesPresent,
        comparablePairCount: venuesPresent.length >= 2 ? (venuesPresent.length * (venuesPresent.length - 1)) / 2 : 0,
        strictTriPresent: venuesPresent.length >= 3,
        strictTriVenueSets: venuesPresent.length >= 3 ? [venuesPresent.slice(0, 3).join("|")] : [],
        ruleCompatibilityClassification,
        fragmentationLabel:
          venuesPresent.length <= 1 ? "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
          : ruleCompatibilityClassification === "UNKNOWN_RULE_MEANING" ? "FAMILY_REFRESHED_RULE_FRAGMENTED"
          : venuesPresent.length >= 3 ? "FAMILY_REFRESHED_COMPARABLE_TRI_EXISTS"
          : "FAMILY_REFRESHED_COMPARABLE_PAIR_EXISTS",
        matcherCandidate: venuesPresent.length >= 2 && ruleCompatibilityClassification !== "UNKNOWN_RULE_MEANING",
        notes: [
          `target_venues=${TARGET_VENUES.join("|")}`,
          `deadline=${extractDeadlineDate(canonicalTopicKey) ?? "unknown"}`,
          `subject=${extractSubjectKey(canonicalTopicKey) ?? "unknown"}`
        ]
      } satisfies PoliticsOfficeExitByDateComparabilityTopicSummary;
    });

  const blockerCounts: Record<string, number> = {};
  for (const summary of comparabilitySummary) {
    if (summary.venuesPresent.length <= 1) {
      increment(blockerCounts, "single_venue_only");
    }
    if (summary.ruleCompatibilityClassification === "UNKNOWN_RULE_MEANING") {
      increment(blockerCounts, "unknown_rule_meaning");
    }
  }

  const bestNextMatcherCandidate = [...comparabilitySummary]
    .filter((summary) => summary.matcherCandidate)
    .sort((left, right) => {
      if (right.venuesPresent.length !== left.venuesPresent.length) {
        return right.venuesPresent.length - left.venuesPresent.length;
      }
      if (right.comparablePairCount !== left.comparablePairCount) {
        return right.comparablePairCount - left.comparablePairCount;
      }
      return left.canonicalTopicKey.localeCompare(right.canonicalTopicKey);
    })[0] ?? null;

  return {
    classifiedRows,
    normalizedTopicRows,
    fetchSummaryInput: {
      rowsFetchedByVenue,
      rowsAdmittedByVenue
    },
    admissionSummary: {
      totalAdmittedOfficeExitRows: admittedRows.length,
      rowsRejectedByReason,
      rowsAdmittedByTopicCandidate,
      venueBreakdown: rowsAdmittedByVenue
    },
    comparabilitySummary,
    basisFragmentationSummary: {
      blockerCounts,
      topicBlockers: comparabilitySummary.map((summary) => ({
        canonicalTopicKey: summary.canonicalTopicKey,
        reasons: summary.venuesPresent.length <= 1 ? ["single_venue_only"] : [],
        venuesPresent: summary.venuesPresent
      })),
      unresolvedRows
    },
    finalDecision: {
      overallFamilyDecision:
        admittedRows.length === 0 ? "OFFICE_EXIT_BY_DATE_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE"
        : bestNextMatcherCandidate?.strictTriPresent ? "OFFICE_EXIT_BY_DATE_FAMILY_REFRESHED_TRI_MATCHER_CANDIDATE_FOUND"
        : bestNextMatcherCandidate !== null ? "OFFICE_EXIT_BY_DATE_FAMILY_REFRESHED_PAIR_MATCHER_CANDIDATE_FOUND"
        : comparabilitySummary.every((summary: PoliticsOfficeExitByDateComparabilityTopicSummary) => summary.venuesPresent.length <= 1)
          ? "OFFICE_EXIT_BY_DATE_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
          : "OFFICE_EXIT_BY_DATE_FAMILY_REFRESHED_RULE_FRAGMENTED",
      bestNextMatcherCandidate: bestNextMatcherCandidate
        ? {
            canonicalTopicKey: bestNextMatcherCandidate.canonicalTopicKey,
            venuesPresent: bestNextMatcherCandidate.venuesPresent,
            ruleCompatibilityClassification: bestNextMatcherCandidate.ruleCompatibilityClassification,
            fragmentationLabel: bestNextMatcherCandidate.fragmentationLabel
          }
        : null,
      bestCandidateTopicKey: bestNextMatcherCandidate?.canonicalTopicKey ?? null,
      familySupplyCredible: admittedRows.length > 0,
      operatorCredible: true,
      matcherFollowUpJustified: bestNextMatcherCandidate !== null,
      singleBestNextAction:
        bestNextMatcherCandidate !== null
          ? `Start a narrow office-exit matcher follow-up on ${bestNextMatcherCandidate.canonicalTopicKey}.`
          : "Keep office-exit-by-date at family-foundation only until exact venue truth is stably re-proven."
    }
  };
};
