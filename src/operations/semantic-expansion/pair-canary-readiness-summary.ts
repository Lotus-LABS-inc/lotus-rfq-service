import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { PairRouteAdminService } from "../../api/admin/pair-route-admin-service.js";
import { writeArtifact, writeMarkdownArtifact } from "./shared.js";

export interface PairCanaryReadinessArtifact {
  observedAt: string;
  routes: readonly {
    routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION";
    currentStage: string;
    shadowEvidence: Awaited<ReturnType<PairRouteAdminService["getShadowEvidence"]>>;
    canaryReadiness: Awaited<ReturnType<PairRouteAdminService["getCanaryReadiness"]>>;
    blockers: readonly string[];
  }[];
}

const checklistMarkdown = (artifact: PairCanaryReadinessArtifact): string => {
  const lines = [
    "# Pair-First Production Checklist",
    "",
    "## Global",
    "",
    "- [x] Route class definition complete",
    "- [x] Basis-aware qualification complete",
    "- [x] Pair-route rollout evidence generated",
    "- [x] Class-based gating added",
    "- [x] Admin visibility and audited controls added",
    "- [x] Runbook written",
    "- [x] Tri removed as a rollout dependency",
    ""
  ];

  for (const route of artifact.routes) {
    lines.push(`## \`${route.routeClass}\``);
    lines.push("");
    lines.push(`- current rollout state: \`${route.currentStage}\``);
    lines.push(`- shadow evidence window: \`${route.shadowEvidence.window.windowStart}\` -> \`${route.shadowEvidence.window.windowEnd}\``);
    lines.push(`- live evidence sufficient for canary: \`${route.canaryReadiness.thresholdResults.every((entry) => entry.pass)}\``);
    lines.push(`- canary eligibility approved: \`${route.canaryReadiness.recommendation === "CANARY_APPROVED_PENDING_OPERATOR_ACTION"}\``);
    lines.push(`- canary recommendation: \`${route.canaryReadiness.recommendation}\``);
    lines.push(`- blocker reasons: ${route.blockers.length > 0 ? route.blockers.join(", ") : "none"}`);
    lines.push(`- bootstrap exact-safe observations: ${route.shadowEvidence.exactSafeSubset.exactSafeObservationCount - route.shadowEvidence.runtimeExactSafeSubset.exactSafeObservationCount}`);
    lines.push(`- runtime exact-safe observations: ${route.shadowEvidence.runtimeExactSafeSubset.exactSafeObservationCount}`);
    lines.push(`- total countable exact-safe observations: ${route.shadowEvidence.countableRuntimeExactSafeSubset.exactSafeObservationCount}`);
    lines.push(`- runtime observations: ${route.shadowEvidence.sourceBreakdown.RUNTIME_OBSERVATION}`);
    lines.push(`- mixed-basis rate: ${route.shadowEvidence.countableRuntimeExactSafeSubset.mixedBasisRate}`);
    lines.push(`- stale-data rate: ${route.shadowEvidence.countableRuntimeExactSafeSubset.staleDataRate}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
};

const readinessMarkdown = (artifact: PairCanaryReadinessArtifact): string => {
  const lines = [
    "# Pair Canary Readiness Summary",
    "",
    `Observed at: ${artifact.observedAt}`,
    ""
  ];
  for (const route of artifact.routes) {
    lines.push(`## ${route.routeClass}`);
    lines.push(`- Current stage: ${route.currentStage}`);
    lines.push(`- Recommendation: ${route.canaryReadiness.recommendation}`);
    lines.push(`- Bootstrap exact-safe observations: ${route.shadowEvidence.exactSafeSubset.exactSafeObservationCount - route.shadowEvidence.runtimeExactSafeSubset.exactSafeObservationCount}`);
    lines.push(`- Runtime exact-safe observations: ${route.shadowEvidence.runtimeExactSafeSubset.exactSafeObservationCount}`);
    lines.push(`- Countable exact-safe observations: ${route.shadowEvidence.countableRuntimeExactSafeSubset.exactSafeObservationCount}`);
    lines.push(`- Runtime observations: ${route.shadowEvidence.sourceBreakdown.RUNTIME_OBSERVATION}`);
    lines.push(`- Blockers: ${route.blockers.length > 0 ? route.blockers.join(", ") : "none"}`);
    lines.push("");
    lines.push("| Threshold | Pass | Actual | Target |");
    lines.push("|---|---:|---:|---:|");
    for (const threshold of route.canaryReadiness.thresholdResults) {
      lines.push(`| ${threshold.metric} | ${threshold.pass ? "yes" : "no"} | ${threshold.actual} | ${threshold.comparator} ${threshold.threshold} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};

export const buildPairCanaryReadinessArtifact = async (
  pairRouteAdminService: Pick<PairRouteAdminService, "listPairRoutes" | "getShadowEvidence" | "getCanaryReadiness" | "getPromotionBlockers">
): Promise<PairCanaryReadinessArtifact> => {
  const routes = await pairRouteAdminService.listPairRoutes();
  const summaries = await Promise.all(routes.map(async (route) => ({
    routeClass: route.routeClassId,
    currentStage: route.currentStage,
    shadowEvidence: await pairRouteAdminService.getShadowEvidence(route.routeClassId),
    canaryReadiness: await pairRouteAdminService.getCanaryReadiness(route.routeClassId),
    blockers: await pairRouteAdminService.getPromotionBlockers(route.routeClassId)
  })));

  return {
    observedAt: new Date().toISOString(),
    routes: summaries
  };
};

export const writePairCanaryReadinessArtifacts = async (
  repoRoot: string,
  pairRouteAdminService: Pick<PairRouteAdminService, "listPairRoutes" | "getShadowEvidence" | "getCanaryReadiness" | "getPromotionBlockers">
): Promise<PairCanaryReadinessArtifact> => {
  const artifact = await buildPairCanaryReadinessArtifact(pairRouteAdminService);
  mkdirSync(path.resolve(repoRoot, "docs"), { recursive: true });
  mkdirSync(path.resolve(repoRoot, "docs/delivery"), { recursive: true });
  writeArtifact(repoRoot, "docs/pair-shadow-evidence-summary.json", artifact.routes.map((route) => ({
    routeClass: route.routeClass,
    currentStage: route.currentStage,
    shadowEvidence: route.shadowEvidence
  })));
  writeArtifact(repoRoot, "docs/pair-canary-readiness-summary.json", artifact);
  writeMarkdownArtifact(repoRoot, "docs/pair-canary-readiness-summary.md", readinessMarkdown(artifact));
  writeFileSync(path.resolve(repoRoot, "docs/delivery/pair-first-production-checklist.md"), checklistMarkdown(artifact), "utf8");
  return artifact;
};
