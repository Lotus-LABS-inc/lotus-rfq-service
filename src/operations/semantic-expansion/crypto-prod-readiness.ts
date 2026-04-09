import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { PairRouteAdminService } from "../../api/admin/pair-route-admin-service.js";
import type { PairCanaryReadiness } from "../../rollout/pair-canary-readiness-evaluator.js";
import type { PairRouteQualification } from "../../qualification/pair-route-qualification.js";
import { readArtifact, writeArtifact, writeMarkdownArtifact } from "./shared.js";
import { buildPairCanaryLaunchPlan, type PairCanaryLaunchPlanArtifact } from "./pair-canary-launch-plan.js";
import { buildPairCanaryReadinessArtifact, type PairCanaryReadinessArtifact } from "./pair-canary-readiness-summary.js";

export type CryptoProdReadinessDecision =
  | "READY_FOR_SHADOW_ONLY"
  | "READY_FOR_CANARY_PENDING_OPERATOR_ACTION"
  | "BLOCKED_BY_EVIDENCE"
  | "BLOCKED_BY_SCOPE"
  | "BLOCKED_BY_RUNTIME_HEALTH"
  | "BLOCKED_BY_MISSING_CONTROLS";

export type CryptoCanaryGateDecision =
  | "CANARY_GATES_PASSED"
  | "CANARY_GATES_FAILED"
  | "CANARY_GATES_SHADOW_ONLY";

export interface CryptoApprovedScopeSlice {
  routeClass: PairRouteQualification["routeClassId"];
  routeMode: PairRouteQualification["definition"]["routeMode"];
  scopeLabel: string | null;
  allowedFamilies: readonly string[];
  blockedFamilies: readonly string[];
  basisRestrictions: readonly string[];
  exactSafeOnly: true;
  triAllowed: false;
  operatorApprovalRequired: true;
}

export interface CryptoRollbackPlan {
  routeClass: PairRouteQualification["routeClassId"];
  currentStage: string;
  rollbackTargetStage: "SHADOW" | "INTERNAL_ONLY";
  disabledScopeLabel: string | null;
  disabledFamilies: readonly string[];
  remainsShadowOnlyFamilies: readonly string[];
  preservedEvidenceRefs: readonly string[];
  restoreProcedure: readonly string[];
}

export interface CryptoOperatorApprovalIntent {
  routeClass: PairRouteQualification["routeClassId"];
  scopeLabel: string | null;
  operatorIdentity: string;
  reason: string | null;
  recordedAt: string;
}

export interface CryptoProdReadinessRouteSummary {
  routeClass: PairRouteQualification["routeClassId"];
  currentStage: string;
  readinessDecision: CryptoProdReadinessDecision;
  canaryGateDecision: CryptoCanaryGateDecision;
  explanation: string;
  blockers: readonly string[];
  approvedScope: CryptoApprovedScopeSlice;
  canaryReadiness: PairCanaryReadiness;
}

export interface CryptoProdReadinessArtifact {
  observedAt: string;
  overallDecision: CryptoProdReadinessDecision;
  routes: readonly CryptoProdReadinessRouteSummary[];
}

export interface CryptoCanaryGatesArtifact {
  observedAt: string;
  routes: readonly {
    routeClass: PairRouteQualification["routeClassId"];
    gateDecision: CryptoCanaryGateDecision;
    blockerReasons: readonly string[];
    thresholdResults: PairCanaryReadiness["thresholdResults"];
  }[];
}

export interface CryptoCanaryLaunchPlanArtifact {
  observedAt: string;
  eligibleRoutes: readonly {
    routeClass: PairRouteQualification["routeClassId"];
    scopePromoted: string | null;
    allowedFamilies: readonly string[];
    blockedFamilies: readonly string[];
    basisRestrictions: readonly string[];
    healthWatchMetrics: readonly string[];
    operatorApproval: "ADMIN_PLUS_2FA_REQUIRED";
  }[];
}

