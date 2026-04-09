import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { PairRouteAdminService } from "../api/admin/pair-route-admin-service.js";
import {
  buildCryptoProdArtifacts,
  type CryptoProdReadinessDecision
} from "../operations/semantic-expansion/crypto-prod-readiness.js";
import { writeArtifact, writeMarkdownArtifact } from "../operations/semantic-expansion/shared.js";
import type { PairPromotionDecisionRecord } from "../shadow/pair-shadow-observation-types.js";

export type CryptoCanaryApprovalState =
  | "NOT_APPROVED"
  | "APPROVED_PENDING_ACTIVATION"
  | "CANARY_ACTIVE"
  | "CANARY_ABORTED"
  | "CANARY_COMPLETED";

export type CryptoFinalCanaryPackageDecision =
  | "CANARY_PACKAGE_READY_PENDING_APPROVAL"
  | "CANARY_PACKAGE_READY_PENDING_ACTIVATION"
  | "CANARY_PACKAGE_ACTIVE"
  | "CANARY_PACKAGE_BLOCKED_BY_SCOPE"
  | "CANARY_PACKAGE_BLOCKED_BY_MISSING_APPROVAL"
  | "CANARY_PACKAGE_BLOCKED_BY_RUNTIME_HEALTH"
  | "CANARY_PACKAGE_ABORT_READY_ONLY";

export interface CryptoCanaryScopeLockArtifact {
  observedAt: string;
  routeClass: "PAIR_PM_OPINION";
  scopeLabel: "btc_exact_slice_only";
  allowedFamilies: readonly ["CRYPTO:SAME_DAY_DIRECTIONAL"];
  basisRestrictions: readonly string[];
  exactSafeOnly: true;
  triAllowed: false;
  inScope: readonly string[];
  outOfScope: readonly string[];
  scopeDecision: "LOCKED" | "BLOCKED_BY_SCOPE";
  blockers: readonly string[];
}

export interface CryptoCanaryOperatorApprovalArtifact {
  observedAt: string;
  routeClass: "PAIR_PM_OPINION";
  approvalState: CryptoCanaryApprovalState;
  latestApprovalIntent: {
    id: string;
    operatorIdentity: string;
    recordedAt: string;
    reason: string | null;
    metadata: Record<string, unknown>;
  } | null;
  activationMode: "CANARY";
  scopeLabel: "btc_exact_slice_only";
  allowedFamilies: readonly ["CRYPTO:SAME_DAY_DIRECTIONAL"];
}

export interface CryptoCanaryDecisionLineageArtifact {
  observedAt: string;
  routeClass: "PAIR_PM_OPINION";
  currentStage: string;
  readinessDecision: CryptoProdReadinessDecision;
  evidenceRefs: readonly string[];
  approvalIntentDecisionIds: readonly string[];
  canaryActivationDecisionIds: readonly string[];
  latestApprovalIntentDecisionId: string | null;
  latestCanaryActivationDecisionId: string | null;
}

export interface CryptoCanaryActivationPlanArtifact {
  observedAt: string;
  routeClass: "PAIR_PM_OPINION";
  finalDecision: CryptoFinalCanaryPackageDecision;
  approvalState: CryptoCanaryApprovalState;
  currentStage: string;
  allowedScope: {
    scopeLabel: "btc_exact_slice_only";
    family: "CRYPTO:SAME_DAY_DIRECTIONAL";
  };
  blockedScope: readonly string[];
  evidenceRefs: readonly string[];
  activationPath: readonly string[];
  monitoringSignals: readonly string[];
  abortSignals: readonly string[];
  remainsShadowOnly: readonly string[];
}

export interface CryptoCanaryMonitoringSummaryArtifact {
  observedAt: string;
  routeClass: "PAIR_PM_OPINION";
  reviewCadence: "15_MINUTE_ROLLOVER";
  checks: readonly string[];
}

