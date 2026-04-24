export type CryptoTokenLaunchByDateProject = "METAMASK" | "BASE";

export interface CryptoTokenLaunchByDateProjectConfig {
  project: CryptoTokenLaunchByDateProject;
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
  excludedDates: readonly string[];
}

const configs = {
  METAMASK: {
    project: "METAMASK",
    displayName: "MetaMask",
    artifactKey: "metamask-token-launch-by-date",
    familyKey: "CRYPTO|TOKEN_LAUNCH_BY_DATE|METAMASK",
    decisionPrefix: "CRYPTO_METAMASK_TOKEN_LAUNCH_BY_DATE",
    rolloutStrategyKey: "crypto-metamask-token-launch-by-date-rollout-v1",
    rolloutScopeType: "CRYPTO_METAMASK_TOKEN_LAUNCH_BY_DATE_LANE",
    laneId: "CRYPTO_METAMASK_TOKEN_LAUNCH_BY_DATE_PAIR_POLYMARKET_PREDICT",
    polymarketEventUrl: "https://polymarket.com/event/will-metamask-launch-a-token-in-2025",
    polymarketEventSlug: "will-metamask-launch-a-token-in-2025",
    predictCategorySlug: "will-metamask-launch-a-token-in-2025",
    opinionMarketSlug: "will-metamask-launch-a-token-by",
    excludedDates: []
  },
  BASE: {
    project: "BASE",
    displayName: "Base",
    artifactKey: "base-token-launch-by-date",
    familyKey: "CRYPTO|TOKEN_LAUNCH_BY_DATE|BASE",
    decisionPrefix: "CRYPTO_BASE_TOKEN_LAUNCH_BY_DATE",
    rolloutStrategyKey: "crypto-base-token-launch-by-date-rollout-v1",
    rolloutScopeType: "CRYPTO_BASE_TOKEN_LAUNCH_BY_DATE_LANE",
    laneId: "CRYPTO_BASE_TOKEN_LAUNCH_BY_DATE_PAIR_POLYMARKET_PREDICT",
    polymarketEventUrl: "https://polymarket.com/event/will-base-launch-a-token-in-2025-341",
    polymarketEventSlug: "will-base-launch-a-token-in-2025-341",
    predictCategorySlug: "will-base-launch-a-token-in-2026",
    opinionMarketSlug: "will-base-launch-a-token-by",
    excludedDates: ["2025-12-31"]
  }
} satisfies Record<CryptoTokenLaunchByDateProject, CryptoTokenLaunchByDateProjectConfig>;

export const cryptoTokenLaunchByDateProjectConfigs = Object.values(configs);

export const getCryptoTokenLaunchByDateProjectConfig = (
  project: CryptoTokenLaunchByDateProject
): CryptoTokenLaunchByDateProjectConfig => configs[project];
