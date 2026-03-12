import {
  type CanonicalRFQInput,
  type CandidateScore,
  type ExecutionPlan,
  type ICostModel,
  type IOrderRouter,
  type IPlanComposer,
  type IRouteScout,
  type ISplitter,
  LiquiditySource,
  type OrderRouterBuildResult,
  type SORAcceptancePolicy,
  type SelectedQuoteInput,
  type SplitAllocation
} from "./types.js";
import { InsufficientLiquidityError } from "./splitter.js";
import { withSpan } from "../../observability/tracing.js";
import {
  internalCrossKillSwitchTotal,
  internalCrossingFilledSizeTotal,
  internalCrossingTotal,
  internalCrossShadowDivergenceTotal,
  internalCrossShadowMatchTotal,
  internalCrossShadowTotal,
  sorAvgSplitsPerLeg,
  sorCandidatesEvaluatedCount,
  sorInternalCrossResultTotal,
  sorPlanBuildLatencyMs
} from "../../observability/metrics.js";
import type { InternalCrossPreviewResult, InternalCrossingEngine } from "../internal-engine/engine.js";
import type { InternalOrder } from "../internal-engine/types.js";
import type { IResolutionRiskReadService } from "../rfq-engine/resolution-risk-read-service.js";
import type { IResolutionRiskPolicyService } from "../rfq-engine/resolution-risk-policy-service.js";
import type { IReplayDecisionCaptureService } from "../replay/replay-decision-capture-service.js";
import type { ReplayCaptureConfig, ReplaySplitEligibilitySnapshot } from "../replay/replay.types.js";
import { SORSnapshotBuilder } from "../replay/builders/sor-snapshot-builder.js";
import type { PerformanceGuardrailConfig } from "../../guardrails/guardrail-config.js";
import type { IGuardrailEvaluator } from "../../guardrails/guardrail-evaluator.js";
import type { IDegradationManager } from "../../guardrails/degradation-manager.js";
import {
  evaluatePlanningGuardrails,
  type GuardrailEnforcementMode,
  type IReplayWriteFailureStatsSource
} from "../../guardrails/planning-guardrail-helper.js";
import type { IPhase3AGuardrailShadowResolver } from "../../guardrails/phase3a-guardrail-shadow.js";
import { pairKey } from "../rfq-engine/resolution-risk-read-service.js";
import {
  isInternalCrossShadowSampled,
  isInternalCrossShadowWindowActive
} from "../internal-engine/runtime-controls.js";
import {
  decisionFromEquivalenceClass,
  getResolutionProfileId,
  resolutionRiskCandidatePairKey,
  type ResolutionRiskRoutingDecision
} from "./resolution-risk-routing-policy.js";

const DEFAULT_MIN_CHUNK = 0.000001;
const DEFAULT_TICK_SIZE = 0.000001;

export class MissingReservationTokenError extends Error {
  public constructor() {
    super("Reservation token missing in canonical RFQ metadata.");
    this.name = "MissingReservationTokenError";
  }
}

export interface OrderRouterDependencies {
  routeScout: IRouteScout;
  costModel: ICostModel;
  splitter: ISplitter;
  planComposer: IPlanComposer;
  internalEngine: Pick<InternalCrossingEngine, "attemptCross" | "previewCross">;
  logger: Pick<import("pino").Logger, "info" | "warn" | "error">;
  internalCrossingEnabled?: boolean;
  internalCrossingShadowEnabled?: boolean;
  internalCrossingShadowPercent?: number;
  internalCrossingShadowStartAt?: string;
  internalCrossingShadowEndAt?: string;
  isKillSwitchActive?: () => Promise<boolean>;
  resolutionRiskReadService?: IResolutionRiskReadService;
  resolutionRiskPolicyService?: IResolutionRiskPolicyService;
  resolutionRiskPenalty?: number;
  now?: () => Date;
  replayDecisionCaptureService?: IReplayDecisionCaptureService;
  replayCaptureConfig?: ReplayCaptureConfig;
  guardrailConfig?: PerformanceGuardrailConfig;
  guardrailEvaluator?: IGuardrailEvaluator;
  degradationManager?: IDegradationManager;
  replayWriteFailureStatsSource?: IReplayWriteFailureStatsSource;
  controlPlaneShardId?: string;
  guardrailEnforcementMode?: GuardrailEnforcementMode;
  phase3AGuardrailShadowResolver?: IPhase3AGuardrailShadowResolver;
}


