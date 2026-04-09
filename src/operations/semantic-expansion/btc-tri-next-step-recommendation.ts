import { writeFileSync } from "node:fs";
import path from "node:path";

import { readArtifact, writeArtifact } from "./shared.js";
import type { BtcInventoryGapSummaryArtifact } from "./btc-inventory-gap-diagnostic.js";
import type { BtcLimitlessCounterpartProofAuditArtifact } from "./btc-limitless-counterpart-proof-audit.js";
import type { VenueBtcCounterpartCapabilityMatrixArtifact } from "./venue-btc-counterpart-capability-matrix.js";

export type BtcTriDecision =
  | "NO_MORE_INGESTION_JUSTIFIED"
  | "LIMITLESS_SURFACE_INSUFFICIENT__PARTNER_ACCESS_NEEDED"
  | "TARGETED_LIMITLESS_INGESTION_JUSTIFIED"
  | "TARGETED_PM_INGESTION_JUSTIFIED"
  | "TRI_NOT_CURRENTLY_REALISTIC_ON_PUBLIC_SURFACES";

export interface BtcTriGoNoGoSummaryArtifact {
  observedAt: string;
  metadataVersion: string;
  decision: BtcTriDecision;
  rationale: string;
  supportingFacts: readonly string[];
  recommendation: {
    internalIngestionWork: "GO" | "NO_GO";
    partnerOrPrivateAccessNeeded: boolean;
    finalDirective: string;
  };
}

const METADATA_VERSION = "btc-tri-go-no-go-summary-v1";
const SUMMARY_OUTPUT_PATH = "docs/btc-tri-go-no-go-summary.json";
const MARKDOWN_OUTPUT_PATH = "docs/btc-tri-next-step-recommendation.md";

export const decideBtcTriNextStep = (input: {
  capabilityMatrix: VenueBtcCounterpartCapabilityMatrixArtifact;
  limitlessProofAudit: BtcLimitlessCounterpartProofAuditArtifact;
  inventoryGapSummary: BtcInventoryGapSummaryArtifact;
}): BtcTriGoNoGoSummaryArtifact => {
  const pmNotFound = input.inventoryGapSummary.countsByVenueAndClassification
    .find((row) => row.venue === "POLYMARKET" && row.classification === "NOT_FOUND_ON_VENUE")?.count ?? 0;
  const pmRejected = input.inventoryGapSummary.countsByVenueAndClassification
    .find((row) => row.venue === "POLYMARKET" && row.classification === "INGESTED_BUT_REJECTED")?.count ?? 0;
  const limitlessExistsNotIngested = input.inventoryGapSummary.countsByVenueAndClassification
    .find((row) => row.venue === "LIMITLESS" && row.classification === "EXISTS_BUT_NOT_INGESTED")?.count ?? 0;
  const limitlessUnknown = input.limitlessProofAudit.classificationCounts.NOT_PROVEN_TO_EXIST;
  const limitlessVisibleNonExact = input.limitlessProofAudit.classificationCounts.VISIBLE_BUT_NON_EXACT;
  const limitlessExactVisible = input.limitlessProofAudit.classificationCounts.EXISTS_AND_VISIBLE;
  const limitlessSurfaceEntry = input.capabilityMatrix.entries.find((entry) => entry.venue === "LIMITLESS");

  let decision: BtcTriDecision;
  if (limitlessExistsNotIngested > 0 && limitlessExactVisible > 0) {
    decision = "TARGETED_LIMITLESS_INGESTION_JUSTIFIED";
  } else if (
    pmRejected === 0
    && pmNotFound === 0
    && input.inventoryGapSummary.auditOutcomeSummary.bucketsWhereIngestionWorkAloneWouldUnlockAdditionalExactTriVenueOverlap > 0
  ) {
    decision = "TARGETED_PM_INGESTION_JUSTIFIED";
  } else if (
    limitlessUnknown >= Math.max(1, input.limitlessProofAudit.opinionBtcBucketCount * 0.8)
    && limitlessSurfaceEntry?.exactCounterpartAbsenceProof === "CANNOT_PROVE_ABSENCE"
  ) {
    decision = "LIMITLESS_SURFACE_INSUFFICIENT__PARTNER_ACCESS_NEEDED";
  } else if (pmRejected > 0 && limitlessExactVisible === 0 && limitlessVisibleNonExact === 0) {
    decision = "TRI_NOT_CURRENTLY_REALISTIC_ON_PUBLIC_SURFACES";
  } else {
    decision = "NO_MORE_INGESTION_JUSTIFIED";
  }

  const supportingFacts = [
    `PM ingested-but-rejected buckets: ${pmRejected}`,
    `PM not-found-on-venue buckets: ${pmNotFound}`,
    `Limitless exact visible buckets: ${limitlessExactVisible}`,
    `Limitless visible-but-non-exact buckets: ${limitlessVisibleNonExact}`,
    `Limitless not-proven buckets: ${limitlessUnknown}`,
    `Buckets unlockable by ingestion alone: ${input.inventoryGapSummary.auditOutcomeSummary.bucketsWhereIngestionWorkAloneWouldUnlockAdditionalExactTriVenueOverlap}`
  ];

  const rationale =
    decision === "TARGETED_LIMITLESS_INGESTION_JUSTIFIED"
      ? "Exact Limitless counterparts are proven to exist and the remaining gap is clearly internal ingestion visibility."
      : decision === "TARGETED_PM_INGESTION_JUSTIFIED"
        ? "Exact Polymarket counterparts are proven to exist and the remaining gap is internal ingestion visibility."
        : decision === "LIMITLESS_SURFACE_INSUFFICIENT__PARTNER_ACCESS_NEEDED"
          ? "Current public Limitless surfaces cannot prove the BTC venue universe safely enough to justify more internal ingestion work."
          : decision === "TRI_NOT_CURRENTLY_REALISTIC_ON_PUBLIC_SURFACES"
            ? "Public-surface PM supply is mostly the wrong date while Limitless exact counterpart existence is still unproven."
            : "Additional internal ingestion work is not justified because exact counterpart existence is not proven where it would matter.";

  const finalDirective =
    decision === "TARGETED_LIMITLESS_INGESTION_JUSTIFIED"
      ? "Do one final tightly scoped Limitless ingestion pass for the exact proven BTC counterpart refs only."
      : decision === "TARGETED_PM_INGESTION_JUSTIFIED"
        ? "Do one final tightly scoped Polymarket ingestion pass for the exact proven BTC counterpart refs only."
        : decision === "LIMITLESS_SURFACE_INSUFFICIENT__PARTNER_ACCESS_NEEDED"
          ? "Stop internal BTC tri ingestion work on public surfaces and pursue partner/private Limitless inventory access."
          : decision === "TRI_NOT_CURRENTLY_REALISTIC_ON_PUBLIC_SURFACES"
            ? "Deprioritize public-surface BTC tri pursuit for now and keep pair routeability as the product value."
            : "Stop further internal ingestion work on this BTC tri family until stronger venue evidence exists.";

  return {
    observedAt: new Date().toISOString(),
    metadataVersion: METADATA_VERSION,
    decision,
    rationale,
    supportingFacts,
    recommendation: {
      internalIngestionWork:
        decision === "TARGETED_LIMITLESS_INGESTION_JUSTIFIED" || decision === "TARGETED_PM_INGESTION_JUSTIFIED"
          ? "GO"
          : "NO_GO",
      partnerOrPrivateAccessNeeded: decision === "LIMITLESS_SURFACE_INSUFFICIENT__PARTNER_ACCESS_NEEDED",
      finalDirective
    }
  };
};

