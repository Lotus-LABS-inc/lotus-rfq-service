import { fileURLToPath } from "node:url";
import path from "node:path";

import { writePairRouteRolloutArtifacts } from "../../src/operations/semantic-expansion/pair-route-rollout-summary.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifact = writePairRouteRolloutArtifacts(repoRoot);

console.log(JSON.stringify({
  observedAt: artifact.observedAt,
  routes: artifact.routes.map((route) => ({
    routeClassId: route.routeClassId,
    readinessState: route.readinessState,
    recommendation: route.recommendation
  }))
}, null, 2));