const isEnforcedGuardrailDecision = (
  decision:
    | Awaited<ReturnType<OrderRouter["evaluateSorGuardrails"]>>
    | null
    | undefined,
): boolean => decision?.enforcementMode === "ENFORCED";
export class OrderRouter implements IOrderRouter {
  private readonly replaySnapshotBuilder = new SORSnapshotBuilder();
  public constructor(private readonly deps: OrderRouterDependencies) { }

  public async buildPlan(
    rfq: CanonicalRFQInput,
    selectedQuote: SelectedQuoteInput,
    policy: SORAcceptancePolicy
  ): Promise<OrderRouterBuildResult> {
    return withSpan(
      "sor.build_plan",
      {
        rfq_id: rfq.rfqId,
        acceptance_policy: policy,
        state: "BUILDING"
      },
      async () => {
        const startedAt = performance.now();
        const reservationToken = this.readReservationToken(rfq);
        const internalCrossOrder = this.buildInternalTakerOrder(rfq, selectedQuote);
        const crossResult = await this.evaluateInternalCross(rfq, internalCrossOrder);

        if (crossResult.kind === "internal_filled") {
          const internalFilledResult = {
            kind: "internal_filled" as const,
            filledSize: crossResult.filledSize,
            trades: crossResult.trades
          };
          await this.captureReplayDecision({
            rfqId: rfq.rfqId,
            rfq,
            selectedQuote,
            policy,
            routeCandidates: [],
            scoredCandidates: [],
            allocations: [],
            resolutionRiskPairPolicies: [],
            candidateOrdering: [],
            splitEligibilityDecisions: [],
            buildResult: internalFilledResult
          });
          return {
            kind: "internal_filled",
            filledSize: crossResult.filledSize,
            trades: crossResult.trades
          };
        }

        const residualRFQ = this.buildResidualRFQ(rfq, crossResult.remainingSize);
        const residualQuote = this.buildResidualQuote(selectedQuote, Number.parseFloat(crossResult.remainingSize));
        const preflightGuardrailDecision = await this.evaluateSorGuardrails({
          rfq,
          bucketEntityCount: 0,
          candidateGroups: 0,
          plannerLatencyMs: 0,
          reasonSuffix: "preflight"
        });
        const allCandidates = await this.deps.routeScout.discoverCandidates(residualRFQ, residualQuote, policy);

        const routeCandidates = this.filterSTPViolations(residualRFQ, allCandidates);

        if (routeCandidates.length === 0) {
          throw new InsufficientLiquidityError("00000000-0000-0000-0000-000000000000", residualQuote.quantity);
        }

        const scoredCandidates = await this.deps.costModel.evaluateCandidates(
          residualRFQ,
          routeCandidates,
          residualQuote,
          policy
        );
        sorCandidatesEvaluatedCount.labels(residualRFQ.rfqId).set(scoredCandidates.length);

        const postDiscoveryGuardrailDecision = await this.evaluateSorGuardrails({
          rfq,
          bucketEntityCount: routeCandidates.length,
          candidateGroups: scoredCandidates.length,
          plannerLatencyMs: performance.now() - startedAt,
          reasonSuffix: "post_discovery"
        });
        const enforcedPostDiscoveryMode =
          postDiscoveryGuardrailDecision && isEnforcedGuardrailDecision(postDiscoveryGuardrailDecision)
            ? postDiscoveryGuardrailDecision.effectiveMode
            : null;
        const enforcedPreflightMode =
          preflightGuardrailDecision && isEnforcedGuardrailDecision(preflightGuardrailDecision)
            ? preflightGuardrailDecision.effectiveMode
            : null;

        const activeGuardrailMode =
          enforcedPostDiscoveryMode ??
          enforcedPreflightMode ??
          "FULL_MODE";
        const allocationResult =
          activeGuardrailMode === "SOR_ONLY" || activeGuardrailMode === "SAFE_FALLBACK"
            ? await this.buildIsolatedAllocationsByLeg(
                rfq.rfqId,
                routeCandidates,
                scoredCandidates,
                residualQuote.quantity,
                policy
              )
            : await this.buildAllocationsByLeg(
                rfq.rfqId,
                routeCandidates,
                scoredCandidates,
                residualQuote.quantity,
                policy
              );
        const allocations = allocationResult.allocations;

        sorPlanBuildLatencyMs.labels(policy).observe(performance.now() - startedAt);
        const avgSplits = this.calculateAvgSplitsPerLeg(routeCandidates, allocations);
        sorAvgSplitsPerLeg.labels(residualRFQ.rfqId).set(avgSplits);

        const plan = await this.composePlan(residualRFQ, residualQuote, policy, scoredCandidates, allocations, {
          reservationToken,
          routeCandidates
        });

        const planCreatedResult = {
          kind: "plan_created" as const,
          crossingFilledSize: crossResult.crossingFilledSize,
          remainingSize: crossResult.remainingSize,
          plan
        };

        await this.captureReplayDecision({
          rfqId: rfq.rfqId,
          rfq: residualRFQ,
          selectedQuote: residualQuote,
          policy,
          routeCandidates: routeCandidates as readonly Record<string, unknown>[],
          scoredCandidates: scoredCandidates.map((candidate) => ({
            candidateId: candidate.candidateId,
            providerId: candidate.providerId,
            effectiveUnitCost: candidate.effectiveUnitCost,
            totalExpectedCost: candidate.totalExpectedCost,
            breakdown: candidate.breakdown as unknown as Record<string, unknown>
          })),
          allocations: allocations as unknown as readonly Record<string, unknown>[],
          resolutionRiskPairPolicies: allocationResult.resolutionRiskPairPolicies,
          candidateOrdering: routeCandidates.map((candidate) => candidate.id),
          splitEligibilityDecisions: allocationResult.splitEligibilityDecisions,
          buildResult: planCreatedResult as unknown as Record<string, unknown>
        });

        return {
          kind: "plan_created",
          crossingFilledSize: crossResult.crossingFilledSize,
          remainingSize: crossResult.remainingSize,
          plan
        };
      }
    );
  }

