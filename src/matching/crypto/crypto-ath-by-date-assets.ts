export type CryptoAthByDateAsset = "BTC" | "ETH" | "SOL" | "XRP";

export interface CryptoAthByDateAssetConfig {
  asset: CryptoAthByDateAsset;
  displayName: string;
  artifactKey: string;
  familyKey: string;
  decisionPrefix: string;
  rolloutStrategyKey: string;
  rolloutScopeType: string;
  laneId: string;
  polymarketEventUrl: string;
  polymarketSlugPrefix: string;
  limitlessMarketUrl: string;
}

const configs = {
  BTC: {
    asset: "BTC",
    displayName: "Bitcoin",
    artifactKey: "btc-ath-by-date",
    familyKey: "CRYPTO|ATH_BY_DATE|BTC",
    decisionPrefix: "CRYPTO_BTC_ATH_BY_DATE",
    rolloutStrategyKey: "crypto-btc-ath-by-date-rollout-v1",
    rolloutScopeType: "CRYPTO_BTC_ATH_BY_DATE_LANE",
    laneId: "CRYPTO_BTC_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET",
    polymarketEventUrl: "https://polymarket.com/event/bitcoin-all-time-high-by",
    polymarketSlugPrefix: "bitcoin-all-time-high-by",
    limitlessMarketUrl: "https://limitless.exchange/markets/bitcoin-all-time-high-by-1775135445330?rv=7Q4JYY4UXP"
  },
  ETH: {
    asset: "ETH",
    displayName: "Ethereum",
    artifactKey: "eth-ath-by-date",
    familyKey: "CRYPTO|ATH_BY_DATE|ETH",
    decisionPrefix: "CRYPTO_ETH_ATH_BY_DATE",
    rolloutStrategyKey: "crypto-eth-ath-by-date-rollout-v1",
    rolloutScopeType: "CRYPTO_ETH_ATH_BY_DATE_LANE",
    laneId: "CRYPTO_ETH_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET",
    polymarketEventUrl: "https://polymarket.com/event/ethereum-all-time-high-by",
    polymarketSlugPrefix: "ethereum-all-time-high-by",
    limitlessMarketUrl: "https://limitless.exchange/markets/ethereum-all-time-high-by-1775136208587?rv=7Q4JYY4UXP"
  },
  SOL: {
    asset: "SOL",
    displayName: "Solana",
    artifactKey: "sol-ath-by-date",
    familyKey: "CRYPTO|ATH_BY_DATE|SOL",
    decisionPrefix: "CRYPTO_SOL_ATH_BY_DATE",
    rolloutStrategyKey: "crypto-sol-ath-by-date-rollout-v1",
    rolloutScopeType: "CRYPTO_SOL_ATH_BY_DATE_LANE",
    laneId: "CRYPTO_SOL_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET",
    polymarketEventUrl: "https://polymarket.com/event/solana-all-time-high-by",
    polymarketSlugPrefix: "solana-all-time-high-by",
    limitlessMarketUrl: "https://limitless.exchange/markets/solana-all-time-high-by-1775136694215?rv=7Q4JYY4UXP"
  },
  XRP: {
    asset: "XRP",
    displayName: "XRP",
    artifactKey: "xrp-ath-by-date",
    familyKey: "CRYPTO|ATH_BY_DATE|XRP",
    decisionPrefix: "CRYPTO_XRP_ATH_BY_DATE",
    rolloutStrategyKey: "crypto-xrp-ath-by-date-rollout-v1",
    rolloutScopeType: "CRYPTO_XRP_ATH_BY_DATE_LANE",
    laneId: "CRYPTO_XRP_ATH_BY_DATE_PAIR_LIMITLESS_POLYMARKET",
    polymarketEventUrl: "https://polymarket.com/event/xrp-all-time-high-by",
    polymarketSlugPrefix: "xrp-all-time-high-by",
    limitlessMarketUrl: "https://limitless.exchange/markets/xrp-all-time-high-by-1775137216905?rv=7Q4JYY4UXP"
  }
} satisfies Record<CryptoAthByDateAsset, CryptoAthByDateAssetConfig>;

export const cryptoAthByDateAssetConfigs = Object.values(configs);

export const getCryptoAthByDateAssetConfig = (
  asset: CryptoAthByDateAsset
): CryptoAthByDateAssetConfig => configs[asset];

export const FAMILY_DATE_LABELS = [
  "March 31, 2026",
  "June 30, 2026",
  "September 30, 2026",
  "December 31, 2026"
] as const;

export const FAMILY_DATE_LABEL_TO_KEY: Record<(typeof FAMILY_DATE_LABELS)[number], string> = {
  "March 31, 2026": "2026-03-31",
  "June 30, 2026": "2026-06-30",
  "September 30, 2026": "2026-09-30",
  "December 31, 2026": "2026-12-31"
};
