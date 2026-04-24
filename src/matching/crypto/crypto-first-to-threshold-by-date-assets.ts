export type CryptoFirstToThresholdByDateAsset = "BTC" | "ETH" | "SOL" | "XRP";

export interface CryptoFirstToThresholdByDateAssetConfig {
  asset: CryptoFirstToThresholdByDateAsset;
  displayName: string;
  artifactKey: string;
  familyKey: string;
  lowerThreshold: string;
  higherThreshold: string;
  deadlineDateKey: "2027-01-01";
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
    artifactKey: "btc-first-to-threshold-by-date",
    familyKey: "CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|BTC|60000|80000|2027-01-01",
    lowerThreshold: "60000",
    higherThreshold: "80000",
    deadlineDateKey: "2027-01-01",
    decisionPrefix: "CRYPTO_BTC_FIRST_TO_THRESHOLD_BY_DATE",
    rolloutStrategyKey: "crypto-btc-first-to-threshold-by-date-rollout-v1",
    rolloutScopeType: "CRYPTO_BTC_FIRST_TO_THRESHOLD_BY_DATE_LANE",
    laneId: "CRYPTO_BTC_FIRST_TO_THRESHOLD_BY_DATE_PAIR_POLYMARKET_PREDICT",
    polymarketEventUrl: "https://polymarket.com/event/will-bitcoin-hit-60k-or-80k-first-965",
    polymarketEventSlug: "will-bitcoin-hit-60k-or-80k-first-965",
    predictCategorySlug: "will-bitcoin-hit-60k-or-80k-first-965"
  },
  ETH: {
    asset: "ETH",
    displayName: "Ethereum",
    artifactKey: "eth-first-to-threshold-by-date",
    familyKey: "CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|ETH|1000|3000|2027-01-01",
    lowerThreshold: "1000",
    higherThreshold: "3000",
    deadlineDateKey: "2027-01-01",
    decisionPrefix: "CRYPTO_ETH_FIRST_TO_THRESHOLD_BY_DATE",
    rolloutStrategyKey: "crypto-eth-first-to-threshold-by-date-rollout-v1",
    rolloutScopeType: "CRYPTO_ETH_FIRST_TO_THRESHOLD_BY_DATE_LANE",
    laneId: "CRYPTO_ETH_FIRST_TO_THRESHOLD_BY_DATE_PAIR_POLYMARKET_PREDICT",
    polymarketEventUrl: "https://polymarket.com/event/will-ethereum-hit-1k-or-3k-first",
    polymarketEventSlug: "will-ethereum-hit-1k-or-3k-first",
    predictCategorySlug: "will-ethereum-hit-1k-or-3k-first"
  },
  SOL: {
    asset: "SOL",
    displayName: "Solana",
    artifactKey: "sol-first-to-threshold-by-date",
    familyKey: "CRYPTO|FIRST_TO_THRESHOLD_BY_DATE|SOL|60|140|2027-01-01",
    lowerThreshold: "60",
    higherThreshold: "140",
    deadlineDateKey: "2027-01-01",
    decisionPrefix: "CRYPTO_SOL_FIRST_TO_THRESHOLD_BY_DATE",
    rolloutStrategyKey: "crypto-sol-first-to-threshold-by-date-rollout-v1",
    rolloutScopeType: "CRYPTO_SOL_FIRST_TO_THRESHOLD_BY_DATE_LANE",
    laneId: "CRYPTO_SOL_FIRST_TO_THRESHOLD_BY_DATE_PAIR_POLYMARKET_PREDICT",
    polymarketEventUrl: "https://polymarket.com/event/will-solana-hit-60-or-140-first",
    polymarketEventSlug: "will-solana-hit-60-or-140-first",
    predictCategorySlug: "will-solana-hit-60-or-140-first"
  }
} satisfies Record<Exclude<CryptoFirstToThresholdByDateAsset, "XRP">, CryptoFirstToThresholdByDateAssetConfig>;

export const cryptoFirstToThresholdByDateAssetConfigs = Object.values(configs);

export const getCryptoFirstToThresholdByDateAssetConfig = (
  asset: Exclude<CryptoFirstToThresholdByDateAsset, "XRP">
): CryptoFirstToThresholdByDateAssetConfig => configs[asset];
