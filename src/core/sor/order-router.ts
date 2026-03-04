import {
  type CanonicalRFQInput,
  type CandidateScore,
  type ExecutionPlan,
  type ICostModel,
  type IOrderRouter,
  type IPlanComposer,
  type IRouteScout,
  type ISplitter,
  type SORAcceptancePolicy,
  type SelectedQuoteInput,
  type SplitAllocation
} from "./types.js";
import { InsufficientLiquidityError } from "./splitter.js";
import { withSpan } from "../../observability/tracing.js";
import {
  sorAvgSplitsPerLeg,
  sorCandidatesEvaluatedCount,
  sorPlanBuildLatencyMs
} from "../../observability/metrics.js";

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
}

export class OrderRouter implements IOrderRouter {
  public constructor(private readonly deps: OrderRouterDependencies) {}

  public async buildPlan(
    rfq: CanonicalRFQInput,
    selectedQuote: SelectedQuoteInput,
    policy: SORAcceptancePolicy
  ): Promise<ExecutionPlan> {
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
        const routeCandidates = await this.deps.routeScout.discoverCandidates(rfq, selectedQuote, policy);
        if (routeCandidates.length === 0) {
          throw new InsufficientLiquidityError("00000000-0000-0000-0000-000000000000", selectedQuote.quantity);
        }

        const scoredCandidates = await this.evaluateCandidates(rfq, selectedQuote, policy);
        sorCandidatesEvaluatedCount.labels(rfq.rfqId).set(scoredCandidates.length);

        const allocations = await this.buildAllocationsByLeg(
          routeCandidates,
          scoredCandidates,
          selectedQuote.quantity,
          policy
        );

        sorPlanBuildLatencyMs.labels(policy).observe(performance.now() - startedAt);
        sorAvgSplitsPerLeg.labels(rfq.rfqId).set(this.calculateAvgSplitsPerLeg(routeCandidates, allocations));

        return this.composePlan(rfq, selectedQuote, policy, scoredCandidates, allocations, {
          reservationToken,
          routeCandidates
        });
      }
    );
  }

  public async evaluateCandidates(
    rfq: CanonicalRFQInput,
    selectedQuote: SelectedQuoteInput,
    policy: SORAcceptancePolicy
  ): Promise<readonly CandidateScore[]> {
    const candidates = await this.deps.routeScout.discoverCandidates(rfq, selectedQuote, policy);
    return this.deps.costModel.evaluateCandidates(rfq, candidates, selectedQuote, policy);
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

    return this.deps.planComposer.composePlan({
      rfq,
      selectedQuote,
      policy,
      reservationToken,
      createdBy: rfq.takerId,
      routeCandidates,
      scoredCandidates,
      allocations
    });
  }

  private readReservationToken(rfq: CanonicalRFQInput): string {
    const token = rfq.metadata?.reservation_token;
    if (typeof token !== "string" || token.length === 0) {
      throw new MissingReservationTokenError();
    }
    return token;
  }

  private async buildAllocationsByLeg(
    routeCandidates: readonly import("./types.js").RouteCandidate[],
    scoredCandidates: readonly CandidateScore[],
    targetSize: number,
    policy: SORAcceptancePolicy
  ): Promise<readonly SplitAllocation[]> {
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

      const splitResult = await this.deps.splitter.split(targetSize, legScored, {
        minChunkSize: DEFAULT_MIN_CHUNK,
        tickSize: DEFAULT_TICK_SIZE,
        perProviderCapacity: {}
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

    return allocations;
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
