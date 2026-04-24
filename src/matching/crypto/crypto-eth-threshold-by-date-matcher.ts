import { getCryptoThresholdByDateAssetConfig } from "./crypto-threshold-by-date-assets.js";
import { buildCryptoThresholdByDateMatcherMaterialization } from "./crypto-threshold-by-date-shared.js";

const config = getCryptoThresholdByDateAssetConfig("ETH");

export const buildCryptoEthThresholdByDateMatcherMaterialization = (
  input: Omit<Parameters<typeof buildCryptoThresholdByDateMatcherMaterialization>[0], "config">
) =>
  buildCryptoThresholdByDateMatcherMaterialization({ ...input, config });
