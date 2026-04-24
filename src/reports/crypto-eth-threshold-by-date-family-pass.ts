import { getCryptoThresholdByDateAssetConfig } from "../matching/crypto/crypto-threshold-by-date-assets.js";
import { runCryptoThresholdByDateFamilyPass } from "./crypto-threshold-by-date-shared.js";

export const runCryptoEthThresholdByDateFamilyPass = async (input: { repoRoot: string }) =>
  runCryptoThresholdByDateFamilyPass({ repoRoot: input.repoRoot, config: getCryptoThresholdByDateAssetConfig("ETH") });
