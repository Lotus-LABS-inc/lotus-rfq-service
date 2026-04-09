import type { MatchingMarketRecord } from "../matching-types.js";
import { isLiveTemporalBasis } from "../../inventory/inventory-basis-classifier.js";
import { extractPoliticsInventoryRow, isPoliticsCandidateMarket } from "./politics-inventory-extractor.js";
import type {
  PoliticsExtractedRow,
  PoliticsNomineeAdmissionLabel,
  PoliticsNomineeEligibilityState,
  PoliticsNomineeFetchStatus,
  PoliticsNomineeFinalDecision,
  PoliticsNomineeFragmentationLabel,
  PoliticsTargetVenue
} from "./politics-types.js";

const POLITICS_NOMINEE_VENUES: readonly PoliticsTargetVenue[] = ["POLYMARKET", "OPINION", "LIMITLESS", "PREDICT"];

const normalizeText = (value: string | null | undefined): string | null =>
  value ? value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ") : null;

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

const looksNomineeLike = (row: PoliticsExtractedRow): boolean => {
  const text = `${row.title} ${row.rulesText ?? ""}`.toLowerCase();
  return row.family === "NOMINEE_WINNER"
    || /\bnominee|nomination|primary|caucus|selected|chosen|pick(?:ed)? to represent\b/.test(text);
};

const inferActiveStatus = (market: MatchingMarketRecord): "OPEN_OR_ACTIVE" | "RESOLVED_OR_EXPIRED" | "UNKNOWN" => {
  const now = new Date();
  if (market.expiresAt && market.expiresAt.getTime() < now.getTime()) {
    return "RESOLVED_OR_EXPIRED";
  }
  const rawStatus = typeof market.rawLineageReferences["status"] === "string" ? String(market.rawLineageReferences["status"]).toLowerCase() : null;
  if (rawStatus && /(open|active|activated|live)/.test(rawStatus)) {
    return "OPEN_OR_ACTIVE";
  }
  if (rawStatus && /(closed|resolved|expired|settled)/.test(rawStatus)) {
    return "RESOLVED_OR_EXPIRED";
  }
  return isLiveTemporalBasis(market.inventoryTemporalBasis) ? "OPEN_OR_ACTIVE" : "UNKNOWN";
};

const inferFetchStatus = (
  venue: PoliticsTargetVenue,
  venueMarkets: readonly MatchingMarketRecord[],
  venueNomineeRows: readonly PoliticsNomineeLiveRow[]
): PoliticsNomineeFetchStatus => {
  if (venue === "POLYMARKET") {
    return venueNomineeRows.length > 0 ? "PARTIAL" : venueMarkets.length > 0 ? "DEGRADED" : "UNAVAILABLE";
  }
  if (venueMarkets.length === 0) {
    return "EMPTY";
  }
  return venueNomineeRows.length > 0 ? "SUCCESS" : "EMPTY";
};

const inferPartyBasis = (row: PoliticsExtractedRow): string | null => {
  const parties = row.partyTerms.filter((term) => !["party"].includes(term));
  if (parties.length > 0) {
    return parties.join("|");
  }
  const text = `${row.title} ${row.rulesText ?? ""}`.toLowerCase();
  if (/\bdemocratic|democrat\b/.test(text)) {
    return "democratic";
  }
  if (/\brepublican|gop\b/.test(text)) {
    return "republican";
  }
  if (/\bcoalition\b/.test(text)) {
    return "coalition";
  }
  if (/\bfield\b/.test(text)) {
    return "field";
  }
  return null;
};

const inferWordingType = (row: PoliticsExtractedRow): "WHO_WILL_BE_NOMINEE" | "WHO_WILL_WIN_PRIMARY" | "WHO_WILL_BE_CHOSEN" | "OTHER_NOMINEE_STYLE" => {
  const text = `${row.title} ${row.rulesText ?? ""}`.toLowerCase();
  return /\bnominee|nomination|become the .* nominee\b/.test(text) ? "WHO_WILL_BE_NOMINEE"
    : /\bwin the .* primary|primary winner|caucus winner\b/.test(text) ? "WHO_WILL_WIN_PRIMARY"
    : /\bchosen|selected|pick(?:ed)?\b/.test(text) ? "WHO_WILL_BE_CHOSEN"
    : "OTHER_NOMINEE_STYLE";
};

