import type {
  LimitlessBtcDirectionalAlignmentMatrix,
  LimitlessBtcDirectionalDecisionArtifact,
  LimitlessBtcDirectionalDecisionLabel,
  LimitlessBtcDirectionalInventoryArtifact,
  LimitlessBtcDirectionalNextStepPlanArtifact,
  LimitlessBtcDirectionalSourceHygieneSummary
} from "./limitless-btc-directional-types.js";

const determineDecision = (input: {
  inventory: LimitlessBtcDirectionalInventoryArtifact;
  alignment: LimitlessBtcDirectionalAlignmentMatrix;
}): LimitlessBtcDirectionalDecisionLabel => {
  if (input.alignment.rows.some((row) => row.exactSafeComparable)) {
    return "LIMITLESS_BTC_DIRECTIONAL_INVENTORY_PRESENT__INGESTION_ADAPTER_NEXT";
  }
  if (!input.inventory.authenticatedEnrichmentAttempted) {
    return "LIMITLESS_BTC_DIRECTIONAL_INVENTORY_NOT_PROVEN_ON_CURRENT_SURFACES";
  }
  return "LIMITLESS_BTC_DIRECTIONAL_INVENTORY_ABSENT_IN_EXACT_SAFE_WINDOWS";
};

const buildRationale = (
  decision: LimitlessBtcDirectionalDecisionLabel,
  inventory: LimitlessBtcDirectionalInventoryArtifact,
  alignment: LimitlessBtcDirectionalAlignmentMatrix
): string => {
  if (decision === "LIMITLESS_BTC_DIRECTIONAL_INVENTORY_PRESENT__INGESTION_ADAPTER_NEXT") {
    return "At least one real Limitless BTC SAME_DAY_DIRECTIONAL candidate aligns exactly with a known PM/Opinion window, so the next step is a narrow ingestion or persistence adapter patch.";
  }
  if (decision === "LIMITLESS_BTC_DIRECTIONAL_INVENTORY_PRESENT__DISCOVERY_PATH_INCOMPLETE") {
    return "Repo-supported Limitless surfaces already contain aligned BTC directional evidence, but the current discovery consumer is not enumerating it correctly.";
  }
  if (decision === "LIMITLESS_BTC_DIRECTIONAL_INVENTORY_NOT_PROVEN_ON_CURRENT_SURFACES") {
    return "Current repo-supported Limitless surfaces are not strong enough to prove whether the missing BTC directional counterpart exists, so absence cannot be asserted safely.";
  }
  if (inventory.candidates.length === 0) {
    return "Current reachable Limitless public/live discovery plus authenticated known-slug enrichment exposed no BTC SAME_DAY_DIRECTIONAL candidates at all.";
  }
  const blockers = alignment.rows.reduce<Record<string, number>>((accumulator, row) => {
    accumulator[row.blocker] = (accumulator[row.blocker] ?? 0) + 1;
    return accumulator;
  }, {});
  const dominant = Object.entries(blockers).sort((left, right) => right[1] - left[1])[0]?.[0] ?? "NO_LIMITLESS_COUNTERPART";
  return `Current reachable Limitless surfaces expose BTC directional candidates, but none close the exact-safe PM/Opinion windows; the dominant blocker is ${dominant}.`;
};

export const buildLimitlessBtcDirectionalDecisionArtifact = (input: {
  inventory: LimitlessBtcDirectionalInventoryArtifact;
  alignment: LimitlessBtcDirectionalAlignmentMatrix;
}): LimitlessBtcDirectionalDecisionArtifact => {
  const decision = determineDecision(input);
  return {
    observedAt: new Date().toISOString(),
    decision,
    exactSafeCounterpartExists: input.alignment.rows.some((row) => row.exactSafeComparable),
    rationale: buildRationale(decision, input.inventory, input.alignment)
  };
};

export const buildLimitlessBtcDirectionalDecisionMarkdown = (
  artifact: LimitlessBtcDirectionalDecisionArtifact
): string => [
  "# Limitless BTC Directional Decision",
  "",
  `- decision: \`${artifact.decision}\``,
  `- exact-safe counterpart exists: ${artifact.exactSafeCounterpartExists ? "yes" : "no"}`,
  "",
  artifact.rationale,
  ""
].join("\n");

