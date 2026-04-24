export type CryptoThresholdByDateAsset = "BTC" | "ETH" | "SOL" | "BNB";

export interface CryptoThresholdByDateAssetConfig {
  asset: CryptoThresholdByDateAsset;
  displayName: string;
  artifactKey: string;
  familyKey: string;
  monthEndDateKey: "2026-04-30";
  decisionPrefix: string;
  rolloutStrategyKey: string;
  rolloutScopeType: string;
  laneId: string;
  polymarketEventUrl: string;
  polymarketEventSlug: string;
  predictCategorySlug: string;
}

const configs = {
  BTC: {
    asset: "BTC",
    displayName: "Bitcoin",
    artifactKey: "btc-threshold-by-date-apr-2026",
    familyKey: "CRYPTO|THRESHOLD_BY_DATE|BTC|2026-04-30",
    monthEndDateKey: "2026-04-30",
    decisionPrefix: "CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026",
    rolloutStrategyKey: "crypto-btc-threshold-by-date-apr-2026-rollout-v1",
    rolloutScopeType: "CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_LANE",
    laneId: "CRYPTO_BTC_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT",
    polymarketEventUrl: "https://polymarket.com/event/what-price-will-bitcoin-hit-in-april-2026",
    polymarketEventSlug: "what-price-will-bitcoin-hit-in-april-2026",
    predictCategorySlug: "what-price-will-bitcoin-hit-in-april-2026"
  },
  ETH: {
    asset: "ETH",
    displayName: "Ethereum",
    artifactKey: "eth-threshold-by-date-apr-2026",
    familyKey: "CRYPTO|THRESHOLD_BY_DATE|ETH|2026-04-30",
    monthEndDateKey: "2026-04-30",
    decisionPrefix: "CRYPTO_ETH_THRESHOLD_BY_DATE_APR_2026",
    rolloutStrategyKey: "crypto-eth-threshold-by-date-apr-2026-rollout-v1",
    rolloutScopeType: "CRYPTO_ETH_THRESHOLD_BY_DATE_APR_2026_LANE",
    laneId: "CRYPTO_ETH_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT",
    polymarketEventUrl: "https://polymarket.com/event/what-price-will-ethereum-hit-in-april-2026",
    polymarketEventSlug: "what-price-will-ethereum-hit-in-april-2026",
    predictCategorySlug: "what-price-will-ethereum-hit-in-april-2026"
  },
  SOL: {
    asset: "SOL",
    displayName: "Solana",
    artifactKey: "sol-threshold-by-date-apr-2026",
    familyKey: "CRYPTO|THRESHOLD_BY_DATE|SOL|2026-04-30",
    monthEndDateKey: "2026-04-30",
    decisionPrefix: "CRYPTO_SOL_THRESHOLD_BY_DATE_APR_2026",
    rolloutStrategyKey: "crypto-sol-threshold-by-date-apr-2026-rollout-v1",
    rolloutScopeType: "CRYPTO_SOL_THRESHOLD_BY_DATE_APR_2026_LANE",
    laneId: "CRYPTO_SOL_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT",
    polymarketEventUrl: "https://polymarket.com/event/what-price-will-solana-hit-in-april-2026",
    polymarketEventSlug: "what-price-will-solana-hit-in-april-2026",
    predictCategorySlug: "what-price-will-solana-hit-in-april-2026"
  },
  BNB: {
    asset: "BNB",
    displayName: "BNB",
    artifactKey: "bnb-threshold-by-date-apr-2026",
    familyKey: "CRYPTO|THRESHOLD_BY_DATE|BNB|2026-04-30",
    monthEndDateKey: "2026-04-30",
    decisionPrefix: "CRYPTO_BNB_THRESHOLD_BY_DATE_APR_2026",
    rolloutStrategyKey: "crypto-bnb-threshold-by-date-apr-2026-rollout-v1",
    rolloutScopeType: "CRYPTO_BNB_THRESHOLD_BY_DATE_APR_2026_LANE",
    laneId: "CRYPTO_BNB_THRESHOLD_BY_DATE_APR_2026_PAIR_POLYMARKET_PREDICT",
    polymarketEventUrl: "https://polymarket.com/event/what-price-will-bnb-hit-in-april",
    polymarketEventSlug: "what-price-will-bnb-hit-in-april",
    predictCategorySlug: "what-price-will-bnb-hit-in-april"
  }
} satisfies Record<CryptoThresholdByDateAsset, CryptoThresholdByDateAssetConfig>;

export const cryptoThresholdByDateAssetConfigs = Object.values(configs);

export const getCryptoThresholdByDateAssetConfig = (
  asset: CryptoThresholdByDateAsset
): CryptoThresholdByDateAssetConfig => configs[asset];
