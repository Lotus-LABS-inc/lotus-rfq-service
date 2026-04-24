import { normalizeFreeText } from "../../canonical/canonicalization-types.js";
import type { CryptoFirstToThresholdByDateAssetConfig } from "./crypto-first-to-threshold-by-date-assets.js";

export type CryptoFirstToThresholdByDateVenue = "POLYMARKET" | "PREDICT";
export type CryptoFirstToThresholdRuleCompatibilityClass =
  | "EXACT_RULE_COMPATIBLE"
  | "SEMANTICALLY_COMPATIBLE_REWORDING";
export type CryptoFirstToThresholdTieHandling = "UNSPECIFIED";
export type CryptoFirstToThresholdInterpretationConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface CryptoFirstToThresholdByDateExtractedRow {
  interpretedContractId: string;
  venue: CryptoFirstToThresholdByDateVenue;
  venueMarketId: string;
  sourceUrl: string;
  title: string;
  rulesText: string | null;
  lowerOutcomeLabel: string;
  higherOutcomeLabel: string;
}

export interface CryptoFirstToThresholdByDateNormalizedTopicRow {
  interpretedContractId: string;
  venue: CryptoFirstToThresholdByDateVenue;
  venueMarketId: string;
  title: string;
  canonicalFamily: "FIRST_TO_THRESHOLD_BY_DATE";
  canonicalTopicKey: string | null;
  canonicalAsset: CryptoFirstToThresholdByDateAssetConfig["asset"] | null;
  canonicalLowerThreshold: string | null;
  canonicalHigherThreshold: string | null;
  canonicalDeadlineDateKey: string | null;
  priceSource: string | null;
  hitBasis: "INTRADAY_HIT" | null;
  fallbackIfNeither: "SPLIT_50_50" | null;
  tieHandling: CryptoFirstToThresholdTieHandling | null;
  exactOutcomeLabels: readonly string[];
  interpretationConfidence: CryptoFirstToThresholdInterpretationConfidence;
  interpretationNotes: readonly string[];
  rejectionReason: string | null;
}

export interface CryptoFirstToThresholdComparabilityTopicSummary {
  canonicalTopicKey: string;
  canonicalAsset: string;
  canonicalLowerThreshold: string;
  canonicalHigherThreshold: string;
  canonicalDeadlineDateKey: string;
  priceSource: string;
  hitBasis: "INTRADAY_HIT";
  fallbackIfNeither: "SPLIT_50_50";
  tieHandling: CryptoFirstToThresholdTieHandling;
  exactOutcomeLabels: readonly string[];
  venuesPresent: readonly CryptoFirstToThresholdByDateVenue[];
  ruleCompatibilityClassification: CryptoFirstToThresholdRuleCompatibilityClass;
  operatorReviewRequiredReasons: readonly string[];
  matcherCandidate: boolean;
  notes: readonly string[];
}

