import {
  buildStableUuid,
  buildStableTextId,
  normalizeCategory,
  normalizeFreeText,
  normalizeMarketClass,
  type CanonicalCategory,
  type CanonicalMarketClass,
  type CanonicalVenue
} from "../canonical/canonicalization-types.js";
import type { SemanticExpansionInventoryRow } from "../operations/semantic-expansion/shared.js";
import type {
  MarketDiscoveryCandidate,
  MarketDiscoveryCandidateType,
  MarketDiscoveryState,
  MarketDiscoverySourceKind,
  NormalizedVenueMarketCandidate,
  VenueMarketDiscoverySnapshot
} from "./market-discovery-types.js";
import { extractMarketSemanticHints } from "./semantic-core-extraction.js";

const DISCOVERY_VERSION = "market-discovery-v1";
const UPSTREAM_PROFILE_PREFIX = "UPSTREAM";

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "be",
  "by",
  "draw",
  "for",
  "game",
  "in",
  "is",
  "market",
  "match",
  "no",
  "on",
  "or",
  "season",
  "the",
  "to",
  "v",
  "vs",
  "will",
  "win",
  "winner",
  "wins",
  "yes"
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeVenue = (venue: string): CanonicalVenue => (
  venue === "PREDICT_FUN" ? "PREDICT" : venue
) as CanonicalVenue;

const titleCase = (value: string): string =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `${token.slice(0, 1).toUpperCase()}${token.slice(1)}`)
    .join(" ");

const extractString = (record: Record<string, unknown>, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
};

const sourceUrlFromPayload = (row: SemanticExpansionInventoryRow): string | null => {
  const payloads = [row.normalizedPayload, row.rawSourcePayload];
  for (const payload of payloads) {
    const value = extractString(payload, ["sourceUrl", "source_url", "url", "slugUrl", "marketUrl", "market_url"]);
    if (value) {
      return value;
    }
  }
  return null;
};

const eventTitleFromPayload = (row: SemanticExpansionInventoryRow): string => {
  const payloads = [row.normalizedPayload, row.rawSourcePayload, row.outcomeSchema];
  for (const payload of payloads) {
    const value = extractString(payload, [
      "eventTitle",
      "event_title",
      "groupTitle",
      "group_title",
      "fixtureTitle",
      "fixture_title",
      "marketGroupTitle",
      "market_group_title",
      "questionTitle"
    ]);
    if (value) {
      return value;
    }
  }
  return row.resolutionTitle?.trim() || row.title;
};

const normalizeOutcomeLabel = (value: string): string =>
  normalizeFreeText(value)
    .replace(/\btie\b/g, "draw")
    .replace(/\s+/g, " ")
    .trim();

const labelFromOutcome = (outcome: unknown): string | null => {
  if (typeof outcome === "string") {
    return outcome.trim() || null;
  }
  if (!isRecord(outcome)) {
    return null;
  }
  return extractString(outcome, ["label", "name", "title", "value", "outcome", "side", "id"]);
};

const outcomeLabels = (outcomes: readonly unknown[]): readonly string[] => {
  const labels = outcomes
    .map(labelFromOutcome)
    .filter((label): label is string => label !== null)
    .map(normalizeOutcomeLabel)
    .filter((label) => label.length > 0);
  return [...new Set(labels)].sort((left, right) => left.localeCompare(right));
};