export interface CryptoCanaryRollbackSummaryArtifact {
  observedAt: string;
  routeClass: "PAIR_PM_OPINION";
  disableActions: readonly string[];
  preservedEvidence: readonly string[];
  confirmationChecks: readonly string[];
}

export interface CryptoFinalCanaryPackageArtifact {
  observedAt: string;
  routeClass: "PAIR_PM_OPINION";
  finalDecision: CryptoFinalCanaryPackageDecision;
  approvalState: CryptoCanaryApprovalState;
  currentStage: string;
  nextOperatorAction: string;
  successLooksLike: readonly string[];
  abortLooksLike: readonly string[];
}

export interface CryptoFinalCanaryPackageArtifacts {
  scopeLock: CryptoCanaryScopeLockArtifact;
  operatorApproval: CryptoCanaryOperatorApprovalArtifact;
  decisionLineage: CryptoCanaryDecisionLineageArtifact;
  activationPlan: CryptoCanaryActivationPlanArtifact;
  activationSummary: string;
  monitoringChecklist: string;
  monitoringSummary: CryptoCanaryMonitoringSummaryArtifact;
  rollbackChecklist: string;
  rollbackSummary: CryptoCanaryRollbackSummaryArtifact;
  finalPackageSummary: CryptoFinalCanaryPackageArtifact;
  operatorSummary: string;
}

const FIRST_CANARY_ROUTE = "PAIR_PM_OPINION" as const;
const FIRST_CANARY_SCOPE = "btc_exact_slice_only" as const;
const FIRST_CANARY_FAMILY = "CRYPTO:SAME_DAY_DIRECTIONAL" as const;

const EXACT_OUT_OF_SCOPE = [
  "PAIR_PM_LIMITLESS",
  "CRYPTO:ATH_BY_DATE",
  "CRYPTO:THRESHOLD_BY_DATE",
  "any broader BTC slice",
  "any non-BTC asset",
  "any tri-capable route",
  "SPORTS:*",
  "ESPORTS:*",
  "POLITICS:*",
  "any shadow-only route not explicitly approved here"
] as const;

const ACTIVATION_SIGNALS = [
  "scope remains PAIR_PM_OPINION + btc_exact_slice_only only",
  "no out-of-scope promotions are visible",
  "no fallback into blocked families occurs",
  "execution and routing health stay normal",
  "evidence logging remains present",
  "decision lineage remains inspectable",
  "error rate and rejection rate remain within expected baseline",
  "eligible routed volume is not materially below expected window volume"
] as const;

const ABORT_SIGNALS = [
  "any out-of-scope family becomes eligible or promoted",
  "mixed-basis or non-exact routing appears inside the canary slice",
  "execution-boundary, replay-protection, or reconciliation incidents occur",
  "evidence logging or decision lineage becomes unavailable",
  "eligible volume diverges materially from expected baseline",
  "operator cannot confirm rollback path remains narrow and auditable"
] as const;

const isApprovalIntentDecision = (decision: PairPromotionDecisionRecord): boolean =>
  decision.routeClass === FIRST_CANARY_ROUTE
  && decision.scopePromoted === FIRST_CANARY_SCOPE
  && decision.metadata?.actionKind === "OPERATOR_APPROVAL_INTENT";

const isCanaryActivationDecision = (decision: PairPromotionDecisionRecord): boolean =>
  decision.routeClass === FIRST_CANARY_ROUTE && decision.newRolloutState === "CANARY";

