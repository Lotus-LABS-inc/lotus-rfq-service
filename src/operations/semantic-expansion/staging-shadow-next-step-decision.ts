import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { PairRouteAdminService } from "../../api/admin/pair-route-admin-service.js";
import { writeArtifact, writeMarkdownArtifact } from "./shared.js";

export interface StagingShadowNextStepDecisionArtifact {
  observedAt: string;
  routes: readonly {
    routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION" | "PAIR_PM_PREDICTFUN";
    decision:
      | "REMAIN_SHADOW__INSUFFICIENT_RUNTIME_EXACT_SAFE_EVIDENCE"
      | "READY_FOR_CANARY_REVIEW"
      | "CANARY_APPROVED_PENDING_OPERATOR_ACTION";
    runtimeExactSafeObservationCount: number;
    totalCountableExactSafeObservationCount: number;
    thresholdTarget: number;
    blockerReasons: readonly string[];
    nextAction: string;
  }[];
}

const markdown = (artifact: StagingShadowNextStepDecisionArtifact): string => {
  const lines = ["# Staging Shadow Next-Step Decision", "", `Observed at: ${artifact.observedAt}`, ""];
  for (const route of artifact.routes) {
    lines.push(`## ${route.routeClass}`);
    lines.push(`- Decision: ${route.decision}`);
    lines.push(`- Runtime exact-safe observations: ${route.runtimeExactSafeObservationCount}`);
    lines.push(`- Total countable exact-safe observations: ${route.totalCountableExactSafeObservationCount}`);
    lines.push(`- Threshold target: ${route.thresholdTarget}`);
    lines.push(`- Blockers: ${route.blockerReasons.join(", ") || "none"}`);
    lines.push(`- Next action: ${route.nextAction}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};

export const buildStagingShadowNextStepDecisionArtifact = async (
  pairRouteAdminService: Pick<PairRouteAdminService, "listPairRoutes" | "getCanaryReadiness" | "getShadowEvidence">
): Promise<StagingShadowNextStepDecisionArtifact> => {
  const routes = await pairRouteAdminService.listPairRoutes();
  return {
    observedAt: new Date().toISOString(),
    routes: await Promise.all(routes.map(async (route) => {
      const readiness = await pairRouteAdminService.getCanaryReadiness(route.routeClassId);
      const evidence = await pairRouteAdminService.getShadowEvidence(route.routeClassId);
      const thresholdTarget =
        readiness.thresholdResults.find((entry) => entry.metric === "minimumExactSafeObservations")?.threshold ?? 0;
      const decision =
        readiness.recommendation === "CANARY_APPROVED_PENDING_OPERATOR_ACTION"
          ? "CANARY_APPROVED_PENDING_OPERATOR_ACTION"
          : readiness.recommendation === "READY_FOR_CANARY_REVIEW"
            ? "READY_FOR_CANARY_REVIEW"
            : "REMAIN_SHADOW__INSUFFICIENT_RUNTIME_EXACT_SAFE_EVIDENCE";
      return {
        routeClass: route.routeClassId,
        decision,
        runtimeExactSafeObservationCount: evidence.runtimeExactSafeSubset.exactSafeObservationCount,
        totalCountableExactSafeObservationCount: evidence.countableRuntimeExactSafeSubset.exactSafeObservationCount,
        thresholdTarget,
        blockerReasons: readiness.blockerReasons,
        nextAction:
          decision === "CANARY_APPROVED_PENDING_OPERATOR_ACTION"
            ? "Prepare the narrow canary launch plan and require ADMIN+2FA promotion."
            : route.routeClassId === "PAIR_PM_LIMITLESS"
              ? "Remain shadow and collect more LIVE_ONLY exact-safe PM+Limitless staging observations."
              : "Remain shadow and collect more LIVE_ONLY exact BTC PM+Opinion staging observations."
      };
    }))
  };
};

export const writeStagingShadowNextStepDecisionArtifact = async (
  repoRoot: string,
  pairRouteAdminService: Pick<PairRouteAdminService, "listPairRoutes" | "getCanaryReadiness" | "getShadowEvidence">
): Promise<StagingShadowNextStepDecisionArtifact> => {
  const artifact = await buildStagingShadowNextStepDecisionArtifact(pairRouteAdminService);
  mkdirSync(path.resolve(repoRoot, "docs"), { recursive: true });
  writeArtifact(repoRoot, "docs/staging-shadow-next-step-decision.json", artifact);
  writeMarkdownArtifact(repoRoot, "docs/staging-shadow-next-step-decision.md", markdown(artifact));
  return artifact;
};