const normalizeDateBoundary = (raw: string | null | undefined): string | null => {
  if (!raw) {
    return null;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
};

const textDateBoundary = (row: SemanticExpansionInventoryRow): string | null => {
  const text = [
    row.title,
    row.resolutionTitle,
    row.venueMarketId,
    row.description,
    row.rules,
    row.resolutionRulesText
  ].filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).join(" ");
  const match = text.match(/\b(20\d{2})[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/);
  if (!match) {
    return null;
  }
  const boundary = `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(`${boundary}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === boundary ? boundary : null;
};

const dateBoundary = (row: SemanticExpansionInventoryRow): string | null => {
  return normalizeDateBoundary(row.resolvesAt)
    ?? normalizeDateBoundary(row.expiresAt)
    ?? textDateBoundary(row);
};

const isInactive = (row: SemanticExpansionInventoryRow, now: Date): boolean => {
  const boundary = row.resolvesAt ?? row.expiresAt ?? dateBoundary(row);
  if (boundary) {
    const date = new Date(boundary);
    if (!Number.isNaN(date.getTime()) && date.getTime() <= now.getTime()) {
      return true;
    }
  }
  const payloadText = JSON.stringify([row.rawSourcePayload, row.normalizedPayload]).toLowerCase();
  return payloadText.includes("market_closed")
    || payloadText.includes("not_accepting_orders")
    || payloadText.includes("\"closed\"")
    || payloadText.includes("\"resolved\"")
    || payloadText.includes("\"inactive\"");
};

const eventTokens = (normalizedEventTitle: string): readonly string[] =>
  [...new Set(
    normalizedEventTitle
      .split(/\s+/)
      .filter((token) => token.length > 1)
      .filter((token) => !STOPWORDS.has(token))
      .filter((token) => !/^\d{4}$/.test(token))
  )].sort((left, right) => left.localeCompare(right));

const tokenIntersectionCount = (left: readonly string[], right: readonly string[]): number => {
  const rightSet = new Set(right);
  return left.filter((token) => rightSet.has(token)).length;
};

const isStrictContractFamily = (family: string | null): boolean =>
  family === "FDV_AFTER_LAUNCH"
  || family === "IPO_MARKET_CAP_THRESHOLD"
  || family === "FIRST_TO_HIT"
  || family === "SEASON_WINNER"
  || family === "TOKEN_LAUNCH_BY_DATE"
  || family === "FED_DECISION"
  || family === "FED_RATE_CUT_BY_DATE"
  || family === "FED_RATE_HIKE_BY_DATE"
  || family === "FED_RATE_CUT_COUNT"
  || family === "PARTY_CONTROL_BALANCE_OF_POWER"
  || family === "AI_MODEL_RANKING"
  || family === "ELECTION_WINNER"
  || family === "WORLD_CUP_TOP_SCORER"
  || family === "WORLD_CUP_MOST_ASSISTS"
  || family === "WORLD_CUP_MOST_CLEAN_SHEETS"
  || family === "WORLD_CUP_GOAL_CONTRIBUTIONS";

const hasEventTitleAgreement = (rows: readonly NormalizedVenueMarketCandidate[]): boolean => {
  if (rows.length < 2) {
    return false;
  }
  const [first, ...rest] = rows;
  if (!first) {
    return false;
  }
  const firstTokens = eventTokens(first.normalizedEventTitle);
  return rest.every((row) =>
    row.normalizedEventTitle === first.normalizedEventTitle
    || tokenIntersectionCount(firstTokens, eventTokens(row.normalizedEventTitle)) >= 2
  );
};

const inferSemanticHints = (row: Pick<NormalizedVenueMarketCandidate, "title" | "eventTitle" | "rulesText" | "venueMarketId" | "category" | "outcomes">) => {
  const hints = extractMarketSemanticHints(row);
  return {
    marketFamily: hints.marketFamily,
    subject: hints.subject,
    condition: hints.condition,
    topicTitle: hints.topicTitle,
    topicKey: hints.topicKey,
    contractLabel: hints.contractLabel,
    contractKey: hints.contractKey,
    sideLabels: hints.sideLabels,
    semanticReasonCodes: hints.reasonCodes
  };
};

const semanticMismatchWarnings = (rows: readonly NormalizedVenueMarketCandidate[]): readonly string[] => {
  const warnings: string[] = [];
  const families = [...new Set(rows.map((row) => row.marketFamily).filter((entry): entry is string => entry !== null))];
  const subjects = [...new Set(rows.map((row) => row.subject).filter((entry): entry is string => entry !== null))];
  const conditions = [...new Set(rows.map((row) => row.condition).filter((entry): entry is string => entry !== null))];
  if (families.length > 1) warnings.push("MARKET_FAMILY_MISMATCH");
  if (subjects.length > 1) warnings.push("SUBJECT_ENTITY_MISMATCH");
  if (conditions.length > 1) warnings.push("CONDITION_ACTION_MISMATCH");
  return warnings;
};

const canJoinGroup = (
  row: NormalizedVenueMarketCandidate,
  group: WorkingGroup,
  rowTokens: readonly string[]
): boolean => {
  const first = group.rows[0];
  if (!first) return false;
  const sameTopic = row.topicKey === first.topicKey
    || row.normalizedEventTitle === first.normalizedEventTitle
    || tokenIntersectionCount(rowTokens, group.tokens) >= 2;
  if (!sameTopic) {
    return false;
  }
  const groupContractKeys = [...new Set(group.rows.map((entry) => entry.contractKey).filter((entry): entry is string => entry !== null))];
  if (row.contractKey !== null || groupContractKeys.length > 0) {
    const strictContractFamily = isStrictContractFamily(row.marketFamily)
      || group.rows.some((entry) => isStrictContractFamily(entry.marketFamily));
    if (strictContractFamily) {
      const sameContract = row.contractKey !== null
        && groupContractKeys.length <= 1
        && (groupContractKeys.length === 0 || groupContractKeys[0] === row.contractKey);
      if (!sameContract) {
        return false;
      }
      const sameFamily = group.rows.every((entry) =>
        entry.marketFamily === null || row.marketFamily === null || entry.marketFamily === row.marketFamily
      );
      const sameCondition = group.rows.every((entry) =>
        entry.condition === null || row.condition === null || entry.condition === row.condition
      );
      const sameSubject = group.rows.every((entry) =>
        entry.subject === null || row.subject === null || entry.subject === row.subject
      );
      if (!sameFamily || !sameCondition || !sameSubject) {
        return false;
      }
      const hasCompleteSubjectEvidence = row.subject !== null && group.rows.every((entry) => entry.subject !== null);
      return hasCompleteSubjectEvidence || row.topicKey === first.topicKey || row.normalizedEventTitle === first.normalizedEventTitle;
    }
  }
  const rowHasStrongHints = row.marketFamily !== null && row.subject !== null && row.condition !== null;
  const groupHasStrongHints = group.rows.some((entry) =>
    entry.marketFamily !== null && entry.subject !== null && entry.condition !== null
  );
  if (!rowHasStrongHints || !groupHasStrongHints) {
    return row.topicKey === first.topicKey || row.normalizedEventTitle === first.normalizedEventTitle;
  }
  const sameFamily = row.marketFamily === null || group.rows.every((entry) => entry.marketFamily === null || entry.marketFamily === row.marketFamily);
  const sameSubject = row.subject === null || group.rows.every((entry) => entry.subject === null || entry.subject === row.subject);
  const sameCondition = row.condition === null || group.rows.every((entry) => entry.condition === null || entry.condition === row.condition);
  if (!sameFamily || !sameSubject || !sameCondition) {
    return false;
  }
  return semanticMismatchWarnings([...group.rows, row]).length === 0;
};

const chooseEventTitle = (rows: readonly NormalizedVenueMarketCandidate[]): string => {
  const sorted = [...rows].sort((left, right) =>
    left.eventTitle.length - right.eventTitle.length || left.eventTitle.localeCompare(right.eventTitle)
  );
  return sorted[0]?.eventTitle ?? "Discovered market";
};

const contractOutcomes = (row: NormalizedVenueMarketCandidate): readonly string[] => {
  if (row.contractKey) return [row.contractKey];
  return row.outcomes.filter((outcome) => outcome !== "yes" && outcome !== "no" && outcome !== "up" && outcome !== "down");
};

const evidenceOutcomes = (row: NormalizedVenueMarketCandidate, allowSideFallback: boolean): readonly string[] => {
  const contracts = contractOutcomes(row);
  if (contracts.length > 0) return contracts;
  return allowSideFallback ? row.sideLabels : [];
};

const allowsSideFallback = (rows: readonly NormalizedVenueMarketCandidate[]): boolean =>
  rows.every((row) => row.sourceKind === "EXISTING_INVENTORY");

const unionOutcomes = (rows: readonly NormalizedVenueMarketCandidate[]): readonly string[] => {
  const allowSideFallback = allowsSideFallback(rows);
  return [...new Set(rows.flatMap((row) => evidenceOutcomes(row, allowSideFallback)))].sort((left, right) => left.localeCompare(right));
};

const sharedOutcomes = (rows: readonly NormalizedVenueMarketCandidate[]): readonly string[] => {
  const counts = new Map<string, Set<CanonicalVenue>>();
  const allowSideFallback = allowsSideFallback(rows);
  for (const row of rows) {
    for (const outcome of evidenceOutcomes(row, allowSideFallback)) {
      const venues = counts.get(outcome) ?? new Set<CanonicalVenue>();
      venues.add(row.venue);
      counts.set(outcome, venues);
    }
  }
  return [...counts.entries()]
    .filter(([, venues]) => venues.size >= 2)
    .map(([outcome]) => outcome)
    .sort((left, right) => left.localeCompare(right));
};

const rulesCompatible = (rows: readonly NormalizedVenueMarketCandidate[]): boolean => {
  const rules = rows
    .map((row) => row.rulesText ? normalizeFreeText(row.rulesText).slice(0, 120) : "")
    .filter((rule) => rule.length > 0);
  if (rules.length < 2) {
    return false;
  }
  const firstTokens = eventTokens(rules[0]!);
  return rules.slice(1).some((rule) => tokenIntersectionCount(firstTokens, eventTokens(rule)) >= 2);
};

const sourceKindForRows = (rows: readonly NormalizedVenueMarketCandidate[]): MarketDiscoverySourceKind => {
  const sources = new Set(rows.map((row) => row.sourceKind));
  if (sources.size === 1) {
    return sources.has("UPSTREAM_VENUE") ? "UPSTREAM_VENUE" : "EXISTING_INVENTORY";
  }
  return "MIXED";
};

const candidateTypeForRows = (
  rows: readonly NormalizedVenueMarketCandidate[],
  warnings: readonly string[],
  input: { eventTitleMatch: boolean; outcomeMatch: boolean; semanticDimensionsComplete: boolean }
): MarketDiscoveryCandidateType => {
  if (warnings.length > 0 || !input.eventTitleMatch || !input.outcomeMatch || !input.semanticDimensionsComplete) {
    return "LOW_CONFIDENCE";
  }
  const sourceKind = sourceKindForRows(rows);
  const canonicalEvents = new Set(rows.map((row) => row.canonicalEventId).filter((entry): entry is string => entry !== null));
  if (sourceKind === "EXISTING_INVENTORY") {
    return canonicalEvents.size > 1 ? "MERGE_SUGGESTION" : "ENRICHMENT_ONLY";
  }
  if (canonicalEvents.size === 0) {
    return "NEW_DISCOVERY";
  }
  if (canonicalEvents.size > 1) {
    return "MERGE_SUGGESTION";
  }
  return "ENRICHMENT_ONLY";
};

const approvalActionsForType = (candidateType: MarketDiscoveryCandidateType): readonly string[] => {
  switch (candidateType) {
    case "NEW_DISCOVERY":
      return ["CREATE_CANONICAL_MARKET_HIDDEN", "CREATE_CANONICAL_MARKET_LIVE", "ATTACH_TO_EXISTING_CANONICAL_MARKET", "SPLIT_CANDIDATE", "REJECT", "SUPPRESS"];
    case "MERGE_SUGGESTION":
      return ["MERGE_EXISTING_CANONICAL_MARKETS", "REJECT", "SUPPRESS"];
    case "ENRICHMENT_ONLY":
      return ["APPLY_METADATA_ENRICHMENT", "REJECT", "SUPPRESS"];
    case "LOW_CONFIDENCE":
      return ["SPLIT_CANDIDATE", "REJECT", "SUPPRESS"];
  }
};

const buildCandidate = (rows: readonly NormalizedVenueMarketCandidate[]): MarketDiscoveryCandidate | null => {
  const venues = [...new Set(rows.map((row) => row.venue))].sort((left, right) => left.localeCompare(right));
  if (venues.length < 2) {
    return null;
  }
  const boundary = rows[0]?.semanticBoundaryKey ?? null;
  const category = rows[0]?.category ?? "OTHER";
  const marketClass = rows[0]?.marketClass ?? "UNKNOWN";
  const eventTitle = chooseEventTitle(rows);
  const normalizedEventTitle = normalizeFreeText(eventTitle);
  const allOutcomes = unionOutcomes(rows);
  const shared = sharedOutcomes(rows);
  const missingOutcomes = rows.map((row) => ({
    venue: row.venue,
    missing: allOutcomes.filter((outcome) => !row.outcomes.includes(outcome))
  })).filter((entry) => entry.missing.length > 0);
  const quoteReadyVenues = rows.filter((row) => row.quoteReady).length;
  const executionReadyVenues = rows.filter((row) => row.executionReady).length;
  const compatibleRules = rulesCompatible(rows);
  const unsafeGroupingWarnings = semanticMismatchWarnings(rows);
  const eventTitleMatch = hasEventTitleAgreement(rows);
  const knownFamilies = [...new Set(rows.map((row) => row.marketFamily).filter((entry): entry is string => entry !== null))];
  const knownSubjects = [...new Set(rows.map((row) => row.subject).filter((entry): entry is string => entry !== null))];
  const knownConditions = [...new Set(rows.map((row) => row.condition).filter((entry): entry is string => entry !== null))];
  const hasStrongDimensions = knownFamilies.length === 1
    && knownSubjects.length === 1
    && knownConditions.length === 1;
  const outcomeMatch = shared.length >= 1;
  const candidateType = candidateTypeForRows(rows, unsafeGroupingWarnings, {
    eventTitleMatch,
    outcomeMatch,
    semanticDimensionsComplete: hasStrongDimensions
  });
  const sourceKind = sourceKindForRows(rows);
  const reasonCodes = [
    eventTitleMatch ? "EVENT_TITLE_MATCH" : "EVENT_TITLE_REVIEW_REQUIRED",
    boundary ? "DATE_TIME_BOUNDARY_MATCH" : "DATE_TIME_BOUNDARY_UNKNOWN",
    ...(outcomeMatch ? ["CONTRACT_OUTCOME_OVERLAP", "OUTCOME_OVERLAP"] : ["OUTCOME_REVIEW_REQUIRED"]),
    compatibleRules ? "RULES_SOURCE_COMPATIBLE" : "RULES_SOURCE_REVIEW_REQUIRED",
    venues.length >= 3 ? "THREE_PLUS_VENUES" : "TWO_VENUES",
    quoteReadyVenues > 0 ? "QUOTE_READINESS_PRESENT" : "QUOTE_READINESS_UNKNOWN",
    executionReadyVenues > 0 ? "EXECUTION_READINESS_PRESENT" : "EXECUTION_READINESS_UNKNOWN",
    ...[...new Set(rows.flatMap((row) => row.semanticReasonCodes))].sort((left, right) => left.localeCompare(right))
  ];
  const outcomeScore = allOutcomes.length === 0 ? 0 : shared.length / allOutcomes.length;
  const confidenceScore = Number(Math.min(1, (
    0.25
    + (outcomeScore * 0.25)
    + (boundary ? 0.15 : 0)
    + (compatibleRules ? 0.10 : 0)
    + Math.min(venues.length / 4, 1) * 0.15
    + Math.min((quoteReadyVenues + executionReadyVenues) / Math.max(rows.length * 2, 1), 1) * 0.10
  )).toFixed(6));
  const state: MarketDiscoveryState = unsafeGroupingWarnings.length === 0
    && eventTitleMatch
    && boundary !== null
    && outcomeMatch
    && confidenceScore >= 0.7
    && candidateType !== "LOW_CONFIDENCE"
    && hasStrongDimensions
    ? "INGESTED"
    : "DISCOVERED";
  const rawCandidateKey = [
    DISCOVERY_VERSION,
    category,
    marketClass,
    boundary ?? "no-date",
    rows.map((row) => `${row.venue}:${row.venueMarketId}`).sort().join("|")
  ].join(":");
  const candidateKey = buildStableTextId("market-discovery-", rawCandidateKey);
  const firstTopicKey = rows.map((row) => row.topicKey).filter((entry) => entry.length > 0).sort()[0] ?? normalizedEventTitle;
  const reviewGroupRawKey = [
    DISCOVERY_VERSION,
    "review-group",
    category,
    boundary ?? "no-date",
    firstTopicKey,
    rows.map((row) => row.venue).sort().join("|")
  ].join(":");
  const reviewGroupKey = buildStableTextId("market-discovery-review-", reviewGroupRawKey);

  return {
    id: buildStableUuid(`market-discovery:${candidateKey}`),
    candidateKey,
    reviewGroupKey,
    reviewGroupTitle: eventTitle,
    state,
    lifecycleState: "OPEN",
    approvedCanonicalEventId: null,
    candidateType,
    sourceKind,
    eventTitle,
    normalizedEventTitle,
    category,
    marketClass,
    semanticBoundaryKey: boundary,
    venueCount: venues.length,
    sharedOutcomeCount: shared.length,
    confidenceScore,
    reasonCodes,
    noveltySummary: {
      sourceKind,
      candidateType,
      canonicalEventCount: new Set(rows.map((row) => row.canonicalEventId).filter(Boolean)).size,
      upstreamVenueCount: rows.filter((row) => row.sourceKind === "UPSTREAM_VENUE").length,
      inventoryVenueCount: rows.filter((row) => row.sourceKind === "EXISTING_INVENTORY").length
    },
    draftSemanticCore: candidateType === "NEW_DISCOVERY" || candidateType === "LOW_CONFIDENCE"
      ? {
          category,
          proposedEventTitle: eventTitle,
          marketFamily: knownFamilies[0] ?? null,
          subject: knownSubjects[0] ?? null,
          condition: knownConditions[0] ?? null,
          timeBoundary: boundary,
          marketClass,
      normalizedOutcomes: allOutcomes,
          venueMembers: rows.map((row) => ({
            venue: row.venue,
            venueMarketId: row.venueMarketId,
            title: row.title,
            sourceUrl: row.sourceUrl
          })),
          missingFields: [
            knownFamilies.length === 0 ? "marketFamily" : null,
            knownFamilies.length > 1 ? "marketFamilyMismatch" : null,
            knownSubjects.length === 0 ? "subject" : null,
            knownSubjects.length > 1 ? "subjectMismatch" : null,
            knownConditions.length === 0 ? "condition" : null,
            knownConditions.length > 1 ? "conditionMismatch" : null,
            boundary === null ? "timeBoundary" : null,
            allOutcomes.length === 0 ? "outcomes" : null,
            // Outcomes exist on the venues but none overlap across them, and the event
            // titles disagree — typed reasons so neither lands in the "unknown" bucket.
            allOutcomes.length > 0 && !outcomeMatch ? "outcomeOverlap" : null,
            !eventTitleMatch ? "eventTitle" : null
          ].filter((entry): entry is string => entry !== null)
        }
      : null,
    matchDimensions: {
      eventTitle: eventTitleMatch,
      category: true,
      marketFamily: knownFamilies.length === 1,
      subject: knownSubjects.length === 1,
      condition: knownConditions.length === 1,
      timeBoundary: boundary !== null,
      outcomes: outcomeMatch,
      rulesSource: compatibleRules,
      venueCount: venues.length >= 2
    },
    unsafeGroupingWarnings,
    approvalActions: approvalActionsForType(candidateType),
    routingStatus: "NOT_APPROVED",
    nextRoutingAction: "NONE",
    routingReview: { exactPromotionIds: [], nearExactMatchIds: [] },
    archiveEligibility: {
      eligible: false,
      reason: "non_terminal_candidate",
      eligibleAfter: null
    },
    venues,
    sharedOutcomes: shared,
    missingOutcomes,
    venueEvidence: rows.map((row) => ({
      venueMarketProfileId: row.venueMarketProfileId,
      canonicalEventId: row.canonicalEventId,
      canonicalMarketId: row.canonicalMarketId,
      venue: row.venue,
      venueMarketId: row.venueMarketId,
      title: row.title,
      outcomes: row.outcomes,
      quoteReady: row.quoteReady,
      executionReady: row.executionReady,
      evidenceLabel: row.evidenceLabel,
      historicalRowCount: row.historicalRowCount
    })),
    metadata: {
      discoveryVersion: DISCOVERY_VERSION,
      rawCandidateKey,
      source: sourceKind === "UPSTREAM_VENUE" ? "upstream-venue-discovery" : "semantic-expansion-inventory",
      sourceUrls: rows.map((row) => row.sourceUrl).filter((entry): entry is string => entry !== null),
      semanticReasonCodes: [...new Set(rows.flatMap((row) => row.semanticReasonCodes))].sort((left, right) => left.localeCompare(right)),
      semanticEvidence: rows.map((row) => ({
        venue: row.venue,
        venueMarketId: row.venueMarketId,
        topicTitle: row.topicTitle,
        topicKey: row.topicKey,
        contractLabel: row.contractLabel,
        contractKey: row.contractKey,
        sideLabels: row.sideLabels
      }))
    }
  };
};

interface WorkingGroup {
  rows: NormalizedVenueMarketCandidate[];
  tokens: readonly string[];
}

export const normalizeInventoryRowForDiscovery = (
  row: SemanticExpansionInventoryRow,
  now = new Date()
): NormalizedVenueMarketCandidate | null => {
  if (isInactive(row, now)) {
    return null;
  }
  const eventTitle = eventTitleFromPayload(row);
  const normalizedEventTitle = normalizeFreeText(eventTitle);
  if (normalizedEventTitle.length === 0) {
    return null;
  }
  const rawBlockers = JSON.stringify([row.rawSourcePayload, row.normalizedPayload]).toLowerCase();
  const quoteReady = !rawBlockers.includes("quote_provider_http_404")
    && !rawBlockers.includes("token_id_missing")
    && !rawBlockers.includes("quote snapshot cache miss");
  const executionReady = row.currentExecutableMemberCount > 0 || quoteReady;
  const normalized: NormalizedVenueMarketCandidate = {
    venueMarketProfileId: row.venueMarketProfileId,
    canonicalEventId: row.canonicalEventId,
    canonicalMarketId: row.canonicalMarketId,
    sourceKind: "EXISTING_INVENTORY",
    venue: normalizeVenue(row.venue),
    venueMarketId: row.venueMarketId,
    title: row.title,
    eventTitle,
    normalizedEventTitle,
    category: normalizeCategory(row.canonicalCategory),
    marketClass: normalizeMarketClass(row.marketClass),
    semanticBoundaryKey: dateBoundary(row),
    outcomes: outcomeLabels(row.outcomes),
    rulesText: row.rules ?? row.resolutionRulesText,
    sourceUrl: sourceUrlFromPayload(row),
    quoteReady,
    executionReady,
    evidenceLabel: row.evidenceLabel,
    historicalRowCount: row.historicalRowCount,
    marketFamily: null,
    subject: null,
    condition: null,
    topicTitle: eventTitle,
    topicKey: normalizeFreeText(eventTitle).replace(/\s/g, "_").toUpperCase(),
    contractLabel: null,
    contractKey: null,
    sideLabels: [],
    semanticReasonCodes: []
  };
  return { ...normalized, ...inferSemanticHints(normalized) };
};

const snapshotEventTitle = (snapshot: VenueMarketDiscoverySnapshot): string => {
  const raw = snapshot.rawSummary;
  for (const key of ["eventTitle", "event_title", "groupTitle", "group_title", "seriesTitle", "series_title"] as const) {
    const value = raw[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return snapshot.title;
};

export const normalizeSnapshotForDiscovery = (
  snapshot: VenueMarketDiscoverySnapshot,
  existingByVenueMarketId: ReadonlyMap<string, {
    canonicalEventId: string;
    canonicalMarketId: string | null;
    venueMarketProfileId: string;
  }> = new Map()
): NormalizedVenueMarketCandidate | null => {
  if (!snapshot.active || snapshot.normalizedTitle.length === 0) {
    return null;
  }
  const existing = existingByVenueMarketId.get(`${snapshot.venue}:${snapshot.venueMarketId}`);
  const normalized: NormalizedVenueMarketCandidate = {
    venueMarketProfileId: existing?.venueMarketProfileId ?? `${UPSTREAM_PROFILE_PREFIX}:${snapshot.venue}:${snapshot.venueMarketId}`,
    canonicalEventId: existing?.canonicalEventId ?? null,
    canonicalMarketId: existing?.canonicalMarketId ?? null,
    sourceKind: "UPSTREAM_VENUE",
    venue: snapshot.venue,
    venueMarketId: snapshot.venueMarketId,
    title: snapshot.title,
    eventTitle: snapshotEventTitle(snapshot),
    normalizedEventTitle: normalizeFreeText(snapshotEventTitle(snapshot)),
    category: snapshot.category,
    marketClass: snapshot.marketClass,
    semanticBoundaryKey: snapshot.semanticBoundaryKey,
    outcomes: snapshot.outcomes.map(normalizeOutcomeLabel).filter((entry) => entry.length > 0),
    rulesText: snapshot.rulesText,
    sourceUrl: snapshot.sourceUrl,
    quoteReady: snapshot.quoteReady,
    executionReady: snapshot.executionReady,
    evidenceLabel: "upstream_discovery_snapshot",
    historicalRowCount: 0,
    marketFamily: null,
    subject: null,
    condition: null,
    topicTitle: snapshotEventTitle(snapshot),
    topicKey: normalizeFreeText(snapshotEventTitle(snapshot)).replace(/\s/g, "_").toUpperCase(),
    contractLabel: null,
    contractKey: null,
    sideLabels: [],
    semanticReasonCodes: []
  };
  return { ...normalized, ...inferSemanticHints(normalized) };
};

export const buildMarketDiscoveryCandidates = (
  rows: readonly SemanticExpansionInventoryRow[],
  now = new Date()
): {
  activeRows: readonly NormalizedVenueMarketCandidate[];
  candidates: readonly MarketDiscoveryCandidate[];
} => {
  const activeRows = rows
    .map((row) => normalizeInventoryRowForDiscovery(row, now))
    .filter((row): row is NormalizedVenueMarketCandidate => row !== null);
  const buckets = new Map<string, NormalizedVenueMarketCandidate[]>();
  for (const row of activeRows) {
    const key = `${row.category}:${row.semanticBoundaryKey ?? "no-date"}:${row.marketClass}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }

  const candidates: MarketDiscoveryCandidate[] = [];
  for (const bucket of buckets.values()) {
    const groups: WorkingGroup[] = [];
    for (const row of bucket.sort((left, right) => left.normalizedEventTitle.localeCompare(right.normalizedEventTitle))) {
      const tokens = eventTokens(row.normalizedEventTitle);
      const match = groups.find((group) => canJoinGroup(row, group, tokens));
      if (match) {
        match.rows.push(row);
        match.tokens = [...new Set([...match.tokens, ...tokens])].sort((left, right) => left.localeCompare(right));
      } else {
        groups.push({ rows: [row], tokens });
      }
    }
    for (const group of groups) {
      const candidate = buildCandidate(group.rows);
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  return {
    activeRows,
    candidates: candidates.sort((left, right) =>
      right.confidenceScore - left.confidenceScore
      || left.eventTitle.localeCompare(right.eventTitle)
    )
  };
};

export const buildMarketDiscoveryCandidatesFromSnapshots = (
  snapshots: readonly VenueMarketDiscoverySnapshot[],
  inventoryRows: readonly SemanticExpansionInventoryRow[] = []
): {
  activeRows: readonly NormalizedVenueMarketCandidate[];
  candidates: readonly MarketDiscoveryCandidate[];
} => {
  const existingByVenueMarketId = new Map<string, {
    canonicalEventId: string;
    canonicalMarketId: string | null;
    venueMarketProfileId: string;
  }>();
  for (const row of inventoryRows) {
    existingByVenueMarketId.set(`${normalizeVenue(row.venue)}:${row.venueMarketId}`, {
      canonicalEventId: row.canonicalEventId,
      canonicalMarketId: row.canonicalMarketId,
      venueMarketProfileId: row.venueMarketProfileId
    });
  }
  const activeRows = snapshots
    .map((snapshot) => normalizeSnapshotForDiscovery(snapshot, existingByVenueMarketId))
    .filter((row): row is NormalizedVenueMarketCandidate => row !== null);
  const buckets = new Map<string, NormalizedVenueMarketCandidate[]>();
  for (const row of activeRows) {
    const key = `${row.category}:${row.semanticBoundaryKey ?? "no-date"}:${row.marketClass}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }
  const candidates: MarketDiscoveryCandidate[] = [];
  for (const bucket of buckets.values()) {
    const groups: WorkingGroup[] = [];
    for (const row of bucket.sort((left, right) => left.normalizedEventTitle.localeCompare(right.normalizedEventTitle))) {
      const tokens = eventTokens(row.normalizedEventTitle);
      const match = groups.find((group) => canJoinGroup(row, group, tokens));
      if (match) {
        match.rows.push(row);
        match.tokens = [...new Set([...match.tokens, ...tokens])].sort((left, right) => left.localeCompare(right));
      } else {
        groups.push({ rows: [row], tokens });
      }
    }
    for (const group of groups) {
      const candidate = buildCandidate(group.rows);
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }
  return {
    activeRows,
    candidates: candidates.sort((left, right) =>
      right.confidenceScore - left.confidenceScore
      || left.eventTitle.localeCompare(right.eventTitle)
    )
  };
};

export const formatDiscoveryLabel = (value: string): string => titleCase(value.replace(/[_-]+/g, " "));
