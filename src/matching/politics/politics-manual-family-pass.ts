import { normalizeFreeText } from "../../canonical/canonicalization-types.js";
import type { PoliticsExtractedRow, PoliticsManualComparabilityLabel, PoliticsManualFamilyClassification, PoliticsManualFamilyDecisionLabel, PoliticsManualNormalizedRow } from "./politics-types.js";

export type PoliticsManualInScopeFamily =
  | "NOMINEE_WINNER"
  | "OFFICE_EXIT_BY_DATE"
  | "OFFICE_WINNER"
  | "GEOPOLITICAL_EVENT_BY_DATE"
  | "GEOPOLITICAL_EVENT";

export interface PoliticsManualClassifiedRow {
  interpretedContractId: string;
  venue: PoliticsManualNormalizedRow["venue"];
  venueMarketId: string;
  title: string;
  family: PoliticsManualFamilyClassification;
  extracted: PoliticsExtractedRow;
  reason: string | null;
}

export interface PoliticsManualComparableCluster {
  family: PoliticsManualInScopeFamily;
  clusterKey: string;
  venues: readonly string[];
  interpretedContractIds: readonly string[];
  comparability: "EXACT_COMPARABLE" | "NARROW_COMPARABLE";
  blocker: PoliticsManualComparabilityLabel | null;
}

export interface PoliticsManualFamilySummary {
  family: PoliticsManualInScopeFamily;
  totalRows: number;
  venues: readonly string[];
  normalizedRows: readonly PoliticsManualNormalizedRow[];
  comparableClusters: readonly PoliticsManualComparableCluster[];
  comparabilityBreakdown: Record<string, number>;
  decision: PoliticsManualFamilyDecisionLabel;
  matcherReady: boolean;
  dominantBlocker: PoliticsManualComparabilityLabel | null;
}

const IN_SCOPE_FAMILIES: readonly PoliticsManualInScopeFamily[] = [
  "NOMINEE_WINNER",
  "OFFICE_EXIT_BY_DATE",
  "OFFICE_WINNER",
  "GEOPOLITICAL_EVENT_BY_DATE",
  "GEOPOLITICAL_EVENT"
];

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

const normalizeText = (value: string | null | undefined): string | null =>
  value ? normalizeFreeText(value).replace(/\s+/g, " ").trim() : null;

const extractPersonSubject = (row: PoliticsExtractedRow): string | null =>
  /\btrump\b/i.test(row.title) ? "donald trump"
  : /\bnewsom\b/i.test(row.title) ? "gavin newsom"
  : /\bbuttigieg\b/i.test(row.title) ? "pete buttigieg"
  : row.candidateNames[0] ?? (
    /\btrump\b/i.test(row.title) ? "donald trump"
    : /\bnewsom\b/i.test(row.title) ? "gavin newsom"
    : /\bbuttigieg\b/i.test(row.title) ? "pete buttigieg"
    : null
  );

const inferOfficeLevel = (office: string | null): string | null =>
  office === "mayor" ? "local"
  : office === "governor" ? "state"
  : office === "president" || office === "prime_minister" ? "national"
  : office?.includes("control") ? "legislative"
  : null;

const inferDeadlineBoundary = (text: string): { deadlineDate: string | null; deadlineBoundaryType: "INCLUSIVE" | "EXCLUSIVE" | null; boundaryPhrase: string | null } => {
  const normalized = text.toLowerCase();
  const boundaryPhrase =
    /\bon or before\b/.test(normalized) ? "on_or_before"
    : /\bbefore\b/.test(normalized) ? "before"
    : /\bby\b/.test(normalized) ? "by"
    : null;

  const deadlineDate =
    normalized.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,\s+20\d{2})?\b/i)?.[0]
    ?? normalized.match(/\b20\d{2}\b/)?.[0]
    ?? null;

  return {
    deadlineDate,
    deadlineBoundaryType:
      boundaryPhrase === "before" ? "EXCLUSIVE"
      : boundaryPhrase === "by" || boundaryPhrase === "on_or_before" ? "INCLUSIVE"
      : null,
    boundaryPhrase
  };
};

