import { normalizeFreeText } from "../../canonical/canonicalization-types.js";
import type { CryptoTokenLaunchByDateProjectConfig } from "./crypto-token-launch-by-date-assets.js";

export type CryptoTokenLaunchByDateVenue = "POLYMARKET" | "PREDICT" | "OPINION";
export type CryptoTokenLaunchByDateRuleCompatibilityClass =
  | "EXACT_RULE_COMPATIBLE"
  | "SEMANTICALLY_COMPATIBLE_REWORDING";

export interface CryptoTokenLaunchByDateExtractedRow {
  interpretedContractId: string;
  venue: CryptoTokenLaunchByDateVenue;
  venueMarketId: string;
  sourceUrl: string;
  title: string;
  rulesText: string | null;
  dateKey: string;
}

export interface CryptoTokenLaunchByDateNormalizedTopicRow {
  interpretedContractId: string;
  venue: CryptoTokenLaunchByDateVenue;
  venueMarketId: string;
  title: string;
  canonicalFamily: "TOKEN_LAUNCH_BY_DATE";
  canonicalTopicKey: string | null;
  canonicalProject: CryptoTokenLaunchByDateProjectConfig["project"] | null;
  canonicalDateKey: string | null;
  interpretationNotes: readonly string[];
  rejectionReason: string | null;
}

export interface CryptoTokenLaunchByDateComparabilityTopicSummary {
  canonicalTopicKey: string;
  canonicalDateKey: string;
  venuesPresent: readonly CryptoTokenLaunchByDateVenue[];
  ruleCompatibilityClassification: CryptoTokenLaunchByDateRuleCompatibilityClass;
  fragmentationLabel:
    | "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
    | "FAMILY_REFRESHED_SHARED_LAUNCH_DATES_EXIST";
  matcherCandidate: boolean;
  notes: readonly string[];
}

