import { normalizeFreeText } from "../../canonical/canonicalization-types.js";
import type { PoliticsExtractedRow } from "./politics-types.js";

export type PoliticsNominee2028FetchStatus =
  | "SUCCESS"
  | "EMPTY"
  | "UNAVAILABLE"
  | "MISCONFIGURED"
  | "UNSUPPORTED_PATH";

export type PoliticsNominee2028SubgroupKey =
  | "NOMINEE|US_PRESIDENT|2028|REPUBLICAN"
  | "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC";

export type PoliticsNominee2028CandidateSetBasis =
  | "FIELD_BASED_FULL_PARTY_NOMINEE"
  | "SINGLE_CANDIDATE_WITHIN_NOMINEE_RACE"
  | "PARTIAL_CANDIDATE_SUBSET"
  | "UNKNOWN_CANDIDATE_SET"
  | "OTHER_INCOMPATIBLE_NOMINEE_BASIS";

export type PoliticsNominee2028ClusterDecision =
  | "EXACT_COMPARABLE"
  | "NARROW_COMPARABLE"
  | "BASIS_FRAGMENTED"
  | "CANDIDATE_SET_MISMATCH"
  | "CYCLE_MISMATCH"
  | "OFFICE_MISMATCH"
  | "JURISDICTION_MISMATCH"
  | "UNKNOWN_CRITICAL_FIELD"
  | "SINGLE_VENUE_ONLY"
  | "NO_SUPPLY";

export type PoliticsNominee2028FinalDecision =
  | "NOMINEE_2028_CLUSTER_NO_SUPPLY"
  | "NOMINEE_2028_CLUSTER_SINGLE_VENUE_ONLY"
  | "NOMINEE_2028_CLUSTER_BASIS_FRAGMENTED"
  | "NOMINEE_2028_CLUSTER_CANDIDATE_SET_MISMATCH"
  | "NOMINEE_2028_CLUSTER_UNKNOWN_FIELDS"
  | "NOMINEE_2028_CLUSTER_NARROW_MATCHER_READY"
  | "NOMINEE_2028_CLUSTER_EXACT_MATCHER_READY";

export interface PoliticsNominee2028CandidateRow {
  interpretedContractId: string;
  venue: "POLYMARKET" | "OPINION" | "LIMITLESS";
  venueMarketId: string;
  title: string;
  extracted: PoliticsExtractedRow;
}

export interface PoliticsNominee2028NormalizedRow {
  interpretedContractId: string;
  venue: PoliticsNominee2028CandidateRow["venue"];
  venueMarketId: string;
  title: string;
  canonicalFamily: "NOMINEE_WINNER";
  canonicalSubject: string | null;
  canonicalJurisdiction: "usa";
  canonicalCycle: "2028";
  canonicalOffice: "president";
  canonicalOfficeLevel: "national";
  canonicalElectionType: "nomination";
  canonicalOutcomeBasis: "winner_of_nomination";
  canonicalTemporalBasis: string;
  interpretationConfidence: PoliticsExtractedRow["extractionConfidence"];
  interpretationNotes: readonly string[];
  rejectionReason: string | null;
  party: "REPUBLICAN" | "DEMOCRATIC";
  candidateSet: readonly string[];
  candidateSetType: PoliticsNominee2028CandidateSetBasis;
  officeScope: "US_PRESIDENT";
  cycleExplicitness: "EXPLICIT" | "DERIVED";
  jurisdictionScope: "US_NATIONAL";
  subgroupKey: PoliticsNominee2028SubgroupKey;
  resolutionBasis: string | null;
}

export interface PoliticsNominee2028ClusterSummary {
  subgroupKey: PoliticsNominee2028SubgroupKey;
  contributingVenues: readonly string[];
  admittedRowCount: number;
  rows: readonly PoliticsNominee2028NormalizedRow[];
  sharedOfficeBasis: boolean;
  sharedCycleBasis: boolean;
  sharedPartyBasis: boolean;
  sharedCandidateSetBasis: boolean;
  sharedResolutionBasis: boolean;
  decision: PoliticsNominee2028ClusterDecision;
  reasons: readonly string[];
}

const IN_SCOPE_VENUES = ["POLYMARKET", "OPINION", "LIMITLESS"] as const;

const normalizeText = (value: string | null | undefined): string | null =>
  value ? normalizeFreeText(value).replace(/\s+/g, " ").trim() : null;

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

const includesAny = (text: string, patterns: readonly RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(text));

const buildCombinedText = (row: PoliticsExtractedRow): string =>
  `${row.title} ${row.rulesText ?? ""}`.toLowerCase();

