import { describe, expect, it } from "vitest";

import { QualificationStage } from "../../src/core/qualification/qualification.types.js";
import { getPairRouteClassDefinition } from "../../src/rollout/pair-route-classes.js";
import { evaluatePairCanaryReadiness } from "../../src/rollout/pair-canary-readiness-evaluator.js";
import { PairShadowAggregator } from "../../src/shadow/pair-shadow-aggregator.js";
import type { PairShadowObservation } from "../../src/shadow/pair-shadow-observation-types.js";
import type { PairRouteQualification } from "../../src/qualification/pair-route-qualification.js";

const buildQualification = (routeClassId: "PAIR_PM_LIMITLESS" | "PAIR_PM_OPINION", overrides?: Partial<PairRouteQualification>): PairRouteQualification => ({
  routeClassId,
  definition: getPairRouteClassDefinition(routeClassId),
  currentStage: QualificationStage.SHADOW,
  readinessState: "SHADOW_READY",
  historicalQualification: {
    routeableMarketCount: 1,
    eventCount: 1,
    exactHistoricalQualifiedCount: routeClassId === "PAIR_PM_LIMITLESS" ? 2 : 1,
    basisClean: true
  },
  liveQualification: {
    routeableMarketCount: routeClassId === "PAIR_PM_OPINION" ? 1 : 0,
    eventCount: 1,
    exactLiveOnlyCount: routeClassId === "PAIR_PM_OPINION" ? 1 : 0,
    basisClean: true
  },
  mixedBasisDiagnostic: {
    routeableMarketCount: 0,
    eventCount: 0
  },
  exactNearExactDistribution: {
    exactHistoricalQualifiedCount: routeClassId === "PAIR_PM_LIMITLESS" ? 2 : 0,
    exactLiveOnlyCount: routeClassId === "PAIR_PM_OPINION" ? 1 : 0,
    nearExactCount: 0,
    noCandidateCount: 0
  },
  safeSubsetMarkets: routeClassId === "PAIR_PM_LIMITLESS"
    ? [
        { category: "CRYPTO", canonicalEventId: "evt-1", canonicalMarketId: "mkt-1", titles: ["Will BTC hit an all time high by Friday?"] },
        { category: "POLITICS", canonicalEventId: "evt-2", canonicalMarketId: "mkt-2", titles: ["Will Gavin Newsom win the nomination?"] }
      ]
    : [
        { category: "CRYPTO", canonicalEventId: "btc-evt", canonicalMarketId: "btc-mkt", titles: ["Will BTC be up or down on March 21?"] }
      ],
  runnableMarkets: [],
  riskProfile: {
    basisCleanliness: "LIVE_STRONG",
    dominantBlockers: [],
    compatibilityQuality: "HIGH",
    provenanceQuality: "HIGH",
    operationalConcerns: [],
    summary: "test profile",
    recommendedReadinessCap: "CANARY_READY"
  },
  recommendation: "SHADOW",
  supportedFamilies: [],
  blockedFamilies: [],
  evidenceRefs: [],
  ...overrides
});

const buildRuntimeObservation = (input: Partial<PairShadowObservation> & Pick<PairShadowObservation, "routeClass" | "routeMode" | "scopeKind" | "scopeKey" | "routeFamily">): PairShadowObservation => ({
  id: `${input.routeClass}-${input.scopeKey}`,
  routeClass: input.routeClass,
  routeMode: input.routeMode,
  sourceKind: "RUNTIME_OBSERVATION",
  scopeKind: input.scopeKind,
  scopeKey: input.scopeKey,
  routeFamily: input.routeFamily,
  canonicalEventId: input.canonicalEventId ?? input.scopeKey,
  canonicalMarketId: input.canonicalMarketId ?? input.scopeKey,
  basisMode: input.basisMode ?? "LIVE_ONLY",
  decisionTimestamp: input.decisionTimestamp ?? "2026-03-29T10:00:00.000Z",
  candidateVenues: input.candidateVenues ?? ["POLYMARKET", "OPINION"],
  chosenShadowRoute: input.chosenShadowRoute ?? input.routeMode,
  baselineComparator: input.baselineComparator ?? "baseline",
  confidenceState: input.confidenceState ?? "HIGH",
  compatibilityState: input.compatibilityState ?? "EXACT",
  exactnessClass: input.exactnessClass ?? "semantic_exact_live_only",
  expectedNetPrice: input.expectedNetPrice ?? 1.02,
  expectedEffectiveCost: input.expectedEffectiveCost ?? 1.0,
  expectedSlippage: input.expectedSlippage ?? 0.005,
  expectedFillability: input.expectedFillability ?? 0.99,
  blockedReason: input.blockedReason ?? null,
  staleData: input.staleData ?? false,
  mixedBasis: input.mixedBasis ?? false,
  insufficientBasis: input.insufficientBasis ?? false,
  insufficientEvidence: input.insufficientEvidence ?? false,
  liveDataClean: input.liveDataClean ?? true,
  executionBoundaryHealthy: input.executionBoundaryHealthy ?? true,
  venueHealthHealthy: input.venueHealthHealthy ?? true,
  reproducibilityHash: `hash-${input.scopeKey}`,
  replayEnvelopeId: input.replayEnvelopeId ?? null,
  createdAt: input.createdAt ?? "2026-03-29T10:00:00.000Z",
  metadata: input.metadata ?? {}
});

