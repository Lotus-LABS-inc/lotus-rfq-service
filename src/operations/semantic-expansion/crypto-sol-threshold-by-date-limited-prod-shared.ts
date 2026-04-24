import { getCryptoThresholdByDateAssetConfig } from "../../matching/crypto/crypto-threshold-by-date-assets.js";

const config = getCryptoThresholdByDateAssetConfig("SOL");

export const CRYPTO_SOL_THRESHOLD_BY_DATE_APR_2026_ROLLOUT_STRATEGY_KEY = config.rolloutStrategyKey as typeof config.rolloutStrategyKey;
export const CRYPTO_SOL_THRESHOLD_BY_DATE_APR_2026_ROLLOUT_SCOPE_TYPE = config.rolloutScopeType as typeof config.rolloutScopeType;
export const cryptoSolThresholdByDateApr2026PairPolymarketPredictLaneId = config.laneId as typeof config.laneId;
export const cryptoSolThresholdByDateApr2026LaneIds = [cryptoSolThresholdByDateApr2026PairPolymarketPredictLaneId] as const;
export type CryptoSolThresholdByDateApr2026LaneId = typeof cryptoSolThresholdByDateApr2026LaneIds[number];
