import { normalizeFreeText } from "../../canonical/canonicalization-types.js";
import type { CryptoThresholdByDateAssetConfig } from "./crypto-threshold-by-date-assets.js";

export type CryptoThresholdByDateVenue = "POLYMARKET" | "PREDICT";
export type CryptoThresholdComparator = "ABOVE" | "BELOW";

export type CryptoThresholdByDateRuleCompatibilityClass =
  | "EXACT_RULE_COMPATIBLE"
  | "SEMANTICALLY_COMPATIBLE_REWORDING";

export interface CryptoThresholdByDateExtractedRow {
  interpretedContractId: string;
  venue: CryptoThresholdByDateVenue;
  venueMarketId: string;
  sourceUrl: string;
  title: string;
  rulesText: string | null;
  comparator: CryptoThresholdComparator;
  thresholdLabel: string;
}

export interface CryptoThresholdByDateNormalizedTopicRow {
  interpretedContractId: string;
  venue: CryptoThresholdByDateVenue;
  venueMarketId: string;
  title: string;
  canonicalFamily: "THRESHOLD_BY_DATE";
  canonicalTopicKey: string | null;
  canonicalAsset: CryptoThresholdByDateAssetConfig["asset"] | null;
  canonicalDateKey: string | null;
  canonicalThresholdValue: string | null;
  canonicalComparator: CryptoThresholdComparator | null;
  canonicalThresholdLabel: string | null;
  interpretationNotes: readonly string[];
  rejectionReason: string | null;
}

export interface CryptoThresholdByDateComparabilityTopicSummary {
  canonicalTopicKey: string;
  canonicalDateKey: string;
  canonicalThresholdValue: string;
  canonicalComparator: CryptoThresholdComparator;
  canonicalThresholdLabel: string;
  venuesPresent: readonly CryptoThresholdByDateVenue[];
  ruleCompatibilityClassification: CryptoThresholdByDateRuleCompatibilityClass;
  fragmentationLabel:
    | "FAMILY_REFRESHED_NO_SUPPLY"
    | "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
    | "FAMILY_REFRESHED_SHARED_THRESHOLD_BUCKETS_EXIST";
  matcherCandidate: boolean;
  notes: readonly string[];
}

export interface CryptoThresholdByDateFoundationArtifacts {
  normalizedTopicRows: readonly CryptoThresholdByDateNormalizedTopicRow[];
  fetchSummaryInput: {
    rowsFetchedByVenue: Record<string, number>;
    rowsAdmittedByVenue: Record<string, number>;
  };
  admissionSummary: {
    totalAdmittedThresholdRows: number;
    rowsRejectedByReason: Record<string, number>;
    rowsAdmittedByTopicCandidate: Record<string, number>;
    venueBreakdown: Record<string, number>;
  };
  comparabilitySummary: readonly CryptoThresholdByDateComparabilityTopicSummary[];
  basisFragmentationSummary: {
    blockerCounts: Record<string, number>;
    topicBlockers: readonly {
      canonicalTopicKey: string | null;
      reasons: readonly string[];
      venuesPresent: readonly CryptoThresholdByDateVenue[];
    }[];
    unresolvedRows: readonly {
      venue: CryptoThresholdByDateVenue;
      venueMarketId: string;
      title: string;
      reason: string;
    }[];
  };
  finalDecision: {
    overallFamilyDecision: string;
    sharedCandidateTopicKeys: readonly string[];
    familySupplyCredible: boolean;
    operatorCredible: boolean;
    matcherFollowUpJustified: boolean;
    singleBestNextAction: string;
  };
}

export interface CryptoThresholdByDatePairLane {
  canonicalTopicKey: string;
  venuePair: "POLYMARKET|PREDICT";
  exactThresholdLabel: string;
  exactThresholdValue: string;
  comparator: CryptoThresholdComparator;
  routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE" | "PAIR_REVIEW_REQUIRED";
  rulesDecision: CryptoThresholdByDateRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: CryptoThresholdByDateVenue;
    venueMarketId: string;
    rawTitle: string;
  }[];
  notes: readonly string[];
}