  private async evaluateSorGuardrails(input: {
    rfq: CanonicalRFQInput;
    bucketEntityCount: number;
    candidateGroups: number;
    plannerLatencyMs: number;
    reasonSuffix: string;
  }) {
    if (!this.deps.guardrailConfig || !this.deps.guardrailEvaluator || !this.deps.degradationManager) {
      return null;
    }

    const enforcementMode =
      this.deps.guardrailEnforcementMode ??
      (
        await this.deps.phase3AGuardrailShadowResolver?.resolve({
          engine: "SOR",
          shardId: this.deps.controlPlaneShardId ?? "sor-main",
          stableId: input.rfq.rfqId,
          marketId: input.rfq.canonicalMarketId,
        })
      )?.enforcementMode ??
      "ENFORCED";

    return evaluatePlanningGuardrails({
      guardrails: this.deps.guardrailConfig,
      stats: {
        plannerType: "SOR",
        plannerLatencyMs: input.plannerLatencyMs,
        bucketEntityCount: input.bucketEntityCount,
        graphEdges: 0,
        candidateGroups: input.candidateGroups,
        lockWaitMs: 0
      },
      context: {
        shardId: this.deps.controlPlaneShardId ?? "sor-main",
        engine: "SOR",
        marketId: input.rfq.canonicalMarketId
      },
      guardrailEvaluator: this.deps.guardrailEvaluator,
      degradationManager: this.deps.degradationManager,
      replayWriteFailureStatsSource: this.deps.replayWriteFailureStatsSource,
      logger: this.deps.logger,
      requestedBy: `sor:${input.reasonSuffix}`,
      enforcementMode
    });
  }


  public async evaluateCandidates(
    rfq: CanonicalRFQInput,
    selectedQuote: SelectedQuoteInput,
    policy: SORAcceptancePolicy
  ): Promise<readonly CandidateScore[]> {
    const allCandidates = await this.deps.routeScout.discoverCandidates(rfq, selectedQuote, policy);
    const candidates = this.filterSTPViolations(rfq, allCandidates);
    return this.deps.costModel.evaluateCandidates(rfq, candidates, selectedQuote, policy);
  }