const inferEventActors = (row: PoliticsExtractedRow): readonly string[] => {
  const text = `${row.title} ${row.rulesText ?? ""}`.toLowerCase();
  const actors = [
    /\bus\b|\bunited states\b/.test(text) ? "united_states" : null,
    /\bchina\b/.test(text) ? "china" : null,
    /\biran\b/.test(text) ? "iran" : null,
    /\bgreenland\b/.test(text) ? "greenland" : null,
    /\brussia\b/.test(text) ? "russia" : null,
    /\bukraine\b/.test(text) ? "ukraine" : null,
    extractPersonSubject(row)
  ].filter((value): value is string => value !== null);
  return [...unique(actors)].sort((left, right) => left.localeCompare(right));
};

const inferCandidateSetType = (row: PoliticsExtractedRow): NonNullable<PoliticsManualNormalizedRow["candidateSetType"]> | null =>
  row.outcomeStructureType === "BINARY_NAMED" && row.candidateNames.length === 1 ? "SINGLE_CANDIDATE"
  : row.outcomeLabels.some((label) => /\bother|field|any other\b/i.test(label)) ? "FIELD"
  : row.candidateNames.length > 0 ? "CANDIDATE_SET"
  : null;

const inferExitConditionType = (text: string): NonNullable<PoliticsManualNormalizedRow["exitConditionType"]> | null =>
  /\bremove|removed|impeach|ousted\b/i.test(text) ? "REMOVED"
  : /\bresign|resigns|resignation\b/i.test(text) ? "RESIGNS"
  : /\bno longer holds office\b/i.test(text) ? "NO_LONGER_HOLDS_OFFICE"
  : /\bout of office|out as\b/i.test(text) ? "OUT_OF_OFFICE"
  : null;

const inferConditionScope = (text: string): NonNullable<PoliticsManualNormalizedRow["conditionScope"]> | null =>
  /\bremoved|resigns|dies|impeached|ousted\b/i.test(text) && /\bor\b|\bany reason\b/i.test(text) ? "COMPOSITE"
  : /\bremoved|resigns|dies|impeached|ousted\b/i.test(text) ? "NARROW"
  : /\bout of office|no longer holds office\b/i.test(text) ? "COMPOSITE"
  : null;

