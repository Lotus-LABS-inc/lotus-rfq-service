import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { PairRouteAdminService } from "../../api/admin/pair-route-admin-service.js";
import { classifyPairShadowObservationQuality } from "../../shadow/pair-shadow-quality.js";
import { writeArtifact, writeMarkdownArtifact } from "./shared.js";

export interface StagingShadowRuntimeCollectionArtifact {
  observedAt: string;
  routes: readonly {
    routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION" | "PAIR_PM_PREDICTFUN";
    totalRuntimeObservations: number;
    canaryEligibleExactSafeRuntimeObservations: number;
    outOfScopeRuntimeObservations: number;
    mixedBasisRuntimeObservations: number;
    staleRuntimeObservations: number;
    shadowOnlyRuntimeObservations: number;
  }[];
}

const markdown = (artifact: StagingShadowRuntimeCollectionArtifact): string => {
  const lines = ["# Staging Shadow Runtime Collection", "", `Observed at: ${artifact.observedAt}`, ""];
  for (const route of artifact.routes) {
    lines.push(`## ${route.routeClass}`);
    lines.push(`- Total runtime observations: ${route.totalRuntimeObservations}`);
    lines.push(`- Canary-eligible exact-safe runtime observations: ${route.canaryEligibleExactSafeRuntimeObservations}`);
    lines.push(`- Shadow-only runtime observations: ${route.shadowOnlyRuntimeObservations}`);
    lines.push(`- Mixed-basis runtime observations: ${route.mixedBasisRuntimeObservations}`);
    lines.push(`- Stale runtime observations: ${route.staleRuntimeObservations}`);
    lines.push(`- Out-of-scope runtime observations: ${route.outOfScopeRuntimeObservations}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};

export const buildStagingShadowRuntimeCollectionArtifact = async (
  pairRouteAdminService: Pick<PairRouteAdminService, "listPairRoutes" | "listShadowObservations">
): Promise<StagingShadowRuntimeCollectionArtifact> => {
  const routes = await pairRouteAdminService.listPairRoutes();
  return {
    observedAt: new Date().toISOString(),
    routes: await Promise.all(routes.map(async (route) => {
      const runtimeObservations = (await pairRouteAdminService.listShadowObservations(route.routeClassId))
        .filter((entry) => entry.sourceKind === "RUNTIME_OBSERVATION" && entry.metadata.verification !== true);
      return {
        routeClass: route.routeClassId,
        totalRuntimeObservations: runtimeObservations.length,
        canaryEligibleExactSafeRuntimeObservations: runtimeObservations.filter(
          (entry) => classifyPairShadowObservationQuality(entry) === "CANARY_COUNTABLE"
        ).length,
        outOfScopeRuntimeObservations: runtimeObservations.filter(
          (entry) => classifyPairShadowObservationQuality(entry) === "OUT_OF_SCOPE_REJECTED"
        ).length,
        mixedBasisRuntimeObservations: runtimeObservations.filter(
          (entry) => classifyPairShadowObservationQuality(entry) === "MIXED_BASIS_REJECTED"
        ).length,
        staleRuntimeObservations: runtimeObservations.filter(
          (entry) => classifyPairShadowObservationQuality(entry) === "STALE_REJECTED"
        ).length,
        shadowOnlyRuntimeObservations: runtimeObservations.filter(
          (entry) => classifyPairShadowObservationQuality(entry) === "SHADOW_ONLY_NOT_COUNTABLE"
        ).length
      };
    }))
  };
};

export const writeStagingShadowRuntimeCollectionArtifact = async (
  repoRoot: string,
  pairRouteAdminService: Pick<PairRouteAdminService, "listPairRoutes" | "listShadowObservations">
): Promise<StagingShadowRuntimeCollectionArtifact> => {
  const artifact = await buildStagingShadowRuntimeCollectionArtifact(pairRouteAdminService);
  mkdirSync(path.resolve(repoRoot, "docs"), { recursive: true });
  writeArtifact(repoRoot, "docs/staging-shadow-runtime-collection.json", artifact);
  writeMarkdownArtifact(repoRoot, "docs/staging-shadow-runtime-collection.md", markdown(artifact));
  return artifact;
};