export interface CryptoRollbackPlanArtifact {
  observedAt: string;
  routes: readonly CryptoRollbackPlan[];
}

export interface CryptoProdArtifacts {
  readinessSummary: CryptoProdReadinessArtifact;
  canaryGatesSummary: CryptoCanaryGatesArtifact;
  canaryLaunchPlan: CryptoCanaryLaunchPlanArtifact;
  rollbackPlan: CryptoRollbackPlanArtifact;
  operatorSummary: string;
  runbook: string;
  checklist: string;
}

const CRYPTO_FAMILY_PREFIX = "CRYPTO:";
const RUNTIME_HEALTH_METRICS = new Set([
  "maximumStaleDataRate",
  "maximumMixedBasisRate",
  "maximumExecutionBoundaryIncidentCount",
  "maximumReplayProtectionIncidentCount",
  "maximumReconciliationIncidentCount",
  "maximumVenueHealthFailureRate"
]);

const sortStrings = (value: readonly string[]): readonly string[] =>
  [...value].sort((left, right) => left.localeCompare(right));

const routeScopeFallback = (routeClass: PairRouteQualification["routeClassId"]): string =>
  routeClass === "PAIR_PM_OPINION" ? "btc_exact_slice_only" : "safe_exact_subset_only";

const hasCryptoScope = (qualification: PairRouteQualification): boolean =>
  qualification.definition.allowedCategories.includes("CRYPTO")
  && qualification.definition.canaryAllowedFamilies.some((family) => family.startsWith(CRYPTO_FAMILY_PREFIX));

const toApprovedScope = (
  qualification: PairRouteQualification,
  scopeLabel: string | null
): CryptoApprovedScopeSlice => ({
  routeClass: qualification.routeClassId,
  routeMode: qualification.definition.routeMode,
  scopeLabel,
  allowedFamilies: qualification.definition.canaryAllowedFamilies.filter((family) => family.startsWith(CRYPTO_FAMILY_PREFIX)),
  blockedFamilies: qualification.blockedFamilies,
  basisRestrictions: ["LIVE_ONLY", "EXACT_SAFE_ONLY", "NO_MIXED_BASIS", "NO_TRI_DEPENDENCY"],
  exactSafeOnly: true,
  triAllowed: false,
  operatorApprovalRequired: true
});

const hasRuntimeHealthBlockers = (readiness: PairCanaryReadiness): boolean =>
  readiness.thresholdResults.some((result) => !result.pass && RUNTIME_HEALTH_METRICS.has(result.metric));

const buildRouteDecision = (input: {
  qualification: PairRouteQualification;
  canaryReadiness: PairCanaryReadiness;
  controlsAvailable: boolean;
  scopeLabel: string | null;
}): CryptoProdReadinessRouteSummary => {
  const approvedScope = toApprovedScope(input.qualification, input.scopeLabel);
  const gateDecision: CryptoCanaryGateDecision =
    input.canaryReadiness.recommendation === "CANARY_APPROVED_PENDING_OPERATOR_ACTION" ? "CANARY_GATES_PASSED"
      : input.canaryReadiness.recommendation === "REMAIN_SHADOW" ? "CANARY_GATES_SHADOW_ONLY"
      : "CANARY_GATES_FAILED";

  let readinessDecision: CryptoProdReadinessDecision;
  let explanation: string;
  let blockers: string[] = [...input.canaryReadiness.blockerReasons];

  if (!input.controlsAvailable) {
    readinessDecision = "BLOCKED_BY_MISSING_CONTROLS";
    explanation = "Required operator controls or approval surfaces are unavailable.";
    blockers = ["missing_admin_controls"];
  } else if (!hasCryptoScope(input.qualification) || approvedScope.allowedFamilies.length === 0) {
    readinessDecision = "BLOCKED_BY_SCOPE";
    explanation = "This route class does not have a currently approved crypto canary scope.";
    blockers = ["no_crypto_canary_scope"];
  } else if (hasRuntimeHealthBlockers(input.canaryReadiness)) {
    readinessDecision = "BLOCKED_BY_RUNTIME_HEALTH";
    explanation = "Runtime-health thresholds remain the blocking factor for crypto canary readiness.";
  } else if (input.canaryReadiness.recommendation === "CANARY_APPROVED_PENDING_OPERATOR_ACTION") {
    readinessDecision = "READY_FOR_CANARY_PENDING_OPERATOR_ACTION";
    explanation = "Crypto exact-safe canary gates have passed, but activation still requires explicit operator approval.";
  } else if (
    input.qualification.readinessState === "SHADOW_READY"
    || input.qualification.readinessState === "CANARY_READY"
    || input.qualification.readinessState === "LIMITED_PROD_READY"
  ) {
    readinessDecision = "READY_FOR_SHADOW_ONLY";
    explanation = "The route remains eligible for shadow observation only; canary evidence is not yet sufficient.";
  } else {
    readinessDecision = "BLOCKED_BY_EVIDENCE";
    explanation = "Crypto evidence is not yet sufficient to progress beyond the current blocked state.";
  }

  return {
    routeClass: input.qualification.routeClassId,
    currentStage: input.qualification.currentStage,
    readinessDecision,
    canaryGateDecision: gateDecision,
    explanation,
    blockers: sortStrings(blockers),
    approvedScope,
    canaryReadiness: input.canaryReadiness
  };
};

