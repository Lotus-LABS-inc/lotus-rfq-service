import {
  classifyPoliticsManualFamily,
  normalizePoliticsManualFamilyRow
} from "./politics-manual-family-pass.js";
import type { PoliticsExtractedRow, PoliticsManualNormalizedRow } from "./politics-types.js";

const TOPIC_PREFIX = "GEOPOLITICAL_EVENT_BY_DATE|USA_GREENLAND|TRUMP_ACQUIRE_GREENLAND";

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
  topicKey.replace(`${TOPIC_PREFIX}|`, "Trump acquire Greenland by ");

const isPartialGreenlandWording = (title: string): boolean =>
  /\bpart of greenland\b/i.test(title);

export interface PoliticsGeopoliticalTrumpAcquireGreenlandTopicSummary {
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

export interface PoliticsGeopoliticalTrumpAcquireGreenlandFoundationArtifacts {
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
  comparabilitySummary: readonly PoliticsGeopoliticalTrumpAcquireGreenlandTopicSummary[];
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
      | "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_FAMILY_REFRESHED_TRI_MATCHER_CANDIDATE_FOUND"
      | "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_FAMILY_REFRESHED_PAIR_MATCHER_CANDIDATE_FOUND"
      | "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
      | "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_FAMILY_REFRESHED_NOT_MATCHER_READY";
    bestCandidateTopicKey: string | null;
    matcherFollowUpJustified: boolean;
    singleBestNextAction: string;
  };
}

export const buildPoliticsGeopoliticalTrumpAcquireGreenlandFamilyArtifacts = (
  rows: readonly PoliticsExtractedRow[],
  observedAt: Date = new Date()
): PoliticsGeopoliticalTrumpAcquireGreenlandFoundationArtifacts => {
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
      const sourceRows = topicRows.map((row) => ({
        venue: row.venue,
        venueMarketId: row.venueMarketId,
        title: row.title
      }));
      const titles = sourceRows.map((row) => row.title);
      const comparabilityLabel =
        titles.some(isPartialGreenlandWording) && titles.some((title) => !isPartialGreenlandWording(title))
          ? "NARROW_COMPARABLE"
          : "EXACT_COMPARABLE";
      const routeabilityCandidate =
        venuesPresent.length >= 3 ? "TRI"
        : venuesPresent.length >= 2 ? "PAIR"
        : "SINGLE_VENUE_ONLY";

      if (routeabilityCandidate !== "SINGLE_VENUE_ONLY" && comparabilityLabel === "NARROW_COMPARABLE") {
        blockerCounts.SEMANTIC_RULE_VARIANCE = (blockerCounts.SEMANTIC_RULE_VARIANCE ?? 0) + 1;
      }

      return {
        topicKey,
        topicLabel: topicLabelFromKey(topicKey),
        deadlineDate: topicKey.slice(-10),
        venuesPresent,
        routeabilityCandidate,
        matcherCandidate: routeabilityCandidate !== "SINGLE_VENUE_ONLY",
        comparabilityLabel,
        sourceRows
      } satisfies PoliticsGeopoliticalTrumpAcquireGreenlandTopicSummary;
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
        bestTri ? "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_FAMILY_REFRESHED_TRI_MATCHER_CANDIDATE_FOUND"
        : bestPair ? "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_FAMILY_REFRESHED_PAIR_MATCHER_CANDIDATE_FOUND"
        : comparabilitySummary.some((topic) => topic.venuesPresent.length === 1) ? "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
        : "GEOPOLITICAL_TRUMP_ACQUIRE_GREENLAND_FAMILY_REFRESHED_NOT_MATCHER_READY",
      bestCandidateTopicKey,
      matcherFollowUpJustified: bestCandidateTopicKey !== null,
      singleBestNextAction:
        bestTri ? `run matcher pass for ${bestTri.topicKey} across ${bestTri.venuesPresent.join("|")}`
        : bestPair ? `run matcher pass for ${bestPair.topicKey} across ${bestPair.venuesPresent.join("|")}`
        : "continue narrow venue-truth repair for the remaining Greenland acquisition topic lanes"
    }
  };
};
