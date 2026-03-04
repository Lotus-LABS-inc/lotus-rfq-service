import Decimal from "decimal.js";
import { z } from "zod";
import { CostModel, type CostModelConfig } from "./cost-model.js";
import type { CandidateScore, ISplitter, RouteCandidate, SORAcceptancePolicy, SplitAllocation } from "./types.js";
import { withSpan } from "../../observability/tracing.js";

export const SplitLegSchema = z.object({
  leg_id: z.string().uuid(),
  target_size: z.number().positive()
});

export const SplitConstraintsSchema = z.object({
  min_chunk_size: z.number().positive(),
  tick_size: z.number().positive(),
  per_provider_capacity: z.record(z.string(), z.number().nonnegative())
});

export interface SplitLegInput {
  leg_id: string;
  target_size: number;
}

export interface SplitLegConstraints {
  min_chunk_size: number;
  tick_size: number;
  per_provider_capacity: Readonly<Record<string, number>>;
}

export interface Split {
  candidateId: string;
  size: number;
}

export interface SplitLegResult {
  splits: readonly Split[];
  fallbackCandidateIds: readonly string[];
  remainingSize: number;
}

export class InsufficientLiquidityError extends Error {
  public readonly reason = "insufficient_liquidity";

  public constructor(public readonly legId: string, public readonly remainingSize: number) {
    super(`Insufficient liquidity for leg ${legId}; remaining size ${remainingSize}`);
    this.name = "InsufficientLiquidityError";
  }
}

export class Splitter implements ISplitter {
  private readonly costModel: CostModel;

  public constructor(config?: Partial<CostModelConfig>) {
    this.costModel = new CostModel(config);
  }

  public splitLeg(
    leg: SplitLegInput,
    candidates: readonly RouteCandidate[],
    policy: SORAcceptancePolicy,
    constraints: SplitLegConstraints
  ): SplitLegResult {
    const parsedLeg = SplitLegSchema.parse(leg);
    const parsedConstraints = SplitConstraintsSchema.parse(constraints);

    const legCandidates = candidates.filter((candidate) => candidate.leg_id === parsedLeg.leg_id);
    const scoredCandidates = [...legCandidates].sort((left, right) => {
      const leftScore = this.normalizedScore(left, parsedConstraints.min_chunk_size);
      const rightScore = this.normalizedScore(right, parsedConstraints.min_chunk_size);
      if (leftScore.equals(rightScore)) {
        return left.id.localeCompare(right.id);
      }
      return leftScore.lessThan(rightScore) ? -1 : 1;
    });

    let remaining = new Decimal(parsedLeg.target_size);
    const splits: Split[] = [];
    const usedCandidateIds = new Set<string>();

    for (const candidate of scoredCandidates) {
      if (remaining.lessThanOrEqualTo(0)) {
        break;
      }

      const providerCapacity = new Decimal(
        parsedConstraints.per_provider_capacity[candidate.provider_id] ?? Number.MAX_SAFE_INTEGER
      );
      const available = Decimal.min(
        new Decimal(candidate.available_size),
        providerCapacity,
        remaining
      );

      const rounded = this.roundDownToTick(available, parsedConstraints.tick_size);
      if (rounded.lessThan(parsedConstraints.min_chunk_size)) {
        continue;
      }

      const allocation = Decimal.min(rounded, remaining);
      if (allocation.lessThan(parsedConstraints.min_chunk_size)) {
        continue;
      }

      splits.push({
        candidateId: candidate.id,
        size: allocation.toNumber()
      });

      usedCandidateIds.add(candidate.id);
      remaining = remaining.minus(allocation);
    }

    const remainingSize = remaining.greaterThan(0) ? remaining.toNumber() : 0;
    if (remainingSize > 0 && policy === "ALL_OR_NONE") {
      throw new InsufficientLiquidityError(parsedLeg.leg_id, remainingSize);
    }

    const fallbackCandidateIds = scoredCandidates
      .map((candidate) => candidate.id)
      .filter((candidateId) => !usedCandidateIds.has(candidateId));

    return {
      splits,
      fallbackCandidateIds,
      remainingSize
    };
  }

  public async split(
    targetSize: number,
    scoredCandidates: readonly CandidateScore[],
    options: {
      minChunkSize: number;
      tickSize: number;
      perProviderCapacity: Readonly<Record<string, number>>;
    }
  ): Promise<readonly SplitAllocation[]> {
    return withSpan(
      "sor.splitter",
      {
        rfq_id: "unknown",
        state: "SPLITTING"
      },
      async () => {
        const parsedOptions = z
          .object({
            minChunkSize: z.number().positive(),
            tickSize: z.number().positive(),
            perProviderCapacity: z.record(z.string(), z.number().nonnegative())
          })
          .parse(options);

        let remaining = new Decimal(targetSize);
        const allocations: SplitAllocation[] = [];
        const sorted = [...scoredCandidates].sort(
          (left, right) => left.totalExpectedCost - right.totalExpectedCost
        );

        for (const candidate of sorted) {
          if (remaining.lessThanOrEqualTo(0)) {
            break;
          }

          const providerCapacity = new Decimal(
            parsedOptions.perProviderCapacity[candidate.providerId] ?? Number.MAX_SAFE_INTEGER
          );
          const available = Decimal.min(providerCapacity, remaining);
          const rounded = this.roundDownToTick(available, parsedOptions.tickSize);
          if (rounded.lessThan(parsedOptions.minChunkSize)) {
            continue;
          }

          allocations.push({
            candidateId: candidate.candidateId,
            providerId: candidate.providerId,
            targetSize: rounded.toNumber(),
            roundedSize: rounded.toNumber(),
            targetPrice: candidate.effectiveUnitCost
          });
          remaining = remaining.minus(rounded);
        }

        return allocations;
      }
    );
  }

  private normalizedScore(
    candidate: RouteCandidate,
    minChunkSize: number
  ): InstanceType<typeof Decimal> {
    const fillProb = Math.max(candidate.fill_prob, 0);
    if (fillProb === 0) {
      return new Decimal(Number.MAX_SAFE_INTEGER);
    }

    const score = this.costModel.scoreCandidate(candidate, minChunkSize).total_score;
    return score.div(fillProb);
  }

  private roundDownToTick(
    value: InstanceType<typeof Decimal>,
    tickSize: number
  ): InstanceType<typeof Decimal> {
    const tick = new Decimal(tickSize);
    if (tick.lessThanOrEqualTo(0)) {
      return new Decimal(0);
    }
    return value.div(tick).floor().times(tick);
  }
}