const overallDecision = (routes: readonly CryptoProdReadinessRouteSummary[]): CryptoProdReadinessDecision => {
  const precedence: readonly CryptoProdReadinessDecision[] = [
    "READY_FOR_CANARY_PENDING_OPERATOR_ACTION",
    "READY_FOR_SHADOW_ONLY",
    "BLOCKED_BY_RUNTIME_HEALTH",
    "BLOCKED_BY_MISSING_CONTROLS",
    "BLOCKED_BY_SCOPE",
    "BLOCKED_BY_EVIDENCE"
  ];
  return precedence.find((decision) => routes.some((route) => route.readinessDecision === decision)) ?? "BLOCKED_BY_EVIDENCE";
};

const buildRollbackPlan = (route: CryptoProdReadinessRouteSummary): CryptoRollbackPlan => ({
  routeClass: route.routeClass,
  currentStage: route.currentStage,
  rollbackTargetStage: route.currentStage === "CANARY" || route.readinessDecision === "READY_FOR_CANARY_PENDING_OPERATOR_ACTION"
    ? "SHADOW"
    : "INTERNAL_ONLY",
  disabledScopeLabel: route.approvedScope.scopeLabel,
  disabledFamilies: route.approvedScope.allowedFamilies,
  remainsShadowOnlyFamilies: route.approvedScope.blockedFamilies,
  preservedEvidenceRefs: [
    "docs/pair-canary-readiness-summary.json",
    "docs/pair-canary-launch-plan.json",
    "docs/pair-route-rollout-summary.json",
    "docs/crypto-multi-asset-next-step-decision.json"
  ],
  restoreProcedure: [
    `Demote ${route.routeClass} to SHADOW or INTERNAL_ONLY using the audited pair-route admin control.`,
    "Preserve current shadow evidence and promotion-decision records.",
    "Regenerate crypto production-readiness artifacts after rollback.",
    "Require fresh operator approval intent before any future canary promotion."
  ]
});

const toMarkdownList = (title: string, lines: readonly string[]): string => [
  `# ${title}`,
  "",
  ...lines,
  ""
].join("\n");

const buildOperatorSummary = (artifact: CryptoProdArtifacts): string =>
  toMarkdownList("Crypto Production Operator Summary", [
    `- overall decision: ${artifact.readinessSummary.overallDecision}`,
    ...artifact.readinessSummary.routes.map((route) =>
      `- ${route.routeClass}: ${route.readinessDecision}; scope=${route.approvedScope.scopeLabel ?? "none"}; families=${route.approvedScope.allowedFamilies.join(", ") || "none"}; blockers=${route.blockers.join(", ") || "none"}`
    )
  ]);

