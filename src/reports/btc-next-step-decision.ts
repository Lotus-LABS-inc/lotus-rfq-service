import type {
  BtcFamilyConvergenceSummary,
  BtcMissingEdgeRootCauseSummary,
  BtcNextStepDecision,
  BtcNextStepDecisionLabel
} from "./btc-audit-types.js";
import type { CryptoPairRouteabilitySummary } from "./crypto-pair-routeability-summary.js";

const buildRationale = (input: {
  decision: BtcNextStepDecisionLabel;
  selectedFamily: string;
  limitlessOpinionExactPath: boolean;
  triCapableFamily: string | null;
  routeability: CryptoPairRouteabilitySummary;
  rootCauseSummary: BtcMissingEdgeRootCauseSummary;
}): string => {
  if (input.decision === "BTC_FAMILY_CONVERGENCE_READY__TRI_POSSIBLE_SOON") {
    return `The ${input.selectedFamily} family now has enough exact-safe pair coverage to make a single-family BTC tri path plausible soon.`;
  }
  if (input.decision === "BTC_INGESTION_GAP_FOUND__RECOVERY_NEXT") {
    return `The matcher is holding exact-safe BTC structure correctly, but missing venue inventory ingestion is still hiding exact counterparts, especially in ${input.selectedFamily}.`;
  }
  if (input.decision === "BTC_NORMALIZATION_GAP_FOUND__FIX_NEXT") {
    return `Remote exact BTC counterparts are present but local normalization is not aligning them into approved exact-safe edges.`;
  }
  return `The matcher is behaving correctly; broader BTC exact-safe expansion is blocked by missing or structurally wrong upstream inventory, and ${input.selectedFamily} remains the best convergence target.`;
};

export const buildBtcNextStepDecision = (input: {
  familySummary: BtcFamilyConvergenceSummary;
  rootCauseSummary: BtcMissingEdgeRootCauseSummary;
  routeability: CryptoPairRouteabilitySummary;
}): BtcNextStepDecision => {
  const triCapableFamily = input.routeability.triCapableFamilies[0] ?? null;
  const limitlessOpinionExactPath = Object.keys(input.routeability.routeablePairsByVenuePair)
    .includes("LIMITLESS_OPINION");
  const decision: BtcNextStepDecisionLabel =
    triCapableFamily || input.familySummary.families.find((entry) => entry.likelyTriViability === "REMOTE_TRI_WINDOW_PRESENT")
      ? "BTC_FAMILY_CONVERGENCE_READY__TRI_POSSIBLE_SOON"
      : input.rootCauseSummary.countsByRootCause.NORMALIZATION_MISSING > input.rootCauseSummary.countsByRootCause.INGESTION_MISSING
        && input.rootCauseSummary.countsByRootCause.NORMALIZATION_MISSING > input.rootCauseSummary.countsByRootCause.UPSTREAM_INVENTORY_MISSING
        ? "BTC_NORMALIZATION_GAP_FOUND__FIX_NEXT"
        : input.rootCauseSummary.countsByRootCause.INGESTION_MISSING > 0
          && input.rootCauseSummary.countsByRootCause.INGESTION_MISSING >= input.rootCauseSummary.countsByRootCause.UPSTREAM_INVENTORY_MISSING
          ? "BTC_INGESTION_GAP_FOUND__RECOVERY_NEXT"
          : "BTC_MATCHER_READY__INVENTORY_BLOCKED";

  return {
    observedAt: new Date().toISOString(),
    decision,
    selectedFamily: input.familySummary.selectedFamily,
    rationale: buildRationale({
      decision,
      selectedFamily: input.familySummary.selectedFamily,
      limitlessOpinionExactPath,
      triCapableFamily,
      routeability: input.routeability,
      rootCauseSummary: input.rootCauseSummary
    }),
    exactSafeEdges: input.routeability.exactSafeApprovedCount,
    limitlessOpinionExactPath,
    triCapableFamily
  };
};

export const buildBtcNextStepDecisionMarkdown = (
  artifact: BtcNextStepDecision
): string => [
  "# BTC Next-Step Decision",
  "",
  `- decision: \`${artifact.decision}\``,
  `- selected family: \`${artifact.selectedFamily}\``,
  `- exact-safe BTC edges: ${artifact.exactSafeEdges}`,
  `- Limitless ↔ Opinion exact-safe path: ${artifact.limitlessOpinionExactPath ? "yes" : "no"}`,
  `- tri-capable family: ${artifact.triCapableFamily ?? "none"}`,
  "",
  artifact.rationale,
  ""
].join("\n");