const toScopeLock = (
  decision: CryptoProdReadinessDecision,
  allowedFamilies: readonly string[],
  basisRestrictions: readonly string[],
  exactSafeOnly: boolean,
  triAllowed: boolean
): CryptoCanaryScopeLockArtifact => {
  const blockers: string[] = [];
  const scopeValid =
    decision !== "BLOCKED_BY_SCOPE"
    && allowedFamilies.length === 1
    && allowedFamilies[0] === FIRST_CANARY_FAMILY
    && exactSafeOnly
    && !triAllowed;

  if (!scopeValid) {
    blockers.push("scope_lock_mismatch");
  }

  return {
    observedAt: new Date().toISOString(),
    routeClass: FIRST_CANARY_ROUTE,
    scopeLabel: FIRST_CANARY_SCOPE,
    allowedFamilies: [FIRST_CANARY_FAMILY],
    basisRestrictions,
    exactSafeOnly: true,
    triAllowed: false,
    inScope: [FIRST_CANARY_ROUTE, FIRST_CANARY_SCOPE, FIRST_CANARY_FAMILY],
    outOfScope: EXACT_OUT_OF_SCOPE,
    scopeDecision: scopeValid ? "LOCKED" : "BLOCKED_BY_SCOPE",
    blockers
  };
};

const deriveApprovalState = (
  currentStage: string,
  approvalDecisions: readonly PairPromotionDecisionRecord[],
  canaryActivationDecisions: readonly PairPromotionDecisionRecord[]
): CryptoCanaryApprovalState => {
  if (currentStage === "CANARY") {
    return "CANARY_ACTIVE";
  }
  if (canaryActivationDecisions.length > 0) {
    return "CANARY_ABORTED";
  }
  if (approvalDecisions.length > 0) {
    return "APPROVED_PENDING_ACTIVATION";
  }
  return "NOT_APPROVED";
};

const deriveFinalDecision = (input: {
  scopeDecision: CryptoCanaryScopeLockArtifact["scopeDecision"];
  readinessDecision: CryptoProdReadinessDecision;
  approvalState: CryptoCanaryApprovalState;
}): CryptoFinalCanaryPackageDecision => {
  if (input.scopeDecision === "BLOCKED_BY_SCOPE") {
    return "CANARY_PACKAGE_BLOCKED_BY_SCOPE";
  }
  if (input.readinessDecision === "BLOCKED_BY_RUNTIME_HEALTH") {
    return "CANARY_PACKAGE_BLOCKED_BY_RUNTIME_HEALTH";
  }
  if (input.approvalState === "CANARY_ACTIVE") {
    return "CANARY_PACKAGE_ACTIVE";
  }
  if (input.approvalState === "CANARY_ABORTED") {
    return "CANARY_PACKAGE_ABORT_READY_ONLY";
  }
  if (input.approvalState === "APPROVED_PENDING_ACTIVATION") {
    return "CANARY_PACKAGE_READY_PENDING_ACTIVATION";
  }
  if (input.readinessDecision === "READY_FOR_CANARY_PENDING_OPERATOR_ACTION") {
    return "CANARY_PACKAGE_READY_PENDING_APPROVAL";
  }
  return "CANARY_PACKAGE_BLOCKED_BY_MISSING_APPROVAL";
};

const toMarkdownChecklist = (title: string, items: readonly string[]): string =>
  [`# ${title}`, "", ...items.map((item) => `- [ ] ${item}`), ""].join("\n");

const toActivationSummary = (
  artifact: CryptoCanaryActivationPlanArtifact,
  approval: CryptoCanaryOperatorApprovalArtifact
): string => [
  "# Crypto Canary Activation Summary",
  "",
  `- route class: \`${artifact.routeClass}\``,
  `- exact scope: \`${artifact.allowedScope.scopeLabel}\` / \`${artifact.allowedScope.family}\``,
  `- final decision: \`${artifact.finalDecision}\``,
  `- approval state: \`${approval.approvalState}\``,
  `- current stage: \`${artifact.currentStage}\``,
  `- remains shadow-only: ${artifact.remainsShadowOnly.join(", ")}`,
  `- blocked scope: ${artifact.blockedScope.join(", ")}`,
  "",
  "## Start Path",
  ...artifact.activationPath.map((step) => `- ${step}`),
  "",
  "## Abort Triggers",
  ...artifact.abortSignals.map((signal) => `- ${signal}`),
  ""
].join("\n");

