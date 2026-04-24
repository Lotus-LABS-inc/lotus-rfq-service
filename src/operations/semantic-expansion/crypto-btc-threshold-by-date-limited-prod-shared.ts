import { getCryptoThresholdByDateAssetConfig } from "../../matching/crypto/crypto-threshold-by-date-assets.js";

const config = getCryptoThresholdByDateAssetConfig("BTC");

export const CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_ROLLOUT_STRATEGY_KEY = config.rolloutStrategyKey as typeof config.rolloutStrategyKey;
export const CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_ROLLOUT_SCOPE_TYPE = config.rolloutScopeType as typeof config.rolloutScopeType;
export const cryptoBtcThresholdByDateApr2026PairPolymarketPredictLaneId = config.laneId as typeof config.laneId;
export const cryptoBtcThresholdByDateApr2026LaneIds = [cryptoBtcThresholdByDateApr2026PairPolymarketPredictLaneId] as const;
export type CryptoBtcThresholdByDateApr2026LaneId = typeof cryptoBtcThresholdByDateApr2026LaneIds[number];
