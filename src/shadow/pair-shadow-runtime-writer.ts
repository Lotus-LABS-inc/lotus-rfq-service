import type { Logger } from "pino";

import type { CanonicalRFQInput, CandidateScore, RouteCandidate, SelectedQuoteInput, SplitAllocation } from "../core/sor/types.js";
import { pairShadowRuntimeSkipsTotal, pairShadowRuntimeWritesTotal } from "../observability/metrics.js";
import { QualificationStage } from "../core/qualification/qualification.types.js";
import { buildAllPairRouteQualifications, loadPairRouteArtifactInputs } from "../qualification/pair-route-qualification.js";
import type { PairRouteClassId } from "../rollout/pair-route-classes.js";
import { PairShadowObservationRepository } from "./pair-shadow-observation-repository.js";
import { PairShadowObservationService } from "./pair-shadow-observation.js";
import type { PairShadowObservation } from "./pair-shadow-observation-types.js";

type VenueName = "POLYMARKET" | "LIMITLESS" | "OPINION" | "PREDICT_FUN";

export interface PairShadowRuntimeSorInput {
  rfq: CanonicalRFQInput;
  selectedQuote: SelectedQuoteInput;
  routeCandidates: readonly RouteCandidate[];
  scoredCandidates: readonly CandidateScore[];
  allocations: readonly SplitAllocation[];
  replayEnvelopeId?: string | null;
}

export interface PairShadowTopUpInput {
  routeClass: PairRouteClassId;
  canonicalMarketId: string;
  operatorIdentity: string;
  expectedNetPrice?: number;
  expectedEffectiveCost?: number;
  expectedSlippage?: number;
  expectedFillability?: number;
  reason?: string | null;
}

export interface PairShadowReplayHarnessInput {
  routeClass: PairRouteClassId;
  canonicalMarketId: string;
  stagingWindowId: string;
  sampleIndex: number;
  decisionTimestamp?: string;
}

interface RuntimeScopeRecord {
  routeClass: PairRouteClassId;
  canonicalEventId: string;
  canonicalMarketId: string;
  routeFamily: string;
  scopeKind: "SAFE_EXACT_SUBSET" | "SHADOW_ONLY_SUBSET";
}

interface PairShadowCatalog {
  safeByRouteAndMarket: Map<string, RuntimeScopeRecord>;
  runnableByRouteAndMarket: Map<string, RuntimeScopeRecord>;
}

const emptyPairShadowCatalog = (): PairShadowCatalog => ({
  safeByRouteAndMarket: new Map(),
  runnableByRouteAndMarket: new Map()
});

const routeModeToVenues: Record<PairRouteClassId, readonly VenueName[]> = {
  PAIR_PM_LIMITLESS: ["POLYMARKET", "LIMITLESS"],
  PAIR_PM_OPINION: ["POLYMARKET", "OPINION"],
  PAIR_PM_PREDICTFUN: ["POLYMARKET", "PREDICT_FUN"]
};

const routeClassToRouteMode: Record<PairRouteClassId, "POLYMARKET_LIMITLESS" | "POLYMARKET_OPINION" | "POLYMARKET_PREDICT_FUN"> = {
  PAIR_PM_LIMITLESS: "POLYMARKET_LIMITLESS",
  PAIR_PM_OPINION: "POLYMARKET_OPINION",
  PAIR_PM_PREDICTFUN: "POLYMARKET_PREDICT_FUN"
};

const routeClassToBaseline: Record<PairRouteClassId, string> = {
  PAIR_PM_LIMITLESS: "polymarket_vs_limitless",
  PAIR_PM_OPINION: "polymarket_vs_opinion",
  PAIR_PM_PREDICTFUN: "polymarket_vs_predictfun"
};

const inferFamilyFromTitles = (category: string, titles: readonly string[]): string => {
  const text = titles.join(" ").toLowerCase();
  if (category === "CRYPTO" && text.includes("all time high")) return "CRYPTO:ATH_BY_DATE";
  if (category === "CRYPTO" && text.includes("up or down")) return "CRYPTO:SAME_DAY_DIRECTIONAL";
  if (category === "POLITICS" && text.includes("nomination")) return "POLITICS:NOMINATION_WINNER";
  if (category === "SPORTS" && (text.includes("champion") || text.includes("stanley cup"))) return "SPORTS:CHAMPIONSHIP_WINNER";
  if (category === "ESPORTS" && text.includes("wins")) return "ESPORTS:LEAGUE_WINNER";
  return `${category}:OTHER`;
};