export const isNominee2028CandidateRow = (row: PoliticsExtractedRow): boolean => {
  if (!IN_SCOPE_VENUES.includes(row.venue as (typeof IN_SCOPE_VENUES)[number])) {
    return false;
  }
  const text = buildCombinedText(row);
  return includesAny(text, [/\bnominee\b/, /\bnomination\b/, /\bprimary\b/, /\bcaucus\b/])
    && includesAny(text, [/\bpresident\b/, /\bpresidential\b/, /\bu\.?s\.?\s+president\b/, /\bwhite house\b/])
    && (/\b2028\b/.test(text) || row.cycleYear === "2028")
    && includesAny(text, [/\brepublican\b/, /\bgop\b/, /\bdemocratic\b/, /\bdemocrat\b/]);
};

const inferParty = (row: PoliticsExtractedRow): "REPUBLICAN" | "DEMOCRATIC" | null => {
  const text = buildCombinedText(row);
  return /\brepublican\b|\bgop\b/.test(text) || row.partyTerms.some((term) => /republican|gop/i.test(term)) ? "REPUBLICAN"
    : /\bdemocratic\b|\bdemocrat\b/.test(text) || row.partyTerms.some((term) => /democrat/i.test(term)) ? "DEMOCRATIC"
    : null;
};

