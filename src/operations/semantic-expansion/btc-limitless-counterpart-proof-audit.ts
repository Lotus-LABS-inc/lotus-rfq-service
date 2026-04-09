import { writeFileSync } from "node:fs";
import path from "node:path";

import { OpinionClient } from "../../integrations/opinion/opinion-client.js";
import { buildOpinionCryptoDateFamilyMatrix, type OpinionCryptoDateFamilyMatrixResult, type OpinionCryptoDateFamilyRow } from "../../integrations/opinion/opinion-crypto-date-family-matrix.js";
import { LimitlessHistoricalClient } from "../../integrations/limitless/limitless-client.js";
import { compareStructuredPropositions, parseStructuredProposition, type StructuredProposition } from "../../simulation/proposition-matching.js";
import { loadLimitlessVenueAuditUniverse, type VenueAuditEvidenceProvenance, type VenueAuditSourceCandidate, type VenueAuditSourceResult } from "./btc-venue-audit-sources.js";
import { writeArtifact } from "./shared.js";

export type LimitlessCounterpartProofClassification =
  | "EXISTS_AND_VISIBLE"
  | "VISIBLE_BUT_NON_EXACT"
  | "EXISTS_BUT_NOT_ACCESSIBLE_WITH_CURRENT_SURFACE"
  | "NOT_PROVEN_TO_EXIST"
  | "PROVEN_NOT_PRESENT";

type ProofEvidenceProvenance = Exclude<VenueAuditEvidenceProvenance, "ingested">;

const toProofEvidenceProvenance = (value: VenueAuditEvidenceProvenance): ProofEvidenceProvenance =>
  value === "ingested" ? "unknown_partial" : value;

export interface BtcLimitlessProofCandidate {
  venueMarketId: string;
  title: string;
  family: string;
  asset: string | null;
  exactDate: string | null;
  cutoffStyle: string;
  reference: string | null;
  evidenceProvenance: ProofEvidenceProvenance;
  classification: "EXACT" | "NON_EXACT";
  blockReason: "wrong_family" | "wrong_date" | "wrong_cutoff" | "semantic_mismatch";
}

export interface BtcLimitlessCounterpartProofBucket {
  opinionMarketId: string;
  opinionTitle: string;
  targetSpec: {
    asset: string | null;
    family: string;
    targetDate: string | null;
    cutoffStyle: string;
    triggerStyle: string | null;
    binaryStructure: string;
  };
  classification: LimitlessCounterpartProofClassification;
  rationale: string;
  rawEvidenceReferences: readonly string[];
  visibleCandidates: readonly BtcLimitlessProofCandidate[];
}

export interface BtcLimitlessCounterpartProofAuditArtifact {
  observedAt: string;
  metadataVersion: string;
  opinionBtcBucketCount: number;
  warnings: readonly string[];
  classificationCounts: Readonly<Record<LimitlessCounterpartProofClassification, number>>;
  buckets: readonly BtcLimitlessCounterpartProofBucket[];
}

const METADATA_VERSION = "btc-limitless-counterpart-proof-audit-v1";
const AUDIT_OUTPUT_PATH = "docs/btc-limitless-counterpart-proof-audit.json";
const SUMMARY_OUTPUT_PATH = "docs/btc-limitless-counterpart-proof-summary.md";

const buildTargetBinaryStructure = (bucket: OpinionCryptoDateFamilyRow): string =>
  bucket.triggerStyle ?? "binary_yes_no";

