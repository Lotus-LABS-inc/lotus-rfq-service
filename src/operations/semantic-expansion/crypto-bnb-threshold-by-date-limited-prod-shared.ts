import { getCryptoThresholdByDateAssetConfig } from "../../matching/crypto/crypto-threshold-by-date-assets.js";

const config = getCryptoThresholdByDateAssetConfig("BNB");

export const CRYPTO_BNB_THRESHOLD_BY_DATE_APR_2026_ROLLOUT_STRATEGY_KEY = config.rolloutStrategyKey as typeof config.rolloutStrategyKey;
export const CRYPTO_BNB_THRESHOLD_BY_DATE_APR_2026_ROLLOUT_SCOPE_TYPE = config.rolloutScopeType as typeof config.rolloutScopeType;
export const cryptoBnbThresholdByDateApr2026PairPolymarketPredictLaneId = config.laneId as typeof config.laneId;
export const cryptoBnbThresholdByDateApr2026LaneIds = [cryptoBnbThresholdByDateApr2026PairPolymarketPredictLaneId] as const;
export type CryptoBnbThresholdByDateApr2026LaneId = typeof cryptoBnbThresholdByDateApr2026LaneIds[number];