describe("pair canary readiness", () => {
  it("keeps PAIR_PM_LIMITLESS in shadow when evidence only exists outside the exact-safe subset", async () => {
    const qualification = buildQualification("PAIR_PM_LIMITLESS", {
      safeSubsetMarkets: [],
      runnableMarkets: [
        { category: "SPORTS", canonicalEventId: "shadow-1", canonicalMarketId: "shadow-1", venues: ["POLYMARKET:1", "LIMITLESS:1"] }
      ]
    });
    const aggregator = new PairShadowAggregator(
      {
        listObservations: async () => [
          buildRuntimeObservation({
            routeClass: "PAIR_PM_LIMITLESS",
            routeMode: "POLYMARKET_LIMITLESS",
            scopeKind: "SHADOW_ONLY_SUBSET",
            scopeKey: "shadow-1",
            routeFamily: "SPORTS:CHAMPIONSHIP_WINNER",
            candidateVenues: ["POLYMARKET", "LIMITLESS"]
          })
        ]
      },
      process.cwd()
    );
    const evidence = await aggregator.buildEvidence(qualification);
    const readiness = evaluatePairCanaryReadiness("PAIR_PM_LIMITLESS", evidence);

    expect(evidence.exactSafeSubset.exactSafeObservationCount).toBe(0);
    expect(readiness.recommendation).toBe("REMAIN_SHADOW");
  });

  it("approves PAIR_PM_OPINION for operator canary action only after clean runtime exact-slice evidence", async () => {
    const qualification = buildQualification("PAIR_PM_OPINION");
    const runtimeRows = [
      buildRuntimeObservation({
        routeClass: "PAIR_PM_OPINION",
        routeMode: "POLYMARKET_OPINION",
        scopeKind: "SAFE_EXACT_SUBSET",
        scopeKey: "btc-evt-1",
        routeFamily: "CRYPTO:SAME_DAY_DIRECTIONAL",
        metadata: { runtimeSource: "staging_replay_harness", authoritativeWindow: "staging_shadow_slice" }
      }),
      buildRuntimeObservation({
        routeClass: "PAIR_PM_OPINION",
        routeMode: "POLYMARKET_OPINION",
        scopeKind: "SAFE_EXACT_SUBSET",
        scopeKey: "btc-evt-2",
        routeFamily: "CRYPTO:SAME_DAY_DIRECTIONAL",
        metadata: { runtimeSource: "staging_replay_harness", authoritativeWindow: "staging_shadow_slice" }
      }),
      buildRuntimeObservation({
        routeClass: "PAIR_PM_OPINION",
        routeMode: "POLYMARKET_OPINION",
        scopeKind: "SAFE_EXACT_SUBSET",
        scopeKey: "btc-evt-3",
        routeFamily: "CRYPTO:SAME_DAY_DIRECTIONAL",
        metadata: { runtimeSource: "staging_replay_harness", authoritativeWindow: "staging_shadow_slice" }
      })
    ];
    const aggregator = new PairShadowAggregator(
      {
        listObservations: async () => runtimeRows
      },
      process.cwd()
    );
    const evidence = await aggregator.buildEvidence(qualification);
    const readiness = evaluatePairCanaryReadiness("PAIR_PM_OPINION", evidence);

    expect(evidence.countableRuntimeExactSafeSubset.exactSafeObservationCount).toBe(3);
    expect(readiness.blockerReasons).toEqual([]);
    expect(readiness.recommendation).toBe("CANARY_APPROVED_PENDING_OPERATOR_ACTION");
  });
});
