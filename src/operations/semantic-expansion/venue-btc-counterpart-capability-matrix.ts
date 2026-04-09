import { writeFileSync } from "node:fs";
import path from "node:path";

import { OpinionClient } from "../../integrations/opinion/opinion-client.js";
import { PredexonHistoricalClient } from "../../integrations/predexon/predexon-client.js";
import { LimitlessHistoricalClient } from "../../integrations/limitless/limitless-client.js";
import {
  loadLimitlessVenueAuditUniverse,
  loadPolymarketVenueAuditUniverse,
  type VenueAuditSourceResult
} from "./btc-venue-audit-sources.js";
import { buildOpinionCryptoDateFamilyMatrix } from "../../integrations/opinion/opinion-crypto-date-family-matrix.js";
import { writeArtifact } from "./shared.js";

export type VenueCapabilityClassification = "DIRECT_PROOF" | "PARTIAL_PROOF" | "POSITIVE_ONLY" | "WEAK_INFERENCE_ONLY";
export type CounterpartProofStrength = "CAN_PROVE_PRESENCE" | "CAN_PROVE_ABSENCE" | "PARTIAL_NEGATIVE_PROOF" | "CANNOT_PROVE_ABSENCE";

export interface VenueCapabilityMatrixEntry {
  venue: "OPINION" | "POLYMARKET" | "LIMITLESS";
  supportedSurfaces: readonly string[];
  marketListCompleteness: "high" | "medium" | "low";
  marketDetailCompleteness: "high" | "medium" | "low";
  searchableByAsset: boolean;
  searchableByDate: boolean;
  searchableByContractFamily: boolean;
  historicalCoverage: "high" | "medium" | "low";
  snapshotCoverage: "high" | "medium" | "low";
  exactCounterpartPresenceProof: CounterpartProofStrength;
  exactCounterpartAbsenceProof: CounterpartProofStrength;
  classification: VenueCapabilityClassification;
  limitations: readonly string[];
  evidenceObserved: {
    available: boolean;
    candidateCount: number;
    warningCount: number;
  };
}

export interface VenueBtcCounterpartCapabilityMatrixArtifact {
  observedAt: string;
  metadataVersion: string;
  opinionBtcBucketCount: number;
  entries: readonly VenueCapabilityMatrixEntry[];
}

const METADATA_VERSION = "venue-btc-counterpart-capability-matrix-v1";
const MATRIX_OUTPUT_PATH = "docs/venue-btc-counterpart-capability-matrix.json";
const SUMMARY_OUTPUT_PATH = "docs/venue-btc-counterpart-capability-summary.md";

const buildOpinionEntry = (opinionBtcBucketCount: number): VenueCapabilityMatrixEntry => ({
  venue: "OPINION",
  supportedSurfaces: ["openapi:/market"],
  marketListCompleteness: "high",
  marketDetailCompleteness: "medium",
  searchableByAsset: true,
  searchableByDate: true,
  searchableByContractFamily: true,
  historicalCoverage: "low",
  snapshotCoverage: "low",
  exactCounterpartPresenceProof: "CAN_PROVE_PRESENCE",
  exactCounterpartAbsenceProof: "PARTIAL_NEGATIVE_PROOF",
  classification: "DIRECT_PROOF",
  limitations: [
    "Opinion is authoritative for the current live BTC target bucket set, not for proving other venue universes.",
    "The current pass uses list pagination rather than exhaustive historical exports."
  ],
  evidenceObserved: {
    available: true,
    candidateCount: opinionBtcBucketCount,
    warningCount: 0
  }
});

const buildPolymarketEntry = (universe: VenueAuditSourceResult): VenueCapabilityMatrixEntry => ({
  venue: "POLYMARKET",
  supportedSurfaces: ["predexon:listMarkets(search=Bitcoin)"],
  marketListCompleteness: universe.available ? "medium" : "low",
  marketDetailCompleteness: "medium",
  searchableByAsset: true,
  searchableByDate: false,
  searchableByContractFamily: false,
  historicalCoverage: "medium",
  snapshotCoverage: "low",
  exactCounterpartPresenceProof: universe.available ? "CAN_PROVE_PRESENCE" : "PARTIAL_NEGATIVE_PROOF",
  exactCounterpartAbsenceProof: universe.exactAbsenceAllowed ? "CAN_PROVE_ABSENCE" : "PARTIAL_NEGATIVE_PROOF",
  classification: universe.available ? "DIRECT_PROOF" : "WEAK_INFERENCE_ONLY",
  limitations: universe.available
    ? [
      "Predexon search is asset-led rather than exact date/family indexed.",
      "Negative proof is only safe when the live Predexon surface is reachable in this run."
    ]
    : [
      "Predexon live search was unavailable in this run, so negative proofs must degrade to non-proof."
    ],
  evidenceObserved: {
    available: universe.available,
    candidateCount: universe.candidates.length,
    warningCount: universe.warnings.length
  }
});

