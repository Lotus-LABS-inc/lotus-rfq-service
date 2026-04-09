import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Pool } from "pg";

import { normalizePropositionTextForSimilarity } from "../../canonical/proposition-fingerprint.js";
import { LimitlessHistoricalClient } from "../../integrations/limitless/limitless-client.js";
import { OpinionClient } from "../../integrations/opinion/opinion-client.js";
import {
  buildOpinionCryptoDateFamilyMatrix,
  inferCryptoCutoffStyle,
  type OpinionCryptoCutoffStyle,
  type OpinionCryptoDateFamilyMatrixResult,
  type OpinionCryptoDateFamilyRow
} from "../../integrations/opinion/opinion-crypto-date-family-matrix.js";
import { classifyStructuredOpinionFamily } from "../../integrations/opinion/opinion-family-classifier.js";
import { PredexonHistoricalClient } from "../../integrations/predexon/predexon-client.js";
import {
  compareStructuredPropositions,
  parseStructuredProposition,
  type PropositionComparison,
  type StructuredProposition
} from "../../simulation/proposition-matching.js";
import {
  loadLimitlessVenueAuditUniverse,
  loadPolymarketVenueAuditUniverse,
  type VenueAuditEvidenceProvenance,
  type VenueAuditSourceCandidate,
  type VenueAuditSourceResult
} from "./btc-venue-audit-sources.js";
import type { CrossVenueMatchReport, SemanticExpansionInventoryRow } from "./shared.js";
import { loadSemanticExpansionInventory, readArtifact, writeArtifact } from "./shared.js";

type DiagnosticVenue = "POLYMARKET" | "LIMITLESS";
type CandidateReason =
  | "exact_family_date_cutoff_match"
  | "wrong_family"
  | "wrong_date"
  | "wrong_cutoff"
  | "semantic_mismatch";
export type VenueAuditClassification =
  | "INGESTED_EXACT_MATCH"
  | "EXISTS_BUT_NOT_INGESTED"
  | "INGESTED_BUT_REJECTED"
  | "NOT_FOUND_ON_VENUE"
  | "UNKNOWN";

interface MatchLookupEntry {
  matchClass: string;
  finalConfidence: number | null;
  failedDimensions: readonly string[];
  blockReason: string | null;
}

interface InventoryDescriptor {
  row: SemanticExpansionInventoryRow;
  family: string;
  asset: string | null;
  exactDate: string | null;
  cutoffStyle: OpinionCryptoCutoffStyle;
  parsed: StructuredProposition;
}

export interface BtcInventoryGapDiagnosticCandidate {
  sourceType: "ingested_inventory" | "venue_audit";
  venue: DiagnosticVenue;
  venueMarketId: string;
  title: string;
  canonicalEventId: string | null;
  canonicalMarketId: string | null;
  family: string;
  asset: string | null;
  exactDate: string | null;
  cutoffStyle: OpinionCryptoCutoffStyle;
  rejectionReason: CandidateReason;
  familyMatch: boolean;
  dateDistanceDays: number | null;
  cutoffDistanceRank: number;
  wordingSimilarity: number;
  failedDimensions: readonly string[];
  comparisonClassification: PropositionComparison["classification"] | null;
  evidenceProvenance: VenueAuditEvidenceProvenance;
  existingCrossVenueMatchClass: string | null;
  existingCrossVenueFinalConfidence: number | null;
  existingCrossVenueFailedDimensions: readonly string[];
  reference: string | null;
}

export interface BtcVenueAuditDecision {
  classification: VenueAuditClassification;
  evidenceProvenance: VenueAuditEvidenceProvenance;
  explanation: string;
}

export interface BtcInventoryGapBucketDiagnostic {
  opinionMarketId: string;
  opinionTitle: string;
  canonicalFamily: string;
  targetDate: string | null;
  cutoffSchema: OpinionCryptoCutoffStyle;
  venueAuditByVenue: Readonly<Record<DiagnosticVenue, BtcVenueAuditDecision>>;
  ingestedCandidateEvaluations: Readonly<Record<DiagnosticVenue, readonly BtcInventoryGapDiagnosticCandidate[]>>;
  venueAuditCandidateEvaluations: Readonly<Record<DiagnosticVenue, readonly BtcInventoryGapDiagnosticCandidate[]>>;
  nearestNearMatchCandidates: Readonly<{
    ingested: Readonly<Record<DiagnosticVenue, readonly BtcInventoryGapDiagnosticCandidate[]>>;
    venueAudit: Readonly<Record<DiagnosticVenue, readonly BtcInventoryGapDiagnosticCandidate[]>>;
  }>;
}

export interface BtcInventoryGapDiagnosticArtifact {
  observedAt: string;
  metadataVersion: string;
  opinionBtcBucketCount: number;
  venueAuditWarnings: readonly string[];
  buckets: readonly BtcInventoryGapBucketDiagnostic[];
}