const inferCandidateCompleteness = (row: PoliticsExtractedRow): { apparentlyComplete: boolean; hasRemainder: boolean } => {
  const normalizedLabels = row.outcomeLabels.map((label) => normalizeText(label) ?? "");
  const hasRemainder = normalizedLabels.some((label) => /\bother|field|remainder|write in|any other\b/.test(label));
  const apparentlyComplete = row.outcomeStructureType === "MULTI_CANDIDATE" && row.candidateNames.length >= 2;
  return { apparentlyComplete, hasRemainder };
};

export interface PoliticsNomineeLiveRow {
  interpretedContractId: string;
  venue: PoliticsTargetVenue;
  venueMarketId: string;
  sourceMarketSlug: string | null;
  title: string;
  category: MatchingMarketRecord["category"];
  activeStatus: "OPEN_OR_ACTIVE" | "RESOLVED_OR_EXPIRED" | "UNKNOWN";
  closesAt: string | null;
  resolvesAt: string | null;
  rawOutcomes: readonly string[];
  rawMetadataReferenceKeys: readonly string[];
  extractionConfidence: PoliticsExtractedRow["extractionConfidence"];
  fetchStatus: PoliticsNomineeFetchStatus;
  extracted: PoliticsExtractedRow;
}

export interface PoliticsNomineeAdmittedRow {
  interpretedContractId: string;
  venue: PoliticsTargetVenue;
  title: string;
  sourceMarketSlug: string | null;
  admissionLabel: "NOMINEE_ADMITTED";
  normalized: PoliticsNomineeBasisRecord;
}

export interface PoliticsNomineeBasisRecord {
  interpretedContractId: string;
  venue: PoliticsTargetVenue;
  family: "NOMINEE_WINNER";
  jurisdiction: string | null;
  office: string | null;
  chamber: string | null;
  branch: string | null;
  cycleYear: string | null;
  contestStage: string | null;
  nominatingBody: string | null;
  candidateSetFingerprint: string | null;
  explicitCandidateNames: readonly string[];
  candidateSetApparentlyComplete: boolean;
  hasRemainderOutcome: boolean;
  outcomeStructureType: PoliticsExtractedRow["outcomeStructureType"];
  resolutionBasisFingerprint: string | null;
  cutoffSemantics: string | null;
  wordingType: "WHO_WILL_BE_NOMINEE" | "WHO_WILL_WIN_PRIMARY" | "WHO_WILL_BE_CHOSEN" | "OTHER_NOMINEE_STYLE";
  provenanceConfidence: PoliticsExtractedRow["extractionConfidence"];
  missingCriticalFields: readonly string[];
}

export interface PoliticsNomineeFragmentationPair {
  leftInterpretedContractId: string;
  rightInterpretedContractId: string;
  leftVenue: PoliticsTargetVenue;
  rightVenue: PoliticsTargetVenue;
  label: PoliticsNomineeFragmentationLabel;
  reasons: readonly string[];
  comparableClusterKey: string | null;
}

export interface PoliticsNomineeComparableCluster {
  clusterKey: string;
  venues: readonly PoliticsTargetVenue[];
  interpretedContractIds: readonly string[];
  comparability: "EXACT" | "SPLIT";
  jurisdiction: string;
  office: string;
  cycleYear: string;
  nominatingBody: string;
  candidateSetFingerprint: string | null;
}