  private filterSTPViolations(
    rfq: CanonicalRFQInput,
    candidates: readonly import("./types.js").RouteCandidate[]
  ): readonly import("./types.js").RouteCandidate[] {
    const stpMode = rfq.stpMode ?? "CANCEL_NEWEST";
    if (stpMode === "NONE") return candidates;

    return candidates.filter((candidate) => {
      // In this system, provider_id is the unique identifier for the LP/Venue
      // and takerId is the unique identifier for the user.
      // If they match, it's a potential self-trade.
      if (candidate.provider_id === rfq.takerId) {
        // Log STP event
        this.deps.logger.warn(
          {
            rfqId: rfq.rfqId,
            takerId: rfq.takerId,
            providerId: candidate.provider_id,
            stpMode
          },
          "Self-trade violation detected; filtering candidate."
        );
        return false;
      }
      return true;
    });
  }

  public async composePlan(
    rfq: CanonicalRFQInput,
    selectedQuote: SelectedQuoteInput,
    policy: SORAcceptancePolicy,
    scoredCandidates: readonly CandidateScore[],
    allocations: readonly SplitAllocation[],
    options?: {
      reservationToken?: string;
      routeCandidates?: readonly import("./types.js").RouteCandidate[];
    }
  ): Promise<ExecutionPlan> {
    const reservationToken = options?.reservationToken ?? this.readReservationToken(rfq);
    const routeCandidates =
      options?.routeCandidates ?? (await this.deps.routeScout.discoverCandidates(rfq, selectedQuote, policy));

    // The instruction implies idempotencyKey should be part of rfq,
    // so we pass the rfq object directly to the plan composer.
    // If CanonicalRFQInput is updated to include idempotencyKey, it will be available here.
    return this.deps.planComposer.composePlan(
      rfq,
      routeCandidates,
      scoredCandidates,
      allocations,
      policy
    );
  }

  private readReservationToken(rfq: CanonicalRFQInput): string {
    const token = rfq.metadata?.reservation_token;
    if (typeof token !== "string" || token.length === 0) {
      throw new MissingReservationTokenError();
    }
    return token;
  }

  private buildInternalTakerOrder(rfq: CanonicalRFQInput, selectedQuote: SelectedQuoteInput): InternalOrder {
    return {
      id: rfq.rfqId,
      user_id: rfq.takerId,
      market_id: rfq.canonicalMarketId,
      side: rfq.side,
      price: selectedQuote.price.toString(),
      initial_size: rfq.quantity,
      remaining_size: rfq.quantity,
      status: "OPEN",
      created_at: new Date(),
      updated_at: new Date()
    };
  }

  private buildResidualRFQ(rfq: CanonicalRFQInput, remainingSize: string): CanonicalRFQInput {
    const metadata = rfq.metadata ? { ...rfq.metadata } : undefined;
    const legs = metadata?.legs;
    if (Array.isArray(legs)) {
      const updatedLegs = legs.map((leg) => {
        if (typeof leg !== "object" || leg === null) {
          return leg;
        }
        return {
          ...leg,
          quantity: remainingSize,
          target_quantity: remainingSize
        };
      });
      if (metadata) {
        metadata.legs = updatedLegs;
      }
    }

    return {
      ...rfq,
      quantity: remainingSize,
      ...(metadata ? { metadata } : {})
    };
  }

  private buildResidualQuote(selectedQuote: SelectedQuoteInput, remainingSize: number): SelectedQuoteInput {
    return {
      ...selectedQuote,
      quantity: remainingSize
    };
  }

