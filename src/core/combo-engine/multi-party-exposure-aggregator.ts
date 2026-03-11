import Decimal from "decimal.js";

import { calculateExposureDelta } from "../internal-engine/risk-utils.js";
import type {
  MultiPartyExposureAggregationInput,
  MultiPartyExposureAggregationLeg,
  MultiPartyExposureAggregationResult,
  MultiPartyParticipantExposureDelta,
  MultiPartyPerLegExposureDelta
} from "./types.js";

interface AggregationBucket {
  participantId: string;
  userId: string;
  maxLossDelta: InstanceType<typeof Decimal>;
  maxGainDelta: InstanceType<typeof Decimal>;
  perLegDeltas: MultiPartyPerLegExposureDelta[];
  seenLegIds: Set<string>;
}

export interface IMultiPartyExposureAggregator {
  aggregate(input: MultiPartyExposureAggregationInput): MultiPartyExposureAggregationResult;
}

export class MultiPartyExposureAggregator implements IMultiPartyExposureAggregator {
  public aggregate(input: MultiPartyExposureAggregationInput): MultiPartyExposureAggregationResult {
    if (input.matchedLegAllocations.length === 0) {
      return {
        participantExposureDeltas: []
      };
    }

    const buckets = new Map<string, AggregationBucket>();

    for (const allocation of input.matchedLegAllocations) {
      this.validateAllocation(allocation);

      const bucketKey = allocation.participantId;
      const existing = buckets.get(bucketKey);
      if (existing && existing.userId !== allocation.userId) {
        throw new Error("participant_user_mismatch");
      }

      const delta = calculateExposureDelta(allocation.side, allocation.price, allocation.matchedSize);
      const perLegDelta: MultiPartyPerLegExposureDelta = {
        legId: allocation.legId,
        marketId: allocation.marketId,
        outcomeId: allocation.outcomeId,
        side: allocation.side,
        price: allocation.price,
        matchedSize: allocation.matchedSize,
        maxLossDelta: delta.maxLossDelta,
        maxGainDelta: delta.maxGainDelta
      };

      if (existing) {
        if (existing.seenLegIds.has(allocation.legId)) {
          throw new Error("duplicate_participant_leg_allocation");
        }

        existing.seenLegIds.add(allocation.legId);
        existing.maxLossDelta = existing.maxLossDelta.plus(delta.maxLossDelta);
        existing.maxGainDelta = existing.maxGainDelta.plus(delta.maxGainDelta);
        existing.perLegDeltas.push(perLegDelta);
        continue;
      }

      buckets.set(bucketKey, {
        participantId: allocation.participantId,
        userId: allocation.userId,
        maxLossDelta: new Decimal(delta.maxLossDelta),
        maxGainDelta: new Decimal(delta.maxGainDelta),
        perLegDeltas: [perLegDelta],
        seenLegIds: new Set([allocation.legId])
      });
    }

    const participantExposureDeltas: MultiPartyParticipantExposureDelta[] = [...buckets.values()]
      .sort((left, right) => left.participantId.localeCompare(right.participantId))
      .map((bucket) => ({
        participantId: bucket.participantId,
        userId: bucket.userId,
        maxLossDelta: bucket.maxLossDelta.toDecimalPlaces(8).toString(),
        maxGainDelta: bucket.maxGainDelta.toDecimalPlaces(8).toString(),
        perLegDeltas: [...bucket.perLegDeltas].sort((left, right) => {
          const marketDiff = left.marketId.localeCompare(right.marketId);
          if (marketDiff !== 0) {
            return marketDiff;
          }

          const outcomeDiff = left.outcomeId.localeCompare(right.outcomeId);
          if (outcomeDiff !== 0) {
            return outcomeDiff;
          }

          return left.legId.localeCompare(right.legId);
        })
      }));

    return {
      participantExposureDeltas
    };
  }

  private validateAllocation(allocation: MultiPartyExposureAggregationLeg): void {
    if (allocation.participantId.trim().length === 0) {
      throw new Error("participant_id_required");
    }

    if (allocation.userId.trim().length === 0) {
      throw new Error("user_id_required");
    }

    if (allocation.legId.trim().length === 0) {
      throw new Error("leg_id_required");
    }

    if (allocation.marketId.trim().length === 0 || allocation.outcomeId.trim().length === 0) {
      throw new Error("market_outcome_required");
    }

    let size: InstanceType<typeof Decimal>;
    try {
      size = new Decimal(allocation.matchedSize);
    } catch {
      throw new Error("invalid_matched_size");
    }

    if (!size.isFinite()) {
      throw new Error("invalid_matched_size");
    }

    if (size.lt(0)) {
      throw new Error("negative_matched_size");
    }

    if (size.isZero()) {
      throw new Error("invalid_matched_size");
    }

    try {
      const price = new Decimal(allocation.price);
      if (!price.isFinite()) {
        throw new Error("invalid_price");
      }
    } catch {
      throw new Error("invalid_price");
    }
  }
}
