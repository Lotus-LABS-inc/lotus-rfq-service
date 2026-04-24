import { normalizeFreeText } from "../../canonical/canonicalization-types.js";
import type { CryptoFdvAfterLaunchProjectConfig } from "./crypto-fdv-after-launch-assets.js";

export type CryptoFdvAfterLaunchVenue = "POLYMARKET" | "PREDICT" | "OPINION";
export type CryptoFdvAfterLaunchRuleCompatibilityClass =
  | "EXACT_RULE_COMPATIBLE"
  | "SEMANTICALLY_COMPATIBLE_REWORDING";

export interface CryptoFdvAfterLaunchExtractedRow {
  interpretedContractId: string;
  venue: CryptoFdvAfterLaunchVenue;
  venueMarketId: string;
  sourceUrl: string;
  title: string;
  rulesText: string | null;
  thresholdLabel: string;
}

export interface CryptoFdvAfterLaunchNormalizedTopicRow {
  interpretedContractId: string;
  venue: CryptoFdvAfterLaunchVenue;
  venueMarketId: string;
  title: string;
  canonicalFamily: "FDV_THRESHOLD_AFTER_LAUNCH";
  canonicalTopicKey: string | null;
  canonicalProject: CryptoFdvAfterLaunchProjectConfig["project"] | null;
  canonicalObservationWindow: "ONE_DAY_AFTER_LAUNCH" | null;
  canonicalComparator: "ABOVE" | null;
  canonicalThresholdValue: string | null;
  canonicalThresholdLabel: string | null;
  interpretationNotes: readonly string[];
  rejectionReason: string | null;
}

export interface CryptoFdvAfterLaunchComparabilityTopicSummary {
  canonicalTopicKey: string;
  canonicalThresholdValue: string;
  canonicalThresholdLabel: string;
  venuesPresent: readonly CryptoFdvAfterLaunchVenue[];
  ruleCompatibilityClassification: CryptoFdvAfterLaunchRuleCompatibilityClass;
  fragmentationLabel:
    | "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
    | "FAMILY_REFRESHED_SHARED_FDV_THRESHOLDS_EXIST";
  matcherCandidate: boolean;
  notes: readonly string[];
}