export const classifyPoliticsManualFamily = (row: PoliticsExtractedRow): PoliticsManualClassifiedRow => {
  const combined = `${row.title} ${row.rulesText ?? ""}`;
  const hasCriticalDate = Boolean(row.dateBoundarySemantics || inferDeadlineBoundary(combined).deadlineDate);

  if (IN_SCOPE_FAMILIES.includes(row.family as PoliticsManualInScopeFamily)) {
    return {
      interpretedContractId: row.interpretedContractId,
      venue: row.venue,
      venueMarketId: row.venueMarketId,
      title: row.title,
      family: row.family as PoliticsManualInScopeFamily,
      extracted: row,
      reason: null
    };
  }

  if (row.family === "PARTY_CONTROL" || row.family === "CONFIRMATION_APPOINTMENT" || row.family === "THRESHOLD_BY_DATE" || row.family === "OUT_OF_SCOPE") {
    return {
      interpretedContractId: row.interpretedContractId,
      venue: row.venue,
      venueMarketId: row.venueMarketId,
      title: row.title,
      family: "OUT_OF_SCOPE",
      extracted: row,
      reason: `excluded family ${row.family}`
    };
  }

  if ((row.eventType === "ceasefire" || row.eventType === "territorial_acquisition") && hasCriticalDate) {
    return { interpretedContractId: row.interpretedContractId, venue: row.venue, venueMarketId: row.venueMarketId, title: row.title, family: "GEOPOLITICAL_EVENT_BY_DATE", extracted: row, reason: "manual event/date override" };
  }
  if (row.eventType === "territorial_acquisition") {
    return { interpretedContractId: row.interpretedContractId, venue: row.venue, venueMarketId: row.venueMarketId, title: row.title, family: "GEOPOLITICAL_EVENT", extracted: row, reason: "manual event override" };
  }

  const normalized = combined.toLowerCase();
  if (/\bnominee|nomination|primary|caucus\b/.test(normalized)) {
    return { interpretedContractId: row.interpretedContractId, venue: row.venue, venueMarketId: row.venueMarketId, title: row.title, family: row.office && row.cycleYear ? "NOMINEE_WINNER" : "INSUFFICIENT_EVIDENCE", extracted: row, reason: row.office && row.cycleYear ? "manual nomination classification" : "missing office/cycle" };
  }
  if (/\bout as|out of office|removed|resigns\b/.test(normalized)) {
    return { interpretedContractId: row.interpretedContractId, venue: row.venue, venueMarketId: row.venueMarketId, title: row.title, family: hasCriticalDate ? "OFFICE_EXIT_BY_DATE" : "INSUFFICIENT_EVIDENCE", extracted: row, reason: hasCriticalDate ? "manual office-exit classification" : "missing deadline" };
  }
  if (/\bceasefire|greenland|acquire|annex\b/.test(normalized) || (/\bvisit\b/.test(normalized) && /\bchina\b/.test(normalized))) {
    return { interpretedContractId: row.interpretedContractId, venue: row.venue, venueMarketId: row.venueMarketId, title: row.title, family: hasCriticalDate ? "GEOPOLITICAL_EVENT_BY_DATE" : "GEOPOLITICAL_EVENT", extracted: row, reason: "manual geopolitical classification" };
  }
  if (row.office && row.cycleYear) {
    return { interpretedContractId: row.interpretedContractId, venue: row.venue, venueMarketId: row.venueMarketId, title: row.title, family: "OFFICE_WINNER", extracted: row, reason: "manual office-winner classification" };
  }

  return {
    interpretedContractId: row.interpretedContractId,
    venue: row.venue,
    venueMarketId: row.venueMarketId,
    title: row.title,
    family: row.parseFailures.length > 0 ? "INSUFFICIENT_EVIDENCE" : "UNKNOWN_POLITICS_FAMILY",
    extracted: row,
    reason: row.parseFailures.join("|") || "not in scoped families"
  };
};

export const normalizePoliticsManualFamilyRow = (classified: PoliticsManualClassifiedRow): PoliticsManualNormalizedRow | null => {
  if (!IN_SCOPE_FAMILIES.includes(classified.family as PoliticsManualInScopeFamily)) {
    return null;
  }

  const row = classified.extracted;
  const text = `${row.title} ${row.rulesText ?? ""}`;
  const deadline = inferDeadlineBoundary(text);
  const common: PoliticsManualNormalizedRow = {
    interpretedContractId: row.interpretedContractId,
    canonicalFamily: classified.family as PoliticsManualInScopeFamily,
    venue: row.venue,
    venueMarketId: row.venueMarketId,
    title: row.title,
    canonicalSubject: extractPersonSubject(row),
    canonicalJurisdiction: row.jurisdiction,
    canonicalCycle: row.cycleYear,
    canonicalOffice: row.office,
    canonicalOfficeLevel: inferOfficeLevel(row.office),
    canonicalElectionType: row.contestStage,
    canonicalEventActors: inferEventActors(row),
    canonicalOutcomeBasis: null,
    canonicalTemporalBasis: row.dateBoundarySemantics || deadline.deadlineDate ? "DATE_BOUND" : "OPEN_ENDED",
    interpretationConfidence: row.extractionConfidence,
    interpretationNotes: [...row.parseFailures, ...(classified.reason ? [classified.reason] : [])],
    rejectionReason: null
  };

  if (classified.family === "NOMINEE_WINNER") {
    const party = row.partyTerms[0] ?? null;
    const candidateSetType = inferCandidateSetType(row);
    const rejectionReason = !row.office || !row.jurisdiction || !row.cycleYear || !party ? "missing nominee critical field" : null;
    return {
      ...common,
      canonicalOutcomeBasis: "winner_of_nomination",
      party,
      candidateSet: row.candidateNames,
      candidateSetType,
      rejectionReason
    };
  }

  if (classified.family === "OFFICE_EXIT_BY_DATE") {
    const exitConditionType = inferExitConditionType(text);
    const conditionScope = inferConditionScope(text);
    const rejectionReason = !common.canonicalSubject || !row.office || !row.jurisdiction || !deadline.deadlineDate ? "missing office-exit critical field" : null;
    return {
      ...common,
      canonicalOutcomeBasis: "office_exit",
      exitConditionType,
      deadlineDate: deadline.deadlineDate ?? row.dateBoundarySemantics,
      deadlineBoundaryType: deadline.deadlineBoundaryType,
      conditionScope,
      rejectionReason
    };
  }

  if (classified.family === "OFFICE_WINNER") {
    const rejectionReason = !row.office || !row.jurisdiction || !row.cycleYear ? "missing office-winner critical field" : null;
    return {
      ...common,
      canonicalOutcomeBasis: "office_winner",
      candidateSet: row.candidateNames,
      candidateSetType: inferCandidateSetType(row),
      electionRound: row.contestStage,
      rejectionReason
    };
  }

  if (classified.family === "GEOPOLITICAL_EVENT_BY_DATE") {
    const rejectionReason = common.canonicalEventActors.length < 2 || !row.eventType || !deadline.deadlineDate ? "missing geopolitical-date critical field" : null;
    return {
      ...common,
      canonicalOutcomeBasis: "event_occurs",
      canonicalTemporalBasis: "DATE_BOUND",
      eventType: row.eventType,
      deadlineDate: deadline.deadlineDate ?? row.dateBoundarySemantics,
      deadlineBoundaryType: deadline.deadlineBoundaryType,
      dateBounded: true,
      rejectionReason
    };
  }

  const rejectionReason = common.canonicalEventActors.length < 1 || !row.eventType ? "missing geopolitical-event critical field" : null;
  return {
    ...common,
    canonicalOutcomeBasis: "event_occurs",
    canonicalTemporalBasis: "OPEN_ENDED",
    eventType: row.eventType,
    dateBounded: false,
    rejectionReason
  };
};