const buildRunbook = (artifact: CryptoProdArtifacts): string => {
  const routeLines = artifact.readinessSummary.routes.flatMap((route) => [
    `## ${route.routeClass}`,
    `- Current stage: \`${route.currentStage}\``,
    `- Current readiness: \`${route.readinessDecision}\``,
    `- Approved scope: \`${route.approvedScope.scopeLabel ?? "none"}\``,
    `- Allowed families: ${route.approvedScope.allowedFamilies.join(", ") || "none"}`,
    `- Blocked families: ${route.approvedScope.blockedFamilies.join(", ") || "none"}`,
    `- Basis restrictions: ${route.approvedScope.basisRestrictions.join(", ")}`,
    `- Canary blockers: ${route.blockers.join(", ") || "none"}`,
    ""
  ]);

  return [
    "# Crypto Pair-First Production Runbook",
    "",
    "## Scope Definition",
    "- Crypto only.",
    "- Pair-first only.",
    "- Exact-safe only.",
    "- No tri dependency.",
    "- No mixed-basis activation.",
    "- First live crypto canary is PAIR_PM_OPINION on btc_exact_slice_only only.",
    "- PAIR_PM_LIMITLESS remains out of scope for the first live window.",
    "- Sports remains secondary and non-blocking for crypto canary activation.",
    "",
    "## Preflight Checks",
    "- Refresh pair-route rollout, pair canary readiness, and crypto production-readiness artifacts.",
    "- Confirm current approved crypto scope matches the latest machine-readable artifact.",
    "- Confirm promotion remains explicit operator action and no broad route defaults are enabled.",
    "",
    "## Canary Entry Criteria",
    "- Route decision is `READY_FOR_CANARY_PENDING_OPERATOR_ACTION`.",
    "- Current approved scope is non-empty and crypto-only.",
    "- Runtime-health blockers are empty.",
    "- Operator approval intent has been recorded.",
    "",
    "## Operator Approval Flow",
    "- Review crypto production-readiness summary.",
    "- Review route-specific launch and rollback plans.",
    "- Review the first-window canary activation, monitoring, and rollback package artifacts.",
    "- Record operator approval intent with ADMIN+2FA.",
    "- Promote to canary only through the audited pair-route canary promotion endpoint.",
    "- Approval intent is required but is not activation.",
    "",
    "## Stage Meanings",
    "- `INTERNAL_ONLY`: blocked from rollout.",
    "- `SHADOW`: evidence collection only.",
    "- `CANARY`: explicitly approved narrow crypto slice.",
    "- `LIMITED_PROD`: not activated by this pass.",
    "",
    "## Monitoring Signals",
    "- `expectedNetExecutionImprovement`",
    "- `staleDataRate`",
    "- `mixedBasisRate`",
    "- `executionBoundaryIncidentCount`",
    "- `replayProtectionIncidentCount`",
    "- `reconciliationIncidentCount`",
    "- `venueHealthFailureRate`",
    "",
    "## Failure Conditions",
    "- Any execution-boundary incident.",
    "- Any replay-protection incident.",
    "- Any reconciliation incident.",
    "- Mixed-basis evidence detected in the active slice.",
    "- Venue health degradation above threshold.",
    "",
    "## Rollback Steps",
    "- Generate the route-specific rollback plan artifact.",
    "- Follow the short first-window rollback checklist for PAIR_PM_OPINION.",
    "- Demote the affected route class back to `SHADOW` or `INTERNAL_ONLY`.",
    "- Preserve shadow evidence and promotion-decision history.",
    "- Regenerate readiness artifacts after rollback.",
    "",
    "## Post-Launch Review",
    "- Reconfirm canary metrics remain inside thresholds.",
    "- Reconfirm no blocked family or shadow-only slice was activated.",
    "- Reconfirm the current approved scope remains the exact promoted scope.",
    "",
    ...routeLines
  ].join("\n");
};

