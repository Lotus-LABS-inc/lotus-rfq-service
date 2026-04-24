import { normalizeFreeText } from "../../canonical/canonicalization-types.js";
import type { CryptoAthByDateAssetConfig } from "./crypto-ath-by-date-assets.js";
import { FAMILY_DATE_LABEL_TO_KEY } from "./crypto-ath-by-date-assets.js";

export type CryptoAthByDateVenue = "LIMITLESS" | "POLYMARKET";

export type CryptoAthByDateRuleCompatibilityClass =
  | "EXACT_RULE_COMPATIBLE"
  | "SEMANTICALLY_COMPATIBLE_REWORDING";

export interface CryptoAthByDateExtractedRow {
  interpretedContractId: string;
  venue: CryptoAthByDateVenue;
  venueMarketId: string;
  sourceUrl: string;
  title: string;
  rulesText: string | null;
  exactDateLabel: string;
}

export interface CryptoAthByDateNormalizedTopicRow {
  interpretedContractId: string;
  venue: CryptoAthByDateVenue;
  venueMarketId: string;
  title: string;
  canonicalFamily: "ATH_BY_DATE";
  canonicalTopicKey: string | null;
  canonicalAsset: CryptoAthByDateAssetConfig["asset"] | null;
  canonicalDateKey: string | null;
  interpretationNotes: readonly string[];
  rejectionReason: string | null;
}

export interface CryptoAthByDateComparabilityTopicSummary {
  canonicalTopicKey: string;
  canonicalDateKey: string;
  venuesPresent: readonly CryptoAthByDateVenue[];
  ruleCompatibilityClassification: CryptoAthByDateRuleCompatibilityClass;
  fragmentationLabel:
    | "FAMILY_REFRESHED_NO_SUPPLY"
    | "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
    | "FAMILY_REFRESHED_SHARED_DATE_BUCKETS_EXIST";
  matcherCandidate: boolean;
  notes: readonly string[];
}