export interface PoliticsNomineeLivePassArtifacts {
  liveInventorySummary: {
    observedAt: string;
    liveNomineeRowsByVenue: Record<string, number>;
    usableNomineeCandidateRowsByVenue: Record<string, number>;
    freshLiveSupplyImprovedVsCensus: boolean;
  };
  liveInventoryByVenue: Record<string, {
    totalPoliticsLiveRows: number;
    nomineeLikeRows: number;
    usableNomineeRows: number;
  }>;
  liveFetchStatus: Record<string, {
    fetchStatus: PoliticsNomineeFetchStatus;
    rationale: string;
  }>;
  liveRowSamples: readonly {
    venue: string;
    title: string;
    admissionHint: PoliticsNomineeAdmissionLabel;
    extractionConfidence: string;
  }[];
  admissionSummary: {
    observedAt: string;
    labels: Record<string, number>;
    admittedCount: number;
  };
  admissionRejections: Record<string, readonly { venue: string; title: string }[]>;
  admittedRows: readonly PoliticsNomineeAdmittedRow[];
  basisSchemaSummary: {
    observedAt: string;
    criticalFields: readonly string[];
    wordingTypes: Record<string, number>;
  };
  basisNormalizationSummary: {
    observedAt: string;
    knownJurisdictionRows: number;
    knownOfficeRows: number;
    knownCycleRows: number;
    knownCandidateSetRows: number;
    knownPartyBasisRows: number;
  };
  basisSamples: readonly PoliticsNomineeBasisRecord[];
  basisFragmentationSummary: {
    observedAt: string;
    labels: Record<string, number>;
    dominantFragmentation: PoliticsNomineeFragmentationLabel | null;
  };
  fragmentationByVenuePair: Record<string, Record<string, number>>;
  comparableClusters: readonly PoliticsNomineeComparableCluster[];
  eligibilityDecision: {
    observedAt: string;
    state: PoliticsNomineeEligibilityState;
  };
  eligibilityRationale: {
    observedAt: string;
    rationale: string;
    comparableExactClusterCount: number;
    comparableSplitClusterCount: number;
  };
  narrowSplits: readonly {
    splitKey: string;
    rationale: string;
  }[];
  prematchReadinessSummary: {
    observedAt: string;
    finalLabel: PoliticsNomineeFinalDecision;
    candidatePairInputCount: number;
    safeMatcherFollowUpJustified: boolean;
  };
  candidatePairInputs: readonly {
    leftInterpretedContractId: string;
    rightInterpretedContractId: string;
    clusterKey: string;
    readinessClass: "EXACT_SAFE" | "SPLIT_REQUIRED";
  }[];
  exactSafeSubgroupSummary: readonly {
    clusterKey: string;
    readinessClass: "EXACT_SAFE" | "SPLIT_REQUIRED";
    venues: readonly PoliticsTargetVenue[];
  }[];
  deltaVsCensus: {
    observedAt: string;
    priorNomineeRows: number;
    currentNomineeRows: number;
    priorEligibility: string;
    currentEligibility: PoliticsNomineeEligibilityState;
    comparableClustersDelta: number;
  };
  liveImprovementSummary: {
    observedAt: string;
    improved: boolean;
    rationale: string;
  };
  finalDecision: {
    observedAt: string;
    finalLabel: PoliticsNomineeFinalDecision;
    eligibilityState: PoliticsNomineeEligibilityState;
    safeMatcherFollowUpJustified: boolean;
  };
  operatorSummary: string;
}

const admitNomineeRow = (row: PoliticsExtractedRow): PoliticsNomineeAdmissionLabel => {
  const text = `${row.title} ${row.rulesText ?? ""}`.toLowerCase();
  if (!looksNomineeLike(row)) {
    if (row.family === "OFFICE_WINNER") return "OFFICE_WINNER_NOT_NOMINEE";
    if (row.family === "PARTY_CONTROL") return "PARTY_CONTROL_NOT_NOMINEE";
    if (row.family === "CONFIRMATION_APPOINTMENT") return "CONFIRMATION_NOT_NOMINEE";
    if (row.family === "THRESHOLD_BY_DATE" || row.family === "OFFICE_EXIT_BY_DATE" || row.family === "GEOPOLITICAL_EVENT_BY_DATE") return "EVENT_DATE_NOT_NOMINEE";
    return "OUT_OF_SCOPE";
  }
  if (!row.office || !row.cycleYear || !row.jurisdiction) {
    return "MISSING_OFFICE_OR_CYCLE";
  }
  if (row.outcomeStructureType === "YES_NO" && row.candidateNames.length === 0) {
    return "OUTCOME_SET_TOO_AMBIGUOUS";
  }
  if (!/\bnominee|nomination|primary|caucus|selected|chosen\b/.test(text)) {
    return "TITLE_TOO_AMBIGUOUS";
  }
  if (/\bwill win the presidency|win the election|general election\b/.test(text) && !/\bnominee|primary|caucus\b/.test(text)) {
    return "OFFICE_WINNER_NOT_NOMINEE";
  }
  if (/\bprimary\b/.test(text) && !/\bnominee|nomination|selected|chosen\b/.test(text)) {
    return "PRIMARY_WINNER_NOT_NOMINEE";
  }
  return "NOMINEE_ADMITTED";
};

