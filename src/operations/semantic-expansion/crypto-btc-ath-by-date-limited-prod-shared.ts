import { getCryptoAthByDateAssetConfig } from "../../matching/crypto/crypto-ath-by-date-assets.js";

const config = getCryptoAthByDateAssetConfig("BTC");

export const CRYPTO_BTC_ATH_BY_DATE_ROLLOUT_STRATEGY_KEY =
  config.rolloutStrategyKey as typeof config.rolloutStrategyKey;
export const CRYPTO_BTC_ATH_BY_DATE_ROLLOUT_SCOPE_TYPE =
  config.rolloutScopeType as typeof config.rolloutScopeType;

export const cryptoBtcAthByDatePairLimitlessPolymarketLaneId =
  config.laneId as typeof config.laneId;

export const cryptoBtcAthByDateLaneIds = [
  cryptoBtcAthByDatePairLimitlessPolymarketLaneId
] as const;

export type CryptoBtcAthByDateLaneId =
  typeof cryptoBtcAthByDateLaneIds[number];