const compareCandidateSets = (left: readonly string[] | undefined, right: readonly string[] | undefined): boolean =>
  JSON.stringify([...(left ?? [])].sort()) === JSON.stringify([...(right ?? [])].sort());

export const classifyPoliticsManualComparability = (
  family: PoliticsManualInScopeFamily,
  left: PoliticsManualNormalizedRow,
  right: PoliticsManualNormalizedRow
): PoliticsManualComparabilityLabel => {
  if (left.rejectionReason || right.rejectionReason) {
    return "UNKNOWN_CRITICAL_FIELD";
  }

  if (family === "NOMINEE_WINNER") {
    if (left.canonicalOffice !== right.canonicalOffice) return "OFFICE_MISMATCH";
    if (left.canonicalJurisdiction !== right.canonicalJurisdiction) return "JURISDICTION_MISMATCH";
    if (left.canonicalCycle !== right.canonicalCycle || left.party !== right.party) return "BASIS_FRAGMENTED";
    if (!compareCandidateSets(left.candidateSet, right.candidateSet)) return "CANDIDATE_SET_MISMATCH";
    return left.candidateSetType === right.candidateSetType ? "EXACT_COMPARABLE" : "NARROW_COMPARABLE";
  }

  if (family === "OFFICE_EXIT_BY_DATE") {
    if (left.canonicalOffice !== right.canonicalOffice) return "OFFICE_MISMATCH";
    if (left.canonicalJurisdiction !== right.canonicalJurisdiction) return "JURISDICTION_MISMATCH";
    if (left.canonicalSubject !== right.canonicalSubject) return "BASIS_FRAGMENTED";
    if (left.deadlineDate !== right.deadlineDate || left.deadlineBoundaryType !== right.deadlineBoundaryType) return "DATE_BOUNDARY_MISMATCH";
    if (left.exitConditionType !== right.exitConditionType || left.conditionScope !== right.conditionScope) return "CONDITION_SCOPE_MISMATCH";
    return "EXACT_COMPARABLE";
  }

  if (family === "OFFICE_WINNER") {
    if (left.canonicalOffice !== right.canonicalOffice) return "OFFICE_MISMATCH";
    if (left.canonicalJurisdiction !== right.canonicalJurisdiction) return "JURISDICTION_MISMATCH";
    if (left.canonicalCycle !== right.canonicalCycle) return "BASIS_FRAGMENTED";
    if (!compareCandidateSets(left.candidateSet, right.candidateSet)) return "CANDIDATE_SET_MISMATCH";
    return left.electionRound === right.electionRound ? "EXACT_COMPARABLE" : "NARROW_COMPARABLE";
  }

  if (family === "GEOPOLITICAL_EVENT_BY_DATE") {
    if (JSON.stringify(left.canonicalEventActors) !== JSON.stringify(right.canonicalEventActors)) return "EVENT_ACTOR_MISMATCH";
    if (left.eventType !== right.eventType) return "BASIS_FRAGMENTED";
    if (left.deadlineDate !== right.deadlineDate || left.deadlineBoundaryType !== right.deadlineBoundaryType) return "DATE_BOUNDARY_MISMATCH";
    return "EXACT_COMPARABLE";
  }

  if (JSON.stringify(left.canonicalEventActors) !== JSON.stringify(right.canonicalEventActors)) return "EVENT_ACTOR_MISMATCH";
  if (left.eventType !== right.eventType) return "BASIS_FRAGMENTED";
  return "EXACT_COMPARABLE";
};