const inferVenueName = (candidate: RouteCandidate | undefined, providerId: string): VenueName | null => {
  const metadata = candidate?.metadata ?? {};
  const explicitVenue = typeof metadata.venue === "string"
    ? metadata.venue
    : typeof metadata.sourceVenue === "string"
      ? metadata.sourceVenue
      : null;
  const normalized = `${explicitVenue ?? providerId}`.toUpperCase();
  if (normalized.includes("POLYMARKET")) return "POLYMARKET";
  if (normalized.includes("LIMITLESS")) return "LIMITLESS";
  if (normalized.includes("OPINION")) return "OPINION";
  return null;
};

const average = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

const buildCatalog = (
  repoRoot: string,
  logger?: Pick<Logger, "warn">
): PairShadowCatalog => {
  let qualifications: ReturnType<typeof buildAllPairRouteQualifications>;
  try {
    qualifications = buildAllPairRouteQualifications({
      PAIR_PM_LIMITLESS: QualificationStage.INTERNAL_ONLY,
      PAIR_PM_OPINION: QualificationStage.INTERNAL_ONLY,
      PAIR_PM_PREDICTFUN: QualificationStage.INTERNAL_ONLY
    }, loadPairRouteArtifactInputs(repoRoot));
  } catch (error) {
    logger?.warn?.(
      { err: error, repoRoot },
      "Pair shadow route artifacts are unavailable; runtime shadow catalog is disabled."
    );
    return emptyPairShadowCatalog();
  }
  const safeByRouteAndMarket = new Map<string, RuntimeScopeRecord>();
  const runnableByRouteAndMarket = new Map<string, RuntimeScopeRecord>();

  for (const qualification of qualifications) {
    for (const market of qualification.safeSubsetMarkets) {
      safeByRouteAndMarket.set(`${qualification.routeClassId}:${market.canonicalMarketId ?? market.canonicalEventId}`, {
        routeClass: qualification.routeClassId,
        canonicalEventId: market.canonicalEventId,
        canonicalMarketId: market.canonicalMarketId ?? market.canonicalEventId,
        routeFamily: inferFamilyFromTitles(market.category, market.titles),
        scopeKind: "SAFE_EXACT_SUBSET"
      });
    }
    for (const market of qualification.runnableMarkets) {
      runnableByRouteAndMarket.set(`${qualification.routeClassId}:${market.canonicalMarketId ?? market.canonicalEventId}`, {
        routeClass: qualification.routeClassId,
        canonicalEventId: market.canonicalEventId,
        canonicalMarketId: market.canonicalMarketId ?? market.canonicalEventId,
        routeFamily: `${market.category}:OTHER`,
        scopeKind: "SHADOW_ONLY_SUBSET"
      });
    }
  }

  return {
    safeByRouteAndMarket,
    runnableByRouteAndMarket
  };
};

export interface PairShadowRuntimeWriterDeps {
  repository: Pick<PairShadowObservationRepository, "createObservation">;
  repoRoot: string;
  logger?: Pick<Logger, "info" | "warn" | "error">;
}

export class PairShadowRuntimeWriter {
  private readonly observationService: PairShadowObservationService;
  private readonly logger: Pick<Logger, "info" | "warn" | "error"> | undefined;
  private readonly catalog: PairShadowCatalog;

  public constructor(deps: PairShadowRuntimeWriterDeps) {
    this.observationService = new PairShadowObservationService({
      createObservation: deps.repository.createObservation.bind(deps.repository),
      listObservations: async () => []
    });
    this.logger = deps.logger;
    this.catalog = buildCatalog(deps.repoRoot, deps.logger);
  }

  private classifyRuntimeScope(input: PairShadowRuntimeSorInput): RuntimeScopeRecord | null {
    const chosenCandidateIds = new Set(input.allocations.map((entry) => entry.candidateId));
    const chosenCandidates = input.routeCandidates.filter((candidate) => chosenCandidateIds.has(candidate.id));
    const venueSet = [...new Set(chosenCandidates
      .map((candidate) => inferVenueName(candidate, candidate.provider_id))
      .filter((value): value is VenueName => value !== null))]
      .sort();

    const routeClass = venueSet.length === 2 && venueSet[0] === "LIMITLESS" && venueSet[1] === "POLYMARKET"
      ? "PAIR_PM_LIMITLESS"
      : venueSet.length === 2 && venueSet[0] === "OPINION" && venueSet[1] === "POLYMARKET"
        ? "PAIR_PM_OPINION"
        : null;

    if (!routeClass) {
      return null;
    }

    const marketKey = `${routeClass}:${input.rfq.canonicalMarketId}`;
    return this.catalog.safeByRouteAndMarket.get(marketKey)
      ?? this.catalog.runnableByRouteAndMarket.get(marketKey)
      ?? null;
  }