  private async evaluateInternalCross(
    rfq: CanonicalRFQInput,
    internalOrder: InternalOrder
  ): Promise<
    | { kind: "internal_filled"; filledSize: string; trades: readonly import("../internal-engine/types.js").Trade[] }
    | { kind: "external_only"; crossingFilledSize: string; remainingSize: string }
  > {
    const killSwitchActive = await (this.deps.isKillSwitchActive?.() ?? Promise.resolve(false));
    const shouldShadowEvaluate =
      !this.deps.internalCrossingEnabled &&
      isInternalCrossShadowWindowActive({
        enabled: this.deps.internalCrossingShadowEnabled ?? false,
        percent: this.deps.internalCrossingShadowPercent ?? 0,
        ...(this.deps.internalCrossingShadowStartAt ? { startAt: this.deps.internalCrossingShadowStartAt } : {}),
        ...(this.deps.internalCrossingShadowEndAt ? { endAt: this.deps.internalCrossingShadowEndAt } : {}),
        ...(this.deps.now ? { now: this.deps.now } : {})
      }) &&
      isInternalCrossShadowSampled(rfq.rfqId, this.deps.internalCrossingShadowPercent ?? 0);

    if (killSwitchActive) {
      internalCrossKillSwitchTotal.labels(this.deps.internalCrossingEnabled ? "authoritative" : "shadow").inc();
      sorInternalCrossResultTotal.labels("KILL_SWITCH").inc();
      internalCrossingTotal.inc({
        market_id: rfq.canonicalMarketId,
        side: rfq.side,
        status: "KILL_SWITCH"
      });
      if (shouldShadowEvaluate) {
        await this.evaluateShadowInternalCross(internalOrder);
      }
      return {
        kind: "external_only",
        crossingFilledSize: "0",
        remainingSize: internalOrder.remaining_size
      };
    }

    if (!this.deps.internalCrossingEnabled) {
      sorInternalCrossResultTotal.labels("DISABLED").inc();
      if (shouldShadowEvaluate) {
        await this.evaluateShadowInternalCross(internalOrder);
      }
      return {
        kind: "external_only",
        crossingFilledSize: "0",
        remainingSize: internalOrder.remaining_size
      };
    }

    const crossResult = await withSpan(
      "sor.internal_cross",
      {
        rfq_id: rfq.rfqId,
        state: "INTERNAL_CROSSING",
        market_id: rfq.canonicalMarketId
      },
      async () => this.deps.internalEngine.attemptCross(internalOrder)
    );

    const crossingFilledSize = crossResult.filledSize.toString();
    const remainingSize = crossResult.remainingSize.toString();
    const crossingStatus =
      crossResult.remainingSize <= 0 ? "FILLED" : crossResult.filledSize > 0 ? "PARTIAL" : "NONE";

    sorInternalCrossResultTotal.labels(crossingStatus).inc();
    internalCrossingTotal.inc({
      market_id: rfq.canonicalMarketId,
      side: rfq.side,
      status: crossingStatus
    });
    if (crossResult.filledSize > 0) {
      internalCrossingFilledSizeTotal.inc(
        { market_id: rfq.canonicalMarketId, side: rfq.side },
        crossResult.filledSize
      );
    }

    if (crossResult.remainingSize <= 0) {
      return {
        kind: "internal_filled",
        filledSize: crossingFilledSize,
        trades: crossResult.trades
      };
    }

    return {
      kind: "external_only",
      crossingFilledSize,
      remainingSize
    };
  }

  private async evaluateShadowInternalCross(internalOrder: InternalOrder): Promise<void> {
    const preview = await this.deps.internalEngine.previewCross(internalOrder);
    const status = this.readShadowStatus(preview);
    internalCrossShadowTotal.labels(status).inc();

    if (status === "NONE") {
      internalCrossShadowMatchTotal.labels("no_internal_liquidity").inc();
      return;
    }

    internalCrossShadowDivergenceTotal.labels(
      preview.wouldSelfTrade ? "self_trade" : "internal_liquidity_bypassed"
    ).inc();
  }

  private readShadowStatus(preview: InternalCrossPreviewResult): "NONE" | "PARTIAL" | "FILLED" | "SELF_TRADE" {
    if (preview.wouldSelfTrade) {
      return "SELF_TRADE";
    }
    if (preview.fillableSize <= 0) {
      return "NONE";
    }
    if (preview.remainingSize <= 0) {
      return "FILLED";
    }
    return "PARTIAL";
  }