export const buildPoliticsManualFamilySummary = (
  family: PoliticsManualInScopeFamily,
  rows: readonly PoliticsManualNormalizedRow[]
): PoliticsManualFamilySummary => {
  const comparabilityBreakdown: Record<string, number> = {};
  const clusters = new Map<string, PoliticsManualComparableCluster>();
  const blockerCounts: Record<string, number> = {};

  for (let index = 0; index < rows.length; index += 1) {
    for (let inner = index + 1; inner < rows.length; inner += 1) {
      const left = rows[index]!;
      const right = rows[inner]!;
      if (left.venue === right.venue) {
        continue;
      }
      const label = classifyPoliticsManualComparability(family, left, right);
      comparabilityBreakdown[label] = (comparabilityBreakdown[label] ?? 0) + 1;
      if (label === "EXACT_COMPARABLE" || label === "NARROW_COMPARABLE") {
        const clusterKey =
          family === "NOMINEE_WINNER" ? [left.canonicalOffice, left.canonicalJurisdiction, left.canonicalCycle, left.party].join("|")
          : family === "OFFICE_EXIT_BY_DATE" ? [left.canonicalSubject, left.canonicalOffice, left.deadlineDate, left.deadlineBoundaryType].join("|")
          : family === "OFFICE_WINNER" ? [left.canonicalOffice, left.canonicalJurisdiction, left.canonicalCycle].join("|")
          : family === "GEOPOLITICAL_EVENT_BY_DATE" ? [left.eventType, left.canonicalEventActors.join("|"), left.deadlineDate, left.deadlineBoundaryType].join("|")
          : [left.eventType, left.canonicalEventActors.join("|")].join("|");
        const current = clusters.get(clusterKey) ?? {
          family,
          clusterKey,
          venues: [],
          interpretedContractIds: [],
          comparability: label,
          blocker: null
        };
        current.venues = unique([...current.venues, left.venue, right.venue]);
        current.interpretedContractIds = unique([...current.interpretedContractIds, left.interpretedContractId, right.interpretedContractId]);
        current.comparability = current.comparability === "EXACT_COMPARABLE" && label === "EXACT_COMPARABLE" ? "EXACT_COMPARABLE" : "NARROW_COMPARABLE";
        clusters.set(clusterKey, current);
      } else {
        blockerCounts[label] = (blockerCounts[label] ?? 0) + 1;
      }
    }
  }

  const clusterList = [...clusters.values()];
  const dominantBlocker = Object.entries(blockerCounts).sort((left, right) => right[1] - left[1])[0]?.[0] as PoliticsManualComparabilityLabel | undefined;
  const venues = [...unique(rows.map((row) => row.venue))].sort();

  const decision: PoliticsManualFamilyDecisionLabel =
    rows.length === 0 ? "FAMILY_REFRESHED_NO_SUPPLY"
    : venues.length <= 1 ? "FAMILY_REFRESHED_SINGLE_VENUE_ONLY"
    : clusterList.some((cluster) => cluster.comparability === "EXACT_COMPARABLE" || cluster.comparability === "NARROW_COMPARABLE")
      ? "FAMILY_NOW_NARROW_MATCHER_READY"
    : dominantBlocker === "DATE_BOUNDARY_MISMATCH" ? "FAMILY_REFRESHED_BOUNDARY_MISMATCH"
    : dominantBlocker === "CANDIDATE_SET_MISMATCH" ? "FAMILY_REFRESHED_CANDIDATE_SET_MISMATCH"
    : dominantBlocker === "OFFICE_MISMATCH" || dominantBlocker === "JURISDICTION_MISMATCH" || dominantBlocker === "CONDITION_SCOPE_MISMATCH" ? "FAMILY_REFRESHED_OFFICE_SCOPE_MISMATCH"
    : dominantBlocker === "EVENT_ACTOR_MISMATCH" ? "FAMILY_REFRESHED_EVENT_SCOPE_MISMATCH"
    : dominantBlocker ? "FAMILY_REFRESHED_BASIS_FRAGMENTED"
    : "FAMILY_STILL_NOT_MATCHER_READY";

  return {
    family,
    totalRows: rows.length,
    venues,
    normalizedRows: rows,
    comparableClusters: clusterList,
    comparabilityBreakdown,
    decision,
    matcherReady: decision === "FAMILY_NOW_NARROW_MATCHER_READY",
    dominantBlocker: dominantBlocker ?? null
  };
};

