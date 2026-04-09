import type {
  BtcAuditVenue,
  BtcMissingEdgeRootCauseSummary,
  BtcTargetedIngestionRecoverySummary
} from "./btc-audit-types.js";

export interface BtcRecoveryActionResult {
  venue: BtcAuditVenue;
  action: string;
  candidateWindowCount: number;
  newEligibleWindows: number;
}

export const buildBtcTargetedIngestionRecoverySummary = (input: {
  executed: boolean;
  rationale: string;
  actions: readonly BtcRecoveryActionResult[];
  beforeExactSafeEdges: number;
  afterExactSafeEdges: number;
  rootCauseSummary: BtcMissingEdgeRootCauseSummary;
}): BtcTargetedIngestionRecoverySummary => {
  const ingestionEntries = input.rootCauseSummary.entries.filter((entry) => entry.rootCause === "INGESTION_MISSING");
  return {
    observedAt: new Date().toISOString(),
    executed: input.executed,
    rationale:
      input.executed
        ? input.rationale
        : input.rationale || (
          ingestionEntries.length === 0
            ? "No exact BTC counterpart window was proven on the public venue surface without already being present locally, so no targeted ingestion pass was justified."
            : "Ingestion gaps were detected, but there is not yet a narrow venue-specific recovery path that can improve the exact-safe BTC window without broadening scope."
        ),
    actions: [...input.actions],
    beforeExactSafeEdges: input.beforeExactSafeEdges,
    afterExactSafeEdges: input.afterExactSafeEdges
  };
};

export const buildBtcTargetedIngestionRecoverySummaryMarkdown = (
  artifact: BtcTargetedIngestionRecoverySummary
): string => [
  "# BTC Targeted Ingestion Recovery Summary",
  "",
  `- executed: ${artifact.executed ? "yes" : "no"}`,
  `- rationale: ${artifact.rationale}`,
  `- exact-safe edges before recovery: ${artifact.beforeExactSafeEdges}`,
  `- exact-safe edges after recovery: ${artifact.afterExactSafeEdges}`,
  "",
  "| Venue | Action | Candidate Windows | New Eligible Windows |",
  "| --- | --- | --- | --- |",
  ...(artifact.actions.length === 0
    ? ["| n/a | no-op | 0 | 0 |"]
    : artifact.actions.map((action) =>
      `| ${action.venue} | ${action.action} | ${action.candidateWindowCount} | ${action.newEligibleWindows} |`
    )),
  ""
].join("\n");