export interface CryptoFdvAfterLaunchFoundationArtifacts {
  normalizedTopicRows: readonly CryptoFdvAfterLaunchNormalizedTopicRow[];
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
  comparabilitySummary: readonly CryptoFdvAfterLaunchComparabilityTopicSummary[];
  basisFragmentationSummary: {
    blockerCounts: Record<string, number>;
    topicBlockers: readonly {
      canonicalTopicKey: string | null;
      reasons: readonly string[];
      venuesPresent: readonly CryptoFdvAfterLaunchVenue[];
    }[];
    unresolvedRows: readonly {
      venue: CryptoFdvAfterLaunchVenue;
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

export interface CryptoFdvAfterLaunchPairLane {
  canonicalTopicKey: string;
  venuePair: "POLYMARKET|PREDICT";
  exactFdvThresholdLabel: string;
  exactFdvThresholdValue: string;
  routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE" | "PAIR_REVIEW_REQUIRED";
  rulesDecision: CryptoFdvAfterLaunchRuleCompatibilityClass;
  matcherReady: boolean;
  evidence: readonly {
    venue: CryptoFdvAfterLaunchVenue;
    venueMarketId: string;
    rawTitle: string;
  }[];
  notes: readonly string[];
}

export interface CryptoFdvAfterLaunchMatcherMaterialization {
  admittedVenues: readonly CryptoFdvAfterLaunchVenue[];
  admittedTopicKeys: readonly string[];
  pairLanes: readonly CryptoFdvAfterLaunchPairLane[];
  rejections: readonly {
    scope: "fdv_threshold" | "pair_lane";
    canonicalTopicKey?: string | null;
    exactFdvThresholdLabel?: string | null;
    venuePair?: string;
    reason: "NOT_SHARED" | "PAIR_EDGE_MISSING";
    notes: string;
  }[];
  finalDecision: {
    overallDecision: string;
    bestPair: "POLYMARKET|PREDICT" | null;
    pairMatcherReady: boolean;
    exactSafePairCandidateCount: number;
    ruleStatus: CryptoFdvAfterLaunchRuleCompatibilityClass;
    operatorCredible: boolean;
    matcherFollowUpJustified: boolean;
    singleBestNextAction: string;
  };
}

const TOPIC_VENUES = ["POLYMARKET", "PREDICT", "OPINION"] as const;

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

export const normalizeFdvThreshold = (value: string): { value: string; label: string } | null => {
  const match = value.match(/\$?\s*(\d+(?:,\d{3})*(?:\.\d+)?)(m|b|million|billion)?\b/i);
  if (!match) return null;
  const base = Number.parseFloat(match[1]!.replace(/,/g, ""));
  const unit = (match[2] ?? "").toLowerCase();
  const multiplier = unit.startsWith("b") ? 1_000_000_000 : unit.startsWith("m") ? 1_000_000 : 1;
  const numeric = base * multiplier;
  if (!Number.isFinite(numeric)) return null;
  const label = numeric >= 1_000_000_000
    ? `$${Number(numeric / 1_000_000_000).toLocaleString("en-US")}B`
    : `$${Number(numeric / 1_000_000).toLocaleString("en-US")}M`;
  return { value: String(numeric), label };
};

const buildTopicKey = (config: CryptoFdvAfterLaunchProjectConfig, thresholdValue: string): string =>
  `${config.familyKey}|ABOVE|${thresholdValue}`;

const toNormalizedTopicRow = (
  config: CryptoFdvAfterLaunchProjectConfig,
  row: CryptoFdvAfterLaunchExtractedRow
): CryptoFdvAfterLaunchNormalizedTopicRow => {
  const threshold = normalizeFdvThreshold(row.thresholdLabel) ?? normalizeFdvThreshold(row.title);
  const canonicalTopicKey = threshold ? buildTopicKey(config, threshold.value) : null;
  return {
    interpretedContractId: row.interpretedContractId,
    venue: row.venue,
    venueMarketId: row.venueMarketId,
    title: row.title,
    canonicalFamily: "FDV_THRESHOLD_AFTER_LAUNCH",
    canonicalTopicKey,
    canonicalProject: canonicalTopicKey ? config.project : null,
    canonicalObservationWindow: canonicalTopicKey ? "ONE_DAY_AFTER_LAUNCH" : null,
    canonicalComparator: canonicalTopicKey ? "ABOVE" : null,
    canonicalThresholdValue: threshold?.value ?? null,
    canonicalThresholdLabel: threshold?.label ?? null,
    interpretationNotes: [
      `project=${config.project}`,
      `threshold_label=${row.thresholdLabel}`,
      row.rulesText ? "rules_present" : "rules_missing"
    ],
    rejectionReason: canonicalTopicKey === null ? `OUT_OF_SCOPE_FOR_${config.project}_FDV_AFTER_LAUNCH` : null
  };
};

const deriveRuleCompatibility = (
  rows: readonly CryptoFdvAfterLaunchNormalizedTopicRow[],
  sourceRowsById: ReadonlyMap<string, CryptoFdvAfterLaunchExtractedRow>
): CryptoFdvAfterLaunchRuleCompatibilityClass => {
  const normalizedRuleTexts = new Set(
    rows
      .map((row) => sourceRowsById.get(row.interpretedContractId)?.rulesText ?? row.title)
      .map((value) => normalizeFreeText(value).replace(/\s+/g, " ").trim())
      .filter((value) => value.length > 0)
  );
  return normalizedRuleTexts.size <= 1 ? "EXACT_RULE_COMPATIBLE" : "SEMANTICALLY_COMPATIBLE_REWORDING";
};

export const buildCryptoFdvAfterLaunchFamilyArtifacts = (
  config: CryptoFdvAfterLaunchProjectConfig,
  rows: readonly CryptoFdvAfterLaunchExtractedRow[]
): CryptoFdvAfterLaunchFoundationArtifacts => {
  const rowsFetchedByVenue: Record<string, number> = {};
  const rowsAdmittedByVenue: Record<string, number> = {};
  const rowsRejectedByReason: Record<string, number> = {};
  const rowsAdmittedByTopicCandidate: Record<string, number> = {};
  const unresolvedRows: CryptoFdvAfterLaunchFoundationArtifacts["basisFragmentationSummary"]["unresolvedRows"][number][] = [];
  const sourceRowsById = new Map(rows.map((row) => [row.interpretedContractId, row] as const));

  for (const row of rows) {
    if (TOPIC_VENUES.includes(row.venue)) increment(rowsFetchedByVenue, row.venue);
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

  const topics = new Map<string, CryptoFdvAfterLaunchNormalizedTopicRow[]>();
  for (const row of normalizedTopicRows) {
    if (row.rejectionReason || row.canonicalTopicKey === null) continue;
    const bucket = topics.get(row.canonicalTopicKey) ?? [];
    bucket.push(row);
    topics.set(row.canonicalTopicKey, bucket);
  }

  const comparabilitySummary = [...topics.entries()]
    .map(([canonicalTopicKey, topicRows]) => {
      const first = topicRows[0]!;
      const venuesPresent = [...new Set(topicRows.map((row) => row.venue))].sort() as CryptoFdvAfterLaunchVenue[];
      const matcherCandidate = venuesPresent.includes("POLYMARKET") && venuesPresent.includes("PREDICT");
      return {
        canonicalTopicKey,
        canonicalThresholdValue: first.canonicalThresholdValue ?? "unknown",
        canonicalThresholdLabel: first.canonicalThresholdLabel ?? "unknown",
        venuesPresent,
        ruleCompatibilityClassification: deriveRuleCompatibility(topicRows, sourceRowsById),
        fragmentationLabel: matcherCandidate
          ? "FAMILY_REFRESHED_SHARED_FDV_THRESHOLDS_EXIST"
          : "FAMILY_REFRESHED_SINGLE_VENUE_ONLY",
        matcherCandidate,
        notes: [`project=${config.project}`, `pair_shared=${matcherCandidate ? "yes" : "no"}`]
      } satisfies CryptoFdvAfterLaunchComparabilityTopicSummary;
    })
    .sort((left, right) => Number(left.canonicalThresholdValue) - Number(right.canonicalThresholdValue));

  const sharedCandidateTopicKeys = comparabilitySummary
    .filter((topic) => topic.matcherCandidate)
    .map((topic) => topic.canonicalTopicKey);

  return {
    normalizedTopicRows,
    fetchSummaryInput: { rowsFetchedByVenue, rowsAdmittedByVenue },
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
          reasons: ["not_shared_on_polymarket_predict"],
          venuesPresent: topic.venuesPresent
        })),
      unresolvedRows
    },
    finalDecision: {
      overallFamilyDecision: sharedCandidateTopicKeys.length > 0
        ? `${config.decisionPrefix}_FAMILY_REFRESHED_MULTI_VENUE_MATCHER_CANDIDATE_FOUND`
        : `${config.decisionPrefix}_FAMILY_REFRESHED_SINGLE_VENUE_ONLY`,
      sharedCandidateTopicKeys,
      familySupplyCredible: sharedCandidateTopicKeys.length > 0,
      operatorCredible: sharedCandidateTopicKeys.length > 0,
      matcherFollowUpJustified: sharedCandidateTopicKeys.length > 0,
      singleBestNextAction: sharedCandidateTopicKeys.length > 0
        ? `Run a narrow matcher pass for the shared ${config.project} FDV thresholds only, starting with POLYMARKET|PREDICT and excluding venue-only tails.`
        : `Keep ${config.project} FDV after launch on the narrow family/supply track until a shared pair core survives.`
    }
  };
};