const buildBasisRecord = (row: PoliticsExtractedRow): PoliticsNomineeBasisRecord => {
  const completeness = inferCandidateCompleteness(row);
  const nominatingBody = inferPartyBasis(row);
  const resolutionBasisFingerprint = unique([
    ...row.resolutionBasisHints.map((hint) => normalizeText(hint) ?? "").filter((hint) => hint.length > 0),
    normalizeText(row.rulesText)?.includes("delegate") ? "delegate_rules" : null,
    normalizeText(row.rulesText)?.includes("official party") ? "official_party_call" : null
  ].filter((value): value is string => value !== null)).join("|") || null;
  const missingCriticalFields = [
    row.jurisdiction ? null : "jurisdiction",
    row.office ? null : "office",
    row.cycleYear ? null : "cycleYear",
    nominatingBody ? null : "nominatingBody",
    row.candidateSetFingerprint ? null : "candidateSetFingerprint"
  ].filter((value): value is string => value !== null);

  return {
    interpretedContractId: row.interpretedContractId,
    venue: row.venue,
    family: "NOMINEE_WINNER",
    jurisdiction: row.jurisdiction,
    office: row.office,
    chamber: row.chamber,
    branch: row.branch,
    cycleYear: row.cycleYear,
    contestStage: row.contestStage,
    nominatingBody,
    candidateSetFingerprint: row.candidateSetFingerprint,
    explicitCandidateNames: row.candidateNames,
    candidateSetApparentlyComplete: completeness.apparentlyComplete,
    hasRemainderOutcome: completeness.hasRemainder,
    outcomeStructureType: row.outcomeStructureType,
    resolutionBasisFingerprint,
    cutoffSemantics: row.dateBoundarySemantics,
    wordingType: inferWordingType(row),
    provenanceConfidence: row.extractionConfidence,
    missingCriticalFields
  };
};

const classifyFragmentation = (left: PoliticsNomineeBasisRecord, right: PoliticsNomineeBasisRecord): PoliticsNomineeFragmentationPair => {
  const venuePair = [left.venue, right.venue].sort().join("_");
  const baseKey = [left.jurisdiction, left.office, left.cycleYear, left.nominatingBody].join("|");
  if (left.missingCriticalFields.length > 0 || right.missingCriticalFields.length > 0) {
    return {
      leftInterpretedContractId: left.interpretedContractId,
      rightInterpretedContractId: right.interpretedContractId,
      leftVenue: left.venue,
      rightVenue: right.venue,
      label: "MISSING_CRITICAL_FIELD",
      reasons: ["critical fields missing"],
      comparableClusterKey: null
    };
  }
  if (left.office !== right.office) {
    return { leftInterpretedContractId: left.interpretedContractId, rightInterpretedContractId: right.interpretedContractId, leftVenue: left.venue, rightVenue: right.venue, label: "OFFICE_FRAGMENTED", reasons: ["office differs"], comparableClusterKey: null };
  }
  if (left.jurisdiction !== right.jurisdiction) {
    return { leftInterpretedContractId: left.interpretedContractId, rightInterpretedContractId: right.interpretedContractId, leftVenue: left.venue, rightVenue: right.venue, label: "JURISDICTION_FRAGMENTED", reasons: ["jurisdiction differs"], comparableClusterKey: null };
  }
  if (left.cycleYear !== right.cycleYear) {
    return { leftInterpretedContractId: left.interpretedContractId, rightInterpretedContractId: right.interpretedContractId, leftVenue: left.venue, rightVenue: right.venue, label: "CYCLE_FRAGMENTED", reasons: ["cycle differs"], comparableClusterKey: null };
  }
  if (left.nominatingBody !== right.nominatingBody) {
    return { leftInterpretedContractId: left.interpretedContractId, rightInterpretedContractId: right.interpretedContractId, leftVenue: left.venue, rightVenue: right.venue, label: "PARTY_BASIS_FRAGMENTED", reasons: ["party basis differs"], comparableClusterKey: null };
  }
  if (left.outcomeStructureType !== right.outcomeStructureType) {
    return { leftInterpretedContractId: left.interpretedContractId, rightInterpretedContractId: right.interpretedContractId, leftVenue: left.venue, rightVenue: right.venue, label: "OUTCOME_STRUCTURE_FRAGMENTED", reasons: ["outcome structure differs"], comparableClusterKey: null };
  }
  if ((left.resolutionBasisFingerprint ?? null) !== (right.resolutionBasisFingerprint ?? null)) {
    return { leftInterpretedContractId: left.interpretedContractId, rightInterpretedContractId: right.interpretedContractId, leftVenue: left.venue, rightVenue: right.venue, label: "RESOLUTION_BASIS_FRAGMENTED", reasons: ["resolution basis differs"], comparableClusterKey: null };
  }
  if ((left.candidateSetFingerprint ?? null) !== (right.candidateSetFingerprint ?? null)) {
    return {
      leftInterpretedContractId: left.interpretedContractId,
      rightInterpretedContractId: right.interpretedContractId,
      leftVenue: left.venue,
      rightVenue: right.venue,
      label: "CANDIDATE_SET_FRAGMENTED",
      reasons: ["candidate universe differs"],
      comparableClusterKey: `${baseKey}|${venuePair}`
    };
  }
  if (left.wordingType !== right.wordingType || left.contestStage !== right.contestStage) {
    return {
      leftInterpretedContractId: left.interpretedContractId,
      rightInterpretedContractId: right.interpretedContractId,
      leftVenue: left.venue,
      rightVenue: right.venue,
      label: "COMPARABLE_AFTER_SPLIT",
      reasons: ["comparable after wording or stage split"],
      comparableClusterKey: `${baseKey}|${left.candidateSetFingerprint ?? "binary"}`
    };
  }
  return {
    leftInterpretedContractId: left.interpretedContractId,
    rightInterpretedContractId: right.interpretedContractId,
    leftVenue: left.venue,
    rightVenue: right.venue,
    label: "COMPARABLE_EXACT_CANDIDATE",
    reasons: ["all basis fields align"],
    comparableClusterKey: `${baseKey}|${left.candidateSetFingerprint ?? "binary"}`
  };
};

