import { createHash } from "node:crypto";

import type { RedisClient } from "../../db/redis.js";

const INTERNAL_NETTING_KILL_SWITCH_KEY = "internal_netting:kill_switch";

export interface InternalNettingRolloutWindowInput {
  enabled: boolean;
  percent: number;
  startAt?: string;
  endAt?: string;
  now?: () => Date;
}

export type InternalNettingPreviewOutcome = "full_net" | "partial_net" | "no_net";
export type InternalNettingShadowDimension = "netted_outcome" | "residual_leg_count";
export type InternalNettingShadowReason =
  | "different_netting_outcome"
  | "different_residual_size"
  | "error"
  | "kill_switch"
  | "disabled";

export interface InternalNettingShadowDecision {
  outcome: InternalNettingPreviewOutcome;
  residualLegCount: number;
  nettedSize: number;
}

export interface InternalNettingShadowComparison {
  match: boolean;
  dimension: InternalNettingShadowDimension;
  reason?: InternalNettingShadowReason;
}

const toUint32 = (hex: string): number => Number.parseInt(hex, 16) >>> 0;

export const isInternalNettingRolloutWindowActive = (
  input: InternalNettingRolloutWindowInput
): boolean => {
  if (!input.enabled || input.percent <= 0) {
    return false;
  }

  const now = (input.now ?? (() => new Date()))().getTime();

  if (input.startAt) {
    const start = Date.parse(input.startAt);
    if (Number.isFinite(start) && now < start) {
      return false;
    }
  }

  if (input.endAt) {
    const end = Date.parse(input.endAt);
    if (Number.isFinite(end) && now > end) {
      return false;
    }
  }

  return true;
};

export const isInternalNettingSampled = (stableId: string, percent: number): boolean => {
  if (percent <= 0) {
    return false;
  }
  if (percent >= 1) {
    return true;
  }

  const digest = createHash("sha256").update(stableId).digest("hex");
  const bucket = toUint32(digest.slice(0, 8)) / 0xffffffff;
  return bucket < percent;
};

export const compareInternalNettingShadowDecision = (
  authoritative: InternalNettingShadowDecision,
  shadow: InternalNettingShadowDecision
): InternalNettingShadowComparison => {
  if (authoritative.outcome !== shadow.outcome) {
    return {
      match: false,
      dimension: "netted_outcome",
      reason: "different_netting_outcome"
    };
  }

  if (authoritative.residualLegCount !== shadow.residualLegCount) {
    return {
      match: false,
      dimension: "residual_leg_count",
      reason: "different_residual_size"
    };
  }

  return {
    match: true,
    dimension: "netted_outcome"
  };
};

export const isInternalNettingKillSwitchActive = async (
  redis: Pick<RedisClient, "get">
): Promise<boolean> => {
  const value = await redis.get(INTERNAL_NETTING_KILL_SWITCH_KEY);
  if (value === null) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on" || normalized === "enabled";
};