const buildLimitlessEntry = (universe: VenueAuditSourceResult): VenueCapabilityMatrixEntry => ({
  venue: "LIMITLESS",
  supportedSurfaces: ["limitless:getMarketDetail(known_refs_only)", "snapshot:.tmp-limitless-*.html"],
  marketListCompleteness: "low",
  marketDetailCompleteness: universe.available ? "medium" : "low",
  searchableByAsset: false,
  searchableByDate: false,
  searchableByContractFamily: false,
  historicalCoverage: "low",
  snapshotCoverage: universe.candidates.some((candidate) => candidate.evidenceProvenance === "snapshot_supported") ? "medium" : "low",
  exactCounterpartPresenceProof: universe.available ? "CAN_PROVE_PRESENCE" : "PARTIAL_NEGATIVE_PROOF",
  exactCounterpartAbsenceProof: "CANNOT_PROVE_ABSENCE",
  classification: universe.available ? "POSITIVE_ONLY" : "WEAK_INFERENCE_ONLY",
  limitations: [
    "Current public Limitless surfaces are positive-evidence oriented and do not safely prove absence.",
    "Detail API can enrich known references but does not provide exhaustive BTC date-family discovery.",
    "Snapshot absence is never evidence of non-existence."
  ],
  evidenceObserved: {
    available: universe.available,
    candidateCount: universe.candidates.length,
    warningCount: universe.warnings.length
  }
});

const buildMarkdownSummary = (artifact: VenueBtcCounterpartCapabilityMatrixArtifact): string => [
  "# Venue BTC Counterpart Capability Summary",
  "",
  `- Opinion BTC buckets available: ${artifact.opinionBtcBucketCount}`,
  "",
  ...artifact.entries.flatMap((entry) => [
    `## ${entry.venue}`,
    `- classification: \`${entry.classification}\``,
    `- supported surfaces: ${entry.supportedSurfaces.join(", ")}`,
    `- market list completeness: ${entry.marketListCompleteness}`,
    `- market detail completeness: ${entry.marketDetailCompleteness}`,
    `- searchable by asset/date/family: ${entry.searchableByAsset}/${entry.searchableByDate}/${entry.searchableByContractFamily}`,
    `- exact presence proof: ${entry.exactCounterpartPresenceProof}`,
    `- exact absence proof: ${entry.exactCounterpartAbsenceProof}`,
    `- observed candidates: ${entry.evidenceObserved.candidateCount}`,
    `- warnings: ${entry.evidenceObserved.warningCount}`,
    ...entry.limitations.map((limitation) => `- limitation: ${limitation}`),
    ""
  ])
].join("\n");

export const buildVenueBtcCounterpartCapabilityMatrixFromInputs = (input: {
  opinionBtcBucketCount: number;
  polymarketUniverse: VenueAuditSourceResult;
  limitlessUniverse: VenueAuditSourceResult;
}): {
  matrix: VenueBtcCounterpartCapabilityMatrixArtifact;
  markdown: string;
} => {
  const matrix: VenueBtcCounterpartCapabilityMatrixArtifact = {
    observedAt: new Date().toISOString(),
    metadataVersion: METADATA_VERSION,
    opinionBtcBucketCount: input.opinionBtcBucketCount,
    entries: [
      buildOpinionEntry(input.opinionBtcBucketCount),
      buildPolymarketEntry(input.polymarketUniverse),
      buildLimitlessEntry(input.limitlessUniverse)
    ]
  };

  return {
    matrix,
    markdown: buildMarkdownSummary(matrix)
  };
};

export const runVenueBtcCounterpartCapabilityMatrix = async (input: {
  repoRoot: string;
  opinionBaseUrl: string;
  opinionApiKey: string;
  predexonBaseUrl?: string;
  predexonApiKey?: string | null;
  limitlessBaseUrl?: string;
  limitlessApiKey?: string | null;
  matrixOutputPath?: string;
  markdownOutputPath?: string;
}): Promise<VenueBtcCounterpartCapabilityMatrixArtifact> => {
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

  const [matrixResult, polymarketUniverse, limitlessUniverse] = await Promise.all([
    buildOpinionCryptoDateFamilyMatrix({ client: opinionClient }),
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

  const opinionBtcBucketCount = matrixResult.rows.filter((row) => row.asset === "bitcoin").length;
  const result = buildVenueBtcCounterpartCapabilityMatrixFromInputs({
    opinionBtcBucketCount,
    polymarketUniverse,
    limitlessUniverse
  });

  writeArtifact(input.repoRoot, input.matrixOutputPath ?? MATRIX_OUTPUT_PATH, result.matrix);
  writeFileSync(path.resolve(input.repoRoot, input.markdownOutputPath ?? SUMMARY_OUTPUT_PATH), result.markdown, "utf8");
  return result.matrix;
};
