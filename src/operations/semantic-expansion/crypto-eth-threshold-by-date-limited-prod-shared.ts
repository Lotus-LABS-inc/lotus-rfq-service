import { getCryptoThresholdByDateAssetConfig } from "../../matching/crypto/crypto-threshold-by-date-assets.js";

const config = getCryptoThresholdByDateAssetConfig("ETH");

export const CRYPTO_ETH_THRESHOLD_BY_DATE_APR_2026_ROLLOUT_STRATEGY_KEY = config.rolloutStrategyKey as typeof config.rolloutStrategyKey;
export const CRYPTO_ETH_THRESHOLD_BY_DATE_APR_2026_ROLLOUT_SCOPE_TYPE = config.rolloutScopeType as typeof config.rolloutScopeType;
export const cryptoEthThresholdByDateApr2026PairPolymarketPredictLaneId = config.laneId as typeof config.laneId;
export const cryptoEthThresholdByDateApr2026LaneIds = [cryptoEthThresholdByDateApr2026PairPolymarketPredictLaneId] as const;
export type CryptoEthThresholdByDateApr2026LaneId = typeof cryptoEthThresholdByDateApr2026LaneIds[number];