const buildChecklist = (artifact: CryptoProdArtifacts): string => [
  "# Crypto Pair-First Production Checklist",
  "",
  "- [ ] exact-safe scope locked to current machine-readable approved scope",
  "- [ ] latest crypto production-readiness artifacts generated",
  "- [ ] canary gates satisfied for intended route class",
  "- [ ] explicit operator approval required before promotion",
  "- [ ] crypto admin readiness / launch / rollback controls available",
  "- [ ] monitoring signals documented and reviewed",
  "- [ ] rollback steps verified against current route class",
  "- [ ] shadow-only and blocked families explicitly excluded from activation",
  "- [ ] first live window locked to PAIR_PM_OPINION on btc_exact_slice_only",
  "- [ ] PAIR_PM_LIMITLESS explicitly excluded from the first live window",
  "- [ ] short first-window monitoring and rollback checklists reviewed",
  "",
  ...artifact.readinessSummary.routes.flatMap((route) => [
    `## ${route.routeClass}`,
    `- [ ] current decision = \`${route.readinessDecision}\``,
    `- [ ] approved scope = \`${route.approvedScope.scopeLabel ?? "none"}\``,
    `- [ ] allowed families = ${route.approvedScope.allowedFamilies.join(", ") || "none"}`,
    `- [ ] blocker reasons reviewed = ${route.blockers.join(", ") || "none"}`,
    ""
  ])
].join("\n");

const loadCanaryLaunchPlanFallback = (repoRoot: string): PairCanaryLaunchPlanArtifact =>
  readArtifact<PairCanaryLaunchPlanArtifact>(repoRoot, "docs/pair-canary-launch-plan.json");

const loadCanaryReadinessFallback = (repoRoot: string): PairCanaryReadinessArtifact =>
  readArtifact<PairCanaryReadinessArtifact>(repoRoot, "docs/pair-canary-readiness-summary.json");

