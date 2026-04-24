import { getCryptoAthByDateAssetConfig } from "../../matching/crypto/crypto-ath-by-date-assets.js";

const config = getCryptoAthByDateAssetConfig("XRP");

export const CRYPTO_XRP_ATH_BY_DATE_ROLLOUT_STRATEGY_KEY = config.rolloutStrategyKey as typeof config.rolloutStrategyKey;
export const CRYPTO_XRP_ATH_BY_DATE_ROLLOUT_SCOPE_TYPE = config.rolloutScopeType as typeof config.rolloutScopeType;
export const cryptoXrpAthByDatePairLimitlessPolymarketLaneId = config.laneId as typeof config.laneId;