export const buildLimitlessBtcDirectionalNextStepPlan = (
  artifact: LimitlessBtcDirectionalDecisionArtifact
): LimitlessBtcDirectionalNextStepPlanArtifact => {
  if (artifact.decision === "LIMITLESS_BTC_DIRECTIONAL_INVENTORY_PRESENT__INGESTION_ADAPTER_NEXT") {
    return {
      observedAt: new Date().toISOString(),
      decision: artifact.decision,
      actions: [
        {
          step: "Patch the narrow Limitless BTC directional ingestion path to persist the aligned discovered slug and structural fields.",
          owner: "backend",
          modules: [
            "src/jobs/ingest-limitless-live-markets.job.ts",
            "src/matching/crypto/crypto-matching-pipeline.ts"
          ],
          fields: [
            "venueMarketId",
            "title",
            "expiresAt",
            "dateKey",
            "cutoffTimestamp",
            "observationType",
            "bucketGranularity"
          ],
          reruns: [
            "npm run sync:limitless:live-current-state",
            "npm run sync:crypto:pair-graph",
            "npm run report:crypto:pair-routeability"
          ]
        }
      ]
    };
  }
  if (artifact.decision === "LIMITLESS_BTC_DIRECTIONAL_INVENTORY_NOT_PROVEN_ON_CURRENT_SURFACES") {
    return {
      observedAt: new Date().toISOString(),
      decision: artifact.decision,
      actions: [
        {
          step: "Prepare an external Limitless clarification request for BTC same-day directional discovery coverage and required public or authenticated listing surfaces.",
          owner: "operator",
          modules: [
            "docs/limitless-btc-directional-discovery-map.md",
            "docs/limitless-btc-directional-alignment-matrix.md"
          ],
          fields: [
            "surface coverage",
            "missing discovery endpoint",
            "known PM/Opinion target windows"
          ],
          reruns: [
            "npm run report:limitless:btc-directional-proof"
          ]
        }
      ]
    };
  }
  return {
    observedAt: new Date().toISOString(),
    decision: artifact.decision,
    actions: [
      {
        step: "Freeze BTC tri expectations on Limitless SAME_DAY_DIRECTIONAL and treat BTC as pair-route only until venue supply changes.",
        owner: "operator",
        modules: [
          "docs/btc-next-step-decision.md",
          "docs/limitless-btc-directional-operator-summary.md"
        ],
        fields: [
          "decision label",
          "exact-safe counterpart exists",
          "current blocker"
        ],
        reruns: [
          "npm run report:btc:family-convergence-audit",
          "npm run report:limitless:btc-directional-proof"
        ]
      }
    ]
  };
};

export const buildLimitlessBtcDirectionalNextStepPlanMarkdown = (
  artifact: LimitlessBtcDirectionalNextStepPlanArtifact
): string => [
  "# Limitless BTC Directional Next-Step Plan",
  "",
  `- decision: \`${artifact.decision}\``,
  "",
  ...artifact.actions.flatMap((action) => [
    `- step: ${action.step}`,
    `- owner: ${action.owner}`,
    `- modules: ${action.modules.join(", ")}`,
    `- fields: ${action.fields.join(", ")}`,
    `- reruns: ${action.reruns.join(", ")}`
  ]),
  ""
].join("\n");

export const buildLimitlessBtcDirectionalSourceHygieneSummary = (
  inventory: LimitlessBtcDirectionalInventoryArtifact
): LimitlessBtcDirectionalSourceHygieneSummary => {
  const reasons = inventory.exclusions.reduce<Record<string, number>>((accumulator, row) => {
    for (const reason of row.reasons) {
      accumulator[reason] = (accumulator[reason] ?? 0) + 1;
    }
    return accumulator;
  }, {});

  return {
    observedAt: new Date().toISOString(),
    rejectedCount: inventory.exclusions.length,
    reasons,
    examples: inventory.exclusions.slice(0, 10),
    earlyFilterTighteningRecommended: (reasons["missing_btc_signal"] ?? 0) > 0 || (reasons["bad_crypto_row"] ?? 0) > 0
  };
};

export const buildLimitlessBtcDirectionalOperatorSummary = (input: {
  inventory: LimitlessBtcDirectionalInventoryArtifact;
  decision: LimitlessBtcDirectionalDecisionArtifact;
  alignment: LimitlessBtcDirectionalAlignmentMatrix;
}): string => {
  const exactCount = input.alignment.rows.filter((row) => row.exactSafeComparable).length;
  return [
    "# Limitless BTC Directional Operator Summary",
    "",
    `1. Limitless exposed real BTC SAME_DAY_DIRECTIONAL candidates: ${input.inventory.candidates.length > 0 ? "yes" : "no"}.`,
    `2. Exact-safe alignment with known PM/Opinion windows: ${exactCount > 0 ? `yes (${exactCount})` : "no"}.`,
    `3. Current blocker classification: \`${input.decision.decision}\`.`,
    `4. Smallest correct next action: ${buildLimitlessBtcDirectionalNextStepPlan(input.decision).actions[0]?.step ?? "none"}`,
    ""
  ].join("\n");
};