const evaluateLimitlessCandidate = (input: {
  bucket: OpinionCryptoDateFamilyRow;
  bucketParsed: StructuredProposition;
  candidate: VenueAuditSourceCandidate;
}): BtcLimitlessProofCandidate => {
  const familyMatch = input.candidate.asset === "bitcoin" && input.candidate.family === input.bucket.family;
  if (!familyMatch) {
    return {
      venueMarketId: input.candidate.venueMarketId,
      title: input.candidate.title,
      family: input.candidate.family,
      asset: input.candidate.asset,
      exactDate: input.candidate.exactDate,
      cutoffStyle: input.candidate.cutoffStyle,
      reference: input.candidate.reference,
      evidenceProvenance: toProofEvidenceProvenance(input.candidate.evidenceProvenance),
      classification: "NON_EXACT",
      blockReason: "wrong_family"
    };
  }
  if (input.bucket.exactDate !== input.candidate.exactDate) {
    return {
      venueMarketId: input.candidate.venueMarketId,
      title: input.candidate.title,
      family: input.candidate.family,
      asset: input.candidate.asset,
      exactDate: input.candidate.exactDate,
      cutoffStyle: input.candidate.cutoffStyle,
      reference: input.candidate.reference,
      evidenceProvenance: toProofEvidenceProvenance(input.candidate.evidenceProvenance),
      classification: "NON_EXACT",
      blockReason: "wrong_date"
    };
  }
  if (input.bucket.cutoffStyle !== input.candidate.cutoffStyle) {
    return {
      venueMarketId: input.candidate.venueMarketId,
      title: input.candidate.title,
      family: input.candidate.family,
      asset: input.candidate.asset,
      exactDate: input.candidate.exactDate,
      cutoffStyle: input.candidate.cutoffStyle,
      reference: input.candidate.reference,
      evidenceProvenance: toProofEvidenceProvenance(input.candidate.evidenceProvenance),
      classification: "NON_EXACT",
      blockReason: "wrong_cutoff"
    };
  }

  const comparison = compareStructuredPropositions({
    seed: input.bucketParsed,
    candidate: input.candidate.parsed,
    historyQualified: false,
    requireHistoricalQualification: false
  });
  return {
    venueMarketId: input.candidate.venueMarketId,
    title: input.candidate.title,
    family: input.candidate.family,
    asset: input.candidate.asset,
    exactDate: input.candidate.exactDate,
    cutoffStyle: input.candidate.cutoffStyle,
    reference: input.candidate.reference,
    evidenceProvenance: toProofEvidenceProvenance(input.candidate.evidenceProvenance),
    classification:
      comparison.classification === "semantic_exact_live_only" || comparison.classification === "semantic_exact_historical_qualified"
        ? "EXACT"
        : "NON_EXACT",
    blockReason:
      comparison.classification === "semantic_exact_live_only" || comparison.classification === "semantic_exact_historical_qualified"
        ? "semantic_mismatch"
        : "semantic_mismatch"
  };
};

export const classifyLimitlessBucketProof = (input: {
  bucket: OpinionCryptoDateFamilyRow;
  universe: VenueAuditSourceResult;
}): BtcLimitlessCounterpartProofBucket => {
  const bucketParsed = parseStructuredProposition({
    category: "CRYPTO",
    title: input.bucket.title,
    rules: null
  });
  const visibleCandidates = input.universe.candidates.map((candidate) =>
    evaluateLimitlessCandidate({
      bucket: input.bucket,
      bucketParsed,
      candidate
    })
  );

  const exactVisible = visibleCandidates.find((candidate) => candidate.classification === "EXACT" && candidate.evidenceProvenance === "api_confirmed");
  const exactSnapshotOnly = visibleCandidates.find((candidate) => candidate.classification === "EXACT" && candidate.evidenceProvenance === "snapshot_supported");
  const nonExactVisible = visibleCandidates.find((candidate) => candidate.blockReason !== "wrong_family");

  let classification: LimitlessCounterpartProofClassification;
  let rationale: string;
  if (exactVisible) {
    classification = "EXISTS_AND_VISIBLE";
    rationale = "Current supported Limitless payloads directly expose an exact BTC counterpart.";
  } else if (exactSnapshotOnly) {
    classification = "EXISTS_BUT_NOT_ACCESSIBLE_WITH_CURRENT_SURFACE";
    rationale = "Public snapshot evidence suggests an exact BTC counterpart exists, but the current live surface cannot expose enough metadata directly.";
  } else if (nonExactVisible) {
    classification = "VISIBLE_BUT_NON_EXACT";
    rationale = "Current Limitless surfaces expose same-asset BTC markets, but only non-exact family/date/cutoff variants.";
  } else if (input.universe.exactAbsenceAllowed) {
    classification = "PROVEN_NOT_PRESENT";
    rationale = "Current supported Limitless surfaces are strong enough to prove the exact BTC counterpart is absent.";
  } else {
    classification = "NOT_PROVEN_TO_EXIST";
    rationale = "Current supported Limitless surfaces cannot safely prove whether the exact BTC counterpart exists.";
  }

  return {
    opinionMarketId: input.bucket.marketId,
    opinionTitle: input.bucket.title,
    targetSpec: {
      asset: input.bucket.asset,
      family: input.bucket.family,
      targetDate: input.bucket.exactDate,
      cutoffStyle: input.bucket.cutoffStyle,
      triggerStyle: input.bucket.triggerStyle,
      binaryStructure: buildTargetBinaryStructure(input.bucket)
    },
    classification,
    rationale,
    rawEvidenceReferences: visibleCandidates
      .map((candidate) => candidate.reference)
      .filter((value): value is string => typeof value === "string"),
    visibleCandidates
  };
};

