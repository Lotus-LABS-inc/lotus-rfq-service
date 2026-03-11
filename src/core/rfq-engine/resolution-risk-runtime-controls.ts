import type { RedisClient } from "../../db/redis.js";

export const RESOLUTION_RISK_KILL_SWITCH_KEY = "resolution_risk:kill_switch";

export const isResolutionRiskKillSwitchActive = async (redis: RedisClient): Promise<boolean> => {
    const value = await redis.get(RESOLUTION_RISK_KILL_SWITCH_KEY);
    if (!value) {
        return false;
    }

    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "on" || normalized === "enabled";
};