export const buildPoliticsManualFamilyPassArtifacts = (rows: readonly PoliticsExtractedRow[]) => {
  const classified = rows.map((row) => classifyPoliticsManualFamily(row));
  const normalizationSummary: Record<string, Record<string, number>> = {};
  const normalizedByFamily = new Map<PoliticsManualInScopeFamily, PoliticsManualNormalizedRow[]>();
  const classificationSummary: Record<string, number> = {};
  const admissionSummary: Record<string, number> = {};

  for (const family of IN_SCOPE_FAMILIES) {
    normalizedByFamily.set(family, []);
  }

  for (const entry of classified) {
    classificationSummary[entry.family] = (classificationSummary[entry.family] ?? 0) + 1;
    if (IN_SCOPE_FAMILIES.includes(entry.family as PoliticsManualInScopeFamily)) {
      admissionSummary[entry.family] = (admissionSummary[entry.family] ?? 0) + 1;
      const normalized = normalizePoliticsManualFamilyRow(entry);
      if (normalized) {
        normalizedByFamily.get(entry.family as PoliticsManualInScopeFamily)!.push(normalized);
        normalizationSummary[entry.family] ??= {};
        normalizationSummary[entry.family]!.knownJurisdiction = (normalizationSummary[entry.family]!.knownJurisdiction ?? 0) + (normalized.canonicalJurisdiction ? 1 : 0);
        normalizationSummary[entry.family]!.knownOffice = (normalizationSummary[entry.family]!.knownOffice ?? 0) + (normalized.canonicalOffice ? 1 : 0);
        normalizationSummary[entry.family]!.knownCycle = (normalizationSummary[entry.family]!.knownCycle ?? 0) + (normalized.canonicalCycle ? 1 : 0);
        normalizationSummary[entry.family]!.knownActors = (normalizationSummary[entry.family]!.knownActors ?? 0) + (normalized.canonicalEventActors.length > 0 ? 1 : 0);
      }
    }
  }

  const familySummaries = Object.fromEntries(
    IN_SCOPE_FAMILIES.map((family) => [family, buildPoliticsManualFamilySummary(family, normalizedByFamily.get(family) ?? [])])
  ) as Record<PoliticsManualInScopeFamily, PoliticsManualFamilySummary>;

  return {
    classifiedRows: classified,
    normalizationSummary,
    familySummaries
  };
};