const toOperatorSummary = (artifact: CryptoFinalCanaryPackageArtifact): string => [
  "# Crypto Final Canary Operator Summary",
  "",
  `- route class: \`${artifact.routeClass}\``,
  `- final decision: \`${artifact.finalDecision}\``,
  `- approval state: \`${artifact.approvalState}\``,
  `- current stage: \`${artifact.currentStage}\``,
  `- next operator action: ${artifact.nextOperatorAction}`,
  "",
  "## Success Looks Like",
  ...artifact.successLooksLike.map((line) => `- ${line}`),
  "",
  "## Abort Looks Like",
  ...artifact.abortLooksLike.map((line) => `- ${line}`),
  ""
].join("\n");

export const buildCryptoFinalCanaryPackage = async (
  pairRouteAdminService: Pick<PairRouteAdminService,
    | "listPairRoutes"
    | "getShadowEvidence"
    | "getCanaryReadiness"
    | "getPromotionBlockers"
    | "listPromotionDecisions"
  >,
  repoRoot: string = process.cwd()
): Promise<CryptoFinalCanaryPackageArtifacts> => {
  const prodArtifacts = await buildCryptoProdArtifacts(pairRouteAdminService, repoRoot);
  const route = prodArtifacts.readinessSummary.routes.find((entry) => entry.routeClass === FIRST_CANARY_ROUTE);
  if (!route) {
    throw new Error("PAIR_PM_OPINION crypto readiness route not found.");
  }

  const scopeLock = toScopeLock(
    route.readinessDecision,
    route.approvedScope.allowedFamilies,
    route.approvedScope.basisRestrictions,
    route.approvedScope.exactSafeOnly,
    route.approvedScope.triAllowed
  );
  const decisions = await pairRouteAdminService.listPromotionDecisions(FIRST_CANARY_ROUTE);
  const approvalDecisions = decisions.filter(isApprovalIntentDecision);
  const canaryActivationDecisions = decisions.filter(isCanaryActivationDecision);
  const latestApprovalDecision = approvalDecisions[0] ?? null;
  const latestCanaryActivationDecision = canaryActivationDecisions[0] ?? null;
  const approvalState = deriveApprovalState(route.currentStage, approvalDecisions, canaryActivationDecisions);
  const finalDecision = deriveFinalDecision({
    scopeDecision: scopeLock.scopeDecision,
    readinessDecision: route.readinessDecision,
    approvalState
  });

  const operatorApproval: CryptoCanaryOperatorApprovalArtifact = {
    observedAt: new Date().toISOString(),
    routeClass: FIRST_CANARY_ROUTE,
    approvalState,
    latestApprovalIntent: latestApprovalDecision ? {
      id: latestApprovalDecision.id,
      operatorIdentity: latestApprovalDecision.operatorIdentity,
      recordedAt: latestApprovalDecision.createdAt,
      reason: typeof latestApprovalDecision.metadata?.reason === "string" ? latestApprovalDecision.metadata.reason : null,
      metadata: latestApprovalDecision.metadata
    } : null,
    activationMode: "CANARY",
    scopeLabel: FIRST_CANARY_SCOPE,
    allowedFamilies: [FIRST_CANARY_FAMILY]
  };

  const decisionLineage: CryptoCanaryDecisionLineageArtifact = {
    observedAt: new Date().toISOString(),
    routeClass: FIRST_CANARY_ROUTE,
    currentStage: route.currentStage,
    readinessDecision: route.readinessDecision,
    evidenceRefs: [
      "docs/crypto-prod-readiness-summary.json",
      "docs/crypto-canary-launch-plan.json",
      "docs/crypto-rollback-plan.json",
      "docs/pair-canary-readiness-summary.json",
      "docs/pair-route-rollout-summary.json"
    ],
    approvalIntentDecisionIds: approvalDecisions.map((decision) => decision.id),
    canaryActivationDecisionIds: canaryActivationDecisions.map((decision) => decision.id),
    latestApprovalIntentDecisionId: latestApprovalDecision?.id ?? null,
    latestCanaryActivationDecisionId: latestCanaryActivationDecision?.id ?? null
  };

  const activationPath = route.currentStage === "INTERNAL_ONLY"
    ? [
        "Record operator approval intent for PAIR_PM_OPINION on btc_exact_slice_only with ADMIN+2FA.",
        "Promote PAIR_PM_OPINION to SHADOW using the existing audited shadow promotion path.",
        "Reconfirm canary readiness remains READY_FOR_CANARY_PENDING_OPERATOR_ACTION.",
        "Promote PAIR_PM_OPINION to CANARY using the existing audited canary promotion path.",
        "Do not promote any other route class or family in the same window."
      ]
    : route.currentStage === "SHADOW"
      ? [
          "Record operator approval intent for PAIR_PM_OPINION on btc_exact_slice_only with ADMIN+2FA.",
          "Promote PAIR_PM_OPINION to CANARY using the existing audited canary promotion path.",
          "Do not promote any other route class or family in the same window."
        ]
      : [
          "PAIR_PM_OPINION is already in CANARY.",
          "Continue live-window monitoring and keep the package scope locked to btc_exact_slice_only."
        ];

  const activationPlan: CryptoCanaryActivationPlanArtifact = {
    observedAt: new Date().toISOString(),
    routeClass: FIRST_CANARY_ROUTE,
    finalDecision,
    approvalState,
    currentStage: route.currentStage,
    allowedScope: {
      scopeLabel: FIRST_CANARY_SCOPE,
      family: FIRST_CANARY_FAMILY
    },
    blockedScope: EXACT_OUT_OF_SCOPE,
    evidenceRefs: decisionLineage.evidenceRefs,
    activationPath,
    monitoringSignals: [
      "expectedNetExecutionImprovement",
      "staleDataRate",
      "mixedBasisRate",
      "executionBoundaryIncidentCount",
      "replayProtectionIncidentCount",
      "reconciliationIncidentCount",
      "venueHealthFailureRate"
    ],
    abortSignals: ABORT_SIGNALS,
    remainsShadowOnly: [
      "PAIR_PM_LIMITLESS",
      "CRYPTO:ATH_BY_DATE",
      "CRYPTO:THRESHOLD_BY_DATE",
      "all sports/esports families"
    ]
  };

  const monitoringSummary: CryptoCanaryMonitoringSummaryArtifact = {
    observedAt: new Date().toISOString(),
    routeClass: FIRST_CANARY_ROUTE,
    reviewCadence: "15_MINUTE_ROLLOVER",
    checks: ACTIVATION_SIGNALS
  };

  const rollbackSummary: CryptoCanaryRollbackSummaryArtifact = {
    observedAt: new Date().toISOString(),
    routeClass: FIRST_CANARY_ROUTE,
    disableActions: [
      "Demote PAIR_PM_OPINION back to SHADOW or INTERNAL_ONLY using the audited admin path.",
      "Keep all out-of-scope crypto families blocked or shadow-only.",
      "Do not modify PAIR_PM_LIMITLESS during this rollback."
    ],
    preservedEvidence: [
      "promotion decision log",
      "pair canary readiness artifacts",
      "shadow evidence snapshots",
      "crypto final canary package artifacts"
    ],
    confirmationChecks: [
      "PAIR_PM_OPINION is no longer at CANARY stage.",
      "No broader crypto family remains promoted.",
      "PAIR_PM_LIMITLESS remains out of scope for this first live window.",
      "Decision lineage and evidence artifacts are still readable."
    ]
  };

  const finalPackageSummary: CryptoFinalCanaryPackageArtifact = {
    observedAt: new Date().toISOString(),
    routeClass: FIRST_CANARY_ROUTE,
    finalDecision,
    approvalState,
    currentStage: route.currentStage,
    nextOperatorAction: approvalState === "NOT_APPROVED"
      ? "Record operator approval intent for PAIR_PM_OPINION on btc_exact_slice_only."
      : approvalState === "APPROVED_PENDING_ACTIVATION" && route.currentStage === "INTERNAL_ONLY"
        ? "Promote PAIR_PM_OPINION to SHADOW, then re-run readiness before canary promotion."
        : approvalState === "APPROVED_PENDING_ACTIVATION"
          ? "Promote PAIR_PM_OPINION to CANARY through the audited canary promotion endpoint."
          : approvalState === "CANARY_ACTIVE"
            ? "Continue first-window monitoring and keep scope locked."
            : "Keep the package abort-ready only until a fresh approval intent is recorded.",
    successLooksLike: [
      "Only PAIR_PM_OPINION on btc_exact_slice_only is active.",
      "No blocked family or non-BTC slice is promoted.",
      "Health and evidence signals remain normal for the full live window."
    ],
    abortLooksLike: [
      "Any out-of-scope family becomes active.",
      "Runtime-health incidents or missing evidence appear in the live window.",
      "Operator cannot prove the canary remains narrow, auditable, and reversible."
    ]
  };

  const monitoringChecklist = toMarkdownChecklist("Crypto Canary Monitoring Checklist", ACTIVATION_SIGNALS);
  const rollbackChecklist = toMarkdownChecklist("Crypto Canary Rollback Checklist", [
    ...rollbackSummary.disableActions,
    ...rollbackSummary.confirmationChecks
  ]);
  const activationSummary = toActivationSummary(activationPlan, operatorApproval);
  const operatorSummary = toOperatorSummary(finalPackageSummary);

  return {
    scopeLock,
    operatorApproval,
    decisionLineage,
    activationPlan,
    activationSummary,
    monitoringChecklist,
    monitoringSummary,
    rollbackChecklist,
    rollbackSummary,
    finalPackageSummary,
    operatorSummary
  };
};

