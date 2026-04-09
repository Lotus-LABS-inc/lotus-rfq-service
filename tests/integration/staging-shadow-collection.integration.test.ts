import { describe, expect, it } from "vitest";

import { buildStagingShadowRuntimeCollectionArtifact } from "../../src/operations/semantic-expansion/staging-shadow-runtime-collection.js";
import { buildStagingShadowObservationQualityArtifact } from "../../src/operations/semantic-expansion/staging-shadow-observation-quality-summary.js";
import { PairShadowStagingReplayDriver } from "../../src/shadow/pair-shadow-staging-replay-driver.js";

describe("staging shadow collection", () => {
  it("persists runtime observations through the staging replay harness and classifies them", async () => {
    const created: any[] = [];
    const driver = new PairShadowStagingReplayDriver({
      recordReplayHarnessObservation: async (input) => {
        const observation = {
          id: `obs-${created.length + 1}`,
          routeClass: input.routeClass,
          routeMode: input.routeClass === "PAIR_PM_LIMITLESS" ? "POLYMARKET_LIMITLESS" : "POLYMARKET_OPINION",
          sourceKind: "RUNTIME_OBSERVATION",
          scopeKind: "SAFE_EXACT_SUBSET",
          scopeKey: input.canonicalMarketId,
          routeFamily: input.routeClass === "PAIR_PM_LIMITLESS" ? "CRYPTO:ATH_BY_DATE" : "CRYPTO:SAME_DAY_DIRECTIONAL",
          canonicalEventId: input.canonicalMarketId,
          canonicalMarketId: input.canonicalMarketId,
          basisMode: "LIVE_ONLY",
          decisionTimestamp: "2026-03-30T12:00:00.000Z",
          candidateVenues: input.routeClass === "PAIR_PM_LIMITLESS" ? ["POLYMARKET", "LIMITLESS"] : ["POLYMARKET", "OPINION"],
          chosenShadowRoute: input.routeClass === "PAIR_PM_LIMITLESS" ? "POLYMARKET_LIMITLESS" : "POLYMARKET_OPINION",
          baselineComparator: "baseline",
          confidenceState: "HIGH",
          compatibilityState: "EXACT",
          exactnessClass: "semantic_exact_live_only",
          expectedNetPrice: 1.02,
          expectedEffectiveCost: 1,
          expectedSlippage: 0,
          expectedFillability: 1,
          blockedReason: null,
          staleData: false,
          mixedBasis: false,
          insufficientBasis: false,
          insufficientEvidence: false,
          liveDataClean: true,
          executionBoundaryHealthy: true,
          venueHealthHealthy: true,
          reproducibilityHash: `hash-${created.length + 1}`,
          replayEnvelopeId: `replay-${created.length + 1}`,
          createdAt: "2026-03-30T12:00:00.000Z",
          metadata: {
            runtimeSource: "staging_replay_harness",
            authoritativeWindow: "staging_shadow_slice"
          }
        };
        created.push(observation);
        return observation as never;
      }
    });

    await driver.run({
      observedAt: "2026-03-30T12:00:00.000Z",
      environment: "staging",
      authoritativePersistenceTarget: "SUPABASE_DB_URL",
      harnessSource: "staging_replay_harness",
      evidenceWindowStart: "2026-03-30T12:00:00.000Z",
      evidenceWindowEnd: "2026-03-30T12:15:00.000Z",
      routes: [
        {
          routeClass: "PAIR_PM_LIMITLESS",
          routeMode: "POLYMARKET_LIMITLESS",
          canaryCountableScopeKeys: ["mkt-1", "mkt-2"],
          shadowObservableScopeKeys: [],
          blockedScopes: [],
          sampleTarget: 5
        },
        {
          routeClass: "PAIR_PM_OPINION",
          routeMode: "POLYMARKET_OPINION",
          canaryCountableScopeKeys: ["btc-mkt"],
          shadowObservableScopeKeys: [],
          blockedScopes: [],
          sampleTarget: 3
        }
      ]
    });

    const adminService = {
      listPairRoutes: async () => [
        { routeClassId: "PAIR_PM_LIMITLESS" },
        { routeClassId: "PAIR_PM_OPINION" }
      ],
      listShadowObservations: async (routeClass: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION") =>
        created.filter((entry) => entry.routeClass === routeClass)
    };

    const collection = await buildStagingShadowRuntimeCollectionArtifact(adminService as never);
    const quality = await buildStagingShadowObservationQualityArtifact(adminService as never);

    expect(collection.routes.find((entry) => entry.routeClass === "PAIR_PM_LIMITLESS")?.canaryEligibleExactSafeRuntimeObservations).toBe(5);
    expect(collection.routes.find((entry) => entry.routeClass === "PAIR_PM_OPINION")?.canaryEligibleExactSafeRuntimeObservations).toBe(3);
    expect(quality.routes.find((entry) => entry.routeClass === "PAIR_PM_OPINION")?.counts.CANARY_COUNTABLE).toBe(3);
  });
});