export const buildCryptoFdvAfterLaunchMatcherMaterialization = (input: {
  config: CryptoFdvAfterLaunchProjectConfig;
  normalizedTopics: readonly CryptoFdvAfterLaunchNormalizedTopicRow[];
  comparabilitySummary: readonly CryptoFdvAfterLaunchComparabilityTopicSummary[];
}): CryptoFdvAfterLaunchMatcherMaterialization => {
  const topicRows = input.normalizedTopics.filter((row) => row.rejectionReason === null && row.canonicalTopicKey !== null);
  const admittedVenues = [...new Set(topicRows.map((row) => row.venue))].sort() as CryptoFdvAfterLaunchVenue[];
  const admittedTopicKeys = [...new Set(topicRows.map((row) => row.canonicalTopicKey).filter((value): value is string => value !== null))].sort();
  const rowMap = new Map<string, Map<CryptoFdvAfterLaunchVenue, CryptoFdvAfterLaunchNormalizedTopicRow>>();
  for (const row of topicRows) {
    const venueMap = rowMap.get(row.canonicalTopicKey!) ?? new Map<CryptoFdvAfterLaunchVenue, CryptoFdvAfterLaunchNormalizedTopicRow>();
    venueMap.set(row.venue, row);
    rowMap.set(row.canonicalTopicKey!, venueMap);
  }

  const pairLanes: CryptoFdvAfterLaunchPairLane[] = [];
  const rejections: CryptoFdvAfterLaunchMatcherMaterialization["rejections"][number][] = [];
  for (const summary of input.comparabilitySummary) {
    const venueMap = rowMap.get(summary.canonicalTopicKey) ?? new Map<CryptoFdvAfterLaunchVenue, CryptoFdvAfterLaunchNormalizedTopicRow>();
    if (!(venueMap.has("POLYMARKET") && venueMap.has("PREDICT"))) {
      rejections.push({
        scope: "fdv_threshold",
        canonicalTopicKey: summary.canonicalTopicKey,
        exactFdvThresholdLabel: summary.canonicalThresholdLabel,
        reason: "NOT_SHARED",
        notes: `${summary.canonicalThresholdLabel} is not shared on POLYMARKET|PREDICT; current venues are ${summary.venuesPresent.join("|") || "none"}.`
      });
      continue;
    }
    pairLanes.push({
      canonicalTopicKey: summary.canonicalTopicKey,
      venuePair: "POLYMARKET|PREDICT",
      exactFdvThresholdLabel: summary.canonicalThresholdLabel,
      exactFdvThresholdValue: summary.canonicalThresholdValue,
      routeabilityDecision: summary.ruleCompatibilityClassification === "EXACT_RULE_COMPATIBLE"
        ? "PAIR_EXACT_AUTO_ROUTEABLE"
        : "PAIR_REVIEW_REQUIRED",
      rulesDecision: summary.ruleCompatibilityClassification,
      matcherReady: true,
      evidence: [
        { venue: "POLYMARKET", venueMarketId: venueMap.get("POLYMARKET")!.venueMarketId, rawTitle: venueMap.get("POLYMARKET")!.title },
        { venue: "PREDICT", venueMarketId: venueMap.get("PREDICT")!.venueMarketId, rawTitle: venueMap.get("PREDICT")!.title }
      ],
      notes: [`Exact-safe ${input.config.project} FDV threshold ${summary.canonicalThresholdLabel} on POLYMARKET|PREDICT.`]
    });
  }

  if (pairLanes.length === 0) {
    rejections.push({
      scope: "pair_lane",
      venuePair: "POLYMARKET|PREDICT",
      reason: "PAIR_EDGE_MISSING",
      notes: `POLYMARKET|PREDICT does not currently have a shared ${input.config.project} FDV threshold core.`
    });
  }

  return {
    admittedVenues,
    admittedTopicKeys,
    pairLanes,
    rejections,
    finalDecision: {
      overallDecision: pairLanes.length > 0 ? `${input.config.decisionPrefix}_PAIR_MATCHER_READY_PENDING_OPERATOR_REVIEW` : `${input.config.decisionPrefix}_MATCHER_NOT_READY`,
      bestPair: pairLanes.length > 0 ? "POLYMARKET|PREDICT" : null,
      pairMatcherReady: pairLanes.length > 0,
      exactSafePairCandidateCount: pairLanes.length,
      ruleStatus: pairLanes[0]?.rulesDecision ?? "SEMANTICALLY_COMPATIBLE_REWORDING",
      operatorCredible: pairLanes.length > 0,
      matcherFollowUpJustified: pairLanes.length > 0,
      singleBestNextAction: pairLanes.length > 0
        ? `Run a narrow readiness pass for ${input.config.project} FDV after launch with POLYMARKET|PREDICT explicit.`
        : `Keep ${input.config.project} FDV after launch on the narrow family/supply track.`
    }
  };
};