export interface CryptoFirstToThresholdFoundationArtifacts {
  normalizedTopicRows: readonly CryptoFirstToThresholdByDateNormalizedTopicRow[];
  fetchSummaryInput: {
    rowsFetchedByVenue: Record<string, number>;
    rowsAdmittedByVenue: Record<string, number>;
  };
  admissionSummary: {
    totalAdmittedMarkets: number;
    rowsRejectedByReason: Record<string, number>;
    rowsAdmittedByTopicCandidate: Record<string, number>;
    venueBreakdown: Record<string, number>;
  };
  comparabilitySummary: readonly CryptoFirstToThresholdComparabilityTopicSummary[];
  basisFragmentationSummary: {
    blockerCounts: Record<string, number>;
    topicBlockers: readonly {
      canonicalTopicKey: string | null;
      reasons: readonly string[];
      venuesPresent: readonly CryptoFirstToThresholdByDateVenue[];
    }[];
    unresolvedRows: readonly {
      venue: CryptoFirstToThresholdByDateVenue;
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

export interface CryptoFirstToThresholdPairLane {
  canonicalTopicKey: string;
  venuePair: "POLYMARKET|PREDICT";
  exactOutcomeLabels: readonly string[];
  lowerThreshold: string;
  higherThreshold: string;
  routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE" | "PAIR_REVIEW_REQUIRED";
  rulesDecision: CryptoFirstToThresholdRuleCompatibilityClass;
  operatorReviewRequiredReasons: readonly string[];
  matcherReady: boolean;
  evidenceSources: readonly string[];
  evidence: readonly {
    venue: CryptoFirstToThresholdByDateVenue;
    venueMarketId: string;
    rawTitle: string;
  }[];
  notes: readonly string[];
}

export interface CryptoFirstToThresholdMatcherMaterialization {
  admittedVenues: readonly CryptoFirstToThresholdByDateVenue[];
  admittedTopicKeys: readonly string[];
  pairLanes: readonly CryptoFirstToThresholdPairLane[];
  rejections: readonly {
    scope: "family" | "pair_lane";
    canonicalTopicKey?: string | null;
    venuePair?: string;
    reason:
      | "NOT_SHARED"
      | "PAIR_EDGE_MISSING"
      | "ASSET_MISMATCH"
      | "THRESHOLD_MISMATCH"
      | "DEADLINE_MISMATCH"
      | "PRICE_SOURCE_MISMATCH"
      | "HIT_BASIS_MISMATCH"
      | "FALLBACK_MISMATCH"
      | "TIE_HANDLING_AMBIGUOUS";
    notes: string;
  }[];
  finalDecision: {
    overallDecision: string;
    bestPair: "POLYMARKET|PREDICT" | null;
    pairMatcherReady: boolean;
    exactSafePairCandidateCount: number;
    ruleStatus: CryptoFirstToThresholdRuleCompatibilityClass;
    operatorCredible: boolean;
    matcherFollowUpJustified: boolean;
    singleBestNextAction: string;
  };
}

const SUPPORTED_VENUES = ["POLYMARKET", "PREDICT"] as const;

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

const normalizeThreshold = (value: string): string | null => {
  const match = value.match(/(\d+(?:,\d{3})*(?:\.\d+)?)(k|m|b)?/i);
  if (!match) {
    return null;
  }
  const base = Number.parseFloat(match[1]!.replace(/,/g, ""));
  const multiplier =
    !match[2] ? 1
    : match[2].toLowerCase() === "k" ? 1_000
    : match[2].toLowerCase() === "m" ? 1_000_000
    : 1_000_000_000;
  const normalized = base * multiplier;
  return Number.isFinite(normalized) ? String(normalized) : null;
};

const formatThresholdLabel = (rawLabel: string): string =>
  `${rawLabel.replace(/\s+/g, " ").trim()} first`;

const buildTopicKey = (config: CryptoFirstToThresholdByDateAssetConfig): string =>
  config.familyKey;

const parsePriceSource = (rulesText: string | null): string | null => {
  const normalized = normalizeFreeText(rulesText ?? "");
  if (!normalized) {
    return null;
  }
  const pairMatch = normalized.match(/\b(binance)\b.*?\b([a-z]{2,5}\/usdt)\b/);
  if (pairMatch) {
    return `${pairMatch[1]!.toUpperCase()}:${pairMatch[2]!.toUpperCase()}`;
  }
  if (normalized.includes("binance")) {
    return "BINANCE";
  }
  return null;
};

const hasFiftyFiftyFallback = (rulesText: string | null): boolean =>
  /50[\u2013-]?50|50\/50/.test(rulesText ?? "");

const deriveRuleCompatibility = (
  rows: readonly CryptoFirstToThresholdByDateNormalizedTopicRow[],
  sourceRowsById: ReadonlyMap<string, CryptoFirstToThresholdByDateExtractedRow>
): CryptoFirstToThresholdRuleCompatibilityClass => {
  const normalizedRules = new Set(
    rows
      .map((row) => sourceRowsById.get(row.interpretedContractId)?.rulesText ?? row.title)
      .map((value) => normalizeFreeText(value).replace(/\s+/g, " ").trim())
      .filter((value) => value.length > 0)
  );
  return normalizedRules.size <= 1 ? "EXACT_RULE_COMPATIBLE" : "SEMANTICALLY_COMPATIBLE_REWORDING";
};

const toNormalizedTopicRow = (
  config: CryptoFirstToThresholdByDateAssetConfig,
  row: CryptoFirstToThresholdByDateExtractedRow
): CryptoFirstToThresholdByDateNormalizedTopicRow => {
  const lowerThreshold = normalizeThreshold(row.lowerOutcomeLabel);
  const higherThreshold = normalizeThreshold(row.higherOutcomeLabel);
  const priceSource = parsePriceSource(row.rulesText);
  const fallbackIfNeither = hasFiftyFiftyFallback(row.rulesText) ? "SPLIT_50_50" : null;
  const thresholdsMatchConfig =
    lowerThreshold === config.lowerThreshold
    && higherThreshold === config.higherThreshold;

  const rejectionReason =
    lowerThreshold === null || higherThreshold === null
      ? `OUT_OF_SCOPE_FOR_${config.asset}_FIRST_TO_THRESHOLD_BY_DATE`
      : !thresholdsMatchConfig
        ? `OUT_OF_SCOPE_FOR_${config.asset}_FIRST_TO_THRESHOLD_BY_DATE`
        : null;

  return {
    interpretedContractId: row.interpretedContractId,
    venue: row.venue,
    venueMarketId: row.venueMarketId,
    title: row.title,
    canonicalFamily: "FIRST_TO_THRESHOLD_BY_DATE",
    canonicalTopicKey: rejectionReason === null ? buildTopicKey(config) : null,
    canonicalAsset: rejectionReason === null ? config.asset : null,
    canonicalLowerThreshold: rejectionReason === null ? lowerThreshold : null,
    canonicalHigherThreshold: rejectionReason === null ? higherThreshold : null,
    canonicalDeadlineDateKey: rejectionReason === null ? config.deadlineDateKey : null,
    priceSource: rejectionReason === null ? priceSource : null,
    hitBasis: rejectionReason === null ? "INTRADAY_HIT" : null,
    fallbackIfNeither: rejectionReason === null ? fallbackIfNeither : null,
    tieHandling: rejectionReason === null ? "UNSPECIFIED" : null,
    exactOutcomeLabels: rejectionReason === null ? [
      formatThresholdLabel(row.lowerOutcomeLabel),
      formatThresholdLabel(row.higherOutcomeLabel)
    ] : [],
    interpretationConfidence:
      rejectionReason !== null ? "LOW"
      : priceSource !== null && fallbackIfNeither !== null ? "HIGH"
      : "MEDIUM",
    interpretationNotes: [
      `lower_outcome=${row.lowerOutcomeLabel}`,
      `higher_outcome=${row.higherOutcomeLabel}`,
      priceSource ? `price_source=${priceSource}` : "price_source_missing",
      fallbackIfNeither ? "fallback_50_50_present" : "fallback_50_50_missing",
      "tie_handling_unspecified"
    ],
    rejectionReason
  };
};

const EVIDENCE_SOURCE_NAMES = (artifactKey: string) => [
  `artifacts/crypto/${artifactKey}-family-pass/crypto-${artifactKey}-fetch-summary.json`,
  `artifacts/crypto/${artifactKey}-family-pass/crypto-${artifactKey}-admission-summary.json`,
  `artifacts/crypto/${artifactKey}-family-pass/crypto-${artifactKey}-normalized-topics.json`,
  `artifacts/crypto/${artifactKey}-family-pass/crypto-${artifactKey}-comparability-summary.json`,
  `artifacts/crypto/${artifactKey}-family-pass/crypto-${artifactKey}-basis-fragmentation-summary.json`,
  `artifacts/crypto/${artifactKey}-family-pass/crypto-${artifactKey}-final-decision.json`
] as const;

export const buildCryptoFirstToThresholdByDateFamilyArtifacts = (
  config: CryptoFirstToThresholdByDateAssetConfig,
  rows: readonly CryptoFirstToThresholdByDateExtractedRow[]
): CryptoFirstToThresholdFoundationArtifacts => {
  const rowsFetchedByVenue: Record<string, number> = {};
  const rowsAdmittedByVenue: Record<string, number> = {};
  const rowsRejectedByReason: Record<string, number> = {};
  const rowsAdmittedByTopicCandidate: Record<string, number> = {};
  const unresolvedRows: Array<{
    venue: CryptoFirstToThresholdByDateVenue;
    venueMarketId: string;
    title: string;
    reason: string;
  }> = [];
  const sourceRowsById = new Map(rows.map((row) => [row.interpretedContractId, row] as const));

  for (const row of rows) {
    if (SUPPORTED_VENUES.includes(row.venue)) {
      increment(rowsFetchedByVenue, row.venue);
    }
  }

  const normalizedTopicRows = rows
    .filter((row) => SUPPORTED_VENUES.includes(row.venue))
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

  const topics = new Map<string, CryptoFirstToThresholdByDateNormalizedTopicRow[]>();
  for (const row of normalizedTopicRows) {
    if (row.rejectionReason || row.canonicalTopicKey === null) {
      continue;
    }
    const bucket = topics.get(row.canonicalTopicKey) ?? [];
    bucket.push(row);
    topics.set(row.canonicalTopicKey, bucket);
  }

  const comparabilitySummary = [...topics.entries()].map(([canonicalTopicKey, topicRows]) => {
    const first = topicRows[0]!;
    const venuesPresent = [...new Set(topicRows.map((row) => row.venue))].sort() as CryptoFirstToThresholdByDateVenue[];
    const ruleCompatibility = deriveRuleCompatibility(topicRows, sourceRowsById);
    const operatorReviewRequiredReasons = [
      ...(first.tieHandling === "UNSPECIFIED" ? ["tie_handling_unspecified"] : []),
      ...(first.priceSource === null ? ["price_source_missing"] : []),
      ...(first.fallbackIfNeither === null ? ["fallback_if_neither_missing"] : []),
      ...(ruleCompatibility !== "EXACT_RULE_COMPATIBLE" ? ["semantic_rewording"] : [])
    ];

    return {
      canonicalTopicKey,
      canonicalAsset: first.canonicalAsset ?? config.asset,
      canonicalLowerThreshold: first.canonicalLowerThreshold ?? config.lowerThreshold,
      canonicalHigherThreshold: first.canonicalHigherThreshold ?? config.higherThreshold,
      canonicalDeadlineDateKey: first.canonicalDeadlineDateKey ?? config.deadlineDateKey,
      priceSource: first.priceSource ?? "UNKNOWN",
      hitBasis: "INTRADAY_HIT",
      fallbackIfNeither: first.fallbackIfNeither ?? "SPLIT_50_50",
      tieHandling: first.tieHandling ?? "UNSPECIFIED",
      exactOutcomeLabels: first.exactOutcomeLabels,
      venuesPresent,
      ruleCompatibilityClassification: ruleCompatibility,
      operatorReviewRequiredReasons,
      matcherCandidate: venuesPresent.length === 2,
      notes: [
        `asset=${config.asset}`,
        `threshold_pair=${first.canonicalLowerThreshold ?? "unknown"}|${first.canonicalHigherThreshold ?? "unknown"}`
      ]
    } satisfies CryptoFirstToThresholdComparabilityTopicSummary;
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
      totalAdmittedMarkets: normalizedTopicRows.filter((row) => row.rejectionReason === null).length,
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
          ? `Run a narrow matcher pass for the shared ${config.asset} first-to-threshold market only, starting with POLYMARKET|PREDICT and excluding non-shared semantics.`
          : `Keep ${config.asset} first-to-threshold on the narrow family/supply track until a shared POLYMARKET|PREDICT core survives.`
    }
  };
};

export const buildCryptoFirstToThresholdByDateMatcherMaterialization = (input: {
  config: CryptoFirstToThresholdByDateAssetConfig;
  normalizedTopics: readonly CryptoFirstToThresholdByDateNormalizedTopicRow[];
  comparabilitySummary: readonly CryptoFirstToThresholdComparabilityTopicSummary[];
}): CryptoFirstToThresholdMatcherMaterialization => {
  const { config } = input;
  const topicRows = input.normalizedTopics.filter((row) => row.rejectionReason === null && row.canonicalTopicKey !== null);
  const admittedVenues = [...new Set(topicRows.map((row) => row.venue))].sort() as CryptoFirstToThresholdByDateVenue[];
  const admittedTopicKeys = [...new Set(
    topicRows.map((row) => row.canonicalTopicKey).filter((value): value is string => value !== null)
  )].sort();

  const rejections: Array<{
    scope: "family" | "pair_lane";
    canonicalTopicKey?: string | null;
    venuePair?: string;
    reason:
      | "NOT_SHARED"
      | "PAIR_EDGE_MISSING"
      | "ASSET_MISMATCH"
      | "THRESHOLD_MISMATCH"
      | "DEADLINE_MISMATCH"
      | "PRICE_SOURCE_MISMATCH"
      | "HIT_BASIS_MISMATCH"
      | "FALLBACK_MISMATCH"
      | "TIE_HANDLING_AMBIGUOUS";
    notes: string;
  }> = [];

  const summary = input.comparabilitySummary[0];
  if (!summary) {
    rejections.push({
      scope: "pair_lane",
      venuePair: "POLYMARKET|PREDICT",
      reason: "PAIR_EDGE_MISSING",
      notes: `POLYMARKET|PREDICT does not currently have a shared ${config.asset} first-to-threshold market.`
    });
    return {
      admittedVenues,
      admittedTopicKeys,
      pairLanes: [],
      rejections,
      finalDecision: {
        overallDecision: `${config.decisionPrefix}_MATCHER_NOT_READY`,
        bestPair: null,
        pairMatcherReady: false,
        exactSafePairCandidateCount: 0,
        ruleStatus: "SEMANTICALLY_COMPATIBLE_REWORDING",
        operatorCredible: false,
        matcherFollowUpJustified: false,
        singleBestNextAction: `Keep ${config.asset} first-to-threshold on the narrow family/supply track until a shared pair core survives matcher construction.`
      }
    };
  }

  if (!(summary.venuesPresent.includes("POLYMARKET") && summary.venuesPresent.includes("PREDICT"))) {
    rejections.push({
      scope: "family",
      canonicalTopicKey: summary.canonicalTopicKey,
      reason: "NOT_SHARED",
      notes: `${config.asset} first-to-threshold market is not shared on POLYMARKET|PREDICT; current venues are ${summary.venuesPresent.join("|") || "none"}.`
    });
  }

  if (summary.priceSource === "UNKNOWN") {
    rejections.push({
      scope: "family",
      canonicalTopicKey: summary.canonicalTopicKey,
      reason: "PRICE_SOURCE_MISMATCH",
      notes: `${config.asset} first-to-threshold market is missing a credible shared price source extraction.`
    });
  }

  if (summary.fallbackIfNeither !== "SPLIT_50_50") {
    rejections.push({
      scope: "family",
      canonicalTopicKey: summary.canonicalTopicKey,
      reason: "FALLBACK_MISMATCH",
      notes: `${config.asset} first-to-threshold market does not preserve the shared 50/50 neither-hits fallback.`
    });
  }

  if (summary.tieHandling === "UNSPECIFIED") {
    rejections.push({
      scope: "family",
      canonicalTopicKey: summary.canonicalTopicKey,
      reason: "TIE_HANDLING_AMBIGUOUS",
      notes: `${config.asset} first-to-threshold market leaves tie handling unspecified and must remain operator-reviewed.`
    });
  }

  const pairReady = rejections.every((entry) =>
    entry.reason === "TIE_HANDLING_AMBIGUOUS"
      || entry.scope !== "family"
  ) && summary.venuesPresent.includes("POLYMARKET") && summary.venuesPresent.includes("PREDICT");

  const pairLanes = pairReady ? [{
    canonicalTopicKey: summary.canonicalTopicKey,
    venuePair: "POLYMARKET|PREDICT" as const,
    exactOutcomeLabels: summary.exactOutcomeLabels,
    lowerThreshold: summary.canonicalLowerThreshold,
    higherThreshold: summary.canonicalHigherThreshold,
    routeabilityDecision:
      summary.operatorReviewRequiredReasons.length === 0
        ? "PAIR_EXACT_AUTO_ROUTEABLE" as const
        : "PAIR_REVIEW_REQUIRED" as const,
    rulesDecision: summary.ruleCompatibilityClassification,
    operatorReviewRequiredReasons: summary.operatorReviewRequiredReasons,
    matcherReady: true,
    evidenceSources: EVIDENCE_SOURCE_NAMES(config.artifactKey),
    evidence: topicRows.map((row) => ({
      venue: row.venue,
      venueMarketId: row.venueMarketId,
      rawTitle: row.title
    })),
    notes:
      summary.operatorReviewRequiredReasons.length === 0
        ? [`Exact-safe ${config.asset} first-to-threshold binary market on POLYMARKET|PREDICT.`]
        : [
          `${config.asset} first-to-threshold market is shared on POLYMARKET|PREDICT but remains operator-reviewed.`,
          ...summary.operatorReviewRequiredReasons
        ]
  }] satisfies CryptoFirstToThresholdPairLane[] : [];

  if (pairLanes.length === 0 && rejections.length === 0) {
    rejections.push({
      scope: "pair_lane",
      canonicalTopicKey: summary.canonicalTopicKey,
      venuePair: "POLYMARKET|PREDICT",
      reason: "PAIR_EDGE_MISSING",
      notes: `${config.asset} first-to-threshold pair lane could not be materialized from current repo truth.`
    });
  }

  const finalRuleStatus = pairLanes[0]?.rulesDecision ?? summary.ruleCompatibilityClassification;

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
      exactSafePairCandidateCount: pairLanes.length > 0 ? pairLanes[0]!.exactOutcomeLabels.length : 0,
      ruleStatus: finalRuleStatus,
      operatorCredible: pairLanes.length > 0,
      matcherFollowUpJustified: pairLanes.length > 0,
      singleBestNextAction:
        pairLanes.length > 0
          ? `Run a narrow readiness pass for the shared ${config.asset} first-to-threshold pair market with POLYMARKET|PREDICT explicit.`
          : `Keep ${config.asset} first-to-threshold on the narrow family/supply track until a shared pair core survives matcher construction.`
    }
  };
};
