import { createHash } from "node:crypto";

import type { RedisClient } from "../../db/redis.js";

export const INTERNAL_CLEARING_KILL_SWITCH_KEY = "internal_clearing:kill_switch";

export interface InternalClearingRolloutWindowInput {
  enabled: boolean;
  percent: number;
  startAt?: string;
  endAt?: string;
  now?: () => Date;
}

export type InternalClearingPreviewOutcome = "full_clear" | "partial_clear" | "no_clear";
export type InternalClearingShadowDimension = "clearing_outcome" | "residual_leg_count";
export type InternalClearingShadowReason =
  | "different_clearing_outcome"
  | "different_residual_size"
  | "error"
  | "kill_switch"
  | "disabled";

export interface InternalClearingShadowDecision {
  outcome: InternalClearingPreviewOutcome;
  residualLegCount: number;
  participantCount: number;
}

export interface InternalClearingShadowComparison {
  match: boolean;
  dimension: InternalClearingShadowDimension;
  reason?: InternalClearingShadowReason;
}

const toUint32 = (hex: string): number => Number.parseInt(hex, 16) >>> 0;

export const isInternalClearingRolloutWindowActive = (
  input: InternalClearingRolloutWindowInput
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

export const isInternalClearingSampled = (stableId: string, percent: number): boolean => {
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

export const compareInternalClearingShadowDecision = (
  authoritative: InternalClearingShadowDecision,
  shadow: InternalClearingShadowDecision
): InternalClearingShadowComparison => {
  if (authoritative.outcome !== shadow.outcome) {
    return {
      match: false,
      dimension: "clearing_outcome",
      reason: "different_clearing_outcome"
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
    dimension: "clearing_outcome"
  };
};

export const isInternalClearingKillSwitchActive = async (
  redis: Pick<RedisClient, "get">
): Promise<boolean> => {
  const value = await redis.get(INTERNAL_CLEARING_KILL_SWITCH_KEY);
  if (value === null) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on" || normalized === "enabled";
};