export interface BtcInventoryGapSummaryArtifact {
  observedAt: string;
  metadataVersion: string;
  opinionBtcBucketCount: number;
  countsByFamily: ReadonlyArray<{
    family: string;
    bucketCount: number;
  }>;
  countsByVenueAndClassification: ReadonlyArray<{
    venue: DiagnosticVenue;
    classification: VenueAuditClassification;
    count: number;
  }>;
  candidateReasonCountsByVenue: ReadonlyArray<{
    venue: DiagnosticVenue;
    reason: CandidateReason;
    count: number;
  }>;
  bucketIntersectionSummary: {
    bothVenuesTrulyLackNeededCounterpart: number;
    oneVenueTrulyLacksNeededCounterpart: number;
    bothVenuesHaveExactCounterpartOnVenue: number;
  };
  limitlessEvidenceSummary: {
    apiConfirmedExistsButNotIngested: number;
    snapshotSupportedExistsButNotIngested: number;
    unknownDueToIncompleteLiveEvidence: number;
  };
  auditOutcomeSummary: {
    bucketsWhereLimitlessExistsOnVenueButMissingFromIngestion: number;
    bucketsWhereVenueInventoryTrulyDoesNotExist: number;
    bucketsWhereBothVenuesTrulyLackNeededCounterpart: number;
    bucketsWhereIngestionWorkAloneWouldUnlockAdditionalExactTriVenueOverlap: number;
    bucketsWhereInventoryScarcityRemainsTheBlockerEvenAfterFullIngestion: number;
  };
  dominantRootCauseByVenue: {
    polymarket: "missing_ingestion" | "wrong_date_venue_supply" | "mixed" | "unknown";
    limitless: "missing_ingestion" | "absent_same_family_supply" | "mixed" | "unknown";
  };
  mostPromisingBuckets: readonly {
    opinionMarketId: string;
    title: string;
    family: string;
    targetDate: string | null;
    pmClassification: VenueAuditClassification;
    limitlessClassification: VenueAuditClassification;
  }[];
}

const METADATA_VERSION = "btc-inventory-gap-diagnostic-v2";
const DIAGNOSTIC_OUTPUT_PATH = "docs/btc-date-aligned-inventory-gap-diagnostic.json";
const SUMMARY_OUTPUT_PATH = "docs/btc-date-aligned-inventory-gap-summary.json";
const REPORT_OUTPUT_PATH = "docs/btc-date-aligned-inventory-gap-report.md";

const normalizeExactDate = (value: string | null): string | null =>
  value?.toLowerCase().replace(/\s+/g, " ").trim() ?? null;

const toBoundaryDate = (value: string | null): Date | null => {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
};

const differenceInDays = (left: string | null, right: string | null): number | null => {
  const leftDate = toBoundaryDate(left);
  const rightDate = toBoundaryDate(right);
  if (!leftDate || !rightDate) {
    return null;
  }
  return Math.abs(leftDate.getTime() - rightDate.getTime()) / 86400000;
};