const buildRecommendationMarkdown = (summary: BtcTriGoNoGoSummaryArtifact): string => [
  "# BTC Tri Next-Step Recommendation",
  "",
  `- decision: \`${summary.decision}\``,
  `- rationale: ${summary.rationale}`,
  "",
  "## Supporting facts",
  ...summary.supportingFacts.map((fact) => `- ${fact}`),
  "",
  "## Recommendation",
  `- internal ingestion work: ${summary.recommendation.internalIngestionWork}`,
  `- partner/private access needed: ${summary.recommendation.partnerOrPrivateAccessNeeded ? "yes" : "no"}`,
  `- directive: ${summary.recommendation.finalDirective}`,
  "",
  "## Hard go/no-go",
  summary.recommendation.finalDirective,
  ""
].join("\n");

export const runBtcTriNextStepRecommendation = (input: {
  repoRoot: string;
  capabilityMatrixPath?: string;
  proofAuditPath?: string;
  inventoryGapSummaryPath?: string;
  summaryOutputPath?: string;
  markdownOutputPath?: string;
}): BtcTriGoNoGoSummaryArtifact => {
  const capabilityMatrix = readArtifact<VenueBtcCounterpartCapabilityMatrixArtifact>(
    input.repoRoot,
    input.capabilityMatrixPath ?? "docs/venue-btc-counterpart-capability-matrix.json"
  );
  const limitlessProofAudit = readArtifact<BtcLimitlessCounterpartProofAuditArtifact>(
    input.repoRoot,
    input.proofAuditPath ?? "docs/btc-limitless-counterpart-proof-audit.json"
  );
  const inventoryGapSummary = readArtifact<BtcInventoryGapSummaryArtifact>(
    input.repoRoot,
    input.inventoryGapSummaryPath ?? "docs/btc-date-aligned-inventory-gap-summary.json"
  );

  const summary = decideBtcTriNextStep({
    capabilityMatrix,
    limitlessProofAudit,
    inventoryGapSummary
  });
  writeArtifact(input.repoRoot, input.summaryOutputPath ?? SUMMARY_OUTPUT_PATH, summary);
  writeFileSync(path.resolve(input.repoRoot, input.markdownOutputPath ?? MARKDOWN_OUTPUT_PATH), buildRecommendationMarkdown(summary), "utf8");
  return summary;
};