export interface CryptoTokenLaunchByDateFoundationArtifacts {
  normalizedTopicRows: readonly CryptoTokenLaunchByDateNormalizedTopicRow[];
  fetchSummaryInput: {
    rowsFetchedByVenue: Record<string, number>;
    rowsAdmittedByVenue: Record<string, number>;
  };
  admissionSummary: {
    totalAdmittedDateRows: number;
    rowsRejectedByReason: Record<string, number>;
    rowsAdmittedByTopicCandidate: Record<string, number>;
    venueBreakdown: Record<string, number>;
  };
  comparabilitySummary: readonly CryptoTokenLaunchByDateComparabilityTopicSummary[];
  basisFragmentationSummary: {
    blockerCounts: Record<string, number>;
    topicBlockers: readonly {
      canonicalTopicKey: string | null;
      reasons: readonly string[];
      venuesPresent: readonly CryptoTokenLaunchByDateVenue[];
    }[];
    unresolvedRows: readonly {
      venue: CryptoTokenLaunchByDateVenue;
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

export interface CryptoTokenLaunchByDatePairLane {
  canonicalTopicKey: string;
  venuePair: "POLYMARKET|PREDICT";
  exactLaunchDate: string;
  routeabilityDecision: "PAIR_EXACT_AUTO_ROUTEABLE" | "PAIR_REVIEW_REQUIRED";
  rulesDecision: CryptoTokenLaunchByDateRuleCompatibilityClass;
  matcherReady: boolean;
  evidence: readonly {
    venue: CryptoTokenLaunchByDateVenue;
    venueMarketId: string;
    rawTitle: string;
  }[];
  notes: readonly string[];
}

export interface CryptoTokenLaunchByDateMatcherMaterialization {
  admittedVenues: readonly CryptoTokenLaunchByDateVenue[];
  admittedTopicKeys: readonly string[];
  pairLanes: readonly CryptoTokenLaunchByDatePairLane[];
  rejections: readonly {
    scope: "launch_date" | "pair_lane";
    canonicalTopicKey?: string | null;
    exactLaunchDate?: string | null;
    venuePair?: string;
    reason: "NOT_SHARED" | "PAIR_EDGE_MISSING";
    notes: string;
  }[];
  finalDecision: {
    overallDecision: string;
    bestPair: "POLYMARKET|PREDICT" | null;
    pairMatcherReady: boolean;
    exactSafePairCandidateCount: number;
    ruleStatus: CryptoTokenLaunchByDateRuleCompatibilityClass;
    operatorCredible: boolean;
    matcherFollowUpJustified: boolean;
    singleBestNextAction: string;
  };
}

const TOPIC_VENUES = ["POLYMARKET", "PREDICT", "OPINION"] as const;

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

const buildTopicKey = (config: CryptoTokenLaunchByDateProjectConfig, dateKey: string): string =>
  `${config.familyKey}|${dateKey}`;

const toNormalizedTopicRow = (
  config: CryptoTokenLaunchByDateProjectConfig,
  row: CryptoTokenLaunchByDateExtractedRow
): CryptoTokenLaunchByDateNormalizedTopicRow => {
  const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(row.dateKey) ? row.dateKey : null;
  const excluded = dateKey !== null && config.excludedDates.includes(dateKey);
  const canonicalTopicKey = dateKey && !excluded ? buildTopicKey(config, dateKey) : null;
  return {
    interpretedContractId: row.interpretedContractId,
    venue: row.venue,
    venueMarketId: row.venueMarketId,
    title: row.title,
    canonicalFamily: "TOKEN_LAUNCH_BY_DATE",
    canonicalTopicKey,
    canonicalProject: canonicalTopicKey ? config.project : null,
    canonicalDateKey: canonicalTopicKey ? dateKey : null,
    interpretationNotes: [
      `project=${config.project}`,
      `date_key=${row.dateKey}`,
      row.rulesText ? "rules_present" : "rules_missing"
    ],
    rejectionReason:
      dateKey === null ? `OUT_OF_SCOPE_FOR_${config.project}_TOKEN_LAUNCH_BY_DATE`
      : excluded ? `EXCLUDED_NON_SHARED_${config.project}_TOKEN_LAUNCH_DATE`
      : null
  };
};

const deriveRuleCompatibility = (
  rows: readonly CryptoTokenLaunchByDateNormalizedTopicRow[],
  sourceRowsById: ReadonlyMap<string, CryptoTokenLaunchByDateExtractedRow>
): CryptoTokenLaunchByDateRuleCompatibilityClass => {
  const normalizedRuleTexts = new Set(
    rows
      .map((row) => sourceRowsById.get(row.interpretedContractId)?.rulesText ?? row.title)
      .map((value) => normalizeFreeText(value).replace(/\s+/g, " ").trim())
      .filter((value) => value.length > 0)
  );
  return normalizedRuleTexts.size <= 1 ? "EXACT_RULE_COMPATIBLE" : "SEMANTICALLY_COMPATIBLE_REWORDING";
};

export const buildCryptoTokenLaunchByDateFamilyArtifacts = (
  config: CryptoTokenLaunchByDateProjectConfig,
  rows: readonly CryptoTokenLaunchByDateExtractedRow[]
): CryptoTokenLaunchByDateFoundationArtifacts => {
  const rowsFetchedByVenue: Record<string, number> = {};
  const rowsAdmittedByVenue: Record<string, number> = {};
  const rowsRejectedByReason: Record<string, number> = {};
  const rowsAdmittedByTopicCandidate: Record<string, number> = {};
  const unresolvedRows: CryptoTokenLaunchByDateFoundationArtifacts["basisFragmentationSummary"]["unresolvedRows"][number][] = [];
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

  const topics = new Map<string, CryptoTokenLaunchByDateNormalizedTopicRow[]>();
  for (const row of normalizedTopicRows) {
    if (row.rejectionReason || row.canonicalTopicKey === null) continue;
    const bucket = topics.get(row.canonicalTopicKey) ?? [];
    bucket.push(row);
    topics.set(row.canonicalTopicKey, bucket);
  }

  const comparabilitySummary = [...topics.entries()]
    .map(([canonicalTopicKey, topicRows]) => {
      const first = topicRows[0]!;
      const venuesPresent = [...new Set(topicRows.map((row) => row.venue))].sort() as CryptoTokenLaunchByDateVenue[];
      const matcherCandidate = venuesPresent.includes("POLYMARKET") && venuesPresent.includes("PREDICT");
      return {
        canonicalTopicKey,
        canonicalDateKey: first.canonicalDateKey ?? "unknown",
        venuesPresent,
        ruleCompatibilityClassification: deriveRuleCompatibility(topicRows, sourceRowsById),
        fragmentationLabel: matcherCandidate
          ? "FAMILY_REFRESHED_SHARED_LAUNCH_DATES_EXIST"
          : "FAMILY_REFRESHED_SINGLE_VENUE_ONLY",
        matcherCandidate,
        notes: [`project=${config.project}`, `pair_shared=${matcherCandidate ? "yes" : "no"}`]
      } satisfies CryptoTokenLaunchByDateComparabilityTopicSummary;
    })
    .sort((left, right) => left.canonicalDateKey.localeCompare(right.canonicalDateKey));

  const sharedCandidateTopicKeys = comparabilitySummary
    .filter((topic) => topic.matcherCandidate)
    .map((topic) => topic.canonicalTopicKey);

  return {
    normalizedTopicRows,
    fetchSummaryInput: { rowsFetchedByVenue, rowsAdmittedByVenue },
    admissionSummary: {
      totalAdmittedDateRows: normalizedTopicRows.filter((row) => row.rejectionReason === null).length,
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
        ? `Run a narrow matcher pass for the shared ${config.project} token launch dates only, starting with POLYMARKET|PREDICT and excluding venue-only dates.`
        : `Keep ${config.project} token launch by date on the narrow family/supply track until a shared pair core survives.`
    }
  };
};

export const buildCryptoTokenLaunchByDateMatcherMaterialization = (input: {
  config: CryptoTokenLaunchByDateProjectConfig;
  normalizedTopics: readonly CryptoTokenLaunchByDateNormalizedTopicRow[];
  comparabilitySummary: readonly CryptoTokenLaunchByDateComparabilityTopicSummary[];
}): CryptoTokenLaunchByDateMatcherMaterialization => {
  const topicRows = input.normalizedTopics.filter((row) => row.rejectionReason === null && row.canonicalTopicKey !== null);
  const admittedVenues = [...new Set(topicRows.map((row) => row.venue))].sort() as CryptoTokenLaunchByDateVenue[];
  const admittedTopicKeys = [...new Set(topicRows.map((row) => row.canonicalTopicKey).filter((value): value is string => value !== null))].sort();
  const rowMap = new Map<string, Map<CryptoTokenLaunchByDateVenue, CryptoTokenLaunchByDateNormalizedTopicRow>>();
  for (const row of topicRows) {
    const venueMap = rowMap.get(row.canonicalTopicKey!) ?? new Map<CryptoTokenLaunchByDateVenue, CryptoTokenLaunchByDateNormalizedTopicRow>();
    venueMap.set(row.venue, row);
    rowMap.set(row.canonicalTopicKey!, venueMap);
  }

  const pairLanes: CryptoTokenLaunchByDatePairLane[] = [];
  const rejections: CryptoTokenLaunchByDateMatcherMaterialization["rejections"][number][] = [];
  for (const summary of input.comparabilitySummary) {
    const venueMap = rowMap.get(summary.canonicalTopicKey) ?? new Map<CryptoTokenLaunchByDateVenue, CryptoTokenLaunchByDateNormalizedTopicRow>();
    if (!(venueMap.has("POLYMARKET") && venueMap.has("PREDICT"))) {
      rejections.push({
        scope: "launch_date",
        canonicalTopicKey: summary.canonicalTopicKey,
        exactLaunchDate: summary.canonicalDateKey,
        reason: "NOT_SHARED",
        notes: `${summary.canonicalDateKey} is not shared on POLYMARKET|PREDICT; current venues are ${summary.venuesPresent.join("|") || "none"}.`
      });
      continue;
    }
    pairLanes.push({
      canonicalTopicKey: summary.canonicalTopicKey,
      venuePair: "POLYMARKET|PREDICT",
      exactLaunchDate: summary.canonicalDateKey,
      routeabilityDecision: summary.ruleCompatibilityClassification === "EXACT_RULE_COMPATIBLE"
        ? "PAIR_EXACT_AUTO_ROUTEABLE"
        : "PAIR_REVIEW_REQUIRED",
      rulesDecision: summary.ruleCompatibilityClassification,
      matcherReady: true,
      evidence: [
        { venue: "POLYMARKET", venueMarketId: venueMap.get("POLYMARKET")!.venueMarketId, rawTitle: venueMap.get("POLYMARKET")!.title },
        { venue: "PREDICT", venueMarketId: venueMap.get("PREDICT")!.venueMarketId, rawTitle: venueMap.get("PREDICT")!.title }
      ],
      notes: [`Exact-safe ${input.config.project} token launch date ${summary.canonicalDateKey} on POLYMARKET|PREDICT.`]
    });
  }

  if (pairLanes.length === 0) {
    rejections.push({
      scope: "pair_lane",
      venuePair: "POLYMARKET|PREDICT",
      reason: "PAIR_EDGE_MISSING",
      notes: `POLYMARKET|PREDICT does not currently have a shared ${input.config.project} token launch date core.`
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
        ? `Run a narrow readiness pass for ${input.config.project} token launch by date with POLYMARKET|PREDICT explicit.`
        : `Keep ${input.config.project} token launch by date on the narrow family/supply track.`
    }
  };
};
