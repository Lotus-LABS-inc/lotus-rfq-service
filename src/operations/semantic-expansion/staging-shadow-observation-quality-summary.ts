import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { PairRouteAdminService } from "../../api/admin/pair-route-admin-service.js";
import { classifyPairShadowObservationQuality, type PairShadowObservationQuality } from "../../shadow/pair-shadow-quality.js";
import { writeArtifact, writeMarkdownArtifact } from "./shared.js";

export interface StagingShadowObservationQualityArtifact {
  observedAt: string;
  routes: readonly {
    routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION";
    counts: Record<PairShadowObservationQuality, number>;
  }[];
}

const markdown = (artifact: StagingShadowObservationQualityArtifact): string => {
  const lines = ["# Staging Shadow Observation Quality Summary", "", `Observed at: ${artifact.observedAt}`, ""];
  for (const route of artifact.routes) {
    lines.push(`## ${route.routeClass}`);
    for (const [classification, count] of Object.entries(route.counts)) {
      lines.push(`- ${classification}: ${count}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};

const zeroCounts = (): Record<PairShadowObservationQuality, number> => ({
  CANARY_COUNTABLE: 0,
  SHADOW_ONLY_NOT_COUNTABLE: 0,
  MIXED_BASIS_REJECTED: 0,
  STALE_REJECTED: 0,
  OUT_OF_SCOPE_REJECTED: 0,
  POLICY_BLOCKED: 0
});

export const buildStagingShadowObservationQualityArtifact = async (
  pairRouteAdminService: Pick<PairRouteAdminService, "listPairRoutes" | "listShadowObservations">
): Promise<StagingShadowObservationQualityArtifact> => {
  const routes = await pairRouteAdminService.listPairRoutes();
  return {
    observedAt: new Date().toISOString(),
    routes: await Promise.all(routes.map(async (route) => {
      const counts = zeroCounts();
      const runtime = (await pairRouteAdminService.listShadowObservations(route.routeClassId))
        .filter((entry) => entry.sourceKind === "RUNTIME_OBSERVATION" && entry.metadata.verification !== true);
      for (const observation of runtime) {
        counts[classifyPairShadowObservationQuality(observation)] += 1;
      }
      return {
        routeClass: route.routeClassId,
        counts
      };
    }))
  };
};

export const writeStagingShadowObservationQualityArtifact = async (
  repoRoot: string,
  pairRouteAdminService: Pick<PairRouteAdminService, "listPairRoutes" | "listShadowObservations">
): Promise<StagingShadowObservationQualityArtifact> => {
  const artifact = await buildStagingShadowObservationQualityArtifact(pairRouteAdminService);
  mkdirSync(path.resolve(repoRoot, "docs"), { recursive: true });
  writeArtifact(repoRoot, "docs/staging-shadow-observation-quality-summary.json", artifact);
  writeMarkdownArtifact(repoRoot, "docs/staging-shadow-observation-quality-summary.md", markdown(artifact));
  return artifact;
};
