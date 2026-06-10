import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { QualificationStage } from "../../core/qualification/qualification.types.js";
import {
  buildAllPairRouteQualifications,
  loadPairRouteArtifactInputs,
  type PairRouteQualification
} from "../../qualification/pair-route-qualification.js";
import { writeArtifact } from "./shared.js";

export interface PairRouteRolloutArtifact {
  observedAt: string;
  routes: readonly PairRouteQualification[];
}

export const buildPairRouteRolloutArtifact = (repoRoot: string): PairRouteRolloutArtifact => {
  const inputs = loadPairRouteArtifactInputs(repoRoot);
  const qualifications = buildAllPairRouteQualifications({
    PAIR_PM_LIMITLESS: QualificationStage.INTERNAL_ONLY,
    PAIR_PM_OPINION: QualificationStage.INTERNAL_ONLY,
    PAIR_PM_PREDICTFUN: QualificationStage.INTERNAL_ONLY
  }, inputs);
  return {
    observedAt: new Date().toISOString(),
    routes: qualifications
  };
};

const toMarkdown = (artifact: PairRouteRolloutArtifact): string => {
  const lines = [
    "# Pair Route Rollout Summary",
    "",
    `Observed at: ${artifact.observedAt}`,
    "",
    "Tri is explicitly non-blocking in this rollout layer.",
    ""
  ];

  for (const route of artifact.routes) {
    lines.push(`## ${route.routeClassId}`);
    lines.push(`- Route mode: ${route.definition.routeMode}`);
    lines.push(`- Readiness: ${route.readinessState}`);
    lines.push(`- Recommendation: ${route.recommendation}`);
    lines.push(`- Historical-only routeable markets: ${route.historicalQualification.routeableMarketCount}`);
    lines.push(`- Live-only routeable markets: ${route.liveQualification.routeableMarketCount}`);
    lines.push(`- Mixed-basis diagnostic markets: ${route.mixedBasisDiagnostic.routeableMarketCount}`);
    lines.push(`- Exact historical qualified: ${route.exactNearExactDistribution.exactHistoricalQualifiedCount}`);
    lines.push(`- Exact live only: ${route.exactNearExactDistribution.exactLiveOnlyCount}`);
    lines.push(`- Near exact: ${route.exactNearExactDistribution.nearExactCount}`);
    lines.push(`- Safe subset markets: ${route.safeSubsetMarkets.length}`);
    lines.push(`- Strong where: ${route.riskProfile.basisCleanliness}`);
    lines.push(`- Weak where: ${route.riskProfile.operationalConcerns.join("; ") || "none"}`);
    lines.push(`- Allowed first families: ${route.supportedFamilies.join(", ")}`);
    lines.push(`- Blocked families: ${route.blockedFamilies.join(", ")}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
};

export const writePairRouteRolloutArtifacts = (repoRoot: string): PairRouteRolloutArtifact => {
  const artifact = buildPairRouteRolloutArtifact(repoRoot);
  mkdirSync(path.resolve(repoRoot, "docs"), { recursive: true });
  mkdirSync(path.resolve(repoRoot, "artifacts", "shared", "optional"), { recursive: true });
  writeArtifact(repoRoot, "docs/pair-route-rollout-summary.json", artifact);
  writeFileSync(
    path.resolve(repoRoot, "artifacts/shared/optional/pair-route-rollout-evidence.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8"
  );
  writeFileSync(
    path.resolve(repoRoot, "docs/pair-route-rollout-summary.md"),
    toMarkdown(artifact),
    "utf8"
  );
  return artifact;
};