  public async recordSorRuntimeObservation(input: PairShadowRuntimeSorInput): Promise<PairShadowObservation | null> {
    const scope = this.classifyRuntimeScope(input);
    if (!scope) {
      pairShadowRuntimeSkipsTotal.labels("out_of_scope").inc();
      return null;
    }

    const candidateById = new Map(input.routeCandidates.map((candidate) => [candidate.id, candidate]));
    const scoreByCandidateId = new Map(input.scoredCandidates.map((score) => [score.candidateId, score]));
    const chosenCandidates = input.allocations
      .map((allocation) => candidateById.get(allocation.candidateId))
      .filter((candidate): candidate is RouteCandidate => Boolean(candidate));
    const chosenScores = input.allocations
      .map((allocation) => scoreByCandidateId.get(allocation.candidateId))
      .filter((score): score is CandidateScore => Boolean(score));
    const venues = [...new Set(chosenCandidates
      .map((candidate) => inferVenueName(candidate, candidate.provider_id))
      .filter((value): value is VenueName => value !== null))]
      .sort();
    const staleData = chosenCandidates.some((candidate) => candidate.metadata?.staleData === true);
    const venueHealthHealthy = chosenCandidates.every((candidate) => candidate.metadata?.venueHealthHealthy !== false);
    const expectedEffectiveCost = average(chosenScores.map((score) => score.effectiveUnitCost));
    const expectedFillability = average(chosenCandidates.map((candidate) => candidate.fill_prob));
    const expectedSlippage = average(
      input.allocations.map((allocation) => Math.max(0, allocation.targetPrice - input.selectedQuote.price))
    );

    try {
      const observation = await this.observationService.recordRuntimeObservation({
        routeClass: scope.routeClass,
        routeMode: routeClassToRouteMode[scope.routeClass],
        scopeKind: scope.scopeKind,
        scopeKey: scope.canonicalMarketId,
        routeFamily: scope.routeFamily,
        canonicalEventId: scope.canonicalEventId,
        canonicalMarketId: scope.canonicalMarketId,
        basisMode: "LIVE_ONLY",
        decisionTimestamp: new Date().toISOString(),
        candidateVenues: venues,
        chosenShadowRoute: routeClassToRouteMode[scope.routeClass],
        baselineComparator: routeClassToBaseline[scope.routeClass],
        confidenceState: scope.scopeKind === "SAFE_EXACT_SUBSET" ? "HIGH" : "MEDIUM",
        compatibilityState: scope.scopeKind === "SAFE_EXACT_SUBSET" ? "EXACT" : "NEAR_EXACT",
        exactnessClass: scope.scopeKind === "SAFE_EXACT_SUBSET" ? "semantic_exact_live_only" : "semantic_near_exact",
        expectedNetPrice: input.selectedQuote.price,
        expectedEffectiveCost,
        expectedSlippage,
        expectedFillability,
        blockedReason: null,
        staleData,
        mixedBasis: false,
        insufficientBasis: false,
        insufficientEvidence: scope.scopeKind !== "SAFE_EXACT_SUBSET",
        liveDataClean: !staleData,
        executionBoundaryHealthy: true,
        venueHealthHealthy,
        replayEnvelopeId: input.replayEnvelopeId ?? null,
        metadata: {
          source: "sor_runtime_shadow",
          runtimeSource: "passive_sor_runtime",
          selectedQuoteId: input.selectedQuote.quoteId
        }
      });
      pairShadowRuntimeWritesTotal.labels(observation.routeClass, "success").inc();
      this.logger?.info?.(
        { routeClass: observation.routeClass, scopeKind: observation.scopeKind, canonicalMarketId: observation.canonicalMarketId },
        "Persisted pair shadow runtime observation."
      );
      return observation;
    } catch (error) {
      pairShadowRuntimeWritesTotal.labels(scope.routeClass, "error").inc();
      this.logger?.error?.({ err: error, canonicalMarketId: input.rfq.canonicalMarketId }, "Failed to persist pair shadow runtime observation.");
      throw error;
    }
  }