export const buildCryptoProdArtifacts = async (
  pairRouteAdminService: Pick<PairRouteAdminService,
    | "listPairRoutes"
    | "getShadowEvidence"
    | "getCanaryReadiness"
    | "getPromotionBlockers"
  >,
  repoRoot: string = process.cwd()
): Promise<CryptoProdArtifacts> => {
  const routes = await pairRouteAdminService.listPairRoutes();
  const [canaryLaunchPlan, canaryReadinessArtifact] = await Promise.all([
    buildPairCanaryLaunchPlan(pairRouteAdminService).catch(() => loadCanaryLaunchPlanFallback(repoRoot)),
    buildPairCanaryReadinessArtifact(pairRouteAdminService).catch(() => loadCanaryReadinessFallback(repoRoot))
  ]);

  const launchPlanLookup = new Map(canaryLaunchPlan.eligibleRoutes.map((route) => [route.routeClass, route] as const));
  const readinessLookup = new Map(canaryReadinessArtifact.routes.map((route) => [route.routeClass, route] as const));

  const routeSummaries = routes
    .filter((route) => route.definition.allowedCategories.includes("CRYPTO"))
    .map((qualification) => {
      const launchPlanRoute = launchPlanLookup.get(qualification.routeClassId);
      const readinessRoute = readinessLookup.get(qualification.routeClassId);
      return buildRouteDecision({
        qualification,
        canaryReadiness: readinessRoute?.canaryReadiness ?? {
          routeClass: qualification.routeClassId,
          thresholds: {} as PairCanaryReadiness["thresholds"],
          thresholdResults: [],
          blockerReasons: ["missing_canary_readiness"],
          recommendation: "BLOCKED"
        },
        controlsAvailable: true,
        scopeLabel: launchPlanRoute?.scopePromoted ?? routeScopeFallback(qualification.routeClassId)
      });
    });

  const readinessSummary: CryptoProdReadinessArtifact = {
    observedAt: new Date().toISOString(),
    overallDecision: overallDecision(routeSummaries),
    routes: routeSummaries
  };

  const canaryGatesSummary: CryptoCanaryGatesArtifact = {
    observedAt: new Date().toISOString(),
    routes: routeSummaries.map((route) => ({
      routeClass: route.routeClass,
      gateDecision: route.canaryGateDecision,
      blockerReasons: route.blockers,
      thresholdResults: route.canaryReadiness.thresholdResults
    }))
  };

  const canaryLaunchPlanArtifact: CryptoCanaryLaunchPlanArtifact = {
    observedAt: new Date().toISOString(),
    eligibleRoutes: routeSummaries
      .filter((route) => route.readinessDecision === "READY_FOR_CANARY_PENDING_OPERATOR_ACTION")
      .map((route) => ({
        routeClass: route.routeClass,
        scopePromoted: route.approvedScope.scopeLabel,
        allowedFamilies: route.approvedScope.allowedFamilies,
        blockedFamilies: route.approvedScope.blockedFamilies,
        basisRestrictions: route.approvedScope.basisRestrictions,
        healthWatchMetrics: [
          "expectedNetExecutionImprovement",
          "staleDataRate",
          "mixedBasisRate",
          "venueHealthFailureRate"
        ],
        operatorApproval: "ADMIN_PLUS_2FA_REQUIRED" as const
      }))
  };

  const rollbackPlan: CryptoRollbackPlanArtifact = {
    observedAt: new Date().toISOString(),
    routes: routeSummaries.map(buildRollbackPlan)
  };

  const partialArtifacts = {
    readinessSummary,
    canaryGatesSummary,
    canaryLaunchPlan: canaryLaunchPlanArtifact,
    rollbackPlan
  };
  const operatorSummary = buildOperatorSummary({ ...partialArtifacts, operatorSummary: "", runbook: "", checklist: "" } as CryptoProdArtifacts);
  const runbook = buildRunbook({ ...partialArtifacts, operatorSummary, runbook: "", checklist: "" } as CryptoProdArtifacts);
  const checklist = buildChecklist({ ...partialArtifacts, operatorSummary, runbook, checklist: "" } as CryptoProdArtifacts);

  return {
    ...partialArtifacts,
    operatorSummary,
    runbook,
    checklist
  };
};

export const writeCryptoProdArtifacts = async (
  repoRoot: string,
  pairRouteAdminService: Pick<PairRouteAdminService,
    | "listPairRoutes"
    | "getShadowEvidence"
    | "getCanaryReadiness"
    | "getPromotionBlockers"
  >
): Promise<CryptoProdArtifacts> => {
  const artifacts = await buildCryptoProdArtifacts(pairRouteAdminService, repoRoot);
  mkdirSync(path.resolve(repoRoot, "docs"), { recursive: true });
  mkdirSync(path.resolve(repoRoot, "docs/runbooks"), { recursive: true });
  mkdirSync(path.resolve(repoRoot, "docs/delivery"), { recursive: true });
  writeArtifact(repoRoot, "docs/crypto-prod-readiness-summary.json", artifacts.readinessSummary);
  writeArtifact(repoRoot, "docs/crypto-canary-gates-summary.json", artifacts.canaryGatesSummary);
  writeArtifact(repoRoot, "docs/crypto-canary-launch-plan.json", artifacts.canaryLaunchPlan);
  writeArtifact(repoRoot, "docs/crypto-rollback-plan.json", artifacts.rollbackPlan);
  writeMarkdownArtifact(repoRoot, "docs/crypto-prod-operator-summary.md", `${artifacts.operatorSummary}\n`);
  writeFileSync(path.resolve(repoRoot, "docs/runbooks/crypto-pair-first-prod-runbook.md"), `${artifacts.runbook}\n`, "utf8");
  writeFileSync(path.resolve(repoRoot, "docs/delivery/crypto-pair-first-production-checklist.md"), `${artifacts.checklist}\n`, "utf8");
  return artifacts;
};
