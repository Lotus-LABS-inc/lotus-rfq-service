import { getCryptoFirstToThresholdByDateAssetConfig } from "./crypto-first-to-threshold-by-date-assets.js";
import { buildCryptoFirstToThresholdByDateMatcherMaterialization } from "./crypto-first-to-threshold-by-date-shared.js";

const config = getCryptoFirstToThresholdByDateAssetConfig("SOL");

export const buildCryptoSolFirstToThresholdByDateMatcherMaterialization = (
  input: Omit<Parameters<typeof buildCryptoFirstToThresholdByDateMatcherMaterialization>[0], "config">
) =>
  buildCryptoFirstToThresholdByDateMatcherMaterialization({ ...input, config });
