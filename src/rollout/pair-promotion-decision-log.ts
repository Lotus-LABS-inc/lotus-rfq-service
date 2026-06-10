import type { PairCanaryReadiness } from "./pair-canary-readiness-evaluator.js";
import type { PairRouteShadowEvidence } from "../shadow/pair-shadow-metrics.js";
import type { PairPromotionDecisionRepository } from "./pair-promotion-decision-repository.js";

export class PairPromotionDecisionLog {
  public constructor(private readonly repository: PairPromotionDecisionRepository) {}

  public async record(input: {
    routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION" | "PAIR_PM_PREDICTFUN";
    scopePromoted: string;
    evidence: PairRouteShadowEvidence;
    canaryReadiness: PairCanaryReadiness;
    operatorIdentity: string;
    previousRolloutState: string;
    newRolloutState: string;
    rollbackReference: string | null;
    metadata?: Record<string, unknown>;
  }) {
    return this.repository.create({
      routeClass: input.routeClass,
      scopePromoted: input.scopePromoted,
      evidenceWindowStart: input.evidence.window.windowStart,
      evidenceWindowEnd: input.evidence.window.windowEnd,
      metricsSnapshot: input.evidence as unknown as Record<string, unknown>,
      thresholdsEvaluated: {
        thresholds: input.canaryReadiness.thresholds,
        thresholdResults: input.canaryReadiness.thresholdResults,
        blockerReasons: input.canaryReadiness.blockerReasons
      },
      pass: input.canaryReadiness.recommendation === "CANARY_APPROVED_PENDING_OPERATOR_ACTION",
      operatorIdentity: input.operatorIdentity,
      previousRolloutState: input.previousRolloutState,
      newRolloutState: input.newRolloutState,
      rollbackReference: input.rollbackReference,
      metadata: input.metadata ?? {}
    });
  }
}
