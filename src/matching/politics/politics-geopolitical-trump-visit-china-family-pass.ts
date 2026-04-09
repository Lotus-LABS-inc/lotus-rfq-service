import {
  classifyPoliticsManualFamily,
  classifyPoliticsManualComparability,
  normalizePoliticsManualFamilyRow
} from "./politics-manual-family-pass.js";
import type { PoliticsExtractedRow, PoliticsManualNormalizedRow } from "./politics-types.js";

const TOPIC_PREFIX = "GEOPOLITICAL_EVENT_BY_DATE|USA_CHINA|TRUMP_VISIT_CHINA";

const toIsoDate = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(`${value} UTC`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
};

const startOfUtcDay = (value: Date): number =>
  Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());

const buildTopicKey = (row: PoliticsManualNormalizedRow): string | null => {
  const isoDate = toIsoDate(row.deadlineDate);
  return isoDate ? `${TOPIC_PREFIX}|${isoDate}` : null;
};

const topicLabelFromKey = (topicKey: string): string =>
  topicKey.replace(`${TOPIC_PREFIX}|`, "Trump visit China by ");

export interface PoliticsGeopoliticalTrumpVisitChinaTopicSummary {
  topicKey: string;
  topicLabel: string;
  deadlineDate: string;
  venuesPresent: readonly string[];
  routeabilityCandidate: "TRI" | "PAIR" | "SINGLE_VENUE_ONLY";
  matcherCandidate: boolean;
  comparabilityLabel: "EXACT_COMPARABLE" | "NARROW_COMPARABLE" | "FRAGMENTED";
  sourceRows: readonly {
    venue: string;
    venueMarketId: string;
    title: string;
  }[];
}

export interface PoliticsGeopoliticalTrumpVisitChinaFoundationArtifacts {
  fetchSummaryInput: {
    rowsFetchedByVenue: Record<string, number>;
    rowsAdmittedByVenue: Record<string, number>;
  };
  admissionSummary: {
    totalAdmittedRows: number;
    rowsRejectedByReason: Record<string, number>;
    rowsAdmittedByTopicCandidate: Record<string, number>;
    venueBreakdown: Record<string, number>;
  };
  normalizedTopicRows: readonly {
    topicKey: string;
    topicLabel: string;
    deadlineDate: string;
    venue: string;
    venueMarketId: string;
    title: string;
    eventType: string | null;
    canonicalEventActors: readonly string[];
    rejectionReason: string | null;
  }[];
  comparabilitySummary: readonly PoliticsGeopoliticalTrumpVisitChinaTopicSummary[];
  basisFragmentationSummary: {
    blockerCounts: Record<string, number>;
    topicBlockers: readonly {
      topicKey: string;
      blocker: string;
      venuesPresent: readonly string[];
    }[];
    unresolvedRows: readonly {
      venue: string;
      venueMarketId: string;
      title: string;
      reason: string;
    }[];
  };
  finalDecision: {
    overallFamilyDecision:
      | "GEOPOLITICAL_TRUMP_VISIT_CHINA_FAMILY_REFRESHED_TRI_MATCHER_CANDIDATE_FOUND"
      | "GEOPOLITICAL_TRUMP_VISIT_CHINA_FAMILY_REFRESHED_PAIR_MATCHER_CANDIDATE_FOUND"
      | "GEOPOLITICAL_TRUMP_VISIT_CHINA_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
      | "GEOPOLITICAL_TRUMP_VISIT_CHINA_FAMILY_REFRESHED_NOT_MATCHER_READY";
    bestCandidateTopicKey: string | null;
    matcherFollowUpJustified: boolean;
    singleBestNextAction: string;
  };
}