  private async buildAllocationsByLeg(
    stableKey: string,
    routeCandidates: readonly import("./types.js").RouteCandidate[],
    scoredCandidates: readonly CandidateScore[],
    targetSize: number,
    policy: SORAcceptancePolicy
  ): Promise<{
    allocations: readonly SplitAllocation[];
    resolutionRiskPairPolicies: readonly Record<string, unknown>[];
    splitEligibilityDecisions: readonly ReplaySplitEligibilitySnapshot[];
  }> {
    const scoreByCandidateId = new Map(
      scoredCandidates.map((candidate) => [candidate.candidateId, candidate] as const)
    );
    const candidatesByLeg = new Map<string, import("./types.js").RouteCandidate[]>();
    for (const candidate of routeCandidates) {
      const existing = candidatesByLeg.get(candidate.leg_id);
      if (existing) {
        existing.push(candidate);
      } else {
        candidatesByLeg.set(candidate.leg_id, [candidate]);
      }
    }

    const allocations: SplitAllocation[] = [];
    const resolutionRiskPairPolicies: Record<string, unknown>[] = [];
    const splitEligibilityDecisions: ReplaySplitEligibilitySnapshot[] = [];
    for (const legCandidates of candidatesByLeg.values()) {
      const legScored = legCandidates
        .map((candidate) => scoreByCandidateId.get(candidate.id))
        .filter((candidate): candidate is CandidateScore => candidate !== undefined);

      if (legScored.length === 0) {
        throw new InsufficientLiquidityError(
          legCandidates[0]?.leg_id ?? "00000000-0000-0000-0000-000000000000",
          targetSize
        );
      }

      const perProviderCapacity: Record<string, number> = {};
      for (const candidate of legCandidates) {
        perProviderCapacity[candidate.provider_id] = candidate.available_size;
      }

      const resolutionRisk = await this.buildResolutionRiskContext(stableKey, legCandidates);
      if (resolutionRisk) {
        for (const [pairKeyValue, decision] of resolutionRisk.pairPolicies.entries()) {
          resolutionRiskPairPolicies.push({
            pairKey: pairKeyValue,
            ...decision
          });
          splitEligibilityDecisions.push({
            candidateId: pairKeyValue,
            allowed: decision.mode === "normal" || decision.mode === "penalty",
            reason: decision.reason ?? decision.mode,
            ...(decision.mode !== "normal" ? { pairKey: pairKeyValue } : {})
          });
        }
      }

      const splitResult = await this.deps.splitter.split(targetSize, legScored, {
        minChunkSize: DEFAULT_MIN_CHUNK,
        tickSize: DEFAULT_TICK_SIZE,
        perProviderCapacity,
        ...(resolutionRisk ? { resolutionRisk } : {})
      });

      const allocated = splitResult.reduce((total, split) => total + split.roundedSize, 0);
      if (policy === "ALL_OR_NONE" && allocated + 1e-9 < targetSize) {
        throw new InsufficientLiquidityError(
          legCandidates[0]?.leg_id ?? "00000000-0000-0000-0000-000000000000",
          targetSize - allocated
        );
      }

      allocations.push(...splitResult);
    }

    return {
      allocations,
      resolutionRiskPairPolicies,
      splitEligibilityDecisions
    };
  }

  private async buildIsolatedAllocationsByLeg(
    stableKey: string,
    routeCandidates: readonly import("./types.js").RouteCandidate[],
    scoredCandidates: readonly CandidateScore[],
    targetSize: number,
    policy: SORAcceptancePolicy
  ): Promise<{
    allocations: readonly SplitAllocation[];
    resolutionRiskPairPolicies: readonly Record<string, unknown>[];
    splitEligibilityDecisions: readonly ReplaySplitEligibilitySnapshot[];
  }> {
    const candidatesByLeg = new Map<string, CandidateScore[]>();
    const routeCandidateById = new Map(routeCandidates.map((candidate) => [candidate.id, candidate] as const));

    for (const scored of scoredCandidates) {
      const routeCandidate = routeCandidateById.get(scored.candidateId);
      if (!routeCandidate) {
        continue;
      }
      const existing = candidatesByLeg.get(routeCandidate.leg_id);
      if (existing) {
        existing.push(scored);
      } else {
        candidatesByLeg.set(routeCandidate.leg_id, [scored]);
      }
    }

    const allocations: SplitAllocation[] = [];
    const resolutionRiskPairPolicies: Record<string, unknown>[] = [];
    const splitEligibilityDecisions: ReplaySplitEligibilitySnapshot[] = [];

    for (const [legId, legScores] of candidatesByLeg.entries()) {
      const best = [...legScores].sort((left, right) => {
        if (left.effectiveUnitCost !== right.effectiveUnitCost) {
          return left.effectiveUnitCost - right.effectiveUnitCost;
        }
        return left.candidateId.localeCompare(right.candidateId);
      })[0];

      if (!best) {
        throw new InsufficientLiquidityError(legId, targetSize);
      }

      const routeCandidate = routeCandidateById.get(best.candidateId);
      if (!routeCandidate) {
        throw new InsufficientLiquidityError(legId, targetSize);
      }

      const roundedSize = Math.min(targetSize, routeCandidate.available_size);
      if (policy === "ALL_OR_NONE" && roundedSize + 1e-9 < targetSize) {
        throw new InsufficientLiquidityError(legId, targetSize - roundedSize);
      }

      allocations.push({
        candidateId: best.candidateId,
        providerId: best.providerId,
        targetSize,
        roundedSize,
        targetPrice: best.effectiveUnitCost
      });
      splitEligibilityDecisions.push({
        candidateId: best.candidateId,
        allowed: true,
        reason: "guardrail_isolated_route"
      });
      resolutionRiskPairPolicies.push({
        pairKey: `${stableKey}:${best.candidateId}`,
        mode: "guardrail_isolated_route"
      });
    }

    if (allocations.length === 0) {
      throw new InsufficientLiquidityError(
        routeCandidates[0]?.leg_id ?? "00000000-0000-0000-0000-000000000000",
        targetSize
      );
    }

    return {
      allocations,
      resolutionRiskPairPolicies,
      splitEligibilityDecisions
    };
  }