export interface CryptoThresholdByDateMatcherMaterialization {
  admittedVenues: readonly CryptoThresholdByDateVenue[];
  admittedTopicKeys: readonly string[];
  pairLanes: readonly CryptoThresholdByDatePairLane[];
  rejections: readonly {
    scope: "threshold_bucket" | "pair_lane";
    canonicalTopicKey?: string | null;
    exactThresholdLabel?: string | null;
    venuePair?: string;
    reason: "NOT_SHARED" | "PAIR_EDGE_MISSING";
    notes: string;
  }[];
  finalDecision: {
    overallDecision: string;
    bestPair: "POLYMARKET|PREDICT" | null;
    pairMatcherReady: boolean;
    exactSafePairCandidateCount: number;
    ruleStatus: CryptoThresholdByDateRuleCompatibilityClass;
    operatorCredible: boolean;
    matcherFollowUpJustified: boolean;
    singleBestNextAction: string;
  };
}

const TOPIC_VENUES = ["POLYMARKET", "PREDICT"] as const;

const EVIDENCE_SOURCE_NAMES = (artifactKey: string) => [
  `artifacts/crypto/${artifactKey}-family-pass/crypto-${artifactKey}-fetch-summary.json`,
  `artifacts/crypto/${artifactKey}-family-pass/crypto-${artifactKey}-admission-summary.json`,
  `artifacts/crypto/${artifactKey}-family-pass/crypto-${artifactKey}-normalized-topics.json`,
  `artifacts/crypto/${artifactKey}-family-pass/crypto-${artifactKey}-comparability-summary.json`,
  `artifacts/crypto/${artifactKey}-family-pass/crypto-${artifactKey}-basis-fragmentation-summary.json`,
  `artifacts/crypto/${artifactKey}-family-pass/crypto-${artifactKey}-final-decision.json`
] as const;

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

const normalizeThresholdValue = (value: string): string | null => {
  const digits = value.replace(/[^0-9.]/g, "").trim();
  if (digits.length === 0) {
    return null;
  }
  const numeric = Number.parseFloat(digits);
  return Number.isFinite(numeric) ? String(numeric) : null;
};

const comparatorLabel = (comparator: CryptoThresholdComparator): string =>
  comparator === "ABOVE" ? "↑" : "↓";

const buildThresholdLabel = (comparator: CryptoThresholdComparator, thresholdValue: string): string =>
  `${comparatorLabel(comparator)} ${Number.parseInt(thresholdValue, 10).toLocaleString("en-US")}`;

const buildTopicKey = (
  config: CryptoThresholdByDateAssetConfig,
  comparator: CryptoThresholdComparator,
  thresholdValue: string
): string => `${config.familyKey}|${comparator}|${thresholdValue}`;

const toNormalizedTopicRow = (
  config: CryptoThresholdByDateAssetConfig,
  row: CryptoThresholdByDateExtractedRow
): CryptoThresholdByDateNormalizedTopicRow => {
  const canonicalThresholdValue = normalizeThresholdValue(row.thresholdLabel)
    ?? normalizeThresholdValue(row.title)
    ?? normalizeThresholdValue(row.rulesText ?? "");
  const canonicalComparator = canonicalThresholdValue === null ? null : row.comparator;
  const canonicalThresholdLabel =
    canonicalThresholdValue === null || canonicalComparator === null
      ? null
      : buildThresholdLabel(canonicalComparator, canonicalThresholdValue);
  const canonicalTopicKey =
    canonicalThresholdValue === null || canonicalComparator === null
      ? null
      : buildTopicKey(config, canonicalComparator, canonicalThresholdValue);

  return {
    interpretedContractId: row.interpretedContractId,
    venue: row.venue,
    venueMarketId: row.venueMarketId,
    title: row.title,
    canonicalFamily: "THRESHOLD_BY_DATE",
    canonicalTopicKey,
    canonicalAsset: canonicalTopicKey === null ? null : config.asset,
    canonicalDateKey: canonicalTopicKey === null ? null : config.monthEndDateKey,
    canonicalThresholdValue,
    canonicalComparator,
    canonicalThresholdLabel,
    interpretationNotes: [
      `threshold_label=${row.thresholdLabel}`,
      `comparator=${row.comparator}`,
      row.rulesText ? "rules_present" : "rules_missing"
    ],
    rejectionReason:
      canonicalTopicKey === null ? `OUT_OF_SCOPE_FOR_${config.asset}_THRESHOLD_BY_DATE_APR_2026` : null
  };
};