export interface CryptoAthByDateFoundationArtifacts {
  normalizedTopicRows: readonly CryptoAthByDateNormalizedTopicRow[];
  fetchSummaryInput: {
    rowsFetchedByVenue: Record<string, number>;
    rowsAdmittedByVenue: Record<string, number>;
  };
  admissionSummary: {
    totalAdmittedAthRows: number;
    rowsRejectedByReason: Record<string, number>;
    rowsAdmittedByTopicCandidate: Record<string, number>;
    venueBreakdown: Record<string, number>;
  };
  comparabilitySummary: readonly CryptoAthByDateComparabilityTopicSummary[];
  basisFragmentationSummary: {
    blockerCounts: Record<string, number>;
    topicBlockers: readonly {
      canonicalTopicKey: string | null;
      reasons: readonly string[];
      venuesPresent: readonly CryptoAthByDateVenue[];
    }[];
    unresolvedRows: readonly {
      venue: CryptoAthByDateVenue;
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

export interface CryptoAthByDatePairLane {
  canonicalTopicKey: string;
  venuePair: "LIMITLESS|POLYMARKET";
  exactDateKey: string;
  routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE" | "PAIR_REVIEW_REQUIRED";
  rulesDecision: CryptoAthByDateRuleCompatibilityClass;
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: CryptoAthByDateVenue;
    venueMarketId: string;
    rawTitle: string;
  }[];
  notes: readonly string[];
}

export interface CryptoAthByDateMatcherMaterialization {
  admittedVenues: readonly CryptoAthByDateVenue[];
  admittedTopicKeys: readonly string[];
  pairLanes: readonly CryptoAthByDatePairLane[];
  rejections: readonly {
    scope: "date_bucket" | "pair_lane";
    canonicalTopicKey?: string | null;
    exactDateKey?: string | null;
    venuePair?: string;
    reason: "NOT_SHARED" | "PAIR_EDGE_MISSING";
    notes: string;
  }[];
  finalDecision: {
    overallDecision: string;
    bestPair: "LIMITLESS|POLYMARKET" | null;
    pairMatcherReady: boolean;
    exactSafePairCandidateCount: number;
    ruleStatus: CryptoAthByDateRuleCompatibilityClass;
    operatorCredible: boolean;
    matcherFollowUpJustified: boolean;
    singleBestNextAction: string;
  };
}

const TOPIC_VENUES = ["LIMITLESS", "POLYMARKET"] as const;
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

const buildTopicKey = (config: CryptoAthByDateAssetConfig, dateKey: string): string =>
  `${config.familyKey}|${dateKey}`;

const normalizeDateKey = (value: string): string | null => {
  const trimmed = value.trim();
  const direct = (FAMILY_DATE_LABEL_TO_KEY as Record<string, string>)[trimmed];
  if (direct) {
    return direct;
  }
  const normalized = normalizeFreeText(trimmed).replace(/\?/g, "");
  for (const [dateLabel, dateKey] of Object.entries(FAMILY_DATE_LABEL_TO_KEY)) {
    if (normalized.includes(normalizeFreeText(dateLabel))) {
      return dateKey;
    }
  }
  const slugMatch = normalized.match(/\b(march|june|september|december)\s+(\d{1,2})\s+2026\b/);
  if (!slugMatch) {
    return null;
  }
  const month = slugMatch[1] ?? "";
  const day = (slugMatch[2] ?? "").padStart(2, "0");
  const monthNumber =
    month === "march" ? "03"
    : month === "june" ? "06"
    : month === "september" ? "09"
    : month === "december" ? "12"
    : null;
  return monthNumber ? `2026-${monthNumber}-${day}` : null;
};

const toNormalizedTopicRow = (
  config: CryptoAthByDateAssetConfig,
  row: CryptoAthByDateExtractedRow
): CryptoAthByDateNormalizedTopicRow => {
  const canonicalDateKey = normalizeDateKey(row.exactDateLabel)
    ?? normalizeDateKey(row.title)
    ?? normalizeDateKey(row.rulesText ?? "");
  const canonicalTopicKey = canonicalDateKey ? buildTopicKey(config, canonicalDateKey) : null;

  return {
    interpretedContractId: row.interpretedContractId,
    venue: row.venue,
    venueMarketId: row.venueMarketId,
    title: row.title,
    canonicalFamily: "ATH_BY_DATE",
    canonicalTopicKey,
    canonicalAsset: canonicalTopicKey === null ? null : config.asset,
    canonicalDateKey,
    interpretationNotes: [
      `exact_date_label=${row.exactDateLabel}`,
      row.rulesText ? "rules_present" : "rules_missing"
    ],
    rejectionReason:
      canonicalTopicKey === null ? `OUT_OF_SCOPE_FOR_${config.asset}_ATH_BY_DATE_2026`
      : null
  };
};

const deriveRuleCompatibility = (
  rows: readonly CryptoAthByDateNormalizedTopicRow[],
  sourceRowsById: ReadonlyMap<string, CryptoAthByDateExtractedRow>
): CryptoAthByDateRuleCompatibilityClass => {
  const normalizedRuleTexts = new Set(
    rows
      .map((row) => sourceRowsById.get(row.interpretedContractId)?.rulesText ?? row.title)
      .map((value) => normalizeFreeText(value).replace(/\s+/g, " ").trim())
      .filter((value) => value.length > 0)
  );
  return normalizedRuleTexts.size <= 1 ? "EXACT_RULE_COMPATIBLE" : "SEMANTICALLY_COMPATIBLE_REWORDING";
};

export const buildCryptoAthByDateFamilyArtifacts = (
  config: CryptoAthByDateAssetConfig,
  rows: readonly CryptoAthByDateExtractedRow[]
): CryptoAthByDateFoundationArtifacts => {
  const rowsFetchedByVenue: Record<string, number> = {};
  const rowsAdmittedByVenue: Record<string, number> = {};
  const rowsRejectedByReason: Record<string, number> = {};
  const rowsAdmittedByTopicCandidate: Record<string, number> = {};
  const unresolvedRows: Array<{
    venue: CryptoAthByDateVenue;
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

  const topics = new Map<string, CryptoAthByDateNormalizedTopicRow[]>();
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
      const canonicalDateKey = topicRows[0]?.canonicalDateKey ?? "unknown";
      const venuesPresent = [...new Set(topicRows.map((row) => row.venue))].sort() as CryptoAthByDateVenue[];
      const matcherCandidate = venuesPresent.length >= 2;
      return {
        canonicalTopicKey,
        canonicalDateKey,
        venuesPresent,
        ruleCompatibilityClassification: deriveRuleCompatibility(topicRows, sourceRowsById),
        fragmentationLabel:
          topicRows.length === 0 ? "FAMILY_REFRESHED_NO_SUPPLY"
          : venuesPresent.length === 1 ? "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
          : "FAMILY_REFRESHED_SHARED_DATE_BUCKETS_EXIST",
        matcherCandidate,
        notes: [
          `asset=${config.asset}`,
          `pair_shared=${matcherCandidate ? "yes" : "no"}`
        ]
      } satisfies CryptoAthByDateComparabilityTopicSummary;
    })
    .sort((left, right) => left.canonicalDateKey.localeCompare(right.canonicalDateKey));

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
      totalAdmittedAthRows: normalizedTopicRows.filter((row) => row.rejectionReason === null).length,
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
          ? `Run a narrow matcher pass for the shared ${config.asset} ATH-by-date buckets only, starting with LIMITLESS|POLYMARKET and excluding non-shared tails.`
          : `Keep ${config.asset} ATH-by-date on the narrow family/supply track until a shared pair core survives.`
    }
  };
};

const extractDateKey = (config: CryptoAthByDateAssetConfig, topicKey: string): string =>
  topicKey.startsWith(`${config.familyKey}|`) ? topicKey.slice(`${config.familyKey}|`.length) : topicKey;

