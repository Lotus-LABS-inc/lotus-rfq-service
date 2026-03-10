import Decimal from "decimal.js";

import type {
  ComboNettingExposureAggregationInput,
  ComboNettingExposureAggregationResult,
  ComboNettingPerLegExposureDelta
} from "./types.js";
import { calculateExposureDelta } from "../internal-engine/risk-utils.js";

export function aggregateNettingExposureDeltas(
  input: ComboNettingExposureAggregationInput
): ComboNettingExposureAggregationResult {
  let userALoss = new Decimal(0);
  let userAGain = new Decimal(0);
  let userBLoss = new Decimal(0);
  let userBGain = new Decimal(0);

  const userAPerLeg: ComboNettingPerLegExposureDelta[] = [];
  const userBPerLeg: ComboNettingPerLegExposureDelta[] = [];

  for (const leg of input.matchedLegs) {
    const incomingDelta = calculateExposureDelta(leg.incomingSide, leg.price, leg.matchedSize);
    const candidateDelta = calculateExposureDelta(leg.candidateSide, leg.price, leg.matchedSize);

    userALoss = userALoss.plus(incomingDelta.maxLossDelta);
    userAGain = userAGain.plus(incomingDelta.maxGainDelta);
    userBLoss = userBLoss.plus(candidateDelta.maxLossDelta);
    userBGain = userBGain.plus(candidateDelta.maxGainDelta);

    userAPerLeg.push({
      legId: leg.incomingLegId,
      marketId: leg.marketId,
      outcomeId: leg.outcomeId,
      side: leg.incomingSide,
      price: leg.price,
      matchedSize: leg.matchedSize,
      maxLossDelta: incomingDelta.maxLossDelta,
      maxGainDelta: incomingDelta.maxGainDelta
    });
    userBPerLeg.push({
      legId: leg.candidateLegId,
      marketId: leg.marketId,
      outcomeId: leg.outcomeId,
      side: leg.candidateSide,
      price: leg.price,
      matchedSize: leg.matchedSize,
      maxLossDelta: candidateDelta.maxLossDelta,
      maxGainDelta: candidateDelta.maxGainDelta
    });
  }

  return {
    userA: {
      maxLossDelta: userALoss.toDecimalPlaces(8).toString(),
      maxGainDelta: userAGain.toDecimalPlaces(8).toString(),
      perLeg: userAPerLeg
    },
    userB: {
      maxLossDelta: userBLoss.toDecimalPlaces(8).toString(),
      maxGainDelta: userBGain.toDecimalPlaces(8).toString(),
      perLeg: userBPerLeg
    }
  };
}