export const writeCryptoFinalCanaryPackage = async (
  repoRoot: string,
  pairRouteAdminService: Pick<PairRouteAdminService,
    | "listPairRoutes"
    | "getShadowEvidence"
    | "getCanaryReadiness"
    | "getPromotionBlockers"
    | "listPromotionDecisions"
  >
): Promise<CryptoFinalCanaryPackageArtifacts> => {
  const artifacts = await buildCryptoFinalCanaryPackage(pairRouteAdminService, repoRoot);
  mkdirSync(path.resolve(repoRoot, "docs"), { recursive: true });
  writeArtifact(repoRoot, "docs/crypto-canary-scope-lock.json", artifacts.scopeLock);
  writeArtifact(repoRoot, "docs/crypto-canary-operator-approval.json", artifacts.operatorApproval);
  writeArtifact(repoRoot, "docs/crypto-canary-decision-lineage.json", artifacts.decisionLineage);
  writeArtifact(repoRoot, "docs/crypto-canary-activation-plan.json", artifacts.activationPlan);
  writeMarkdownArtifact(repoRoot, "docs/crypto-canary-activation-summary.md", `${artifacts.activationSummary}\n`);
  writeArtifact(repoRoot, "docs/crypto-canary-monitoring-summary.json", artifacts.monitoringSummary);
  writeMarkdownArtifact(repoRoot, "docs/crypto-canary-monitoring-checklist.md", `${artifacts.monitoringChecklist}\n`);
  writeArtifact(repoRoot, "docs/crypto-canary-rollback-summary.json", artifacts.rollbackSummary);
  writeMarkdownArtifact(repoRoot, "docs/crypto-canary-rollback-checklist.md", `${artifacts.rollbackChecklist}\n`);
  writeArtifact(repoRoot, "docs/crypto-final-canary-package-summary.json", artifacts.finalPackageSummary);
  writeMarkdownArtifact(repoRoot, "docs/crypto-final-canary-operator-summary.md", `${artifacts.operatorSummary}\n`);
  return artifacts;
};