const buildComparableClusters = (
  admittedRows: readonly PoliticsNomineeAdmittedRow[],
  fragmentationPairs: readonly PoliticsNomineeFragmentationPair[]
): readonly PoliticsNomineeComparableCluster[] => {
  const clusterMap = new Map<string, PoliticsNomineeComparableCluster>();
  for (const pair of fragmentationPairs.filter((entry) => entry.comparableClusterKey && (entry.label === "COMPARABLE_EXACT_CANDIDATE" || entry.label === "COMPARABLE_AFTER_SPLIT"))) {
    const left = admittedRows.find((row) => row.interpretedContractId === pair.leftInterpretedContractId)?.normalized;
    const right = admittedRows.find((row) => row.interpretedContractId === pair.rightInterpretedContractId)?.normalized;
    if (!left || !right || !pair.comparableClusterKey) {
      continue;
    }
    const comparability = pair.label === "COMPARABLE_EXACT_CANDIDATE" ? "EXACT" : "SPLIT";
    const current = clusterMap.get(pair.comparableClusterKey) ?? {
      clusterKey: pair.comparableClusterKey,
      venues: [],
      interpretedContractIds: [],
      comparability,
      jurisdiction: left.jurisdiction!,
      office: left.office!,
      cycleYear: left.cycleYear!,
      nominatingBody: left.nominatingBody!,
      candidateSetFingerprint: left.candidateSetFingerprint
    };
    current.venues = unique([...current.venues, left.venue, right.venue]) as readonly PoliticsTargetVenue[];
    current.interpretedContractIds = unique([...current.interpretedContractIds, left.interpretedContractId, right.interpretedContractId]);
    current.comparability = current.comparability === "EXACT" && comparability === "EXACT" ? "EXACT" : "SPLIT";
    clusterMap.set(pair.comparableClusterKey, current);
  }
  return [...clusterMap.values()].sort((left, right) => left.clusterKey.localeCompare(right.clusterKey));
};

const buildOperatorSummary = (artifacts: PoliticsNomineeLivePassArtifacts): string => [
  "# Politics Nominee Live Pass",
  "",
  `- Final decision: ${artifacts.finalDecision.finalLabel}`,
  `- Eligibility state: ${artifacts.eligibilityDecision.state}`,
  `- Live nominee rows by venue: ${JSON.stringify(artifacts.liveInventorySummary.liveNomineeRowsByVenue)}`,
  `- Admitted nominee rows: ${artifacts.admissionSummary.admittedCount}`,
  `- Dominant fragmentation: ${artifacts.basisFragmentationSummary.dominantFragmentation ?? "none"}`,
  `- Safe matcher follow-up justified: ${artifacts.prematchReadinessSummary.safeMatcherFollowUpJustified ? "yes" : "no"}`
].join("\n");