  private async captureReplayDecision(input: {
    rfqId: string;
    rfq: Record<string, unknown>;
    selectedQuote: Record<string, unknown>;
    policy: string;
    routeCandidates: readonly Record<string, unknown>[];
    scoredCandidates: readonly import("../replay/replay.types.js").ReplayScoreBreakdownSnapshot[];
    allocations: readonly Record<string, unknown>[];
    resolutionRiskPairPolicies: readonly Record<string, unknown>[];
    candidateOrdering: readonly string[];
    splitEligibilityDecisions: readonly ReplaySplitEligibilitySnapshot[];
    buildResult: Record<string, unknown>;
  }): Promise<void> {
    if (!this.deps.replayDecisionCaptureService || !this.deps.replayCaptureConfig) {
      return;
    }

    await this.deps.replayDecisionCaptureService.capture({
      config: this.deps.replayCaptureConfig,
      buildEnvelope: (metadata) =>
        this.replaySnapshotBuilder.build({
          ...metadata,
          correlationId: input.rfqId,
          ...input
        })
    });
  }

  private async buildResolutionRiskContext(
    stableKey: string,
    candidates: readonly import("./types.js").RouteCandidate[]
  ): Promise<{ pairPolicies: ReadonlyMap<string, ResolutionRiskRoutingDecision> } | undefined> {
    if (candidates.length < 2) {
      return undefined;
    }

    const cautionPenalty = this.deps.resolutionRiskPenalty ?? 0.05;
    const pairPolicies = new Map<string, ResolutionRiskRoutingDecision>();
    const profilePairsToFetch: Array<{ profileAId: string; profileBId: string }> = [];

    for (let index = 0; index < candidates.length; index += 1) {
      for (let cursor = index + 1; cursor < candidates.length; cursor += 1) {
        const left = candidates[index]!;
        const right = candidates[cursor]!;
        const candidatePairKey = resolutionRiskCandidatePairKey(left.id, right.id);
        const leftProfileId = getResolutionProfileId(left);
        const rightProfileId = getResolutionProfileId(right);

        if (!leftProfileId || !rightProfileId) {
          const rawDecision = {
            mode: "isolated_only",
            penalty: 0,
            reason: "missing_resolution_profile_id"
          } satisfies ResolutionRiskRoutingDecision;
          pairPolicies.set(
            candidatePairKey,
            this.applyResolutionRiskPolicy(stableKey, rawDecision, {
              ...(leftProfileId ? { profileAId: leftProfileId } : {}),
              ...(rightProfileId ? { profileBId: rightProfileId } : {})
            })
          );
          continue;
        }

        if (leftProfileId === rightProfileId) {
          pairPolicies.set(candidatePairKey, {
            mode: "normal",
            penalty: 0,
            equivalenceClass: "SAFE_EQUIVALENT"
          });
          continue;
        }

        profilePairsToFetch.push({ profileAId: leftProfileId, profileBId: rightProfileId });
      }
    }

    const assessments = this.deps.resolutionRiskReadService
      ? await this.deps.resolutionRiskReadService.getAssessmentsByProfilePairs(profilePairsToFetch)
      : new Map();

    for (let index = 0; index < candidates.length; index += 1) {
      for (let cursor = index + 1; cursor < candidates.length; cursor += 1) {
        const left = candidates[index]!;
        const right = candidates[cursor]!;
        const candidatePairKey = resolutionRiskCandidatePairKey(left.id, right.id);
        if (pairPolicies.has(candidatePairKey)) {
          continue;
        }

        const leftProfileId = getResolutionProfileId(left);
        const rightProfileId = getResolutionProfileId(right);
        if (!leftProfileId || !rightProfileId) {
          const rawDecision = {
            mode: "isolated_only",
            penalty: 0,
            reason: "missing_resolution_profile_id"
          } satisfies ResolutionRiskRoutingDecision;
          pairPolicies.set(
            candidatePairKey,
            this.applyResolutionRiskPolicy(stableKey, rawDecision, {
              ...(leftProfileId ? { profileAId: leftProfileId } : {}),
              ...(rightProfileId ? { profileBId: rightProfileId } : {})
            })
          );
          continue;
        }

        const assessment = assessments.get(pairKey(leftProfileId, rightProfileId));
        if (!assessment) {
          const rawDecision = {
            mode: "isolated_only",
            penalty: 0,
            reason: this.deps.resolutionRiskReadService
              ? "missing_resolution_risk_assessment"
              : "resolution_risk_unavailable"
          } satisfies ResolutionRiskRoutingDecision;
          pairPolicies.set(
            candidatePairKey,
            this.applyResolutionRiskPolicy(stableKey, rawDecision, {
              profileAId: leftProfileId,
              profileBId: rightProfileId
            })
          );
          continue;
        }

        const rawDecision = decisionFromEquivalenceClass(assessment.equivalenceClass, cautionPenalty);
        pairPolicies.set(
          candidatePairKey,
          this.applyResolutionRiskPolicy(stableKey, rawDecision, {
            equivalenceClass: assessment.equivalenceClass,
            profileAId: leftProfileId,
            profileBId: rightProfileId
          })
        );
      }
    }

    return pairPolicies.size > 0 ? { pairPolicies } : undefined;
  }