const deriveRuleCompatibility = (
  rows: readonly CryptoThresholdByDateNormalizedTopicRow[],
  sourceRowsById: ReadonlyMap<string, CryptoThresholdByDateExtractedRow>
): CryptoThresholdByDateRuleCompatibilityClass => {
  const normalizedRuleTexts = new Set(
    rows
      .map((row) => sourceRowsById.get(row.interpretedContractId)?.rulesText ?? row.title)
      .map((value) => normalizeFreeText(value).replace(/\s+/g, " ").trim())
      .filter((value) => value.length > 0)
  );
  return normalizedRuleTexts.size <= 1 ? "EXACT_RULE_COMPATIBLE" : "SEMANTICALLY_COMPATIBLE_REWORDING";
};

export const buildCryptoThresholdByDateFamilyArtifacts = (
  config: CryptoThresholdByDateAssetConfig,
  rows: readonly CryptoThresholdByDateExtractedRow[]
): CryptoThresholdByDateFoundationArtifacts => {
  const rowsFetchedByVenue: Record<string, number> = {};
  const rowsAdmittedByVenue: Record<string, number> = {};
  const rowsRejectedByReason: Record<string, number> = {};
  const rowsAdmittedByTopicCandidate: Record<string, number> = {};
  const unresolvedRows: Array<{
    venue: CryptoThresholdByDateVenue;
    venueMarketId: string;
    title: string;
    reason: string;
  }> = [];
  const sourceRowsById = new Map(rows.map((row) => [row.interpretedContractId, row] as const));

  for (const row of rows) {
    if (TOPIC_VENUES.includes(row.venue)) {
      increment(rowsFetchedByVenue, row.venue);
    }
  }

  const normalizedTopicRows = rows
    .filter((row) => TOPIC_VENUES.includes(row.venue))
    .map((row) => {
      const normalized = toNormalizedTopicRow(config, row);
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

  const topics = new Map<string, CryptoThresholdByDateNormalizedTopicRow[]>();
  for (const row of normalizedTopicRows) {
    if (row.rejectionReason || row.canonicalTopicKey === null) {
      continue;
    }
    const bucket = topics.get(row.canonicalTopicKey) ?? [];
    bucket.push(row);
    topics.set(row.canonicalTopicKey, bucket);
  }

  const comparabilitySummary = [...topics.entries()]
    .map(([canonicalTopicKey, topicRows]) => {
      const first = topicRows[0]!;
      const venuesPresent = [...new Set(topicRows.map((row) => row.venue))].sort() as CryptoThresholdByDateVenue[];
      const matcherCandidate = venuesPresent.length >= 2;
      return {
        canonicalTopicKey,
        canonicalDateKey: first.canonicalDateKey ?? config.monthEndDateKey,
        canonicalThresholdValue: first.canonicalThresholdValue ?? "unknown",
        canonicalComparator: first.canonicalComparator ?? "ABOVE",
        canonicalThresholdLabel: first.canonicalThresholdLabel ?? "unknown",
        venuesPresent,
        ruleCompatibilityClassification: deriveRuleCompatibility(topicRows, sourceRowsById),
        fragmentationLabel:
          topicRows.length === 0 ? "FAMILY_REFRESHED_NO_SUPPLY"
          : venuesPresent.length === 1 ? "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
          : "FAMILY_REFRESHED_SHARED_THRESHOLD_BUCKETS_EXIST",
        matcherCandidate,
        notes: [
          `asset=${config.asset}`,
          `pair_shared=${matcherCandidate ? "yes" : "no"}`
        ]
      } satisfies CryptoThresholdByDateComparabilityTopicSummary;
    })
    .sort((left, right) => {
      if (left.canonicalComparator !== right.canonicalComparator) {
        return left.canonicalComparator.localeCompare(right.canonicalComparator);
      }
      return Number.parseFloat(left.canonicalThresholdValue) - Number.parseFloat(right.canonicalThresholdValue);
    });

  const sharedCandidateTopicKeys = comparabilitySummary
    .filter((topic) => topic.matcherCandidate)
    .map((topic) => topic.canonicalTopicKey);

  return {
    normalizedTopicRows,
    fetchSummaryInput: {
      rowsFetchedByVenue,
      rowsAdmittedByVenue
    },
    admissionSummary: {
      totalAdmittedThresholdRows: normalizedTopicRows.filter((row) => row.rejectionReason === null).length,
      rowsRejectedByReason,
      rowsAdmittedByTopicCandidate,
      venueBreakdown: rowsAdmittedByVenue
    },
    comparabilitySummary,
    basisFragmentationSummary: {
      blockerCounts: rowsRejectedByReason,
      topicBlockers: comparabilitySummary
        .filter((topic) => !topic.matcherCandidate)
        .map((topic) => ({
          canonicalTopicKey: topic.canonicalTopicKey,
          reasons: ["single_venue_only"],
          venuesPresent: topic.venuesPresent
        })),
      unresolvedRows
    },
    finalDecision: {
      overallFamilyDecision:
        comparabilitySummary.length === 0
          ? `${config.decisionPrefix}_FAMILY_REFRESHED_NO_MATCHER_CANDIDATE`
          : sharedCandidateTopicKeys.length > 0
            ? `${config.decisionPrefix}_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND`
            : `${config.decisionPrefix}_FAMILY_REFRESHED_SINGLE_VENUE_ONLY`,
      sharedCandidateTopicKeys,
      familySupplyCredible: sharedCandidateTopicKeys.length > 0,
      operatorCredible: sharedCandidateTopicKeys.length > 0,
      matcherFollowUpJustified: sharedCandidateTopicKeys.length > 0,
      singleBestNextAction:
        sharedCandidateTopicKeys.length > 0
          ? `Run a narrow matcher pass for the shared ${config.asset} threshold-by-date ladder only, starting with POLYMARKET|PREDICT and excluding non-shared tails.`
          : `Keep ${config.asset} threshold-by-date on the narrow family/supply track until a shared POLYMARKET|PREDICT core survives.`
    }
  };
};

export const buildCryptoThresholdByDateMatcherMaterialization = (input: {
  config: CryptoThresholdByDateAssetConfig;
  normalizedTopics: readonly CryptoThresholdByDateNormalizedTopicRow[];
  comparabilitySummary: readonly CryptoThresholdByDateComparabilityTopicSummary[];
}): CryptoThresholdByDateMatcherMaterialization => {
  const { config } = input;
  const topicRows = input.normalizedTopics.filter((row) => row.rejectionReason === null && row.canonicalTopicKey !== null);
  const admittedVenues = [...new Set(topicRows.map((row) => row.venue))].sort() as CryptoThresholdByDateVenue[];
  const admittedTopicKeys = [...new Set(
    topicRows.map((row) => row.canonicalTopicKey).filter((value): value is string => value !== null)
  )].sort();

  const rowMap = new Map<string, Map<CryptoThresholdByDateVenue, CryptoThresholdByDateNormalizedTopicRow>>();
  for (const row of topicRows) {
    const topicKey = row.canonicalTopicKey!;
    const venueMap = rowMap.get(topicKey) ?? new Map<CryptoThresholdByDateVenue, CryptoThresholdByDateNormalizedTopicRow>();
    venueMap.set(row.venue, row);
    rowMap.set(topicKey, venueMap);
  }

  const pairLanes: CryptoThresholdByDatePairLane[] = [];
  const rejections: Array<{
    scope: "threshold_bucket" | "pair_lane";
    canonicalTopicKey?: string | null;
    exactThresholdLabel?: string | null;
    venuePair?: string;
    reason: "NOT_SHARED" | "PAIR_EDGE_MISSING";
    notes: string;
  }> = [];

  for (const summary of input.comparabilitySummary) {
    const venueMap = rowMap.get(summary.canonicalTopicKey) ?? new Map<CryptoThresholdByDateVenue, CryptoThresholdByDateNormalizedTopicRow>();
    if (!(venueMap.has("POLYMARKET") && venueMap.has("PREDICT"))) {
      rejections.push({
        scope: "threshold_bucket",
        canonicalTopicKey: summary.canonicalTopicKey,
        exactThresholdLabel: summary.canonicalThresholdLabel,
        reason: "NOT_SHARED",
        notes: `${summary.canonicalThresholdLabel} is not shared on POLYMARKET|PREDICT; current venues are ${summary.venuesPresent.join("|") || "none"}.`
      });
      continue;
    }

    const leftRow = venueMap.get("POLYMARKET")!;
    const rightRow = venueMap.get("PREDICT")!;
    pairLanes.push({
      canonicalTopicKey: summary.canonicalTopicKey,
      venuePair: "POLYMARKET|PREDICT",
      exactThresholdLabel: summary.canonicalThresholdLabel,
      exactThresholdValue: summary.canonicalThresholdValue,
      comparator: summary.canonicalComparator,
      routeabilityDecision:
        summary.ruleCompatibilityClassification === "EXACT_RULE_COMPATIBLE"
          ? "PAIR_EXACT_AUTO_ROUTEABLE"
          : "PAIR_REVIEW_REQUIRED",
      rulesDecision: summary.ruleCompatibilityClassification,
      matcherReady: true,
      evidenceSources: EVIDENCE_SOURCE_NAMES(config.artifactKey),
      evidence: [
        { venue: "POLYMARKET", venueMarketId: leftRow.venueMarketId, rawTitle: leftRow.title },
        { venue: "PREDICT", venueMarketId: rightRow.venueMarketId, rawTitle: rightRow.title }
      ],
      notes:
        summary.ruleCompatibilityClassification === "EXACT_RULE_COMPATIBLE"
          ? [`Exact-safe ${config.asset} threshold ladder bucket ${summary.canonicalThresholdLabel} on POLYMARKET|PREDICT.`]
          : [
            `${config.asset} threshold bucket ${summary.canonicalThresholdLabel} is shared on POLYMARKET|PREDICT, but venue wording is semantically compatible rather than exact.`,
            "Operator review is required before treating this pair lane as exact-safe."
          ]
    });
  }

  if (pairLanes.length === 0) {
    rejections.push({
      scope: "pair_lane",
      venuePair: "POLYMARKET|PREDICT",
      reason: "PAIR_EDGE_MISSING",
      notes: `POLYMARKET|PREDICT does not currently have a shared ${config.asset} threshold-by-date bucket core.`
    });
  }

  return {
    admittedVenues,
    admittedTopicKeys,
    pairLanes,
    rejections,
    finalDecision: {
      overallDecision:
        pairLanes.length > 0
          ? `${config.decisionPrefix}_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW`
          : `${config.decisionPrefix}_MATCHER_NOT_READY`,
      bestPair: pairLanes.length > 0 ? "POLYMARKET|PREDICT" : null,
      pairMatcherReady: pairLanes.length > 0,
      exactSafePairCandidateCount: pairLanes.length,
      ruleStatus: pairLanes[0]?.rulesDecision ?? "SEMANTICALLY_COMPATIBLE_REWORDING",
      operatorCredible: pairLanes.length > 0,
      matcherFollowUpJustified: pairLanes.length > 0,
      singleBestNextAction:
        pairLanes.length > 0
          ? `Run a narrow readiness pass for the shared ${config.asset} threshold-by-date pair buckets with POLYMARKET|PREDICT explicit.`
          : `Keep ${config.asset} threshold-by-date on the narrow family/supply track until a shared pair core survives matcher construction.`
    }
  };
};
