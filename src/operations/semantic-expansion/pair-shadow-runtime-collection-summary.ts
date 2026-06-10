import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { PairRouteAdminService } from "../../api/admin/pair-route-admin-service.js";
import { writeArtifact, writeMarkdownArtifact } from "./shared.js";

export interface PairShadowRuntimeCollectionSummary {
  observedAt: string;
  routes: readonly {
    routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION" | "PAIR_PM_PREDICTFUN";
    runtimeObservationCount: number;
    runtimeExactSafeObservationCount: number;
    runtimeShadowOnlyObservationCount: number;
    bootstrapObservationCount: number;
    currentBlockers: readonly string[];
  }[];
}

const markdown = (summary: PairShadowRuntimeCollectionSummary): string => {
  const lines = [
    "# Pair Shadow Runtime Collection Summary",
    "",
    `Observed at: ${summary.observedAt}`,
    ""
  ];
  for (const route of summary.routes) {
    lines.push(`## ${route.routeClass}`);
    lines.push(`- Runtime observations: ${route.runtimeObservationCount}`);
    lines.push(`- Runtime exact-safe observations: ${route.runtimeExactSafeObservationCount}`);
    lines.push(`- Runtime shadow-only observations: ${route.runtimeShadowOnlyObservationCount}`);
    lines.push(`- Bootstrap observations: ${route.bootstrapObservationCount}`);
    lines.push(`- Current blockers: ${route.currentBlockers.join(", ") || "none"}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};

export const buildPairShadowRuntimeCollectionSummary = async (
  pairRouteAdminService: Pick<PairRouteAdminService, "listPairRoutes" | "listShadowObservations" | "getPromotionBlockers">
): Promise<PairShadowRuntimeCollectionSummary> => {
  const routes = await pairRouteAdminService.listPairRoutes();
  return {
    observedAt: new Date().toISOString(),
    routes: await Promise.all(routes.map(async (route) => {
      const observations = await pairRouteAdminService.listShadowObservations(route.routeClassId);
      const runtime = observations.filter((entry) => entry.sourceKind === "RUNTIME_OBSERVATION" && entry.metadata.verification !== true);
      return {
        routeClass: route.routeClassId,
        runtimeObservationCount: runtime.length,
        runtimeExactSafeObservationCount: runtime.filter((entry) => entry.scopeKind === "SAFE_EXACT_SUBSET").length,
        runtimeShadowOnlyObservationCount: runtime.filter((entry) => entry.scopeKind === "SHADOW_ONLY_SUBSET").length,
        bootstrapObservationCount: route.safeSubsetMarkets.length + route.runnableMarkets.length + route.blockedFamilies.length,
        currentBlockers: await pairRouteAdminService.getPromotionBlockers(route.routeClassId)
      };
    }))
  };
};

export const writePairShadowRuntimeCollectionSummary = async (
  repoRoot: string,
  pairRouteAdminService: Pick<PairRouteAdminService, "listPairRoutes" | "listShadowObservations" | "getPromotionBlockers">
): Promise<PairShadowRuntimeCollectionSummary> => {
  const summary = await buildPairShadowRuntimeCollectionSummary(pairRouteAdminService);
  mkdirSync(path.resolve(repoRoot, "docs"), { recursive: true });
  writeArtifact(repoRoot, "docs/pair-shadow-runtime-collection-summary.json", summary);
  writeMarkdownArtifact(repoRoot, "docs/pair-shadow-runtime-collection-summary.md", markdown(summary));
  return summary;
};