const buildMarkdownSummary = (artifact: BtcLimitlessCounterpartProofAuditArtifact): string => {
  const counts = Object.entries(artifact.classificationCounts)
    .map(([classification, count]) => `- ${classification}: ${count}`)
    .join("\n");
  const examples = artifact.buckets
    .filter((bucket) => bucket.classification !== "NOT_PROVEN_TO_EXIST")
    .slice(0, 10)
    .map((bucket) => `- ${bucket.opinionTitle} | ${bucket.classification} | ${bucket.rationale}`)
    .join("\n") || "- none";

  return [
    "# BTC Limitless Counterpart Proof Summary",
    "",
    `- Opinion BTC buckets audited: ${artifact.opinionBtcBucketCount}`,
    "",
    "## Classification counts",
    counts,
    "",
    "## Visible evidence examples",
    examples,
    "",
    "## Conclusion",
    artifact.classificationCounts.EXISTS_AND_VISIBLE > 0
      ? "Limitless exact BTC counterpart existence can be proven for at least some buckets on current supported surfaces."
      : artifact.classificationCounts.EXISTS_BUT_NOT_ACCESSIBLE_WITH_CURRENT_SURFACE > 0
        ? "Limitless exact BTC counterpart existence has some positive evidence, but current supported live surfaces cannot expose it directly."
        : "Limitless exact BTC counterpart existence cannot be proven from current supported public surfaces.",
    ""
  ].join("\n");
};

export const buildBtcLimitlessCounterpartProofAuditFromInputs = (input: {
  matrix: OpinionCryptoDateFamilyMatrixResult;
  limitlessUniverse: VenueAuditSourceResult;
}): {
  audit: BtcLimitlessCounterpartProofAuditArtifact;
  markdown: string;
} => {
  const btcBuckets = input.matrix.rows.filter((row) => row.asset === "bitcoin");
  const buckets = btcBuckets.map((bucket) => classifyLimitlessBucketProof({
    bucket,
    universe: input.limitlessUniverse
  }));

  const classificationCounts = {
    EXISTS_AND_VISIBLE: 0,
    VISIBLE_BUT_NON_EXACT: 0,
    EXISTS_BUT_NOT_ACCESSIBLE_WITH_CURRENT_SURFACE: 0,
    NOT_PROVEN_TO_EXIST: 0,
    PROVEN_NOT_PRESENT: 0
  } satisfies Record<LimitlessCounterpartProofClassification, number>;

  for (const bucket of buckets) {
    classificationCounts[bucket.classification] += 1;
  }

  const audit: BtcLimitlessCounterpartProofAuditArtifact = {
    observedAt: new Date().toISOString(),
    metadataVersion: METADATA_VERSION,
    opinionBtcBucketCount: btcBuckets.length,
    warnings: input.limitlessUniverse.warnings,
    classificationCounts,
    buckets
  };

  return {
    audit,
    markdown: buildMarkdownSummary(audit)
  };
};

export const runBtcLimitlessCounterpartProofAudit = async (input: {
  repoRoot: string;
  opinionBaseUrl: string;
  opinionApiKey: string;
  limitlessBaseUrl?: string;
  limitlessApiKey?: string | null;
  auditOutputPath?: string;
  markdownOutputPath?: string;
}): Promise<BtcLimitlessCounterpartProofAuditArtifact> => {
  const opinionClient = new OpinionClient({
    baseUrl: input.opinionBaseUrl,
    apiKey: input.opinionApiKey
  });
  const limitlessAuditClient = input.limitlessApiKey
    ? new LimitlessHistoricalClient({
      baseUrl: input.limitlessBaseUrl ?? "https://api.limitless.exchange",
      apiKey: input.limitlessApiKey
    })
    : null;

  const [matrix, limitlessUniverse] = await Promise.all([
    buildOpinionCryptoDateFamilyMatrix({ client: opinionClient }),
    loadLimitlessVenueAuditUniverse({
      repoRoot: input.repoRoot,
      client: limitlessAuditClient
    })
  ]);

  const result = buildBtcLimitlessCounterpartProofAuditFromInputs({
    matrix,
    limitlessUniverse
  });

  writeArtifact(input.repoRoot, input.auditOutputPath ?? AUDIT_OUTPUT_PATH, result.audit);
  writeFileSync(path.resolve(input.repoRoot, input.markdownOutputPath ?? SUMMARY_OUTPUT_PATH), result.markdown, "utf8");
  return result.audit;
};