const inferCandidateSetBasis = (row: PoliticsExtractedRow): PoliticsNominee2028CandidateSetBasis => {
  const text = buildCombinedText(row);
  const normalizedCandidates = unique(row.candidateNames.map((name) => normalizeText(name)).filter((name): name is string => Boolean(name)));
  const hasFieldRemainder = row.outcomeLabels.some((label) => /\bother\b|\bfield\b|\bany other\b/i.test(label));
  const candidateSpecificPrompt = /^will\s+[a-z]/i.test(row.title) || /\bwill [a-z][a-z'\-]+\s+[a-z]/i.test(text);

  if (row.outcomeStructureType === "MULTI_CANDIDATE" && hasFieldRemainder) {
    return "FIELD_BASED_FULL_PARTY_NOMINEE";
  }
  if (candidateSpecificPrompt && normalizedCandidates.length >= 1 && (row.outcomeStructureType === "YES_NO" || row.outcomeStructureType === "BINARY_NAMED" || row.outcomeStructureType === "MULTI_CANDIDATE")) {
    return normalizedCandidates.length === 1 ? "SINGLE_CANDIDATE_WITHIN_NOMINEE_RACE" : "PARTIAL_CANDIDATE_SUBSET";
  }
  if (row.outcomeStructureType === "MULTI_CANDIDATE" && normalizedCandidates.length >= 3) {
    return hasFieldRemainder ? "FIELD_BASED_FULL_PARTY_NOMINEE" : "PARTIAL_CANDIDATE_SUBSET";
  }
  if (normalizedCandidates.length === 0) {
    return "UNKNOWN_CANDIDATE_SET";
  }
  return "OTHER_INCOMPATIBLE_NOMINEE_BASIS";
};

const inferResolutionBasis = (row: PoliticsExtractedRow): string | null => {
  const hints = unique(
    row.resolutionBasisHints
      .map((hint) => normalizeText(hint))
      .filter((hint): hint is string => Boolean(hint))
  );
  return hints.length > 0 ? hints.join("|") : null;
};

export const admitNominee2028Row = (row: PoliticsExtractedRow): {
  admitted: boolean;
  reason: string | null;
  subgroupKey: PoliticsNominee2028SubgroupKey | null;
} => {
  const text = buildCombinedText(row);
  if (!isNominee2028CandidateRow(row)) {
    return { admitted: false, reason: "OUT_OF_SCOPE_FOR_2028_PRESIDENTIAL_NOMINEE_CLUSTER", subgroupKey: null };
  }
  const party = inferParty(row);
  if (!party) {
    return { admitted: false, reason: "party unclear", subgroupKey: null };
  }
  if (!(row.office === "president" || /\bpresident|presidential\b/.test(text))) {
    return { admitted: false, reason: "office unclear", subgroupKey: null };
  }
  if (!(/\b2028\b/.test(text) || row.cycleYear === "2028")) {
    return { admitted: false, reason: "cycle unclear", subgroupKey: null };
  }
  if (!(row.jurisdiction === "usa" || /\bu\.?s\.?|united states|white house\b/.test(text))) {
    return { admitted: false, reason: "jurisdiction unclear", subgroupKey: null };
  }
  if (/\bgeneral election\b|\bwin the presidency\b|\bwin the 2028 election\b/.test(text) && !/\bnominee|nomination|primary|caucus\b/.test(text)) {
    return { admitted: false, reason: "election winner not nominee", subgroupKey: null };
  }

  const subgroupKey: PoliticsNominee2028SubgroupKey =
    party === "REPUBLICAN" ? "NOMINEE|US_PRESIDENT|2028|REPUBLICAN" : "NOMINEE|US_PRESIDENT|2028|DEMOCRATIC";
  return { admitted: true, reason: null, subgroupKey };
};

export const normalizeNominee2028Row = (row: PoliticsExtractedRow): PoliticsNominee2028NormalizedRow | null => {
  const admission = admitNominee2028Row(row);
  if (!admission.admitted || !admission.subgroupKey) {
    return null;
  }

  const candidateSet = unique(
    row.candidateNames
      .map((name) => normalizeText(name))
      .filter((name): name is string => Boolean(name))
  );
  const candidateSetType = inferCandidateSetBasis(row);
  const cycleExplicitness: "EXPLICIT" | "DERIVED" = /\b2028\b/.test(buildCombinedText(row)) ? "EXPLICIT" : "DERIVED";
  const rejectionReason =
    candidateSetType === "UNKNOWN_CANDIDATE_SET" ? "candidate set unknown"
    : candidateSetType === "OTHER_INCOMPATIBLE_NOMINEE_BASIS" ? "incompatible nominee basis"
    : null;

  return {
    interpretedContractId: row.interpretedContractId,
    venue: row.venue as PoliticsNominee2028CandidateRow["venue"],
    venueMarketId: row.venueMarketId,
    title: row.title,
    canonicalFamily: "NOMINEE_WINNER",
    canonicalSubject: candidateSet.length === 1 ? candidateSet[0]! : null,
    canonicalJurisdiction: "usa",
    canonicalCycle: "2028",
    canonicalOffice: "president",
    canonicalOfficeLevel: "national",
    canonicalElectionType: "nomination",
    canonicalOutcomeBasis: "winner_of_nomination",
    canonicalTemporalBasis: row.inventoryTemporalBasis,
    interpretationConfidence: row.extractionConfidence,
    interpretationNotes: row.parseFailures,
    rejectionReason,
    party: admission.subgroupKey.endsWith("REPUBLICAN") ? "REPUBLICAN" : "DEMOCRATIC",
    candidateSet,
    candidateSetType,
    officeScope: "US_PRESIDENT",
    cycleExplicitness,
    jurisdictionScope: "US_NATIONAL",
    subgroupKey: admission.subgroupKey,
    resolutionBasis: inferResolutionBasis(row)
  };
};

const compareResolutionBasis = (rows: readonly PoliticsNominee2028NormalizedRow[]): boolean =>
  unique(rows.map((row) => row.resolutionBasis ?? "NONE")).length <= 1;

const compareCandidateBasis = (rows: readonly PoliticsNominee2028NormalizedRow[]): PoliticsNominee2028ClusterDecision | null => {
  const basisTypes = unique(rows.map((row) => row.candidateSetType));
  if (basisTypes.some((basis) => basis === "UNKNOWN_CANDIDATE_SET" || basis === "OTHER_INCOMPATIBLE_NOMINEE_BASIS")) {
    return "UNKNOWN_CRITICAL_FIELD";
  }
  if (basisTypes.length > 1) {
    return "CANDIDATE_SET_MISMATCH";
  }
  if (basisTypes[0] === "FIELD_BASED_FULL_PARTY_NOMINEE") {
    const sets = unique(rows.map((row) => JSON.stringify([...row.candidateSet].sort())));
    return sets.length <= 1 ? "EXACT_COMPARABLE" : "CANDIDATE_SET_MISMATCH";
  }
  if (basisTypes[0] === "SINGLE_CANDIDATE_WITHIN_NOMINEE_RACE") {
    const candidates = unique(rows.map((row) => row.candidateSet[0] ?? "NONE"));
    return candidates.length <= 1 ? "NARROW_COMPARABLE" : "CANDIDATE_SET_MISMATCH";
  }
  if (basisTypes[0] === "PARTIAL_CANDIDATE_SUBSET") {
    return "BASIS_FRAGMENTED";
  }
  return "BASIS_FRAGMENTED";
};

export const buildNominee2028ClusterSummary = (
  subgroupKey: PoliticsNominee2028SubgroupKey,
  rows: readonly PoliticsNominee2028NormalizedRow[]
): PoliticsNominee2028ClusterSummary => {
  const contributingVenues = [...unique(rows.map((row) => row.venue))].sort();
  if (rows.length === 0) {
    return {
      subgroupKey,
      contributingVenues: [],
      admittedRowCount: 0,
      rows: [],
      sharedOfficeBasis: false,
      sharedCycleBasis: false,
      sharedPartyBasis: false,
      sharedCandidateSetBasis: false,
      sharedResolutionBasis: false,
      decision: "NO_SUPPLY",
      reasons: ["no admitted rows"]
    };
  }
  if (contributingVenues.length <= 1) {
    return {
      subgroupKey,
      contributingVenues,
      admittedRowCount: rows.length,
      rows,
      sharedOfficeBasis: true,
      sharedCycleBasis: true,
      sharedPartyBasis: true,
      sharedCandidateSetBasis: false,
      sharedResolutionBasis: compareResolutionBasis(rows),
      decision: "SINGLE_VENUE_ONLY",
      reasons: ["only one venue contributed admitted rows"]
    };
  }

  const sharedOfficeBasis = unique(rows.map((row) => row.canonicalOffice)).length === 1;
  const sharedCycleBasis = unique(rows.map((row) => row.canonicalCycle)).length === 1;
  const sharedPartyBasis = unique(rows.map((row) => row.party)).length === 1;
  const sharedResolutionBasis = compareResolutionBasis(rows);

  let decision: PoliticsNominee2028ClusterDecision;
  const reasons: string[] = [];

  if (!sharedOfficeBasis) {
    decision = "OFFICE_MISMATCH";
    reasons.push("office basis differs");
  } else if (!sharedCycleBasis) {
    decision = "CYCLE_MISMATCH";
    reasons.push("cycle basis differs");
  } else if (!sharedPartyBasis) {
    decision = "BASIS_FRAGMENTED";
    reasons.push("party basis differs");
  } else if (rows.some((row) => row.rejectionReason !== null)) {
    decision = "UNKNOWN_CRITICAL_FIELD";
    reasons.push("one or more rows still have critical-field rejection reasons");
  } else {
    decision = compareCandidateBasis(rows) ?? "BASIS_FRAGMENTED";
    if (decision === "CANDIDATE_SET_MISMATCH") {
      reasons.push("candidate-set basis differs across venues");
    } else if (decision === "NARROW_COMPARABLE") {
      reasons.push("rows align on party/office/cycle but are candidate-specific rather than full-field");
    } else if (decision === "EXACT_COMPARABLE") {
      reasons.push("critical structural fields align across venues");
    } else {
      reasons.push("candidate-set basis remains fragmented");
    }
  }

  if (!sharedResolutionBasis && (decision === "EXACT_COMPARABLE" || decision === "NARROW_COMPARABLE")) {
    decision = "BASIS_FRAGMENTED";
    reasons.push("resolution basis differs");
  }

  return {
    subgroupKey,
    contributingVenues,
    admittedRowCount: rows.length,
    rows,
    sharedOfficeBasis,
    sharedCycleBasis,
    sharedPartyBasis,
    sharedCandidateSetBasis: decision === "EXACT_COMPARABLE" || decision === "NARROW_COMPARABLE",
    sharedResolutionBasis,
    decision,
    reasons
  };
};

export const buildNominee2028FinalDecision = (input: {
  republican: PoliticsNominee2028ClusterSummary;
  democratic: PoliticsNominee2028ClusterSummary;
}): {
  finalLabel: PoliticsNominee2028FinalDecision;
  nomineeMatcherEvalJustified: boolean;
} => {
  const decisions = [input.republican.decision, input.democratic.decision];
  const matcherReady = decisions.some((decision) => decision === "EXACT_COMPARABLE" || decision === "NARROW_COMPARABLE");

  const finalLabel: PoliticsNominee2028FinalDecision =
    decisions.every((decision) => decision === "NO_SUPPLY") ? "NOMINEE_2028_CLUSTER_NO_SUPPLY"
    : decisions.every((decision) => decision === "SINGLE_VENUE_ONLY" || decision === "NO_SUPPLY") ? "NOMINEE_2028_CLUSTER_SINGLE_VENUE_ONLY"
    : decisions.some((decision) => decision === "UNKNOWN_CRITICAL_FIELD") ? "NOMINEE_2028_CLUSTER_UNKNOWN_FIELDS"
    : decisions.some((decision) => decision === "CANDIDATE_SET_MISMATCH") ? "NOMINEE_2028_CLUSTER_CANDIDATE_SET_MISMATCH"
    : decisions.some((decision) => decision === "BASIS_FRAGMENTED") ? "NOMINEE_2028_CLUSTER_BASIS_FRAGMENTED"
    : decisions.some((decision) => decision === "EXACT_COMPARABLE") && decisions.every((decision) => decision === "EXACT_COMPARABLE" || decision === "NO_SUPPLY")
      ? "NOMINEE_2028_CLUSTER_EXACT_MATCHER_READY"
    : matcherReady ? "NOMINEE_2028_CLUSTER_NARROW_MATCHER_READY"
    : "NOMINEE_2028_CLUSTER_BASIS_FRAGMENTED";

  return {
    finalLabel,
    nomineeMatcherEvalJustified: matcherReady
  };
};
