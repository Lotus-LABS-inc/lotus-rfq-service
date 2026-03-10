import { createHash } from "node:crypto";
import type { RedisClient } from "../../db/redis.js";

export const INTERNAL_CROSS_KILL_SWITCH_KEY = "internal_cross:kill_switch";

export interface InternalCrossShadowWindowInput {
  enabled: boolean;
  percent: number;
  startAt?: string;
  endAt?: string;
  now?: () => Date;
}

export const isInternalCrossShadowWindowActive = (
  input: InternalCrossShadowWindowInput
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

const toUint32 = (hex: string): number => Number.parseInt(hex, 16) >>> 0;

export const isInternalCrossShadowSampled = (stableId: string, percent: number): boolean => {
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

export const isInternalCrossKillSwitchActive = async (redis: RedisClient): Promise<boolean> => {
  const value = await redis.get(INTERNAL_CROSS_KILL_SWITCH_KEY);
  return value === "true" || value === "1" || value === "on";
};