  private applyResolutionRiskPolicy(
    stableKey: string,
    decision: ResolutionRiskRoutingDecision,
    context: {
      equivalenceClass?: import("../rfq-engine/resolution-risk.types.js").ResolutionEquivalenceClass;
      profileAId?: string;
      profileBId?: string;
    }
  ): ResolutionRiskRoutingDecision {
    if (!this.deps.resolutionRiskPolicyService) {
      return decision;
    }

    const comparison = this.deps.resolutionRiskPolicyService.evaluateSORDecision({
      stableKey,
      intendedDecision: decision.mode,
      reason: decision.reason ?? decision.mode,
      ...(context.equivalenceClass ? { equivalenceClass: context.equivalenceClass } : {}),
      ...(context.profileAId ? { profileAId: context.profileAId } : {}),
      ...(context.profileBId ? { profileBId: context.profileBId } : {})
    });

    if (comparison.enforcedDecision === "normal") {
      return {
        mode: "normal",
        penalty: 0
      };
    }

    if (comparison.enforcedDecision === "penalty") {
      return decision;
    }

    if (comparison.enforcedDecision === "blocked") {
      return {
        mode: "blocked",
        penalty: 0,
        ...(decision.reason ? { reason: decision.reason } : {}),
        ...(context.equivalenceClass ? { equivalenceClass: context.equivalenceClass } : {})
      };
    }

    return {
      mode: "isolated_only",
      penalty: 0,
      ...(decision.reason ? { reason: decision.reason } : {}),
      ...(context.equivalenceClass ? { equivalenceClass: context.equivalenceClass } : {})
    };
  }

  private calculateAvgSplitsPerLeg(
    candidates: readonly import("./types.js").RouteCandidate[],
    allocations: readonly SplitAllocation[]
  ): number {
    const legCount = new Set(candidates.map((candidate) => candidate.leg_id)).size;
    if (legCount === 0) {
      return 0;
    }
    return allocations.length / legCount;
  }
}
