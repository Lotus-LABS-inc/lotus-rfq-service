import { describe, expect, it } from "vitest";

import { buildCryptoFinalCanaryPackage } from "../../src/reports/crypto-final-canary-package.js";

const buildAdminService = (input?: {
  readinessDecision?: "READY_FOR_CANARY_PENDING_OPERATOR_ACTION" | "BLOCKED_BY_RUNTIME_HEALTH";
  currentStage?: "INTERNAL_ONLY" | "SHADOW" | "CANARY";
  decisions?: readonly {
    id: string;
    routeClass: "PAIR_PM_OPINION";
    scopePromoted: string;
    operatorIdentity: string;
    createdAt: string;
    newRolloutState: string;
    metadata: Record<string, unknown>;
  }[];
  allowedFamilies?: readonly string[];
}) => ({
  listPairRoutes: async () => [],
  getShadowEvidence: async () => ({}),
  getCanaryReadiness: async () => ({
    recommendation: "CANARY_APPROVED_PENDING_OPERATOR_ACTION",
    thresholdResults: input?.readinessDecision === "BLOCKED_BY_RUNTIME_HEALTH"
      ? [
          {
            metric: "maximumExecutionBoundaryIncidentCount",
            comparator: "<=",
            threshold: 0,
            actual: 1,
            pass: false
          }
        ]
      : [],
    blockerReasons: input?.readinessDecision === "BLOCKED_BY_RUNTIME_HEALTH" ? ["execution_boundary_incident"] : []
  }),
  getPromotionBlockers: async () => [],
  listPromotionDecisions: async () => input?.decisions ?? []
} as const);

describe("crypto final canary package", () => {
  it("builds a package that stays locked to the PAIR_PM_OPINION btc exact slice", async () => {
    const artifacts = await buildCryptoFinalCanaryPackage({
      ...buildAdminService(),
      listPairRoutes: async () => [
        {
          routeClassId: "PAIR_PM_OPINION",
          currentStage: "INTERNAL_ONLY",
          definition: {
            allowedCategories: ["CRYPTO"],
            routeMode: "POLYMARKET_OPINION",
            canaryAllowedFamilies: ["CRYPTO:SAME_DAY_DIRECTIONAL"]
          },
          blockedFamilies: ["CRYPTO:ATH_BY_DATE"],
          readinessState: "CANARY_READY",
          recommendation: "CANARY"
        }
      ]
    } as never);

    expect(artifacts.scopeLock.scopeDecision).toBe("LOCKED");
    expect(artifacts.scopeLock.allowedFamilies).toEqual(["CRYPTO:SAME_DAY_DIRECTIONAL"]);
    expect(artifacts.finalPackageSummary.finalDecision).toBe("CANARY_PACKAGE_READY_PENDING_APPROVAL");
    expect(artifacts.finalPackageSummary.nextOperatorAction).toContain("Record operator approval intent");
  });

  it("moves to pending activation once approval intent exists without activating the canary", async () => {
    const artifacts = await buildCryptoFinalCanaryPackage({
      ...buildAdminService({
        decisions: [
          {
            id: "decision-1",
            routeClass: "PAIR_PM_OPINION",
            scopePromoted: "btc_exact_slice_only",
            operatorIdentity: "admin-user",
            createdAt: "2026-04-02T12:00:00.000Z",
            newRolloutState: "INTERNAL_ONLY",
            metadata: {
              actionKind: "OPERATOR_APPROVAL_INTENT",
              packageKind: "FIRST_LIVE_CRYPTO_CANARY"
            }
          }
        ]
      }),
      listPairRoutes: async () => [
        {
          routeClassId: "PAIR_PM_OPINION",
          currentStage: "INTERNAL_ONLY",
          definition: {
            allowedCategories: ["CRYPTO"],
            routeMode: "POLYMARKET_OPINION",
            canaryAllowedFamilies: ["CRYPTO:SAME_DAY_DIRECTIONAL"]
          },
          blockedFamilies: ["CRYPTO:ATH_BY_DATE"],
          readinessState: "CANARY_READY",
          recommendation: "CANARY"
        }
      ]
    } as never);

    expect(artifacts.operatorApproval.approvalState).toBe("APPROVED_PENDING_ACTIVATION");
    expect(artifacts.finalPackageSummary.finalDecision).toBe("CANARY_PACKAGE_READY_PENDING_ACTIVATION");
    expect(artifacts.activationPlan.activationPath[0]).toContain("Record operator approval intent");
  });

  it("blocks the package when runtime health is not ready", async () => {
    const artifacts = await buildCryptoFinalCanaryPackage({
      ...buildAdminService({
        readinessDecision: "BLOCKED_BY_RUNTIME_HEALTH"
      }),
      listPairRoutes: async () => [
        {
          routeClassId: "PAIR_PM_OPINION",
          currentStage: "SHADOW",
          definition: {
            allowedCategories: ["CRYPTO"],
            routeMode: "POLYMARKET_OPINION",
            canaryAllowedFamilies: ["CRYPTO:SAME_DAY_DIRECTIONAL"]
          },
          blockedFamilies: ["CRYPTO:ATH_BY_DATE"],
          readinessState: "CANARY_READY",
          recommendation: "CANARY"
        }
      ]
    } as never);

    expect(artifacts.finalPackageSummary.finalDecision).toBe("CANARY_PACKAGE_BLOCKED_BY_RUNTIME_HEALTH");
  });
});