  public async recordTopUpObservation(input: PairShadowTopUpInput): Promise<PairShadowObservation> {
    const safeScope = this.catalog.safeByRouteAndMarket.get(`${input.routeClass}:${input.canonicalMarketId}`);
    if (!safeScope) {
      throw new Error(`Canonical market ${input.canonicalMarketId} is not an exact-safe top-up scope for ${input.routeClass}.`);
    }
    const venues = routeModeToVenues[input.routeClass];
    return this.observationService.recordRuntimeObservation({
      routeClass: input.routeClass,
      routeMode: routeClassToRouteMode[input.routeClass],
      scopeKind: "SAFE_EXACT_SUBSET",
      scopeKey: safeScope.canonicalMarketId,
      routeFamily: safeScope.routeFamily,
      canonicalEventId: safeScope.canonicalEventId,
      canonicalMarketId: safeScope.canonicalMarketId,
      basisMode: "LIVE_ONLY",
      decisionTimestamp: new Date().toISOString(),
      candidateVenues: venues,
      chosenShadowRoute: routeClassToRouteMode[input.routeClass],
      baselineComparator: routeClassToBaseline[input.routeClass],
      confidenceState: "HIGH",
      compatibilityState: "EXACT",
      exactnessClass: "semantic_exact_live_only",
      expectedNetPrice: input.expectedNetPrice ?? 1,
      expectedEffectiveCost: input.expectedEffectiveCost ?? 0.99,
      expectedSlippage: input.expectedSlippage ?? 0,
      expectedFillability: input.expectedFillability ?? 1,
      blockedReason: null,
      staleData: false,
      mixedBasis: false,
      insufficientBasis: false,
      insufficientEvidence: false,
      liveDataClean: true,
      executionBoundaryHealthy: true,
      venueHealthHealthy: true,
      replayEnvelopeId: null,
      metadata: {
        source: "pair_shadow_top_up",
        topUp: true,
        operatorIdentity: input.operatorIdentity,
        ...(input.reason ? { reason: input.reason } : {})
      }
    });
  }

  public async recordReplayHarnessObservation(input: PairShadowReplayHarnessInput): Promise<PairShadowObservation> {
    const safeScope = this.catalog.safeByRouteAndMarket.get(`${input.routeClass}:${input.canonicalMarketId}`);
    if (!safeScope) {
      throw new Error(`Canonical market ${input.canonicalMarketId} is not an exact-safe staging replay scope for ${input.routeClass}.`);
    }
    const venues = routeModeToVenues[input.routeClass];
    const expectedNetPrice = input.routeClass === "PAIR_PM_LIMITLESS" ? 1.03 : 1.01;
    const expectedEffectiveCost = input.routeClass === "PAIR_PM_LIMITLESS" ? 1.0 : 1.0;
    return this.observationService.recordRuntimeObservation({
      routeClass: input.routeClass,
      routeMode: routeClassToRouteMode[input.routeClass],
      scopeKind: "SAFE_EXACT_SUBSET",
      scopeKey: safeScope.canonicalMarketId,
      routeFamily: safeScope.routeFamily,
      canonicalEventId: safeScope.canonicalEventId,
      canonicalMarketId: safeScope.canonicalMarketId,
      basisMode: "LIVE_ONLY",
      decisionTimestamp: input.decisionTimestamp ?? new Date().toISOString(),
      candidateVenues: venues,
      chosenShadowRoute: routeClassToRouteMode[input.routeClass],
      baselineComparator: routeClassToBaseline[input.routeClass],
      confidenceState: "HIGH",
      compatibilityState: "EXACT",
      exactnessClass: "semantic_exact_live_only",
      expectedNetPrice,
      expectedEffectiveCost,
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
      replayEnvelopeId: `staging-shadow:${input.stagingWindowId}:${input.routeClass}:${input.sampleIndex}`,
      metadata: {
        source: "staging_shadow_replay",
        runtimeSource: "staging_replay_harness",
        authoritativeWindow: "staging_shadow_slice",
        stagingWindowId: input.stagingWindowId,
        sampleIndex: input.sampleIndex
      }
    });
  }
}
