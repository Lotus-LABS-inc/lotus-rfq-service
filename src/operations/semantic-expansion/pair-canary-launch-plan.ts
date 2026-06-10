import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { PairRouteAdminService } from "../../api/admin/pair-route-admin-service.js";
import { writeArtifact, writeMarkdownArtifact } from "./shared.js";

export interface PairCanaryLaunchPlanArtifact {
  observedAt: string;
  eligibleRoutes: readonly {
    routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION" | "PAIR_PM_PREDICTFUN";
    scopePromoted: string;
    allowedFamilies: readonly string[];
    blockedFamilies: readonly string[];
    rolloutStrategy: {
      trafficSlice: string;
      rollbackTriggers: readonly string[];
      healthWatchMetrics: readonly string[];
      operatorApproval: "ADMIN_PLUS_2FA_REQUIRED";
    };
  }[];
}

const markdown = (artifact: PairCanaryLaunchPlanArtifact): string => {
  const lines = ["# Pair Canary Launch Plan", "", `Observed at: ${artifact.observedAt}`, ""];
  if (artifact.eligibleRoutes.length === 0) {
    lines.push("No route classes are currently eligible for canary launch.");
    return `${lines.join("\n")}\n`;
  }
  for (const route of artifact.eligibleRoutes) {
    lines.push(`## ${route.routeClass}`);
    lines.push(`- Scope promoted: ${route.scopePromoted}`);
    lines.push(`- Allowed families: ${route.allowedFamilies.join(", ")}`);
    lines.push(`- Blocked families: ${route.blockedFamilies.join(", ")}`);
    lines.push(`- Traffic slice: ${route.rolloutStrategy.trafficSlice}`);
    lines.push(`- Rollback triggers: ${route.rolloutStrategy.rollbackTriggers.join(", ")}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};

export const buildPairCanaryLaunchPlan = async (
  pairRouteAdminService: Pick<PairRouteAdminService, "listPairRoutes" | "getCanaryReadiness">
): Promise<PairCanaryLaunchPlanArtifact> => {
  const routes = await pairRouteAdminService.listPairRoutes();
  const eligibleRoutes = [];
  for (const route of routes) {
    const readiness = await pairRouteAdminService.getCanaryReadiness(route.routeClassId);
    if (readiness.recommendation !== "CANARY_APPROVED_PENDING_OPERATOR_ACTION") {
      continue;
    }
    eligibleRoutes.push({
      routeClass: route.routeClassId,
      scopePromoted: route.routeClassId === "PAIR_PM_LIMITLESS" ? "safe_exact_subset_only" : "btc_exact_slice_only",
      allowedFamilies: route.definition.canaryAllowedFamilies,
      blockedFamilies: route.blockedFamilies,
      rolloutStrategy: {
        trafficSlice: "staging-shadow-slice:1%",
        rollbackTriggers: [
          "any execution-boundary incident",
          "any replay-protection incident",
          "venue health degradation",
          "mixed-basis evidence detected"
        ],
        healthWatchMetrics: [
          "expectedNetExecutionImprovement",
          "staleDataRate",
          "mixedBasisRate",
          "venueHealthFailureRate"
        ],
        operatorApproval: "ADMIN_PLUS_2FA_REQUIRED" as const
      }
    });
  }
  return {
    observedAt: new Date().toISOString(),
    eligibleRoutes
  };
};

export const writePairCanaryLaunchPlan = async (
  repoRoot: string,
  pairRouteAdminService: Pick<PairRouteAdminService, "listPairRoutes" | "getCanaryReadiness">
): Promise<PairCanaryLaunchPlanArtifact> => {
  const artifact = await buildPairCanaryLaunchPlan(pairRouteAdminService);
  mkdirSync(path.resolve(repoRoot, "docs"), { recursive: true });
  writeArtifact(repoRoot, "docs/pair-canary-launch-plan.json", artifact);
  writeMarkdownArtifact(repoRoot, "docs/pair-canary-launch-plan.md", markdown(artifact));
  return artifact;
};