export const buildCryptoAthByDateMatcherMaterialization = (input: {
  config: CryptoAthByDateAssetConfig;
  normalizedTopics: readonly CryptoAthByDateNormalizedTopicRow[];
  comparabilitySummary: readonly CryptoAthByDateComparabilityTopicSummary[];
}): CryptoAthByDateMatcherMaterialization => {
  const { config } = input;
  const topicRows = input.normalizedTopics.filter((row) => row.rejectionReason === null && row.canonicalTopicKey !== null);
  const admittedVenues = [...new Set(topicRows.map((row) => row.venue))].sort() as CryptoAthByDateVenue[];
  const admittedTopicKeys = [...new Set(
    topicRows.map((row) => row.canonicalTopicKey).filter((value): value is string => value !== null)
  )].sort();

  const rowMap = new Map<string, Map<CryptoAthByDateVenue, CryptoAthByDateNormalizedTopicRow>>();
  for (const row of topicRows) {
    const topicKey = row.canonicalTopicKey!;
    const venueMap = rowMap.get(topicKey) ?? new Map<CryptoAthByDateVenue, CryptoAthByDateNormalizedTopicRow>();
    venueMap.set(row.venue, row);
    rowMap.set(topicKey, venueMap);
  }

  const pairLanes: CryptoAthByDatePairLane[] = [];
  const rejections: Array<{
    scope: "date_bucket" | "pair_lane";
    canonicalTopicKey?: string | null;
    exactDateKey?: string | null;
    venuePair?: string;
    reason: "NOT_SHARED" | "PAIR_EDGE_MISSING";
    notes: string;
  }> = [];

  for (const summary of [...input.comparabilitySummary].sort((a, b) => a.canonicalDateKey.localeCompare(b.canonicalDateKey))) {
    const venueMap = rowMap.get(summary.canonicalTopicKey) ?? new Map<CryptoAthByDateVenue, CryptoAthByDateNormalizedTopicRow>();
    if (!(venueMap.has("LIMITLESS") && venueMap.has("POLYMARKET"))) {
      rejections.push({
        scope: "date_bucket",
        canonicalTopicKey: summary.canonicalTopicKey,
        exactDateKey: summary.canonicalDateKey,
        reason: "NOT_SHARED",
        notes: `${summary.canonicalTopicKey} is not shared on LIMITLESS|POLYMARKET; current venues are ${summary.venuesPresent.join("|") || "none"}.`
      });
      continue;
    }

    const leftRow = venueMap.get("LIMITLESS")!;
    const rightRow = venueMap.get("POLYMARKET")!;
    pairLanes.push({
      canonicalTopicKey: summary.canonicalTopicKey,
      venuePair: "LIMITLESS|POLYMARKET",
      exactDateKey: extractDateKey(config, summary.canonicalTopicKey),
      routeabilityDecision:
        summary.ruleCompatibilityClassification === "EXACT_RULE_COMPATIBLE"
          ? "PAIR_EXACT_AUTO_ROUTEABLE"
          : "PAIR_REVIEW_REQUIRED",
      rulesDecision: summary.ruleCompatibilityClassification,
      matcherReady: true,
      evidenceSources: EVIDENCE_SOURCE_NAMES(config.artifactKey),
      evidence: [
        { venue: "LIMITLESS", venueMarketId: leftRow.venueMarketId, rawTitle: leftRow.title },
        { venue: "POLYMARKET", venueMarketId: rightRow.venueMarketId, rawTitle: rightRow.title }
      ],
      notes:
        summary.ruleCompatibilityClassification === "EXACT_RULE_COMPATIBLE"
          ? [`Exact-safe ${config.asset} ATH-by-date shared bucket on LIMITLESS|POLYMARKET for ${summary.canonicalDateKey}.`]
          : [
            `${config.asset} ATH-by-date bucket ${summary.canonicalDateKey} is shared on LIMITLESS|POLYMARKET, but venue wording is semantically compatible rather than exact.`,
            "Operator review is required before treating this pair lane as exact-safe."
          ]
    });
  }

  if (pairLanes.length === 0) {
    rejections.push({
      scope: "pair_lane",
      venuePair: "LIMITLESS|POLYMARKET",
      reason: "PAIR_EDGE_MISSING",
      notes: `LIMITLESS|POLYMARKET does not currently have a shared ${config.asset} ATH-by-date bucket core.`
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
      bestPair: pairLanes.length > 0 ? "LIMITLESS|POLYMARKET" : null,
      pairMatcherReady: pairLanes.length > 0,
      exactSafePairCandidateCount: pairLanes.length,
      ruleStatus: pairLanes[0]?.rulesDecision ?? "SEMANTICALLY_COMPATIBLE_REWORDING",
      operatorCredible: pairLanes.length > 0,
      matcherFollowUpJustified: pairLanes.length > 0,
      singleBestNextAction:
        pairLanes.length > 0
          ? `Run a narrow readiness pass for the shared ${config.asset} ATH-by-date pair buckets with LIMITLESS|POLYMARKET explicit.`
          : `Keep ${config.asset} ATH-by-date on the narrow family/supply track until a shared pair core survives matcher construction.`
    }
  };
};
