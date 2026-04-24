export type CryptoFdvAfterLaunchProject = "EXTENDED" | "METAMASK" | "OPENSEA" | "REYA";

export interface CryptoFdvAfterLaunchProjectConfig {
  project: CryptoFdvAfterLaunchProject;
  displayName: string;
  artifactKey: string;
  familyKey: string;
  decisionPrefix: string;
  rolloutStrategyKey: string;
  rolloutScopeType: string;
  laneId: string;
  polymarketEventUrl: string;
  polymarketEventSlug: string;
  predictCategorySlug: string;
  opinionMarketSlug?: string;
}

const configs = {
  EXTENDED: {
    project: "EXTENDED",
    displayName: "Extended",
    artifactKey: "extended-fdv-one-day-after-launch",
    familyKey: "CRYPTO|FDV_THRESHOLD_AFTER_LAUNCH|EXTENDED|ONE_DAY_AFTER_LAUNCH",
    decisionPrefix: "CRYPTO_EXTENDED_FDV_ONE_DAY_AFTER_LAUNCH",
    rolloutStrategyKey: "crypto-extended-fdv-one-day-after-launch-rollout-v1",
    rolloutScopeType: "CRYPTO_EXTENDED_FDV_ONE_DAY_AFTER_LAUNCH_LANE",
    laneId: "CRYPTO_EXTENDED_FDV_ONE_DAY_AFTER_LAUNCH_PAIR_POLYMARKET_PREDICT",
    polymarketEventUrl: "https://polymarket.com/event/extended-fdv-above-one-day-after-launch",
    polymarketEventSlug: "extended-fdv-above-one-day-after-launch",
    predictCategorySlug: "extended-fdv-above-one-day-after-launch"
  },
  METAMASK: {
    project: "METAMASK",
    displayName: "MetaMask",
    artifactKey: "metamask-fdv-one-day-after-launch",
    familyKey: "CRYPTO|FDV_THRESHOLD_AFTER_LAUNCH|METAMASK|ONE_DAY_AFTER_LAUNCH",
    decisionPrefix: "CRYPTO_METAMASK_FDV_ONE_DAY_AFTER_LAUNCH",
    rolloutStrategyKey: "crypto-metamask-fdv-one-day-after-launch-rollout-v1",
    rolloutScopeType: "CRYPTO_METAMASK_FDV_ONE_DAY_AFTER_LAUNCH_LANE",
    laneId: "CRYPTO_METAMASK_FDV_ONE_DAY_AFTER_LAUNCH_PAIR_POLYMARKET_PREDICT",
    polymarketEventUrl: "https://polymarket.com/event/metamask-fdv-above-one-day-after-launch",
    polymarketEventSlug: "metamask-fdv-above-one-day-after-launch",
    predictCategorySlug: "metamask-fdv-above-one-day-after-launch",
    opinionMarketSlug: "metamask-fdv-above-one-day-after-launch"
  },
  OPENSEA: {
    project: "OPENSEA",
    displayName: "OpenSea",
    artifactKey: "opensea-fdv-one-day-after-launch",
    familyKey: "CRYPTO|FDV_THRESHOLD_AFTER_LAUNCH|OPENSEA|ONE_DAY_AFTER_LAUNCH",
    decisionPrefix: "CRYPTO_OPENSEA_FDV_ONE_DAY_AFTER_LAUNCH",
    rolloutStrategyKey: "crypto-opensea-fdv-one-day-after-launch-rollout-v1",
    rolloutScopeType: "CRYPTO_OPENSEA_FDV_ONE_DAY_AFTER_LAUNCH_LANE",
    laneId: "CRYPTO_OPENSEA_FDV_ONE_DAY_AFTER_LAUNCH_PAIR_POLYMARKET_PREDICT",
    polymarketEventUrl: "https://polymarket.com/event/opensea-fdv-above-one-day-after-launch",
    polymarketEventSlug: "opensea-fdv-above-one-day-after-launch",
    predictCategorySlug: "opensea-fdv-above-one-day-after-launch",
    opinionMarketSlug: "opensea-fdv-above-one-day-after-launch"
  },
  REYA: {
    project: "REYA",
    displayName: "Reya",
    artifactKey: "reya-fdv-one-day-after-launch",
    familyKey: "CRYPTO|FDV_THRESHOLD_AFTER_LAUNCH|REYA|ONE_DAY_AFTER_LAUNCH",
    decisionPrefix: "CRYPTO_REYA_FDV_ONE_DAY_AFTER_LAUNCH",
    rolloutStrategyKey: "crypto-reya-fdv-one-day-after-launch-rollout-v1",
    rolloutScopeType: "CRYPTO_REYA_FDV_ONE_DAY_AFTER_LAUNCH_LANE",
    laneId: "CRYPTO_REYA_FDV_ONE_DAY_AFTER_LAUNCH_PAIR_POLYMARKET_PREDICT",
    polymarketEventUrl: "https://polymarket.com/event/reya-fdv-above-one-day-after-launch",
    polymarketEventSlug: "reya-fdv-above-one-day-after-launch",
    predictCategorySlug: "reya-fdv-above-one-day-after-launch"
  }
} satisfies Record<CryptoFdvAfterLaunchProject, CryptoFdvAfterLaunchProjectConfig>;

export const cryptoFdvAfterLaunchProjectConfigs = Object.values(configs);

export const getCryptoFdvAfterLaunchProjectConfig = (
  project: CryptoFdvAfterLaunchProject
): CryptoFdvAfterLaunchProjectConfig => configs[project];