const computeWordingSimilarity = (left: string, right: string): number => {
  const leftTokens = new Set(normalizePropositionTextForSimilarity(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizePropositionTextForSimilarity(right).split(" ").filter(Boolean));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
};

const computeCutoffDistanceRank = (
  target: OpinionCryptoCutoffStyle,
  candidate: OpinionCryptoCutoffStyle
): number => {
  if (target === candidate) {
    return 0;
  }
  if (target === "UNKNOWN" || candidate === "UNKNOWN") {
    return 2;
  }
  return 1;
};

const buildPairLookupKey = (
  opinionMarketId: string,
  venue: DiagnosticVenue,
  venueMarketId: string
): string => `OPINION:${opinionMarketId}|${venue}:${venueMarketId}`;

const buildMatchLookup = (report: CrossVenueMatchReport): ReadonlyMap<string, MatchLookupEntry> => {
  const lookup = new Map<string, MatchLookupEntry>();
  for (const match of report.matches) {
    const opinionRef = [match.seed, match.candidate].find((entry) => entry.venue === "OPINION");
    const otherRef = [match.seed, match.candidate].find((entry) => entry.venue === "POLYMARKET" || entry.venue === "LIMITLESS");
    if (!opinionRef || !otherRef) {
      continue;
    }
    lookup.set(buildPairLookupKey(opinionRef.venueMarketId, otherRef.venue as DiagnosticVenue, otherRef.venueMarketId), {
      matchClass: match.matchClass,
      finalConfidence: match.finalConfidence,
      failedDimensions: Array.isArray(match.semanticValidation?.failedDimensions)
        ? match.semanticValidation.failedDimensions.filter((value): value is string => typeof value === "string")
        : [],
      blockReason: match.blockReason ?? null
    });
  }
  return lookup;
};

const toInventoryDescriptor = (row: SemanticExpansionInventoryRow): InventoryDescriptor => {
  const family = classifyStructuredOpinionFamily({
    category: row.canonicalCategory,
    title: row.title,
    rules: row.rules,
    boundaryReferenceAt: row.resolvesAt ? new Date(row.resolvesAt) : row.expiresAt ? new Date(row.expiresAt) : row.publishedAt ? new Date(row.publishedAt) : null
  });
  return {
    row,
    family: family.familyBucket,
    asset: family.subject,
    exactDate: normalizeExactDate(family.deadlineOrSeason),
    cutoffStyle: inferCryptoCutoffStyle({
      title: row.title,
      exactDate: family.deadlineOrSeason,
      timeBoundaryPattern: family.timeBoundaryPattern
    }),
    parsed: family.parsed
  };
};

const toOpinionParsed = (bucket: OpinionCryptoDateFamilyRow): StructuredProposition =>
  parseStructuredProposition({
    category: "CRYPTO",
    title: bucket.title,
    rules: null
  });

const evaluateInventoryCandidate = (input: {
  bucket: OpinionCryptoDateFamilyRow;
  bucketParsed: StructuredProposition;
  candidate: InventoryDescriptor;
  matchLookup: ReadonlyMap<string, MatchLookupEntry>;
}): BtcInventoryGapDiagnosticCandidate => {
  const familyMatch = input.candidate.asset === "bitcoin" && input.candidate.family === input.bucket.family;
  const dateDistanceDays = differenceInDays(input.bucket.exactDate, input.candidate.exactDate);
  const cutoffDistanceRank = computeCutoffDistanceRank(input.bucket.cutoffStyle, input.candidate.cutoffStyle);
  const wordingSimilarity = computeWordingSimilarity(input.bucket.title, input.candidate.row.title);
  const lookupEntry = input.matchLookup.get(
    buildPairLookupKey(input.bucket.marketId, input.candidate.row.venue as DiagnosticVenue, input.candidate.row.venueMarketId)
  );

  let rejectionReason: CandidateReason;
  let comparison: PropositionComparison | null = null;
  let failedDimensions: readonly string[] = [];
  if (!familyMatch) {
    rejectionReason = "wrong_family";
  } else if (input.bucket.exactDate !== input.candidate.exactDate) {
    rejectionReason = "wrong_date";
  } else if (input.bucket.cutoffStyle !== input.candidate.cutoffStyle) {
    rejectionReason = "wrong_cutoff";
  } else {
    comparison = compareStructuredPropositions({
      seed: input.bucketParsed,
      candidate: input.candidate.parsed,
      historyQualified: input.candidate.row.historicalRowCount > 0,
      requireHistoricalQualification: false
    });
    failedDimensions = comparison.failedDimensions;
    rejectionReason =
      comparison.classification === "semantic_exact_historical_qualified" || comparison.classification === "semantic_exact_live_only"
        ? "exact_family_date_cutoff_match"
        : "semantic_mismatch";
  }

  return {
    sourceType: "ingested_inventory",
    venue: input.candidate.row.venue as DiagnosticVenue,
    venueMarketId: input.candidate.row.venueMarketId,
    title: input.candidate.row.title,
    canonicalEventId: input.candidate.row.canonicalEventId,
    canonicalMarketId: input.candidate.row.canonicalMarketId,
    family: input.candidate.family,
    asset: input.candidate.asset,
    exactDate: input.candidate.exactDate,
    cutoffStyle: input.candidate.cutoffStyle,
    rejectionReason,
    familyMatch,
    dateDistanceDays,
    cutoffDistanceRank,
    wordingSimilarity,
    failedDimensions,
    comparisonClassification: comparison?.classification ?? null,
    evidenceProvenance: "ingested",
    existingCrossVenueMatchClass: lookupEntry?.matchClass ?? null,
    existingCrossVenueFinalConfidence: lookupEntry?.finalConfidence ?? null,
    existingCrossVenueFailedDimensions: lookupEntry?.failedDimensions ?? [],
    reference: null
  };
};

const evaluateVenueAuditCandidate = (input: {
  bucket: OpinionCryptoDateFamilyRow;
  bucketParsed: StructuredProposition;
  candidate: VenueAuditSourceCandidate;
}): BtcInventoryGapDiagnosticCandidate => {
  const familyMatch = input.candidate.asset === "bitcoin" && input.candidate.family === input.bucket.family;
  const dateDistanceDays = differenceInDays(input.bucket.exactDate, input.candidate.exactDate);
  const cutoffDistanceRank = computeCutoffDistanceRank(input.bucket.cutoffStyle, input.candidate.cutoffStyle);
  const wordingSimilarity = computeWordingSimilarity(input.bucket.title, input.candidate.title);

  let rejectionReason: CandidateReason;
  let comparison: PropositionComparison | null = null;
  let failedDimensions: readonly string[] = [];
  if (!familyMatch) {
    rejectionReason = "wrong_family";
  } else if (input.bucket.exactDate !== input.candidate.exactDate) {
    rejectionReason = "wrong_date";
  } else if (input.bucket.cutoffStyle !== input.candidate.cutoffStyle) {
    rejectionReason = "wrong_cutoff";
  } else {
    comparison = compareStructuredPropositions({
      seed: input.bucketParsed,
      candidate: input.candidate.parsed,
      historyQualified: false,
      requireHistoricalQualification: false
    });
    failedDimensions = comparison.failedDimensions;
    rejectionReason =
      comparison.classification === "semantic_exact_historical_qualified" || comparison.classification === "semantic_exact_live_only"
        ? "exact_family_date_cutoff_match"
        : "semantic_mismatch";
  }

  return {
    sourceType: "venue_audit",
    venue: input.candidate.venue,
    venueMarketId: input.candidate.venueMarketId,
    title: input.candidate.title,
    canonicalEventId: null,
    canonicalMarketId: null,
    family: input.candidate.family,
    asset: input.candidate.asset,
    exactDate: input.candidate.exactDate,
    cutoffStyle: input.candidate.cutoffStyle,
    rejectionReason,
    familyMatch,
    dateDistanceDays,
    cutoffDistanceRank,
    wordingSimilarity,
    failedDimensions,
    comparisonClassification: comparison?.classification ?? null,
    evidenceProvenance: input.candidate.evidenceProvenance,
    existingCrossVenueMatchClass: null,
    existingCrossVenueFinalConfidence: null,
    existingCrossVenueFailedDimensions: [],
    reference: input.candidate.reference
  };
};

const rankCandidates = (left: BtcInventoryGapDiagnosticCandidate, right: BtcInventoryGapDiagnosticCandidate): number =>
  Number(right.familyMatch) - Number(left.familyMatch)
  || (left.dateDistanceDays ?? Number.POSITIVE_INFINITY) - (right.dateDistanceDays ?? Number.POSITIVE_INFINITY)
  || left.cutoffDistanceRank - right.cutoffDistanceRank
  || right.wordingSimilarity - left.wordingSimilarity
  || left.title.localeCompare(right.title)
  || left.venueMarketId.localeCompare(right.venueMarketId);

const hasExact = (candidates: readonly BtcInventoryGapDiagnosticCandidate[]): boolean =>
  candidates.some((candidate) => candidate.rejectionReason === "exact_family_date_cutoff_match");

const hasRejectedIngested = (candidates: readonly BtcInventoryGapDiagnosticCandidate[]): boolean =>
  candidates.some((candidate) =>
    candidate.familyMatch
    && (candidate.rejectionReason === "wrong_date" || candidate.rejectionReason === "wrong_cutoff" || candidate.rejectionReason === "semantic_mismatch")
  );

const determineVenueAuditDecision = (input: {
  venue: DiagnosticVenue;
  ingestedCandidates: readonly BtcInventoryGapDiagnosticCandidate[];
  venueAuditCandidates: readonly BtcInventoryGapDiagnosticCandidate[];
  venueAudit: VenueAuditSourceResult;
}): BtcVenueAuditDecision => {
  if (hasExact(input.ingestedCandidates)) {
    return {
      classification: "INGESTED_EXACT_MATCH",
      evidenceProvenance: "ingested",
      explanation: "An exact counterpart already exists in current ingested inventory."
    };
  }

  const exactVenueCandidates = input.venueAuditCandidates.filter((candidate) => candidate.rejectionReason === "exact_family_date_cutoff_match");
  if (exactVenueCandidates.length > 0) {
    const provenance = exactVenueCandidates.some((candidate) => candidate.evidenceProvenance === "api_confirmed")
      ? "api_confirmed"
      : exactVenueCandidates.some((candidate) => candidate.evidenceProvenance === "snapshot_supported")
        ? "snapshot_supported"
        : "unknown_partial";
    return {
      classification: "EXISTS_BUT_NOT_INGESTED",
      evidenceProvenance: provenance,
      explanation:
        provenance === "snapshot_supported"
          ? "An exact counterpart appears in supporting public snapshots but is absent from current ingested inventory."
          : "An exact counterpart exists on the live venue surface but is absent from current ingested inventory."
    };
  }

  if (hasRejectedIngested(input.ingestedCandidates)) {
    return {
      classification: "INGESTED_BUT_REJECTED",
      evidenceProvenance: "ingested",
      explanation: "A current ingested candidate exists, but it fails exact family/date/cutoff or semantic checks."
    };
  }

  if (input.venueAudit.exactAbsenceAllowed) {
    return {
      classification: "NOT_FOUND_ON_VENUE",
      evidenceProvenance: "api_confirmed",
      explanation: "No exact counterpart was found on the live venue universe under current strict standards."
    };
  }

  if (input.venueAudit.available) {
    return {
      classification: "UNKNOWN",
      evidenceProvenance: "unknown_partial",
      explanation: "No exact counterpart was confirmed, but live venue evidence is incomplete so absence cannot be asserted safely."
    };
  }

  return {
    classification: "UNKNOWN",
    evidenceProvenance: "unknown_partial",
    explanation: "Venue audit could not establish a reliable live universe for this venue."
  };
};

const classifyPolymarketRootCause = (summary: BtcInventoryGapSummaryArtifact): BtcInventoryGapSummaryArtifact["dominantRootCauseByVenue"]["polymarket"] => {
  const exists = summary.countsByVenueAndClassification.find((row) => row.venue === "POLYMARKET" && row.classification === "EXISTS_BUT_NOT_INGESTED")?.count ?? 0;
  const notFound = summary.countsByVenueAndClassification.find((row) => row.venue === "POLYMARKET" && row.classification === "NOT_FOUND_ON_VENUE")?.count ?? 0;
  const wrongDate = summary.candidateReasonCountsByVenue.find((row) => row.venue === "POLYMARKET" && row.reason === "wrong_date")?.count ?? 0;
  if (exists === 0 && notFound === 0 && wrongDate === 0) {
    return "unknown";
  }
  if (exists > wrongDate && exists > notFound) {
    return "missing_ingestion";
  }
  if (wrongDate >= exists && wrongDate >= notFound) {
    return "wrong_date_venue_supply";
  }
  return "mixed";
};

const classifyLimitlessRootCause = (summary: BtcInventoryGapSummaryArtifact): BtcInventoryGapSummaryArtifact["dominantRootCauseByVenue"]["limitless"] => {
  const exists = summary.countsByVenueAndClassification.find((row) => row.venue === "LIMITLESS" && row.classification === "EXISTS_BUT_NOT_INGESTED")?.count ?? 0;
  const notFound = summary.countsByVenueAndClassification.find((row) => row.venue === "LIMITLESS" && row.classification === "NOT_FOUND_ON_VENUE")?.count ?? 0;
  const unknown = summary.countsByVenueAndClassification.find((row) => row.venue === "LIMITLESS" && row.classification === "UNKNOWN")?.count ?? 0;
  const wrongFamily = summary.candidateReasonCountsByVenue.find((row) => row.venue === "LIMITLESS" && row.reason === "wrong_family")?.count ?? 0;
  if (unknown > exists && unknown > notFound) {
    return "unknown";
  }
  if (exists === 0 && notFound === 0 && wrongFamily === 0) {
    return "unknown";
  }
  if (exists > wrongFamily && exists > notFound) {
    return "missing_ingestion";
  }
  if (wrongFamily >= exists && wrongFamily >= notFound) {
    return "absent_same_family_supply";
  }
  return "mixed";
};

const buildMarkdownReport = (summary: BtcInventoryGapSummaryArtifact): string => {
  const topClassifications = [...summary.countsByVenueAndClassification]
    .sort((left, right) => right.count - left.count || left.venue.localeCompare(right.venue))
    .slice(0, 8)
    .map((row) => `- ${row.venue}: \`${row.classification}\` = ${row.count}`)
    .join("\n");
  const promising = summary.mostPromisingBuckets.length === 0
    ? "- none"
    : summary.mostPromisingBuckets
      .map((row) =>
        `- ${row.title} | ${row.family} | ${row.targetDate ?? "unknown date"} | PM=${row.pmClassification} | LIMITLESS=${row.limitlessClassification}`
      )
      .join("\n");

  const mainBlocker =
    summary.auditOutcomeSummary.bucketsWhereIngestionWorkAloneWouldUnlockAdditionalExactTriVenueOverlap > 0
      && summary.auditOutcomeSummary.bucketsWhereInventoryScarcityRemainsTheBlockerEvenAfterFullIngestion === 0
      ? "missing ingestion"
      : summary.auditOutcomeSummary.bucketsWhereIngestionWorkAloneWouldUnlockAdditionalExactTriVenueOverlap === 0
        && summary.auditOutcomeSummary.bucketsWhereInventoryScarcityRemainsTheBlockerEvenAfterFullIngestion > 0
        ? "true venue inventory scarcity"
        : "both";

  const pmIssue = summary.dominantRootCauseByVenue.polymarket === "missing_ingestion"
    ? "missing ingestion"
    : summary.dominantRootCauseByVenue.polymarket === "wrong_date_venue_supply"
      ? "wrong-date venue supply"
      : "mixed";

  const limitlessIssue = summary.dominantRootCauseByVenue.limitless === "missing_ingestion"
    ? "missing ingestion"
    : summary.dominantRootCauseByVenue.limitless === "absent_same_family_supply"
      ? "absent same-family supply"
      : summary.dominantRootCauseByVenue.limitless === "unknown"
        ? "incomplete live evidence"
        : "mixed";

  const ingestionOnlyTri =
    summary.auditOutcomeSummary.bucketsWhereIngestionWorkAloneWouldUnlockAdditionalExactTriVenueOverlap > 0
      ? "Yes, ingestion work alone could expand exact tri-venue BTC overlap."
      : "No, ingestion work alone would not expand exact tri-venue BTC overlap with the current live venue universe.";

  return [
    "# BTC Date-Aligned Inventory Gap Report",
    "",
    `- Opinion BTC buckets analyzed: ${summary.opinionBtcBucketCount}`,
    `- Buckets where Limitless exists on venue but is missing from ingestion: ${summary.auditOutcomeSummary.bucketsWhereLimitlessExistsOnVenueButMissingFromIngestion}`,
    `- Buckets where venue inventory truly does not exist: ${summary.auditOutcomeSummary.bucketsWhereVenueInventoryTrulyDoesNotExist}`,
    `- Buckets where both venues truly lack the needed counterpart: ${summary.auditOutcomeSummary.bucketsWhereBothVenuesTrulyLackNeededCounterpart}`,
    `- Buckets where ingestion work alone would unlock additional exact tri-venue overlap: ${summary.auditOutcomeSummary.bucketsWhereIngestionWorkAloneWouldUnlockAdditionalExactTriVenueOverlap}`,
    `- Buckets where inventory scarcity remains the blocker even after full ingestion: ${summary.auditOutcomeSummary.bucketsWhereInventoryScarcityRemainsTheBlockerEvenAfterFullIngestion}`,
    "",
    "## Venue audit classifications",
    topClassifications,
    "",
    "## Limitless evidence split",
    `- api-confirmed exists-but-not-ingested: ${summary.limitlessEvidenceSummary.apiConfirmedExistsButNotIngested}`,
    `- snapshot-supported exists-but-not-ingested: ${summary.limitlessEvidenceSummary.snapshotSupportedExistsButNotIngested}`,
    `- unknown due to incomplete live evidence: ${summary.limitlessEvidenceSummary.unknownDueToIncompleteLiveEvidence}`,
    "",
    "## Most promising buckets",
    promising,
    "",
    "## Final conclusion",
    `The remaining blocker is mainly ${mainBlocker}.`,
    `For Polymarket, the bigger issue is ${pmIssue}.`,
    `For Limitless, the bigger issue is ${limitlessIssue}.`,
    ingestionOnlyTri,
    ""
  ].join("\n");
};

export const buildBtcInventoryGapDiagnosticFromInputs = (input: {
  matrix: OpinionCryptoDateFamilyMatrixResult;
  inventory: readonly SemanticExpansionInventoryRow[];
  crossVenueReport: CrossVenueMatchReport;
  venueAuditUniverse?: Partial<Record<DiagnosticVenue, VenueAuditSourceResult>>;
}): {
  diagnostic: BtcInventoryGapDiagnosticArtifact;
  summary: BtcInventoryGapSummaryArtifact;
  markdown: string;
} => {
  const matchLookup = buildMatchLookup(input.crossVenueReport);
  const inventoryDescriptors = input.inventory
    .filter((row) => row.canonicalCategory === "CRYPTO" && (row.venue === "POLYMARKET" || row.venue === "LIMITLESS"))
    .map(toInventoryDescriptor);
  const opinionBuckets = input.matrix.rows.filter((row) => row.asset === "bitcoin");
  const venueAuditUniverse: Record<DiagnosticVenue, VenueAuditSourceResult> = {
    POLYMARKET: input.venueAuditUniverse?.POLYMARKET ?? {
      available: false,
      exactAbsenceAllowed: false,
      candidates: [],
      warnings: ["polymarket_venue_audit_not_supplied"]
    },
    LIMITLESS: input.venueAuditUniverse?.LIMITLESS ?? {
      available: false,
      exactAbsenceAllowed: false,
      candidates: [],
      warnings: ["limitless_venue_audit_not_supplied"]
    }
  };

  const buckets = opinionBuckets.map((bucket) => {
    const bucketParsed = toOpinionParsed(bucket);
    const ingestedEvaluations = {
      POLYMARKET: inventoryDescriptors
        .filter((candidate) => candidate.row.venue === "POLYMARKET")
        .map((candidate) => evaluateInventoryCandidate({ bucket, bucketParsed, candidate, matchLookup }))
        .sort(rankCandidates),
      LIMITLESS: inventoryDescriptors
        .filter((candidate) => candidate.row.venue === "LIMITLESS")
        .map((candidate) => evaluateInventoryCandidate({ bucket, bucketParsed, candidate, matchLookup }))
        .sort(rankCandidates)
    } satisfies Record<DiagnosticVenue, BtcInventoryGapDiagnosticCandidate[]>;
    const auditEvaluations = {
      POLYMARKET: venueAuditUniverse.POLYMARKET.candidates
        .map((candidate) => evaluateVenueAuditCandidate({ bucket, bucketParsed, candidate }))
        .sort(rankCandidates),
      LIMITLESS: venueAuditUniverse.LIMITLESS.candidates
        .map((candidate) => evaluateVenueAuditCandidate({ bucket, bucketParsed, candidate }))
        .sort(rankCandidates)
    } satisfies Record<DiagnosticVenue, BtcInventoryGapDiagnosticCandidate[]>;

    return {
      opinionMarketId: bucket.marketId,
      opinionTitle: bucket.title,
      canonicalFamily: bucket.family,
      targetDate: bucket.exactDate,
      cutoffSchema: bucket.cutoffStyle,
      venueAuditByVenue: {
        POLYMARKET: determineVenueAuditDecision({
          venue: "POLYMARKET",
          ingestedCandidates: ingestedEvaluations.POLYMARKET,
          venueAuditCandidates: auditEvaluations.POLYMARKET,
          venueAudit: venueAuditUniverse.POLYMARKET
        }),
        LIMITLESS: determineVenueAuditDecision({
          venue: "LIMITLESS",
          ingestedCandidates: ingestedEvaluations.LIMITLESS,
          venueAuditCandidates: auditEvaluations.LIMITLESS,
          venueAudit: venueAuditUniverse.LIMITLESS
        })
      },
      ingestedCandidateEvaluations: ingestedEvaluations,
      venueAuditCandidateEvaluations: auditEvaluations,
      nearestNearMatchCandidates: {
        ingested: {
          POLYMARKET: ingestedEvaluations.POLYMARKET.filter((candidate) => candidate.rejectionReason !== "exact_family_date_cutoff_match").slice(0, 5),
          LIMITLESS: ingestedEvaluations.LIMITLESS.filter((candidate) => candidate.rejectionReason !== "exact_family_date_cutoff_match").slice(0, 5)
        },
        venueAudit: {
          POLYMARKET: auditEvaluations.POLYMARKET.filter((candidate) => candidate.rejectionReason !== "exact_family_date_cutoff_match").slice(0, 5),
          LIMITLESS: auditEvaluations.LIMITLESS.filter((candidate) => candidate.rejectionReason !== "exact_family_date_cutoff_match").slice(0, 5)
        }
      }
    } satisfies BtcInventoryGapBucketDiagnostic;
  });

  const countsByFamilyMap = new Map<string, number>();
  const countsByVenueAndClassificationMap = new Map<string, number>();
  const candidateReasonCountsByVenueMap = new Map<string, number>();
  let bothVenuesTrulyLackNeededCounterpart = 0;
  let oneVenueTrulyLacksNeededCounterpart = 0;
  let bothVenuesHaveExactCounterpartOnVenue = 0;
  let bucketsWhereLimitlessExistsOnVenueButMissingFromIngestion = 0;
  let bucketsWhereVenueInventoryTrulyDoesNotExist = 0;
  let bucketsWhereIngestionWorkAloneWouldUnlockAdditionalExactTriVenueOverlap = 0;
  let bucketsWhereInventoryScarcityRemainsTheBlockerEvenAfterFullIngestion = 0;
  let apiConfirmedExistsButNotIngested = 0;
  let snapshotSupportedExistsButNotIngested = 0;
  let unknownDueToIncompleteLiveEvidence = 0;

  for (const bucket of buckets) {
    countsByFamilyMap.set(bucket.canonicalFamily, (countsByFamilyMap.get(bucket.canonicalFamily) ?? 0) + 1);
    for (const venue of ["POLYMARKET", "LIMITLESS"] as const) {
      const decision = bucket.venueAuditByVenue[venue];
      countsByVenueAndClassificationMap.set(
        `${venue}|${decision.classification}`,
        (countsByVenueAndClassificationMap.get(`${venue}|${decision.classification}`) ?? 0) + 1
      );

      const candidateSets = [...bucket.ingestedCandidateEvaluations[venue], ...bucket.venueAuditCandidateEvaluations[venue]];
      for (const candidate of candidateSets) {
        candidateReasonCountsByVenueMap.set(
          `${venue}|${candidate.rejectionReason}`,
          (candidateReasonCountsByVenueMap.get(`${venue}|${candidate.rejectionReason}`) ?? 0) + 1
        );
      }
    }

    const pmDecision = bucket.venueAuditByVenue.POLYMARKET.classification;
    const lmDecision = bucket.venueAuditByVenue.LIMITLESS.classification;
    const pmHasVenueExact = pmDecision === "INGESTED_EXACT_MATCH" || pmDecision === "EXISTS_BUT_NOT_INGESTED";
    const lmHasVenueExact = lmDecision === "INGESTED_EXACT_MATCH" || lmDecision === "EXISTS_BUT_NOT_INGESTED";
    if (pmHasVenueExact && lmHasVenueExact) {
      bothVenuesHaveExactCounterpartOnVenue += 1;
    }
    if (pmDecision === "NOT_FOUND_ON_VENUE" && lmDecision === "NOT_FOUND_ON_VENUE") {
      bothVenuesTrulyLackNeededCounterpart += 1;
    } else if (pmDecision === "NOT_FOUND_ON_VENUE" || lmDecision === "NOT_FOUND_ON_VENUE") {
      oneVenueTrulyLacksNeededCounterpart += 1;
    }

    if (bucket.venueAuditByVenue.LIMITLESS.classification === "EXISTS_BUT_NOT_INGESTED") {
      bucketsWhereLimitlessExistsOnVenueButMissingFromIngestion += 1;
      if (bucket.venueAuditByVenue.LIMITLESS.evidenceProvenance === "api_confirmed") {
        apiConfirmedExistsButNotIngested += 1;
      } else if (bucket.venueAuditByVenue.LIMITLESS.evidenceProvenance === "snapshot_supported") {
        snapshotSupportedExistsButNotIngested += 1;
      }
    }

    if (pmDecision === "NOT_FOUND_ON_VENUE" || lmDecision === "NOT_FOUND_ON_VENUE") {
      bucketsWhereVenueInventoryTrulyDoesNotExist += 1;
      bucketsWhereInventoryScarcityRemainsTheBlockerEvenAfterFullIngestion += 1;
    }
    if (lmDecision === "UNKNOWN") {
      unknownDueToIncompleteLiveEvidence += 1;
    }
    if (pmHasVenueExact && lmHasVenueExact && (pmDecision === "EXISTS_BUT_NOT_INGESTED" || lmDecision === "EXISTS_BUT_NOT_INGESTED")) {
      bucketsWhereIngestionWorkAloneWouldUnlockAdditionalExactTriVenueOverlap += 1;
    }
  }

  const summary: BtcInventoryGapSummaryArtifact = {
    observedAt: new Date().toISOString(),
    metadataVersion: METADATA_VERSION,
    opinionBtcBucketCount: buckets.length,
    countsByFamily: [...countsByFamilyMap.entries()]
      .map(([family, bucketCount]) => ({ family, bucketCount }))
      .sort((left, right) => right.bucketCount - left.bucketCount || left.family.localeCompare(right.family)),
    countsByVenueAndClassification: [...countsByVenueAndClassificationMap.entries()]
      .map(([key, count]) => {
        const [venue, classification] = key.split("|");
        return { venue: venue as DiagnosticVenue, classification: classification as VenueAuditClassification, count };
      })
      .sort((left, right) => right.count - left.count || left.venue.localeCompare(right.venue)),
    candidateReasonCountsByVenue: [...candidateReasonCountsByVenueMap.entries()]
      .map(([key, count]) => {
        const [venue, reason] = key.split("|");
        return { venue: venue as DiagnosticVenue, reason: reason as CandidateReason, count };
      })
      .sort((left, right) => right.count - left.count || left.venue.localeCompare(right.venue)),
    bucketIntersectionSummary: {
      bothVenuesTrulyLackNeededCounterpart,
      oneVenueTrulyLacksNeededCounterpart,
      bothVenuesHaveExactCounterpartOnVenue
    },
    limitlessEvidenceSummary: {
      apiConfirmedExistsButNotIngested,
      snapshotSupportedExistsButNotIngested,
      unknownDueToIncompleteLiveEvidence
    },
    auditOutcomeSummary: {
      bucketsWhereLimitlessExistsOnVenueButMissingFromIngestion,
      bucketsWhereVenueInventoryTrulyDoesNotExist,
      bucketsWhereBothVenuesTrulyLackNeededCounterpart: bothVenuesTrulyLackNeededCounterpart,
      bucketsWhereIngestionWorkAloneWouldUnlockAdditionalExactTriVenueOverlap,
      bucketsWhereInventoryScarcityRemainsTheBlockerEvenAfterFullIngestion
    },
    dominantRootCauseByVenue: {
      polymarket: "unknown",
      limitless: "unknown"
    },
    mostPromisingBuckets: buckets
      .map((bucket) => ({
        opinionMarketId: bucket.opinionMarketId,
        title: bucket.opinionTitle,
        family: bucket.canonicalFamily,
        targetDate: bucket.targetDate,
        pmClassification: bucket.venueAuditByVenue.POLYMARKET.classification,
        limitlessClassification: bucket.venueAuditByVenue.LIMITLESS.classification,
        score:
          Number(bucket.venueAuditByVenue.POLYMARKET.classification === "EXISTS_BUT_NOT_INGESTED")
          + Number(bucket.venueAuditByVenue.LIMITLESS.classification === "EXISTS_BUT_NOT_INGESTED")
          + Number(bucket.venueAuditByVenue.POLYMARKET.classification === "INGESTED_BUT_REJECTED")
          + Number(bucket.venueAuditByVenue.LIMITLESS.classification === "INGESTED_BUT_REJECTED")
      }))
      .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
      .slice(0, 10)
      .map(({ score: _score, ...rest }) => rest)
  };

  summary.dominantRootCauseByVenue.polymarket = classifyPolymarketRootCause(summary);
  summary.dominantRootCauseByVenue.limitless = classifyLimitlessRootCause(summary);

  const diagnostic: BtcInventoryGapDiagnosticArtifact = {
    observedAt: new Date().toISOString(),
    metadataVersion: METADATA_VERSION,
    opinionBtcBucketCount: buckets.length,
    venueAuditWarnings: [...venueAuditUniverse.POLYMARKET.warnings, ...venueAuditUniverse.LIMITLESS.warnings],
    buckets
  };

  return {
    diagnostic,
    summary,
    markdown: buildMarkdownReport(summary)
  };
};

export const runBtcInventoryGapDiagnostic = async (input: {
  repoRoot: string;
  pool: Pool;
  opinionBaseUrl: string;
  opinionApiKey: string;
  predexonBaseUrl?: string;
  predexonApiKey?: string | null;
  limitlessBaseUrl?: string;
  limitlessApiKey?: string | null;
  crossVenueReportPath?: string;
  diagnosticOutputPath?: string;
  summaryOutputPath?: string;
  markdownOutputPath?: string;
}): Promise<{
  diagnostic: BtcInventoryGapDiagnosticArtifact;
  summary: BtcInventoryGapSummaryArtifact;
}> => {
  const opinionClient = new OpinionClient({
    baseUrl: input.opinionBaseUrl,
    apiKey: input.opinionApiKey
  });
  const polymarketAuditClient = input.predexonApiKey
    ? new PredexonHistoricalClient({
      baseUrl: input.predexonBaseUrl ?? "https://api.predexon.com",
      apiKey: input.predexonApiKey
    })
    : null;
  const limitlessAuditClient = input.limitlessApiKey
    ? new LimitlessHistoricalClient({
      baseUrl: input.limitlessBaseUrl ?? "https://api.limitless.exchange",
      apiKey: input.limitlessApiKey
    })
    : null;

  const [matrix, inventory, polymarketUniverse, limitlessUniverse] = await Promise.all([
    buildOpinionCryptoDateFamilyMatrix({ client: opinionClient }),
    loadSemanticExpansionInventory(input.pool),
    polymarketAuditClient
      ? loadPolymarketVenueAuditUniverse({ client: polymarketAuditClient })
      : Promise.resolve({
        available: false,
        exactAbsenceAllowed: false,
        candidates: [],
        warnings: ["polymarket_live_audit_disabled_missing_predexon_api_key"]
      } satisfies VenueAuditSourceResult),
    loadLimitlessVenueAuditUniverse({
      repoRoot: input.repoRoot,
      client: limitlessAuditClient
    })
  ]);

  const crossVenueReport = readArtifact<CrossVenueMatchReport>(
    input.repoRoot,
    input.crossVenueReportPath ?? "docs/cross-venue-match-report.json"
  );

  const result = buildBtcInventoryGapDiagnosticFromInputs({
    matrix,
    inventory,
    crossVenueReport,
    venueAuditUniverse: {
      POLYMARKET: polymarketUniverse,
      LIMITLESS: limitlessUniverse
    }
  });

  writeArtifact(input.repoRoot, input.diagnosticOutputPath ?? DIAGNOSTIC_OUTPUT_PATH, result.diagnostic);
  writeArtifact(input.repoRoot, input.summaryOutputPath ?? SUMMARY_OUTPUT_PATH, result.summary);
  writeFileSync(path.resolve(input.repoRoot, input.markdownOutputPath ?? REPORT_OUTPUT_PATH), result.markdown, "utf8");
  return {
    diagnostic: result.diagnostic,
    summary: result.summary
  };
};
