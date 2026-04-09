import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { PairRouteAdminService } from "../../api/admin/pair-route-admin-service.js";
import { writeArtifact, writeMarkdownArtifact } from "./shared.js";

export interface PairShadowContinuePlanArtifact {
  observedAt: string;
  routes: readonly {
    routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION";
    runtimeExactSafeObservationCount: number;
    totalCountableExactSafeObservationCount: number;
    blockerMetrics: readonly {
      metric: string;
      actual: number;
      target: number;
      comparator: string;
    }[];
    blockerReasons: readonly string[];
    nextObservationTarget: string;
    nextEvidenceWindow: string;
    recommendedOperatorAction: string;
  }[];
}

const markdown = (artifact: PairShadowContinuePlanArtifact): string => {
  const lines = ["# Pair Shadow Continue Plan", "", `Observed at: ${artifact.observedAt}`, ""];
  if (artifact.routes.length === 0) {
    lines.push("No pair route classes currently require a shadow continuation plan.");
    return `${lines.join("\n")}\n`;
  }
  for (const route of artifact.routes) {
    lines.push(`## ${route.routeClass}`);
    lines.push(`- Runtime exact-safe observations: ${route.runtimeExactSafeObservationCount}`);
    lines.push(`- Total countable exact-safe observations: ${route.totalCountableExactSafeObservationCount}`);
    lines.push(`- Blocker reasons: ${route.blockerReasons.join(", ") || "none"}`);
    lines.push(`- Next observation target: ${route.nextObservationTarget}`);
    lines.push(`- Next evidence window: ${route.nextEvidenceWindow}`);
    lines.push(`- Operator action: ${route.recommendedOperatorAction}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};

export const buildPairShadowContinuePlan = async (
  pairRouteAdminService: Pick<PairRouteAdminService, "listPairRoutes" | "getCanaryReadiness" | "getShadowEvidence">
): Promise<PairShadowContinuePlanArtifact> => {
  const routes = await pairRouteAdminService.listPairRoutes();
  const blockedRoutes = await Promise.all(routes.map(async (route) => {
    const readiness = await pairRouteAdminService.getCanaryReadiness(route.routeClassId);
    const evidence = await pairRouteAdminService.getShadowEvidence(route.routeClassId);
    const failing = readiness.thresholdResults.filter((entry) => !entry.pass).map((entry) => ({
      metric: entry.metric,
      actual: entry.actual,
      target: entry.threshold,
      comparator: entry.comparator
    }));
    if (readiness.recommendation === "CANARY_APPROVED_PENDING_OPERATOR_ACTION" || readiness.recommendation === "READY_FOR_CANARY_REVIEW") {
      return null;
    }
    return {
      routeClass: route.routeClassId,
      runtimeExactSafeObservationCount: evidence.runtimeExactSafeSubset.exactSafeObservationCount,
      totalCountableExactSafeObservationCount: evidence.countableRuntimeExactSafeSubset.exactSafeObservationCount,
      blockerMetrics: failing,
      blockerReasons: readiness.blockerReasons,
      nextObservationTarget:
        route.routeClassId === "PAIR_PM_LIMITLESS"
          ? "Collect enough LIVE_ONLY exact-safe PM+Limitless observations to reach 5."
          : "Collect enough LIVE_ONLY exact BTC PM+Opinion slice observations to reach 3.",
      nextEvidenceWindow: "Next staging shadow slice window",
      recommendedOperatorAction:
        route.routeClassId === "PAIR_PM_LIMITLESS"
          ? "Remain shadow. Observe exact-safe subset and use top-up only if passive live evidence remains below sample minimum."
          : "Remain shadow. Observe exact BTC slice and do not widen beyond the proven PM+Opinion slice."
    };
  }));
  return {
    observedAt: new Date().toISOString(),
    routes: blockedRoutes.filter((route): route is NonNullable<typeof route> => route !== null)
  };
};

export const writePairShadowContinuePlan = async (
  repoRoot: string,
  pairRouteAdminService: Pick<PairRouteAdminService, "listPairRoutes" | "getCanaryReadiness" | "getShadowEvidence">
): Promise<PairShadowContinuePlanArtifact> => {
  const artifact = await buildPairShadowContinuePlan(pairRouteAdminService);
  mkdirSync(path.resolve(repoRoot, "docs"), { recursive: true });
  writeArtifact(repoRoot, "docs/pair-shadow-continue-plan.json", artifact);
  writeMarkdownArtifact(repoRoot, "docs/pair-shadow-continue-plan.md", markdown(artifact));
  return artifact;
};