export const buildPoliticsGeopoliticalTrumpVisitChinaFamilyArtifacts = (
  rows: readonly PoliticsExtractedRow[],
  observedAt: Date = new Date()
): PoliticsGeopoliticalTrumpVisitChinaFoundationArtifacts => {
  const rowsFetchedByVenue: Record<string, number> = {};
  const rowsAdmittedByVenue: Record<string, number> = {};
  const rowsRejectedByReason: Record<string, number> = {};
  const rowsAdmittedByTopicCandidate: Record<string, number> = {};
  const blockerCounts: Record<string, number> = {};
  const topicBlockers: {
    topicKey: string;
    blocker: string;
    venuesPresent: readonly string[];
  }[] = [];
  const unresolvedRows: {
    venue: string;
    venueMarketId: string;
    title: string;
    reason: string;
  }[] = [];
  const normalizedTopicRows: {
    topicKey: string;
    topicLabel: string;
    deadlineDate: string;
    venue: string;
    venueMarketId: string;
    title: string;
    eventType: string | null;
    canonicalEventActors: readonly string[];
    rejectionReason: string | null;
  }[] = [];
  const rowsByTopic = new Map<string, PoliticsManualNormalizedRow[]>();
  const observedDay = startOfUtcDay(observedAt);

  for (const row of rows) {
    rowsFetchedByVenue[row.venue] = (rowsFetchedByVenue[row.venue] ?? 0) + 1;
    const classified = classifyPoliticsManualFamily(row);
    const normalized = normalizePoliticsManualFamilyRow(classified);

    if (!normalized || normalized.canonicalFamily !== "GEOPOLITICAL_EVENT_BY_DATE") {
      rowsRejectedByReason.OUT_OF_SCOPE_TOPIC = (rowsRejectedByReason.OUT_OF_SCOPE_TOPIC ?? 0) + 1;
      unresolvedRows.push({
        venue: row.venue,
        venueMarketId: row.venueMarketId,
        title: row.title,
        reason: "OUT_OF_SCOPE_TOPIC"
      });
      continue;
    }

    const topicKey = buildTopicKey(normalized);
    const isoDate = toIsoDate(normalized.deadlineDate);
    if (!topicKey || !isoDate) {
      rowsRejectedByReason.UNKNOWN_CRITICAL_FIELD = (rowsRejectedByReason.UNKNOWN_CRITICAL_FIELD ?? 0) + 1;
      unresolvedRows.push({
        venue: row.venue,
        venueMarketId: row.venueMarketId,
        title: row.title,
        reason: "UNKNOWN_CRITICAL_FIELD"
      });
      continue;
    }

    const deadlineDay = startOfUtcDay(new Date(`${isoDate}T00:00:00Z`));
    const rejectionReason =
      normalized.rejectionReason
      ?? (deadlineDay < observedDay ? "DEADLINE_ALREADY_PASSED" : null);

    normalizedTopicRows.push({
      topicKey,
      topicLabel: topicLabelFromKey(topicKey),
      deadlineDate: isoDate,
      venue: normalized.venue,
      venueMarketId: normalized.venueMarketId,
      title: normalized.title,
      eventType: normalized.eventType ?? null,
      canonicalEventActors: normalized.canonicalEventActors,
      rejectionReason
    });

    if (rejectionReason) {
      rowsRejectedByReason[rejectionReason] = (rowsRejectedByReason[rejectionReason] ?? 0) + 1;
      unresolvedRows.push({
        venue: normalized.venue,
        venueMarketId: normalized.venueMarketId,
        title: normalized.title,
        reason: rejectionReason
      });
      continue;
    }

    rowsAdmittedByVenue[normalized.venue] = (rowsAdmittedByVenue[normalized.venue] ?? 0) + 1;
    rowsAdmittedByTopicCandidate[topicKey] = (rowsAdmittedByTopicCandidate[topicKey] ?? 0) + 1;
    const existing = rowsByTopic.get(topicKey) ?? [];
    existing.push(normalized);
    rowsByTopic.set(topicKey, existing);
  }

  const comparabilitySummary = [...rowsByTopic.entries()]
    .map(([topicKey, topicRows]) => {
      const venuesPresent = [...new Set(topicRows.map((row) => row.venue))].sort();
      const pairwiseLabels: string[] = [];
      for (let index = 0; index < topicRows.length; index += 1) {
        for (let inner = index + 1; inner < topicRows.length; inner += 1) {
          if (topicRows[index]!.venue === topicRows[inner]!.venue) {
            continue;
          }
          pairwiseLabels.push(classifyPoliticsManualComparability("GEOPOLITICAL_EVENT_BY_DATE", topicRows[index]!, topicRows[inner]!));
        }
      }
      const comparabilityLabel =
        pairwiseLabels.length === 0 ? "FRAGMENTED"
        : pairwiseLabels.every((label) => label === "EXACT_COMPARABLE") ? "EXACT_COMPARABLE"
        : pairwiseLabels.every((label) => label === "EXACT_COMPARABLE" || label === "NARROW_COMPARABLE") ? "NARROW_COMPARABLE"
        : "FRAGMENTED";
      const routeabilityCandidate =
        venuesPresent.length >= 3 ? "TRI"
        : venuesPresent.length >= 2 ? "PAIR"
        : "SINGLE_VENUE_ONLY";

      if (comparabilityLabel === "FRAGMENTED") {
        blockerCounts.FRAGMENTED = (blockerCounts.FRAGMENTED ?? 0) + 1;
        topicBlockers.push({
          topicKey,
          blocker: "FRAGMENTED",
          venuesPresent
        });
      }

      return {
        topicKey,
        topicLabel: topicLabelFromKey(topicKey),
        deadlineDate: topicKey.slice(-10),
        venuesPresent,
        routeabilityCandidate,
        matcherCandidate: routeabilityCandidate !== "SINGLE_VENUE_ONLY" && comparabilityLabel !== "FRAGMENTED",
        comparabilityLabel,
        sourceRows: topicRows.map((row) => ({
          venue: row.venue,
          venueMarketId: row.venueMarketId,
          title: row.title
        }))
      } satisfies PoliticsGeopoliticalTrumpVisitChinaTopicSummary;
    })
    .sort((left, right) => left.deadlineDate.localeCompare(right.deadlineDate));

  const bestTri = comparabilitySummary.find((topic) => topic.matcherCandidate && topic.routeabilityCandidate === "TRI") ?? null;
  const bestPair = comparabilitySummary.find((topic) => topic.matcherCandidate && topic.routeabilityCandidate === "PAIR") ?? null;
  const bestCandidateTopicKey = bestTri?.topicKey ?? bestPair?.topicKey ?? null;

  return {
    fetchSummaryInput: {
      rowsFetchedByVenue,
      rowsAdmittedByVenue
    },
    admissionSummary: {
      totalAdmittedRows: Object.values(rowsAdmittedByVenue).reduce((sum, count) => sum + count, 0),
      rowsRejectedByReason,
      rowsAdmittedByTopicCandidate,
      venueBreakdown: rowsAdmittedByVenue
    },
    normalizedTopicRows,
    comparabilitySummary,
    basisFragmentationSummary: {
      blockerCounts,
      topicBlockers,
      unresolvedRows
    },
    finalDecision: {
      overallFamilyDecision:
        bestTri ? "GEOPOLITICAL_TRUMP_VISIT_CHINA_FAMILY_REFRESHED_TRI_MATCHER_CANDIDATE_FOUND"
        : bestPair ? "GEOPOLITICAL_TRUMP_VISIT_CHINA_FAMILY_REFRESHED_PAIR_MATCHER_CANDIDATE_FOUND"
        : comparabilitySummary.some((topic) => topic.venuesPresent.length === 1) ? "GEOPOLITICAL_TRUMP_VISIT_CHINA_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
        : "GEOPOLITICAL_TRUMP_VISIT_CHINA_FAMILY_REFRESHED_NOT_MATCHER_READY",
      bestCandidateTopicKey,
      matcherFollowUpJustified: bestCandidateTopicKey !== null,
      singleBestNextAction:
        bestTri ? `run matcher pass for ${bestTri.topicKey} across ${bestTri.venuesPresent.join("|")}`
        : bestPair ? `run matcher pass for ${bestPair.topicKey} across ${bestPair.venuesPresent.join("|")}`
        : "continue narrow venue-truth repair for the remaining unresolved Trump-visit-China date buckets"
    }
  };
};
