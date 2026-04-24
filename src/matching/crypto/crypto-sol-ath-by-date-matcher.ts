import { getCryptoAthByDateAssetConfig } from "./crypto-ath-by-date-assets.js";
import { buildCryptoAthByDateMatcherMaterialization } from "./crypto-ath-by-date-shared.js";

const config = getCryptoAthByDateAssetConfig("SOL");

export const buildCryptoSolAthByDateMatcherMaterialization = (input: {
  normalizedTopics: readonly any[];
  comparabilitySummary: readonly any[];
}) => buildCryptoAthByDateMatcherMaterialization({
  config,
  ...input
});
