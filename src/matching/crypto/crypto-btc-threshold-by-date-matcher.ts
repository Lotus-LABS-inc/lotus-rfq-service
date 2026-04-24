import { getCryptoThresholdByDateAssetConfig } from "./crypto-threshold-by-date-assets.js";
import { buildCryptoThresholdByDateMatcherMaterialization } from "./crypto-threshold-by-date-shared.js";

const config = getCryptoThresholdByDateAssetConfig("BTC");

export const buildCryptoBtcThresholdByDateMatcherMaterialization = (
  input: Omit<Parameters<typeof buildCryptoThresholdByDateMatcherMaterialization>[0], "config">
) =>
  buildCryptoThresholdByDateMatcherMaterialization({ ...input, config });