export const buildPoliticsNomineeLivePassArtifacts = (markets: readonly MatchingMarketRecord[], priorCensus?: {
  priorNomineeRows?: number;
  priorEligibility?: string;
}): PoliticsNomineeLivePassArtifacts => {
  const liveMarkets = markets.filter((market) => isPoliticsCandidateMarket(market) && isLiveTemporalBasis(market.inventoryTemporalBasis));
  const extracted = liveMarkets.map((market) => extractPoliticsInventoryRow(market));
  const nomineeRowsByVenue = new Map<PoliticsTargetVenue, PoliticsNomineeLiveRow[]>();

  const liveRows = liveMarkets
    .map((market, index) => {
      const row = extracted[index]!;
      const venue = row.venue;
      const liveRow: PoliticsNomineeLiveRow = {
        interpretedContractId: row.interpretedContractId,
        venue,
        venueMarketId: row.venueMarketId,
        sourceMarketSlug: row.sourceMarketSlug,
        title: row.title,
        category: row.category,
        activeStatus: inferActiveStatus(market),
        closesAt: row.expiresAt,
        resolvesAt: row.resolvesAt,
        rawOutcomes: row.outcomeLabels,
        rawMetadataReferenceKeys: Object.keys(market.rawLineageReferences),
        extractionConfidence: row.extractionConfidence,
        fetchStatus: "SUCCESS",
        extracted: row
      };
      nomineeRowsByVenue.set(venue, [...(nomineeRowsByVenue.get(venue) ?? []), liveRow]);
      return liveRow;
    })
    .filter((row) => looksNomineeLike(row.extracted));

  const liveInventoryByVenue = Object.fromEntries(
    POLITICS_NOMINEE_VENUES.map((venue) => {
      const venueMarkets = liveMarkets.filter((market) => market.venue === venue);
      const venueRows = liveRows.filter((row) => row.venue === venue);
      const fetchStatus = inferFetchStatus(venue, venueMarkets, venueRows);
      for (const row of venueRows) {
        row.fetchStatus = fetchStatus;
      }
      return [venue, {
        totalPoliticsLiveRows: venueMarkets.length,
        nomineeLikeRows: venueRows.length,
        usableNomineeRows: venueRows.filter((row) => row.activeStatus !== "RESOLVED_OR_EXPIRED").length
      }];
    })
  );

  const liveFetchStatus = Object.fromEntries(
    POLITICS_NOMINEE_VENUES.map((venue) => {
      const fetchStatus = inferFetchStatus(
        venue,
        liveMarkets.filter((market) => market.venue === venue),
        liveRows.filter((row) => row.venue === venue)
      );
      return [venue, {
        fetchStatus,
        rationale:
          fetchStatus === "PARTIAL" ? "Venue is evaluated from current local inventory only." :
          fetchStatus === "SUCCESS" ? "Venue has live/current nominee-like politics rows." :
          fetchStatus === "EMPTY" ? "Venue returned no live nominee-like rows in current inventory." :
          fetchStatus === "DEGRADED" ? "Venue has politics inventory but no fresh nominee rows in the live lane." :
          "Venue has no safe current nominee inventory available."
      }];
    })
  );

  const admissionTallies: Record<string, number> = {};
  const admissionRejections: Record<string, { venue: string; title: string }[]> = {};
  const admittedRows: PoliticsNomineeAdmittedRow[] = [];
  for (const row of liveRows) {
    const label = admitNomineeRow(row.extracted);
    admissionTallies[label] = (admissionTallies[label] ?? 0) + 1;
    if (label !== "NOMINEE_ADMITTED") {
      (admissionRejections[label] ??= []).push({ venue: row.venue, title: row.title });
      continue;
    }
    admittedRows.push({
      interpretedContractId: row.interpretedContractId,
      venue: row.venue,
      title: row.title,
      sourceMarketSlug: row.sourceMarketSlug,
      admissionLabel: "NOMINEE_ADMITTED",
      normalized: buildBasisRecord(row.extracted)
    });
  }

  const fragmentationPairs: PoliticsNomineeFragmentationPair[] = [];
  const fragmentationByVenuePair: Record<string, Record<string, number>> = {};
  for (let index = 0; index < admittedRows.length; index += 1) {
    for (let inner = index + 1; inner < admittedRows.length; inner += 1) {
      if (admittedRows[index]!.venue === admittedRows[inner]!.venue) continue;
      const pair = classifyFragmentation(admittedRows[index]!.normalized, admittedRows[inner]!.normalized);
      fragmentationPairs.push(pair);
      const key = [pair.leftVenue, pair.rightVenue].sort().join("_");
      fragmentationByVenuePair[key] ??= {};
      fragmentationByVenuePair[key]![pair.label] = (fragmentationByVenuePair[key]![pair.label] ?? 0) + 1;
    }
  }

  const clusters = buildComparableClusters(admittedRows, fragmentationPairs);
  const exactClusters = clusters.filter((cluster) => cluster.comparability === "EXACT" && cluster.venues.length >= 2);
  const splitClusters = clusters.filter((cluster) => cluster.comparability === "SPLIT" && cluster.venues.length >= 2);

  const unknownHeavy = admittedRows.filter((row) => row.normalized.missingCriticalFields.length > 0).length >= Math.max(1, Math.ceil(admittedRows.length / 2));
  const eligibilityState: PoliticsNomineeEligibilityState =
    exactClusters.length > 0 ? "MATCHING_ELIGIBLE"
    : splitClusters.length > 0 ? "ELIGIBLE_AFTER_SPLIT"
    : admittedRows.length === 0 ? "TOO_THIN"
    : unknownHeavy ? "TOO_UNKNOWN"
    : "BASIS_FRAGMENTED";

  const candidatePairInputs = fragmentationPairs
    .filter((pair) => pair.comparableClusterKey && (pair.label === "COMPARABLE_EXACT_CANDIDATE" || pair.label === "COMPARABLE_AFTER_SPLIT"))
    .map((pair) => ({
      leftInterpretedContractId: pair.leftInterpretedContractId,
      rightInterpretedContractId: pair.rightInterpretedContractId,
      clusterKey: pair.comparableClusterKey!,
      readinessClass: pair.label === "COMPARABLE_EXACT_CANDIDATE" ? "EXACT_SAFE" as const : "SPLIT_REQUIRED" as const
    }));

  const finalLabel: PoliticsNomineeFinalDecision =
    eligibilityState === "MATCHING_ELIGIBLE" ? "NOMINEE_MATCHING_ELIGIBLE_READY_FOR_MATCHER"
    : eligibilityState === "ELIGIBLE_AFTER_SPLIT" ? "NOMINEE_ELIGIBLE_AFTER_SPLIT"
    : eligibilityState === "TOO_THIN" ? "NOMINEE_TOO_THIN_AFTER_LIVE_REFRESH"
    : eligibilityState === "TOO_UNKNOWN" ? "NOMINEE_UNKNOWN_FIELDS_STILL_BLOCKING"
    : liveRows.length > 0 ? "NOMINEE_BASIS_FRAGMENTATION_CONFIRMED"
    : "NOMINEE_LIVE_REFRESH_NO_CHANGE";

  const basisLabels = fragmentationPairs.reduce<Record<string, number>>((acc, pair) => {
    acc[pair.label] = (acc[pair.label] ?? 0) + 1;
    return acc;
  }, {});
  const dominantFragmentation = Object.entries(basisLabels).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] as PoliticsNomineeFragmentationLabel | undefined;

  const artifacts: PoliticsNomineeLivePassArtifacts = {
    liveInventorySummary: {
      observedAt: new Date().toISOString(),
      liveNomineeRowsByVenue: Object.fromEntries(POLITICS_NOMINEE_VENUES.map((venue) => [venue, liveRows.filter((row) => row.venue === venue).length])),
      usableNomineeCandidateRowsByVenue: Object.fromEntries(POLITICS_NOMINEE_VENUES.map((venue) => [venue, liveRows.filter((row) => row.venue === venue && row.activeStatus !== "RESOLVED_OR_EXPIRED").length])),
      freshLiveSupplyImprovedVsCensus: liveRows.length > (priorCensus?.priorNomineeRows ?? 0)
    },
    liveInventoryByVenue,
    liveFetchStatus,
    liveRowSamples: liveRows.slice(0, 12).map((row) => ({
      venue: row.venue,
      title: row.title,
      admissionHint: admitNomineeRow(row.extracted),
      extractionConfidence: row.extractionConfidence
    })),
    admissionSummary: {
      observedAt: new Date().toISOString(),
      labels: admissionTallies,
      admittedCount: admittedRows.length
    },
    admissionRejections,
    admittedRows,
    basisSchemaSummary: {
      observedAt: new Date().toISOString(),
      criticalFields: ["jurisdiction", "office", "cycleYear", "nominatingBody", "candidateSetFingerprint"],
      wordingTypes: admittedRows.reduce<Record<string, number>>((acc, row) => {
        acc[row.normalized.wordingType] = (acc[row.normalized.wordingType] ?? 0) + 1;
        return acc;
      }, {})
    },
    basisNormalizationSummary: {
      observedAt: new Date().toISOString(),
      knownJurisdictionRows: admittedRows.filter((row) => row.normalized.jurisdiction).length,
      knownOfficeRows: admittedRows.filter((row) => row.normalized.office).length,
      knownCycleRows: admittedRows.filter((row) => row.normalized.cycleYear).length,
      knownCandidateSetRows: admittedRows.filter((row) => row.normalized.candidateSetFingerprint).length,
      knownPartyBasisRows: admittedRows.filter((row) => row.normalized.nominatingBody).length
    },
    basisSamples: admittedRows.slice(0, 12).map((row) => row.normalized),
    basisFragmentationSummary: {
      observedAt: new Date().toISOString(),
      labels: basisLabels,
      dominantFragmentation: dominantFragmentation ?? null
    },
    fragmentationByVenuePair,
    comparableClusters: clusters,
    eligibilityDecision: {
      observedAt: new Date().toISOString(),
      state: eligibilityState
    },
    eligibilityRationale: {
      observedAt: new Date().toISOString(),
      rationale:
        eligibilityState === "MATCHING_ELIGIBLE" ? "At least one recurring nominee subgroup is basis-aligned across venues."
        : eligibilityState === "ELIGIBLE_AFTER_SPLIT" ? "Comparable nominee rows exist only after a narrower office/jurisdiction/cycle/party split."
        : eligibilityState === "TOO_THIN" ? "Live nominee inventory did not produce enough admitted rows to support matching."
        : eligibilityState === "TOO_UNKNOWN" ? "Critical nominee basis fields remain missing on too many admitted rows."
        : "Nominee recurrence exists, but basis fragmentation still blocks safe matching.",
      comparableExactClusterCount: exactClusters.length,
      comparableSplitClusterCount: splitClusters.length
    },
    narrowSplits: splitClusters.map((cluster) => ({
      splitKey: cluster.clusterKey,
      rationale: `${cluster.jurisdiction} ${cluster.office} ${cluster.cycleYear} ${cluster.nominatingBody}`
    })),
    prematchReadinessSummary: {
      observedAt: new Date().toISOString(),
      finalLabel,
      candidatePairInputCount: eligibilityState === "MATCHING_ELIGIBLE" || eligibilityState === "ELIGIBLE_AFTER_SPLIT" ? candidatePairInputs.length : 0,
      safeMatcherFollowUpJustified: eligibilityState === "MATCHING_ELIGIBLE" || eligibilityState === "ELIGIBLE_AFTER_SPLIT"
    },
    candidatePairInputs: eligibilityState === "MATCHING_ELIGIBLE" || eligibilityState === "ELIGIBLE_AFTER_SPLIT" ? candidatePairInputs : [],
    exactSafeSubgroupSummary: clusters
      .filter((cluster) => cluster.venues.length >= 2)
      .map((cluster) => ({
        clusterKey: cluster.clusterKey,
        readinessClass: cluster.comparability === "EXACT" ? "EXACT_SAFE" as const : "SPLIT_REQUIRED" as const,
        venues: cluster.venues
      })),
    deltaVsCensus: {
      observedAt: new Date().toISOString(),
      priorNomineeRows: priorCensus?.priorNomineeRows ?? 0,
      currentNomineeRows: liveRows.length,
      priorEligibility: priorCensus?.priorEligibility ?? "BASIS_FRAGMENTED",
      currentEligibility: eligibilityState,
      comparableClustersDelta: clusters.length
    },
    liveImprovementSummary: {
      observedAt: new Date().toISOString(),
      improved: liveRows.length > (priorCensus?.priorNomineeRows ?? 0) || clusters.length > 0,
      rationale:
        clusters.length > 0 ? "Live nominee refresh produced comparable clusters that were not explicit in the prior census."
        : liveRows.length > (priorCensus?.priorNomineeRows ?? 0) ? "Live nominee refresh increased observable nominee inventory but did not fix comparability."
        : "Live nominee refresh did not materially improve nominee comparability."
    },
    finalDecision: {
      observedAt: new Date().toISOString(),
      finalLabel,
      eligibilityState,
      safeMatcherFollowUpJustified: eligibilityState === "MATCHING_ELIGIBLE" || eligibilityState === "ELIGIBLE_AFTER_SPLIT"
    },
    operatorSummary: ""
  };

  artifacts.operatorSummary = buildOperatorSummary(artifacts);
  return artifacts;
};
